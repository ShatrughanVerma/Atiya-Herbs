const test = require('node:test');
const assert = require('node:assert/strict');
const {setup} = require('./helpers');
const {createIngest} = require('../src/ingest');
const {createPuller} = require('../src/puller');

const FOLDER = 'recordings/2026/11/call-1-1700000000000/';
const ID = 'call-1-1700000000000';

// A stand-in for the staging bucket
function fakeBucket(files) {
  const reads = [];
  return {
    files,
    reads,
    async send(command) {
      const name = command.constructor.name;
      if (name === 'ListObjectsV2Command') {
        return {Contents: Object.keys(files).filter(k => k.startsWith(command.input.Prefix)).map(Key => ({Key})), IsTruncated: false};
      }
      if (name === 'GetObjectCommand') {
        reads.push(command.input.Key);
        const data = files[command.input.Key];
        return {Body: {transformToByteArray: async () => new Uint8Array(data)}};
      }
      if (name === 'DeleteObjectsCommand') {
        command.input.Delete.Objects.forEach(o => delete files[o.Key]);
        return {};
      }
      throw new Error(`unexpected ${name}`);
    },
  };
}

const segments = n => Object.fromEntries(Array.from({length: n}, (_, i) => [`${FOLDER}part_${String(i).padStart(5, '0')}.ts`, Buffer.from(`data-${i}`)]));
const ENDED = Buffer.from('#EXTM3U\n#EXTINF:5,\npart_00000.ts\n#EXT-X-ENDLIST\n');
const LIVE = Buffer.from('#EXTM3U\n#EXTINF:5,\npart_00000.ts\n');

function make(files, extra = {}) {
  const t = setup({env: {PULL_ENDPOINT: 'https://s3.example.com', PULL_BUCKET: 'b', PULL_ACCESS_KEY_ID: 'k', PULL_SECRET_ACCESS_KEY: 's', ...extra}});
  const bucket = fakeBucket(files);
  const puller = createPuller({config: t.config, store: t.store, ingest: createIngest({config: t.config, store: t.store, logger: t.logger}), logger: t.logger, s3: bucket});
  return {t, bucket, puller};
}

test('is off unless the bucket settings are filled in', () => {
  const t = setup();
  const puller = createPuller({config: t.config, store: t.store, ingest: {}, logger: t.logger});
  assert.equal(puller.available, false);
  t.cleanup();
});

test('a call still in progress: new chunks are pulled once, nothing is finished or deleted', async () => {
  const files = {...segments(2), [`${FOLDER}live.m3u8`]: LIVE};
  const {t, bucket, puller} = make(files);
  await puller.pollOnce();
  assert.equal((await t.store.listChunks(ID)).length, 2);
  assert.equal((await t.store.getRecording(ID)).status, 'receiving');
  assert.equal(Object.keys(bucket.files).length, 3); // bucket untouched

  // a third chunk appears; the first two are not downloaded again
  bucket.files[`${FOLDER}part_00002.ts`] = Buffer.from('data-2');
  bucket.reads.length = 0;
  await puller.pollOnce();
  assert.deepEqual(bucket.reads, [`${FOLDER}part_00002.ts`]);
  assert.equal((await t.store.listChunks(ID)).length, 3);
  t.cleanup();
});

test('when LiveKit has ended the recording the call is queued with the chunk count and the bucket is cleared', async () => {
  const files = {...segments(3), [`${FOLDER}playlist.m3u8`]: ENDED, [`${FOLDER}live.m3u8`]: ENDED};
  const {t, bucket, puller} = make(files);
  await puller.pollOnce();
  const rec = await t.store.getRecording(ID);
  assert.equal(rec.status, 'pending');
  assert.equal(rec.expectedChunks, 3);
  assert.deepEqual(Object.keys(bucket.files), []);

  // and the normal worker turns it into an MP4 (the puller used the real clock, the test clock is behind it)
  t.advance(24 * 3600 * 1000);
  assert.deepEqual(await t.worker.tick(), {callId: ID, outcome: 'completed'});
  t.cleanup();
});

test('a playlist without the end marker does not finish the call', async () => {
  const {t, puller} = make({...segments(2), [`${FOLDER}playlist.m3u8`]: LIVE});
  await puller.pollOnce();
  assert.equal((await t.store.getRecording(ID)).status, 'receiving');
  t.cleanup();
});

test('PULL_DELETE_AFTER=false keeps the bucket as it is', async () => {
  const {t, bucket, puller} = make({...segments(1), [`${FOLDER}playlist.m3u8`]: ENDED}, {PULL_DELETE_AFTER: 'false'});
  await puller.pollOnce();
  assert.equal((await t.store.getRecording(ID)).status, 'pending');
  assert.equal(Object.keys(bucket.files).length, 2);
  t.cleanup();
});

test('audio: one .ogg file becomes chunk 0 of the audio track and is finished at once', async () => {
  const key = 'recordings/2026/11/call-2-1700000000001.ogg';
  const {t, bucket, puller} = make({[key]: Buffer.from('ogg-bytes')});
  await puller.pollOnce();
  const chunks = await t.store.listChunks('call-2-1700000000001');
  assert.deepEqual(chunks.map(c => [c.track, c.seq]), [['audio', 0]]);
  assert.equal((await t.store.getRecording('call-2-1700000000001')).status, 'pending');
  assert.deepEqual(Object.keys(bucket.files), []);
  t.cleanup();
});

test('a damaged download is not deleted from the bucket and is retried on the next look', async () => {
  const files = {...segments(2), [`${FOLDER}playlist.m3u8`]: ENDED};
  const {t, bucket, puller} = make(files);
  const original = bucket.send.bind(bucket);
  let fail = true;
  bucket.send = async command => {
    if (fail && command.constructor.name === 'GetObjectCommand' && command.input.Key.endsWith('part_00001.ts')) {
      throw new Error('network dropped');
    }
    return original(command);
  };
  await puller.pollOnce();
  assert.equal((await t.store.getRecording(ID)).status, 'receiving');
  assert.equal(Object.keys(bucket.files).length, 3); // nothing deleted
  assert.ok(t.logger.events.some(e => /tried again/.test(e.message)));

  fail = false;
  await puller.pollOnce();
  assert.equal((await t.store.getRecording(ID)).status, 'pending');
  assert.equal((await t.store.listChunks(ID)).length, 2);
  assert.deepEqual(Object.keys(bucket.files), []);
  t.cleanup();
});

test('leftovers of a call already finished here are cleared only when every chunk is on this disk', async () => {
  const files = {...segments(2), [`${FOLDER}playlist.m3u8`]: ENDED};
  const {t, bucket, puller} = make(files, {PULL_DELETE_AFTER: 'false'});
  await puller.pollOnce(); // pulled and finished, bucket kept
  t.config.pull.deleteAfter = true;
  await puller.pollOnce();
  assert.deepEqual(Object.keys(bucket.files), []);

  const other = make({...segments(2)});
  await other.t.store.ensureRecording(ID, new Date());
  await other.t.store.requestFinish(ID, 2, new Date()); // finished here without having both chunks
  await other.puller.pollOnce();
  assert.equal(Object.keys(other.bucket.files).length, 2); // chunks are only in the bucket, so they stay
  t.cleanup();
  other.t.cleanup();
});
