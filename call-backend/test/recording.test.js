const {test, beforeEach, afterEach} = require('node:test');
const assert = require('node:assert/strict');
const {once} = require('node:events');
const {io: connect} = require('socket.io-client');
const {EgressStatus} = require('@livekit/protocol');
const {createCallBackend} = require('../src');
const {D1Store, MemoryStore, SCHEMA, MIGRATIONS} = require('../src/recordingStore');

const ENV = {
  RING_TIMEOUT_MS: '2000',
  RECONNECT_GRACE_MS: '300',
  LIVEKIT_URL: 'wss://example.livekit.cloud',
  LIVEKIT_API_KEY: 'devkey',
  LIVEKIT_API_SECRET: 'a-long-test-secret-that-is-at-least-32-chars',
  R2_ENDPOINT: 'https://acct.r2.cloudflarestorage.com',
  R2_ACCESS_KEY_ID: 'r2-key',
  R2_SECRET_ACCESS_KEY: 'r2-secret',
  R2_BUCKET: 'atiyaherbs-call-recordings',
  RECORDING_POLL_MS: '5',
  RECORDING_POLL_ATTEMPTS: '5',
};

let server;
let url;
let store;
let egress;
const clients = [];

// A stand-in for LiveKit's egress client that records what it was asked to do
const fakeEgress = () => ({
  started: [],
  stopped: [],
  nextStatus: EgressStatus.EGRESS_COMPLETE,
  async startRoomCompositeEgress(room, output, opts) {
    this.started.push({room, output, opts});
    return {egressId: `EG_${this.started.length}`};
  },
  async stopEgress(id) {
    this.stopped.push(id);
  },
  async listEgress({egressId}) {
    return [{egressId, status: this.nextStatus, error: 'boom', fileResults: [{size: 4096n, duration: 65_000_000_000n}]}];
  },
});

const start = async (env = ENV) => {
  store = new MemoryStore();
  egress = fakeEgress();
  ({server} = createCallBackend(env, () => {}, {store, egress}));
  server.listen(0);
  await once(server, 'listening');
  url = `http://127.0.0.1:${server.address().port}`;
};

beforeEach(() => start());
afterEach(async () => {
  clients.splice(0).forEach(c => c.disconnect());
  await new Promise(resolve => server.close(resolve));
});

const join = async userId => {
  const socket = connect(url, {auth: {userId, name: userId}, transports: ['websocket'], reconnection: false});
  clients.push(socket);
  const [session] = await once(socket, 'session');
  socket.session = session;
  return socket;
};
const emitAck = (socket, event, payload) => new Promise(resolve => socket.emit(event, payload, resolve));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// Asha calls Bilal and Bilal answers; resolves when both have their tokens
const connectedCall = async () => {
  const a = await join('asha');
  const b = await join('bilal');
  const {callId} = await emitAck(a, 'call:start', {to: 'bilal', video: false});
  const ready = Promise.all([once(a, 'call:ready'), once(b, 'call:ready')]);
  b.emit('call:accept', {callId});
  await ready;
  return {a, b, callId};
};

test('recording is offered only when LiveKit and R2 are both set up', async () => {
  assert.equal((await join('x')).session.recordingAvailable, true);
  clients.splice(0).forEach(c => c.disconnect());
  await new Promise(resolve => server.close(resolve));
  await start({...ENV, R2_BUCKET: ''});
  assert.equal((await join('x')).session.recordingAvailable, false);
});

test('nothing is recorded until the other person agrees, then it records to R2 and logs consent', async () => {
  const {a, b, callId} = await connectedCall();

  const asked = once(b, 'recording:requested');
  assert.deepEqual(await emitAck(a, 'recording:request', {callId}), {ok: true});
  assert.deepEqual((await asked)[0], {callId, from: {id: 'asha', name: 'asha'}});
  assert.equal(egress.started.length, 0); // asking alone records nothing

  // The person who asked can't answer for the other person
  a.emit('recording:respond', {callId, allow: true});
  await wait(100);
  assert.equal(egress.started.length, 0);

  const onA = once(a, 'recording:state');
  const onB = once(b, 'recording:state');
  b.emit('recording:respond', {callId, allow: true});
  assert.deepEqual((await onA)[0], {callId, state: 'on'});
  assert.deepEqual((await onB)[0], {callId, state: 'on'});

  assert.equal(egress.started.length, 1);
  const [{room, output, opts}] = egress.started;
  assert.equal(room, `call-${callId}`);
  assert.equal(opts.audioOnly, true);
  assert.match(output.filepath, new RegExp(`^recordings/\\d{4}/\\d{2}/${callId}-\\d+\\.ogg$`));
  assert.equal(output.output.case, 's3');
  assert.equal(output.output.value.endpoint, ENV.R2_ENDPOINT);
  assert.equal(output.output.value.bucket, ENV.R2_BUCKET);
  assert.equal(output.output.value.forcePathStyle, true);
  assert.equal(output.output.value.region, 'auto');

  const row = await store.get('EG_1');
  assert.deepEqual(
    {status: row.status, requested_by: row.requested_by, allowed_by: row.allowed_by, caller: row.caller, callee: row.callee},
    {status: 'recording', requested_by: 'asha', allowed_by: 'bilal', caller: 'asha', callee: 'bilal'},
  );
  assert.ok(row.consent_at);
});

test('declining means no recording', async () => {
  const {a, b, callId} = await connectedCall();
  await emitAck(a, 'recording:request', {callId});
  const declined = once(a, 'recording:state');
  b.emit('recording:respond', {callId, allow: false});
  assert.deepEqual((await declined)[0], {callId, state: 'off', reason: 'declined'});
  assert.equal(egress.started.length, 0);
  assert.deepEqual(await emitAck(a, 'recording:request', {callId}), {ok: true}); // can ask again
});

test('only people on an active call can ask, and only one request at a time', async () => {
  const a = await join('asha');
  const b = await join('bilal');
  const outsider = await join('carol');
  const {callId} = await emitAck(a, 'call:start', {to: 'bilal'});
  assert.deepEqual(await emitAck(a, 'recording:request', {callId}), {ok: false, error: 'not-active'}); // still ringing

  const ready = once(a, 'call:ready');
  b.emit('call:accept', {callId});
  await ready;
  assert.deepEqual(await emitAck(outsider, 'recording:request', {callId}), {ok: false, error: 'not-active'});
  assert.deepEqual(await emitAck(a, 'recording:request', {callId}), {ok: true});
  assert.deepEqual(await emitAck(b, 'recording:request', {callId}), {ok: false, error: 'already'});
  assert.equal(egress.started.length, 0);
});

test('stopping, or ending the call, finishes the recording and saves its size and length', async () => {
  const {a, b, callId} = await connectedCall();
  await emitAck(a, 'recording:request', {callId});
  const on = once(a, 'recording:state');
  b.emit('recording:respond', {callId, allow: true});
  await on;

  const ended = once(b, 'call:ended');
  a.emit('call:end', {callId});
  await ended;
  await wait(120);
  assert.deepEqual(egress.stopped, ['EG_1']);
  const row = await store.get('EG_1');
  assert.equal(row.status, 'complete');
  assert.equal(row.size_bytes, 4096);
  assert.equal(row.duration_seconds, 65);
  assert.ok(row.ended_at);
});

test('a failed upload is saved as failed', async () => {
  egress.nextStatus = EgressStatus.EGRESS_FAILED;
  const {a, b, callId} = await connectedCall();
  await emitAck(a, 'recording:request', {callId});
  const on = Promise.all([once(a, 'recording:state'), once(b, 'recording:state')]);
  b.emit('recording:respond', {callId, allow: true});
  await on; // both have heard "on" before the stop below
  const off = once(b, 'recording:state');
  a.emit('recording:stop', {callId});
  assert.deepEqual((await off)[0], {callId, state: 'off', reason: 'stopped'});
  await wait(120);
  const row = await store.get('EG_1');
  assert.equal(row.status, 'failed');
  assert.equal(row.error, 'boom');
});

test('recording stops being offered once the monthly minutes are used up', async () => {
  const now = new Date().toISOString();
  await store.insert({
    id: 'old',
    call_id: 'c',
    room: 'r',
    caller: 'x',
    callee: 'y',
    requested_by: 'x',
    allowed_by: 'y',
    consent_at: now,
    mode: 'audio',
    status: 'complete',
    duration_seconds: 50 * 60,
    created_at: now,
  });
  const {a, b, callId} = await connectedCall();
  await emitAck(a, 'recording:request', {callId});
  const off = once(a, 'recording:state');
  b.emit('recording:respond', {callId, allow: true});
  assert.deepEqual((await off)[0], {callId, state: 'off', reason: 'quota'});
  assert.equal(egress.started.length, 0);
});

test('Cloudflare D1: creates the table and always passes values as parameters', async () => {
  const calls = [];
  const fetchImpl = async (requestUrl, init) => {
    calls.push({url: requestUrl, headers: init.headers, ...JSON.parse(init.body)});
    return {ok: true, status: 200, json: async () => ({success: true, result: [{results: [{total: 125}]}]})};
  };
  const d1 = new D1Store({accountId: 'acct1', databaseId: 'db1', apiToken: 'tok', fetchImpl});

  await d1.init();
  assert.equal(calls.length, SCHEMA.length + MIGRATIONS.length);
  assert.equal(calls[0].url, 'https://api.cloudflare.com/client/v4/accounts/acct1/d1/database/db1/query');
  assert.equal(calls[0].headers.Authorization, 'Bearer tok');
  assert.match(calls[0].sql, /CREATE TABLE IF NOT EXISTS call_recordings/);

  calls.length = 0;
  const hostile = "EG_1'; DROP TABLE call_recordings;--";
  await d1.insert({id: hostile, call_id: 'c1', status: 'recording'});
  assert.equal(calls[0].sql, 'INSERT INTO call_recordings (id, call_id, status) VALUES (?, ?, ?)');
  assert.deepEqual(calls[0].params, [hostile, 'c1', 'recording']);

  await d1.update('EG_1', {status: 'complete', size_bytes: 10, not_a_column: 'ignored'});
  assert.equal(calls[1].sql, 'UPDATE call_recordings SET status = ?, size_bytes = ? WHERE id = ?');
  assert.deepEqual(calls[1].params, ['complete', 10, 'EG_1']);

  assert.equal(await d1.secondsRecordedInMonth('2026-10'), 125);
  assert.deepEqual(calls[2].params, ['2026-10%']);
});

test('Cloudflare D1: a failed request is reported with the reason', async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 403,
    json: async () => ({success: false, errors: [{message: 'Authentication error'}]}),
  });
  const d1 = new D1Store({accountId: 'a', databaseId: 'd', apiToken: 't', fetchImpl});
  await assert.rejects(() => d1.query('SELECT 1'), /Authentication error/);
});
