const {test} = require('node:test');
const assert = require('node:assert/strict');
const {Buffer} = require('node:buffer');
const {Readable, Writable} = require('node:stream');
const {EgressStatus} = require('@livekit/protocol');
const {createCloudinaryArchiver} = require('../src/cloudinaryArchive');
const {createRecordingService} = require('../src/recording');
const {D1Store, MemoryStore} = require('../src/recordingStore');

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

// A fake S3 / R2 client: hands out the file's bytes and remembers deletes
const fakeS3 = ({failGet = false} = {}) => ({
  sent: [],
  async send(command) {
    this.sent.push({name: command.constructor.name, input: command.input});
    if (command.constructor.name === 'GetObjectCommand') {
      if (failGet) {
        throw new Error('NoSuchKey');
      }
      return {Body: Readable.from([Buffer.from('ogg-bytes')])};
    }
    return {};
  },
});

// A fake Cloudinary: collects the upload options and the bytes it is sent
const fakeCloudinary = ({fail = false} = {}) => {
  const fake = {
    configured: null,
    uploads: [],
    config(settings) {
      fake.configured = settings;
    },
    uploader: {
      upload_stream(options, callback) {
        const chunks = [];
        const sink = new Writable({
          write(chunk, enc, done) {
            chunks.push(chunk);
            done();
          },
          final(done) {
            fake.uploads.push({options, body: Buffer.concat(chunks).toString()});
            if (fail) {
              callback(new Error('Invalid credentials'));
            } else {
              callback(null, {public_id: `${options.folder}/${options.public_id}`, bytes: 9, resource_type: 'video', type: options.type});
            }
            done();
          },
        });
        return sink;
      },
    },
  };
  return fake;
};

const ARGS = {bucket: 'staging-bucket', objectKey: 'recordings/2026/10/c1-1.ogg', callId: 'c1', sizeBytes: 9};

test('copies the recording to Cloudinary as a private file, then removes the R2 copy', async () => {
  const s3 = fakeS3();
  const cloudinary = fakeCloudinary();
  const archiver = createCloudinaryArchiver({env: ENV, s3, cloudinary});

  assert.equal(archiver.available, true);
  assert.deepEqual(cloudinary.configured, {cloud_name: 'demo-cloud', api_key: 'cl-key', api_secret: 'cl-secret', secure: true});

  const result = await archiver.archive(ARGS);
  assert.equal(result.ok, true);
  assert.match(result.publicId, /^atiyaherbs\/call-recordings\/c1-\d+$/);
  assert.equal(result.deliveryType, 'authenticated');
  assert.equal(result.resourceType, 'video');

  const [{options, body}] = cloudinary.uploads;
  assert.equal(options.resource_type, 'video'); // Cloudinary stores audio under "video"
  assert.equal(options.type, 'authenticated'); // not openable without a signed link
  assert.equal(options.folder, 'atiyaherbs/call-recordings');
  assert.equal(body, 'ogg-bytes');

  assert.deepEqual(
    s3.sent.map(c => [c.name, c.input.Bucket, c.input.Key]),
    [
      ['GetObjectCommand', 'staging-bucket', ARGS.objectKey],
      ['DeleteObjectCommand', 'staging-bucket', ARGS.objectKey],
    ],
  );
});

test('a failed Cloudinary upload leaves the file in R2 (nothing is lost)', async () => {
  const s3 = fakeS3();
  const archiver = createCloudinaryArchiver({env: ENV, s3, cloudinary: fakeCloudinary({fail: true})});
  const result = await archiver.archive(ARGS);
  assert.deepEqual(result, {ok: false, error: 'upload-failed'});
  assert.deepEqual(s3.sent.map(c => c.name), ['GetObjectCommand']); // no delete
});

test('a file the R2 copy cannot be read for is reported, and nothing is deleted', async () => {
  const s3 = fakeS3({failGet: true});
  const archiver = createCloudinaryArchiver({env: ENV, s3, cloudinary: fakeCloudinary()});
  assert.deepEqual(await archiver.archive(ARGS), {ok: false, error: 'upload-failed'});
  assert.deepEqual(s3.sent.map(c => c.name), ['GetObjectCommand']);
});

test('files over the free plan size limit are not sent to Cloudinary', async () => {
  const s3 = fakeS3();
  const cloudinary = fakeCloudinary();
  const archiver = createCloudinaryArchiver({env: {...ENV, CLOUDINARY_MAX_MB: '1'}, s3, cloudinary});
  assert.deepEqual(await archiver.archive({...ARGS, sizeBytes: 2 * 1024 * 1024}), {ok: false, error: 'too-large'});
  assert.equal(cloudinary.uploads.length, 0);
  assert.equal(s3.sent.length, 0);
});

test('Cloudinary\'s single CLOUDINARY_URL variable works too', () => {
  const cloudinary = fakeCloudinary();
  const archiver = createCloudinaryArchiver({
    env: {CLOUDINARY_URL: 'cloudinary://123456:s3cr3t@my-cloud'},
    s3: fakeS3(),
    cloudinary,
  });
  assert.equal(archiver.available, true);
  assert.deepEqual(cloudinary.configured, {cloud_name: 'my-cloud', api_key: '123456', api_secret: 's3cr3t', secure: true});
  // The unfilled placeholder from the Cloudinary page is not a real login
  assert.equal(createCloudinaryArchiver({env: {CLOUDINARY_URL: 'cloudinary://<your_api_key>:<your_api_secret>@my-cloud'}, cloudinary: fakeCloudinary()}).available, false);
});

test('without Cloudinary settings the archiver is off, and the R2 copy can be kept on request', async () => {
  assert.equal(createCloudinaryArchiver({env: {}, cloudinary: fakeCloudinary()}).available, false);

  const s3 = fakeS3();
  const archiver = createCloudinaryArchiver({env: {...ENV, RECORDING_KEEP_R2_COPY: 'true'}, s3, cloudinary: fakeCloudinary()});
  assert.equal((await archiver.archive(ARGS)).ok, true);
  assert.deepEqual(s3.sent.map(c => c.name), ['GetObjectCommand']); // kept
});

// ---- The whole path: recording finishes -> Cloudinary -> details saved ----

const finishedRecording = async (archiver) => {
  const store = new MemoryStore();
  const egress = {
    async startRoomCompositeEgress() {
      return {egressId: 'EG_1'};
    },
    async stopEgress() {},
    async listEgress() {
      return [{status: EgressStatus.EGRESS_COMPLETE, fileResults: [{size: 4096n, duration: 65_000_000_000n}]}];
    },
  };
  const service = createRecordingService({env: ENV, store, egress, archiver, livekitConfigured: true, sleepFn: async () => {}});
  const call = {id: 'c1', room: 'call-c1', caller: 'asha', callee: 'bilal'};
  assert.equal((await service.start(call, {requestedBy: 'asha', allowedBy: 'bilal'})).ok, true);
  await service.stopAndFinish('EG_1');
  return {store, service};
};

test('the finished recording is moved to Cloudinary and its details are saved', async () => {
  const s3 = fakeS3();
  const archiver = createCloudinaryArchiver({env: ENV, s3, cloudinary: fakeCloudinary()});
  const {store, service} = await finishedRecording(archiver);

  assert.equal(service.destination, 'cloudinary');
  const row = await store.get('EG_1');
  assert.equal(row.status, 'complete');
  assert.equal(row.destination, 'cloudinary');
  assert.match(row.cloudinary_public_id, /^atiyaherbs\/call-recordings\/c1-\d+$/);
  assert.equal(row.cloudinary_resource_type, 'video');
  assert.equal(row.cloudinary_delivery_type, 'authenticated');
  assert.equal(row.size_bytes, 9);
  assert.equal(row.duration_seconds, 65);
});

test('if Cloudinary fails, the recording stays in R2 and the row says so', async () => {
  const archiver = createCloudinaryArchiver({env: ENV, s3: fakeS3(), cloudinary: fakeCloudinary({fail: true})});
  const {store} = await finishedRecording(archiver);
  const row = await store.get('EG_1');
  assert.equal(row.status, 'complete');
  assert.equal(row.destination, 'r2');
  assert.match(row.error, /Cloudinary copy failed \(upload-failed\); the file is still in R2/);
  assert.equal(row.cloudinary_public_id, undefined);
});

test('without Cloudinary, recordings stay in R2 as before', async () => {
  const {store, service} = await finishedRecording(createCloudinaryArchiver({env: {...ENV, CLOUDINARY_CLOUD_NAME: ''}}));
  assert.equal(service.destination, 'r2');
  assert.equal((await store.get('EG_1')).destination, 'r2');
});

test('Cloudinary details are saved to D1 as parameters', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(JSON.parse(init.body));
    return {ok: true, status: 200, json: async () => ({success: true, result: [{results: []}]})};
  };
  const d1 = new D1Store({accountId: 'a', databaseId: 'd', apiToken: 't', fetchImpl});
  await d1.update('EG_1', {destination: 'cloudinary', cloudinary_public_id: 'x/y', cloudinary_delivery_type: 'authenticated'});
  assert.equal(
    calls[0].sql,
    'UPDATE call_recordings SET destination = ?, cloudinary_public_id = ?, cloudinary_delivery_type = ? WHERE id = ?',
  );
  assert.deepEqual(calls[0].params, ['cloudinary', 'x/y', 'authenticated', 'EG_1']);
});
