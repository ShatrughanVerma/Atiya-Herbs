const {test} = require('node:test');
const assert = require('node:assert/strict');
const {Buffer} = require('node:buffer');
const {Readable, Writable} = require('node:stream');
const {EgressStatus} = require('@livekit/protocol');
const {createCloudinaryArchiver} = require('../src/cloudinaryArchive');
const {createCompressor, audioArgs, videoArgs} = require('../src/compress');
const {createRecordingService} = require('../src/recording');
const {MemoryStore} = require('../src/recordingStore');

const ENV = {
  CLOUDINARY_CLOUD_NAME: 'demo-cloud',
  CLOUDINARY_API_KEY: 'cl-key',
  CLOUDINARY_API_SECRET: 'cl-secret',
  R2_ENDPOINT: 'https://acct.r2.cloudflarestorage.com',
  R2_ACCESS_KEY_ID: 'r2-key',
  R2_SECRET_ACCESS_KEY: 'r2-secret',
  R2_BUCKET: 'staging-bucket',
  LIVEKIT_URL: 'wss://example.livekit.cloud',
  RECORDING_POLL_MS: '1',
  RECORDING_POLL_ATTEMPTS: '3',
};

const collect = async stream => {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString();
};

// A stand-in for ffmpeg: a tiny Node program that upper-cases what it is sent, so the streaming, the exit codes
// and the "could not start" case can be tested without ffmpeg installed.
const UPPERCASE = ['-e', "process.stdin.on('data', d => process.stdout.write(d.toString().toUpperCase()))"];
const FAIL = ['-e', "process.stdin.resume(); process.stdin.on('end', () => { console.error('bad input'); process.exit(3); })"];

  test('ffmpeg arguments: mono Opus voice audio, small H.264 video, bitrate from settings', () => {
    const audio = audioArgs('24k');
    assert.ok(audio.includes('libopus'));
    assert.deepEqual(audio.slice(audio.indexOf('-ac'), audio.indexOf('-ac') + 2), ['-ac', '1']);
    assert.deepEqual(audio.slice(audio.indexOf('-b:a'), audio.indexOf('-b:a') + 2), ['-b:a', '24k']);
    assert.ok(audio.includes('pipe:0') && audio.includes('pipe:1')); // streams in and out, no temp files

    const video = videoArgs();
    assert.ok(video.includes('libx264') && video.some(a => a.includes('min(640,iw)')));

    const compressor = createCompressor({env: {RECORDING_AUDIO_BITRATE: '16k'}, spawn: (cmd, args) => assert.fail(`unexpected ${cmd} ${args}`)});
    assert.equal(compressor.enabled, true);
    assert.equal(createCompressor({env: {RECORDING_COMPRESS: 'false'}}).enabled, false);
  });

  test('streams a recording through the program and returns the result', async () => {
    const compressor = createCompressor({command: process.execPath, buildArgs: () => UPPERCASE});
    const {output, finished} = compressor.compress(Readable.from([Buffer.from('hello '), Buffer.from('world')]), 'audio');
    assert.equal(await collect(output), 'HELLO WORLD');
    await finished;
  });

  test('reports a program that ends with an error, with its message', async () => {
    const compressor = createCompressor({command: process.execPath, buildArgs: () => FAIL});
    const {output, finished} = compressor.compress(Readable.from([Buffer.from('x')]), 'audio');
    output.resume();
    await assert.rejects(finished, /exited with code 3: bad input/);
  });

  // The stand-in is given a real file path (not a pipe) and upper-cases its content, like ffmpeg reading a seekable MP4.
  const READ_FILE = file => ['-e', "process.stdout.write(require('fs').readFileSync(process.argv[1]).toString().toUpperCase())", file];

  test('a video is saved to a temporary file first, because ffmpeg cannot read an MP4 index from a pipe', async () => {
    let seenFile;
    const compressor = createCompressor({
      command: process.execPath,
      buildVideoArgs: file => {
        seenFile = file;
        return READ_FILE(file);
      },
    });
    const {output, finished} = compressor.compress(Readable.from([Buffer.from('mp4 '), Buffer.from('bytes')]), 'video');
    assert.equal(await collect(output), 'MP4 BYTES');
    await finished;
    assert.ok(seenFile && !seenFile.startsWith('pipe:'));
    assert.equal(require('node:fs').existsSync(seenFile), false); // temp file removed afterwards
  });

  test('a failed video compression is reported and its temporary file is removed', async () => {
    let seenFile;
    const compressor = createCompressor({
      command: process.execPath,
      buildVideoArgs: file => {
        seenFile = file;
        return ['-e', "console.error('moov atom not found'); process.exit(1)"];
      },
    });
    const {output, finished} = compressor.compress(Readable.from([Buffer.from('x')]), 'video');
    output.resume();
    await assert.rejects(finished, /exited with code 1: moov atom not found/);
    assert.equal(require('node:fs').existsSync(seenFile), false);
  });

  test('reports a program that is not installed, without crashing', async () => {
    const compressor = createCompressor({command: 'definitely-not-ffmpeg-xyz'});
    const {output, finished} = compressor.compress(Readable.from([Buffer.from('x')]), 'audio');
    output.resume();
    await assert.rejects(finished, /could not run definitely-not-ffmpeg-xyz/);
  });

// ---- The archiver with compression ----

const fakeS3 = () => ({
  sent: [],
  async send(command) {
    this.sent.push(command.constructor.name);
    if (command.constructor.name === 'GetObjectCommand') {
      return {Body: Readable.from([Buffer.from('ogg-bytes')])};
    }
    return {};
  },
});

const fakeCloudinary = () => {
  const fake = {
    uploads: [],
    destroyed: [],
    config() {},
    uploader: {
      async destroy(publicId) {
        fake.destroyed.push(publicId);
        return {result: 'ok'};
      },
      upload_stream(options, callback) {
        const chunks = [];
        return new Writable({
          write(chunk, enc, done) {
            chunks.push(chunk);
            done();
          },
          final(done) {
            const body = Buffer.concat(chunks).toString();
            fake.uploads.push({options, body});
            callback(null, {public_id: `${options.folder}/${options.public_id}`, bytes: body.length, resource_type: 'video', type: options.type});
            done();
          },
        });
      },
    },
  };
  return fake;
};

// A fake compressor with a chosen outcome: output is "<tag>:<original bytes>"
const fakeCompressor = ({fail = false} = {}) => ({
  enabled: true,
  modes: [],
  compress(input, mode) {
    this.modes.push(mode);
    const {PassThrough} = require('node:stream');
    const output = new PassThrough();
    const finished = new Promise((resolve, reject) => {
      collect(input).then(text => {
        output.end(`small:${text}`);
        setImmediate(() => (fail ? reject(new Error('ffmpeg crashed')) : resolve()));
      });
    });
    finished.catch(() => {});
    return {output, finished};
  },
});

const ARGS = {bucket: 'staging-bucket', objectKey: 'recordings/2026/11/c1-1.ogg', callId: 'c1', sizeBytes: 9};

test('stores the compressed recording and removes the R2 copy', async () => {
  const s3 = fakeS3();
  const cloudinary = fakeCloudinary();
  const compressor = fakeCompressor();
  const archiver = createCloudinaryArchiver({env: ENV, s3, cloudinary, compressor});

  const result = await archiver.archive(ARGS);
  assert.equal(result.ok, true);
  assert.equal(result.compressed, true);
  assert.equal(cloudinary.uploads[0].body, 'small:ogg-bytes'); // what was stored is the compressed version
  assert.deepEqual(compressor.modes, ['audio']);
  assert.deepEqual(s3.sent, ['GetObjectCommand', 'DeleteObjectCommand']);
  assert.deepEqual(cloudinary.destroyed, []);
});

test('if compression fails half-way, the incomplete upload is removed and the original is stored', async () => {
  const s3 = fakeS3();
  const cloudinary = fakeCloudinary();
  const archiver = createCloudinaryArchiver({env: ENV, s3, cloudinary, compressor: fakeCompressor({fail: true})});

  const result = await archiver.archive(ARGS);
  assert.equal(result.ok, true);
  assert.equal(result.compressed, false);
  assert.equal(cloudinary.destroyed.length, 1); // the half-finished compressed upload was deleted
  assert.match(cloudinary.destroyed[0], /^atiyaherbs\/call-recordings\/c1-/);
  assert.equal(cloudinary.uploads.at(-1).body, 'ogg-bytes'); // the untouched original
  assert.deepEqual(s3.sent, ['GetObjectCommand', 'GetObjectCommand', 'DeleteObjectCommand']);
});

// ---- Chunked (segmented) recordings ----

const PREFIX = 'recordings/2026/11/c1-1/';
const chunkedS3 = pieces => ({
  sent: [],
  deleted: [],
  async send(command) {
    const name = command.constructor.name;
    this.sent.push(name);
    if (name === 'ListObjectsV2Command') {
      return {Contents: Object.keys(pieces).map(Key => ({Key})), IsTruncated: false};
    }
    if (name === 'GetObjectCommand') {
      return {Body: Readable.from([Buffer.from(pieces[command.input.Key])])};
    }
    if (name === 'DeleteObjectsCommand') {
      this.deleted.push(...command.input.Delete.Objects.map(o => o.Key));
    }
    return {};
  },
});
const CHUNKED_ARGS = {bucket: 'staging-bucket', objectKey: `${PREFIX}playlist.m3u8`, callId: 'c1', mode: 'video'};
const joinWithMarker = (input, output) => require('node:fs').promises.readFile(input, 'utf8').then(text => require('node:fs').promises.writeFile(output, `MP4[${text}]`));

test('a chunked recording is joined in order into one file, uploaded once, and the folder is cleared', async () => {
  // keys are given out of order on purpose: the pieces must be joined by name, not by listing order
  const s3 = chunkedS3({[`${PREFIX}part_00002.ts`]: 'C', [`${PREFIX}playlist.m3u8`]: '#EXTM3U', [`${PREFIX}part_00000.ts`]: 'A', [`${PREFIX}part_00001.ts`]: 'B', [`${PREFIX}live.m3u8`]: '#EXTM3U'});
  const cloudinary = fakeCloudinary();
  const archiver = createCloudinaryArchiver({env: ENV, s3, cloudinary, remux: joinWithMarker});

  const result = await archiver.archive(CHUNKED_ARGS);
  assert.deepEqual([result.ok, result.pieces], [true, 3]);
  assert.equal(cloudinary.uploads.length, 1);
  assert.equal(cloudinary.uploads[0].body, 'MP4[ABC]');
  assert.equal(cloudinary.uploads[0].options.transformation, undefined); // already recorded small, nothing more to do
  assert.equal(s3.deleted.length, 5); // every piece and both playlists are removed afterwards
});

test('if joining into an MP4 fails, the joined stream is stored instead of losing the recording', async () => {
  const s3 = chunkedS3({[`${PREFIX}part_00000.ts`]: 'A', [`${PREFIX}part_00001.ts`]: 'B'});
  const cloudinary = fakeCloudinary();
  const logs = [];
  const archiver = createCloudinaryArchiver({env: ENV, s3, cloudinary, remux: async () => { throw new Error('ffmpeg missing'); }, log: m => logs.push(m)});

  const result = await archiver.archive(CHUNKED_ARGS);
  assert.equal(result.ok, true);
  assert.equal(cloudinary.uploads[0].body, 'AB');
  assert.match(logs[0], /could not join the recording pieces into an MP4 \(ffmpeg missing\)/);
});

test('a chunked recording with no pieces, or one that is too big, is reported and nothing is uploaded or deleted', async () => {
  const empty = chunkedS3({[`${PREFIX}playlist.m3u8`]: '#EXTM3U'});
  const cloudinary = fakeCloudinary();
  assert.deepEqual(await createCloudinaryArchiver({env: ENV, s3: empty, cloudinary, remux: joinWithMarker}).archive(CHUNKED_ARGS), {ok: false, error: 'no-segments'});

  const big = chunkedS3({[`${PREFIX}part_00000.ts`]: 'x'.repeat(2 * 1024 * 1024)});
  const result = await createCloudinaryArchiver({env: {...ENV, CLOUDINARY_MAX_MB: '1'}, s3: big, cloudinary, remux: joinWithMarker}).archive(CHUNKED_ARGS);
  assert.deepEqual(result, {ok: false, error: 'too-large'});
  assert.equal(cloudinary.uploads.length, 0);
  assert.deepEqual(big.deleted, []);
});

test('RECORDING_COMPRESS=cloudinary: a video is uploaded as it is with a Cloudinary incoming transformation, no ffmpeg', async () => {
  const cloudinary = fakeCloudinary();
  const env = {...ENV, RECORDING_COMPRESS: 'cloudinary'};
  const archiver = createCloudinaryArchiver({env, s3: fakeS3(), cloudinary, compressor: createCompressor({env, command: 'definitely-not-ffmpeg-xyz'})});

  assert.equal(archiver.compression, true);
  const result = await archiver.archive({...ARGS, mode: 'video'});
  assert.deepEqual([result.ok, result.compressed], [true, true]);
  assert.equal(cloudinary.uploads[0].body, 'ogg-bytes'); // sent untouched; Cloudinary shrinks it
  assert.deepEqual(cloudinary.uploads[0].options.transformation, [{width: 640, crop: 'limit', quality: 'auto:low', video_codec: 'h264'}]);
});

test('RECORDING_COMPRESS=cloudinary: audio is left alone, and a video falls back to the original if Cloudinary refuses the transformation', async () => {
  const env = {...ENV, RECORDING_COMPRESS: 'cloudinary'};
  const audioCloudinary = fakeCloudinary();
  const audio = createCloudinaryArchiver({env, s3: fakeS3(), cloudinary: audioCloudinary});
  const audioResult = await audio.archive({...ARGS, mode: 'audio'});
  assert.deepEqual([audioResult.ok, audioResult.compressed], [true, false]);
  assert.equal(audioCloudinary.uploads[0].options.transformation, undefined);

  const picky = fakeCloudinary();
  const realUpload = picky.uploader.upload_stream;
  picky.uploader.upload_stream = (options, callback) =>
    options.transformation ? new Writable({write: (c, e, done) => done(), final: done => { callback(new Error('invalid transformation')); done(); }}) : realUpload(options, callback);
  const logs = [];
  const video = createCloudinaryArchiver({env, s3: fakeS3(), cloudinary: picky, log: m => logs.push(m)});
  const videoResult = await video.archive({...ARGS, mode: 'video'});
  assert.deepEqual([videoResult.ok, videoResult.compressed], [true, false]);
  assert.match(logs[0], /Cloudinary could not compress the recording \(invalid transformation\)/);
});

test('without ffmpeg installed, the original recording is stored instead of losing it', async () => {
  const s3 = fakeS3();
  const cloudinary = fakeCloudinary();
  const compressor = createCompressor({env: ENV, command: 'definitely-not-ffmpeg-xyz'});
  const archiver = createCloudinaryArchiver({env: ENV, s3, cloudinary, compressor});

  const result = await archiver.archive(ARGS);
  assert.deepEqual([result.ok, result.compressed], [true, false]);
  assert.equal(cloudinary.uploads.at(-1).body, 'ogg-bytes');
});

test('a recording over the size limit is still tried when compression can make it fit', async () => {
  const cloudinary = fakeCloudinary();
  const archiver = createCloudinaryArchiver({
    env: {...ENV, CLOUDINARY_MAX_MB: '1'},
    s3: fakeS3(),
    cloudinary,
    compressor: fakeCompressor(),
  });
  const result = await archiver.archive({...ARGS, sizeBytes: 3 * 1024 * 1024});
  assert.deepEqual([result.ok, result.compressed], [true, true]);

  // ... but if compression fails too, the oversized original is not sent
  const stuck = createCloudinaryArchiver({
    env: {...ENV, CLOUDINARY_MAX_MB: '1'},
    s3: fakeS3(),
    cloudinary: fakeCloudinary(),
    compressor: fakeCompressor({fail: true}),
  });
  assert.deepEqual(await stuck.archive({...ARGS, sizeBytes: 3 * 1024 * 1024}), {ok: false, error: 'too-large'});
});

test('video recordings are compressed as video', async () => {
  const compressor = fakeCompressor();
  const archiver = createCloudinaryArchiver({env: ENV, s3: fakeS3(), cloudinary: fakeCloudinary(), compressor});
  await archiver.archive({...ARGS, mode: 'video'});
  assert.deepEqual(compressor.modes, ['video']);
});

// ---- The whole path, and the safety net ----

const makeService = ({archiver, store = new MemoryStore()}) => {
  const egress = {
    async startRoomCompositeEgress() {
      return {egressId: 'EG_1'};
    },
    async stopEgress() {},
    async listEgress() {
      return [{status: EgressStatus.EGRESS_COMPLETE, fileResults: [{size: 4096n, duration: 65_000_000_000n}]}];
    },
  };
  return {store, service: createRecordingService({env: ENV, store, egress, archiver, livekitConfigured: true, sleepFn: async () => {}})};
};
const CALL = {id: 'c1', room: 'call-c1', caller: 'asha', callee: 'bilal'};

test('when the call ends, the recording is compressed and stored, and the sizes are saved', async () => {
  const archiver = createCloudinaryArchiver({env: ENV, s3: fakeS3(), cloudinary: fakeCloudinary(), compressor: fakeCompressor()});
  const {store, service} = makeService({archiver});

  assert.equal(service.compression, true);
  await service.start(CALL, {requestedBy: 'asha', allowedBy: 'bilal'});
  await service.stopAndFinish('EG_1');

  const row = await store.get('EG_1');
  assert.equal(row.destination, 'cloudinary');
  assert.equal(row.compressed, 1);
  assert.equal(row.original_size_bytes, 4096);
  assert.equal(row.size_bytes, 'small:ogg-bytes'.length);
  assert.equal(row.error, null);
});

test('a recording left in R2 (for example after a restart) is moved by the sweep, once', async () => {
  const store = new MemoryStore();
  const first = makeService({archiver: createCloudinaryArchiver({env: ENV, s3: fakeS3(), cloudinary: fakeCloudinary({}), compressor: fakeCompressor()}), store});
  // Cloudinary is "down" at the time: the call ends but the copy fails
  const down = makeService({
    archiver: createCloudinaryArchiver({
      env: ENV,
      s3: {
        async send() {
          throw new Error('network down');
        },
      },
      cloudinary: fakeCloudinary(),
      compressor: fakeCompressor(),
    }),
    store,
  });
  await down.service.start(CALL, {requestedBy: 'asha', allowedBy: 'bilal'});
  await down.service.stopAndFinish('EG_1');
  const stuck = await store.get('EG_1');
  assert.equal(stuck.destination, 'r2');
  assert.match(stuck.error, /Cloudinary copy failed \(upload-failed\)/);
  assert.deepEqual(await store.listPendingArchive(), ['EG_1']);

  // later Cloudinary works again: the sweep finishes the job and does not repeat it
  assert.equal(await first.service.retryPendingArchives(), 1);
  const done = await store.get('EG_1');
  assert.deepEqual([done.destination, done.compressed, done.error], ['cloudinary', 1, null]);
  assert.equal(await first.service.retryPendingArchives(), 0);
});

test('the sweep skips recordings Cloudinary can never take, and does nothing without Cloudinary', async () => {
  const store = new MemoryStore();
  const now = new Date().toISOString();
  await store.insert({id: 'big', call_id: 'c', room: 'r', caller: 'x', callee: 'y', requested_by: 'x', allowed_by: 'y', consent_at: now, mode: 'audio', status: 'complete', destination: 'r2', error: 'Cloudinary copy failed (too-large); the file is still in R2', created_at: now});
  assert.deepEqual(await store.listPendingArchive(), []);

  const off = makeService({archiver: createCloudinaryArchiver({env: {}, cloudinary: fakeCloudinary()}), store});
  assert.equal(await off.service.retryPendingArchives(), 0);
});
