const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createStagingArchiver} = require('../src/stagingArchiver');
const {createRecordingService} = require('../src/recording');
const {MemoryStore} = require('../src/recordingStore');

test('staging mode is on only with RECORDING_ARCHIVE=staging', () => {
  assert.equal(createStagingArchiver({env: {}}).available, false);
  assert.equal(createStagingArchiver({env: {RECORDING_ARCHIVE: 'staging'}}).available, true);
});

test('with staging mode the recording stays in the bucket and is marked as staging, not moved or deleted', async () => {
  const store = new MemoryStore();
  const logs = [];
  const archiver = createStagingArchiver({env: {RECORDING_ARCHIVE: 'staging'}});
  const service = createRecordingService({
    env: {R2_ENDPOINT: 'https://s3.example.com', R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's', R2_BUCKET: 'b', RECORDING_MODE: 'video'},
    store,
    egress: {
      async startRoomCompositeEgress() {
        return {egressId: 'EG_1'};
      },
      async stopEgress() {},
      async listEgress() {
        return [{egressId: 'EG_1', status: 3, segmentResults: [{size: 2048n, duration: 12_000_000_000n}]}];
      },
    },
    archiver,
    livekitConfigured: true,
    log: m => logs.push(m),
    sleepFn: async () => {},
  });
  assert.equal(service.destination, 'staging');
  const call = {id: 'c1', room: 'r1', caller: 'a', callee: 'b'};
  const started = await service.start(call, {requestedBy: 'a', allowedBy: 'b'});
  assert.equal(started.ok, true);
  await service.stopAndFinish('EG_1');
  const row = await store.get('EG_1');
  assert.equal(row.destination, 'staging');
  assert.equal(row.status, 'complete');
  assert.equal(row.error, null);
  assert.ok(logs.some(m => /staging bucket/.test(m)));
});
