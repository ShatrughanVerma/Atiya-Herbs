const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const {setup, sha, INGEST, READ} = require('./helpers');

// Tiny HTTP client against the app on a random port
async function withServer(app, run) {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await run(async (method, path, {key = INGEST, body, headers = {}} = {}) => {
      const isBuffer = Buffer.isBuffer(body);
      const res = await fetch(base + path, {
        method,
        headers: {...(key ? {Authorization: `Bearer ${key}`} : {}), ...(body && !isBuffer ? {'Content-Type': 'application/json'} : {}), ...headers},
        body: body ? (isBuffer ? body : JSON.stringify(body)) : undefined,
      });
      const type = res.headers.get('content-type') || '';
      return {status: res.status, body: type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer())};
    });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

const chunk = n => Buffer.from(`chunk-data-${n}`);
const upload = (call, callId, seq, data = chunk(seq), extra = {}) =>
  call('PUT', `/calls/${callId}/tracks/av/chunks/${seq}`, {body: data, headers: {'x-chunk-sha256': sha(data), ...extra}});

test('rejects uploads without the right key', async () => {
  const t = setup();
  await withServer(t.app, async call => {
    assert.equal((await call('PUT', '/calls/c1/tracks/av/chunks/0', {key: null, body: chunk(0)})).status, 401);
    assert.equal((await call('PUT', '/calls/c1/tracks/av/chunks/0', {key: READ, body: chunk(0)})).status, 401);
    assert.equal((await call('GET', '/calls/c1/status', {key: INGEST})).status, 401);
  });
  t.cleanup();
});

test('rejects unsafe call ids and bad chunk addresses', async () => {
  const t = setup();
  await withServer(t.app, async call => {
    assert.equal((await call('PUT', '/calls/..%2Fevil/tracks/av/chunks/0', {body: chunk(0)})).status, 400);
    assert.equal((await call('PUT', '/calls/c1/tracks/xx/chunks/0', {body: chunk(0)})).status, 400);
    assert.equal((await call('PUT', '/calls/c1/tracks/av/chunks/-1', {body: chunk(0)})).status, 400);
  });
  t.cleanup();
});

test('stores a chunk, ignores a repeat, refuses a damaged one', async () => {
  const t = setup();
  await withServer(t.app, async call => {
    const first = await upload(call, 'c1', 0);
    assert.equal(first.status, 201);
    const again = await upload(call, 'c1', 0);
    assert.equal(again.status, 200);
    assert.equal(again.body.duplicate, true);
    const damaged = await call('PUT', '/calls/c1/tracks/av/chunks/1', {body: chunk(1), headers: {'x-chunk-sha256': 'a'.repeat(64)}});
    assert.equal(damaged.status, 422);
    assert.equal((await t.store.listChunks('c1')).length, 1);
    const conflict = await call('PUT', '/calls/c1/tracks/av/chunks/0', {body: Buffer.from('other bytes')});
    assert.equal(conflict.status, 409);
  });
  t.cleanup();
});

test('a complete call becomes one MP4, chunks are deleted, status and download work', async () => {
  const t = setup();
  await withServer(t.app, async call => {
    for (const n of [0, 1, 2]) {
      assert.equal((await upload(call, 'c1', n)).status, 201);
    }
    assert.equal((await call('POST', '/calls/c1/finish', {body: {expectedChunks: 3}})).status, 202);
    // after finishing, more chunks are refused
    assert.equal((await upload(call, 'c1', 3)).status, 409);

    assert.deepEqual(await t.worker.tick(), {callId: 'c1', outcome: 'completed'});

    const status = await call('GET', '/calls/c1/status', {key: READ});
    assert.equal(status.body.status, 'completed');
    assert.equal(status.body.durationSec, 12);
    assert.equal(status.body.missingChunks, null);
    assert.equal(fs.existsSync(`${t.config.chunkDir}/c1`), false);

    const file = await call('GET', '/calls/c1/recording', {key: READ});
    assert.equal(file.status, 200);
    assert.equal(file.body.toString(), 'fake mp4');

    // ffmpeg was told to join with the concat demuxer and write MP4 with faststart
    const args = t.ffmpeg.calls[0].args;
    assert.ok(args.includes('concat') && args.includes('+faststart') && args.includes('libx264'));
  });
  t.cleanup();
});

test('missing chunk: waits and retries, then ends as partial and keeps the chunks', async () => {
  const t = setup();
  await withServer(t.app, async call => {
    await upload(call, 'c2', 0);
    await upload(call, 'c2', 2);
    await call('POST', '/calls/c2/finish', {body: {expectedChunks: 3}});

    assert.equal((await t.worker.tick()).outcome, 'retry');
    assert.equal((await t.store.getRecording('c2')).status, 'pending');
    assert.equal(await t.worker.tick(), null); // not due yet

    t.advance(60_000);
    assert.equal((await t.worker.tick()).outcome, 'retry');
    t.advance(120_000);
    assert.equal((await t.worker.tick()).outcome, 'partial'); // third and last try

    const status = (await call('GET', '/calls/c2/status', {key: READ})).body;
    assert.equal(status.status, 'partial');
    assert.equal(status.missingChunks, 'av:1');
    assert.equal(fs.existsSync(`${t.config.chunkDir}/c2`), true);
    assert.equal((await call('GET', '/calls/c2/recording', {key: READ})).status, 200);
  });
  t.cleanup();
});

test('chunks sent after the call was queued for processing are refused', async () => {
  const t = setup();
  await withServer(t.app, async call => {
    await upload(call, 'c3', 0);
    await upload(call, 'c3', 2);
    await call('POST', '/calls/c3/finish', {body: {expectedChunks: 3}});
    assert.equal((await t.worker.tick()).outcome, 'retry');
    // the sender's retry gets through after the call was queued: only allowed while still receiving, so it is refused
    assert.equal((await upload(call, 'c3', 1)).status, 409);
  });
  t.cleanup();
});

test('a damaged chunk on disk is skipped and the call is partial', async () => {
  const t = setup({env: {MAX_ATTEMPTS: '1'}});
  await withServer(t.app, async call => {
    for (const n of [0, 1, 2]) {
      await upload(call, 'c4', n);
    }
    await call('POST', '/calls/c4/finish', {body: {expectedChunks: 3}});
    const files = await t.store.listChunks('c4');
    fs.writeFileSync(files[1].filePath, 'tampered!!!!!!');
    assert.equal((await t.worker.tick()).outcome, 'partial');
    const rec = await t.store.getRecording('c4');
    assert.equal(rec.corruptChunks, 1);
    assert.equal(rec.missingChunks, 'av:1');
    assert.equal((await t.store.listChunks('c4'))[1].status, 'corrupt');
  });
  t.cleanup();
});

test('ffmpeg failing is retried with a wait, then the call is marked failed with the reason', async () => {
  const t = setup({ffmpegFails: true});
  await withServer(t.app, async call => {
    await upload(call, 'c5', 0);
    await call('POST', '/calls/c5/finish', {body: {expectedChunks: 1}});
    assert.equal((await t.worker.tick()).outcome, 'error');
    assert.equal(await t.worker.tick(), null);
    t.advance(60_000);
    assert.equal((await t.worker.tick()).outcome, 'error');
    t.advance(120_000);
    assert.equal((await t.worker.tick()).outcome, 'failed');
    const rec = await t.store.getRecording('c5');
    assert.equal(rec.status, 'failed');
    assert.match(rec.error, /exited with code 1/);
    assert.equal(fs.existsSync(`${t.config.chunkDir}/c5`), true); // chunks are kept
    assert.equal((await t.store.listChunks('c5')).length, 1);
    assert.ok(t.logger.events.some(e => e.level === 'error' && /failed for good/.test(e.message)));
  });
  t.cleanup();
});

test('a call that goes quiet without "finish" is closed by itself and processed', async () => {
  const t = setup();
  await withServer(t.app, async call => {
    await upload(call, 'c6', 0);
    await upload(call, 'c6', 1);
    assert.equal(await t.worker.tick(), null);
    t.advance(t.config.idleFinishMs + 1000);
    assert.deepEqual(await t.worker.tick(), {callId: 'c6', outcome: 'completed'});
  });
  t.cleanup();
});

test('a call left in "processing" by a crash is queued again on start', async () => {
  const t = setup();
  await withServer(t.app, async call => {
    await upload(call, 'c7', 0);
    await call('POST', '/calls/c7/finish', {body: {expectedChunks: 1}});
    await t.store.claimNext(new Date('2030-01-01'));
    assert.equal((await t.store.getRecording('c7')).status, 'processing');
    assert.equal(await t.store.requeueStuck(), 1);
    assert.equal((await t.store.getRecording('c7')).status, 'pending');
  });
  t.cleanup();
});

test('recording is not available before it is ready', async () => {
  const t = setup();
  await withServer(t.app, async call => {
    await upload(call, 'c8', 0);
    assert.equal((await call('GET', '/calls/c8/recording', {key: READ})).status, 404);
    assert.equal((await call('GET', '/calls/nope/status', {key: READ})).status, 404);
  });
  t.cleanup();
});

test('kept chunks are removed after the retention days, the MP4 stays', async () => {
  const t = setup({env: {DELETE_CHUNKS_AFTER: 'false', CHUNK_RETENTION_DAYS: '2'}});
  await withServer(t.app, async call => {
    for (const n of [0, 1]) {
      await upload(call, 'k1', n);
    }
    await call('POST', '/calls/k1/finish', {body: {expectedChunks: 2}});
    assert.equal((await t.worker.tick()).outcome, 'completed');
    // chunks are kept after the MP4 is made
    assert.equal(fs.existsSync(`${t.config.chunkDir}/k1`), true);

    t.advance(24 * 3600 * 1000); // 1 day: still kept
    assert.equal(await t.worker.cleanupChunks(), 0);
    assert.equal(fs.existsSync(`${t.config.chunkDir}/k1`), true);

    t.advance(25 * 3600 * 1000); // just over 2 days
    assert.equal(await t.worker.cleanupChunks(), 1);
    assert.equal(fs.existsSync(`${t.config.chunkDir}/k1`), false);
    assert.ok((await t.store.listChunks('k1')).every(c => c.status === 'deleted'));
    assert.equal((await call('GET', '/calls/k1/recording', {key: READ})).status, 200); // MP4 still there
    assert.equal(await t.worker.cleanupChunks(), 0); // nothing left to do
  });
  t.cleanup();
});

test('chunks of a partial recording are not removed by the cleanup, and neither if the MP4 is gone', async () => {
  const t = setup({env: {DELETE_CHUNKS_AFTER: 'false', CHUNK_RETENTION_DAYS: '2', MAX_ATTEMPTS: '1'}});
  await withServer(t.app, async call => {
    await upload(call, 'k2', 0);
    await upload(call, 'k2', 2);
    await call('POST', '/calls/k2/finish', {body: {expectedChunks: 3}});
    assert.equal((await t.worker.tick()).outcome, 'partial');
    t.advance(10 * 24 * 3600 * 1000);
    assert.equal(await t.worker.cleanupChunks(), 0);
    assert.equal(fs.existsSync(`${t.config.chunkDir}/k2`), true);

    await upload(call, 'k3', 0);
    await call('POST', '/calls/k3/finish', {body: {expectedChunks: 1}});
    assert.equal((await t.worker.tick()).outcome, 'completed');
    fs.rmSync((await t.store.getRecording('k3')).finalPath); // someone deleted the MP4
    t.advance(10 * 24 * 3600 * 1000);
    assert.equal(await t.worker.cleanupChunks(), 0); // chunks are the only copy left, so they stay
    assert.equal(fs.existsSync(`${t.config.chunkDir}/k3`), true);
  });
  t.cleanup();
});
