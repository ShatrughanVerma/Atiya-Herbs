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
