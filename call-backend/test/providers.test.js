const {test, afterEach} = require('node:test');
const assert = require('node:assert/strict');
const {once} = require('node:events');
const {io: connect} = require('socket.io-client');
const {createCallBackend} = require('../src');
const {createProviders} = require('../src/providers');
const {MemoryStore} = require('../src/recordingStore');

const LIVEKIT = {
  LIVEKIT_URL: 'wss://example.livekit.cloud',
  LIVEKIT_API_KEY: 'devkey',
  LIVEKIT_API_SECRET: 'a-long-test-secret-that-is-at-least-32-chars',
};
const AGORA = {AGORA_APP_ID: '0123456789abcdef0123456789abcdef', AGORA_APP_CERTIFICATE: 'fedcba9876543210fedcba9876543210'};

test('LiveKit is used unless Agora is both chosen and set up', () => {
  assert.equal(createProviders({...LIVEKIT}).provider, 'livekit');
  assert.equal(createProviders({...LIVEKIT, ...AGORA}).provider, 'livekit'); // set up, but not chosen
  assert.equal(createProviders({...LIVEKIT, CALL_PROVIDER: 'agora'}).provider, 'livekit'); // chosen, but no App ID: keep calls working
  const both = createProviders({...LIVEKIT, ...AGORA, CALL_PROVIDER: ' Agora '});
  assert.deepEqual([both.provider, both.configured, both.livekitConfigured, both.agoraConfigured], ['agora', true, true, true]);
});

test('calling can run on Agora alone, and is not configured when neither is set up', () => {
  const agoraOnly = createProviders({...AGORA, CALL_PROVIDER: 'agora'});
  assert.deepEqual([agoraOnly.provider, agoraOnly.configured, agoraOnly.livekitConfigured], ['agora', true, false]);
  assert.equal(createProviders({}).configured, false);
});

test('each provider hands the app what it needs to join', async () => {
  const providers = createProviders({...LIVEKIT, ...AGORA});
  const lk = await providers.issue('livekit', {identity: 'asha', name: 'Asha', room: 'call-1'});
  assert.deepEqual([lk.provider, lk.serverUrl, typeof lk.token], ['livekit', LIVEKIT.LIVEKIT_URL, 'string']);

  const ag = await providers.issue('agora', {identity: '9935687829', name: 'Asha', room: 'call-1'});
  assert.deepEqual([ag.provider, ag.appId, ag.channel, ag.account], ['agora', AGORA.AGORA_APP_ID, 'call-1', '9935687829']);
  assert.match(ag.token, /^007/); // Agora's current token format
  assert.equal(ag.serverUrl, undefined);
  assert.equal(JSON.stringify(ag).includes(AGORA.AGORA_APP_CERTIFICATE), false); // the certificate never leaves the server
});

// ---- A real call through the signaling server ----

let server;
const clients = [];
afterEach(async () => {
  clients.splice(0).forEach(c => c.disconnect());
  if (server) {
    await new Promise(resolve => server.close(resolve));
    server = undefined;
  }
});

const startServer = async env => {
  const egress = {async startRoomCompositeEgress() { return {egressId: 'EG_1'}; }, async stopEgress() {}, async listEgress() { return []; }};
  ({server} = createCallBackend({RING_TIMEOUT_MS: '2000', ...env}, () => {}, {store: new MemoryStore(), egress}));
  server.listen(0);
  await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}`;
};
const join = async (url, userId) => {
  const socket = connect(url, {auth: {userId, name: userId}, transports: ['websocket'], reconnection: false});
  clients.push(socket);
  await once(socket, 'session');
  return socket;
};
const emitAck = (socket, event, payload) => new Promise(resolve => socket.emit(event, payload, resolve));

const callAndAnswer = async url => {
  const a = await join(url, 'asha');
  const b = await join(url, 'bilal');
  const {callId} = await emitAck(a, 'call:start', {to: 'bilal', video: false});
  const readyA = once(a, 'call:ready');
  const readyB = once(b, 'call:ready');
  b.emit('call:accept', {callId});
  return {a, b, callId, readyA: (await readyA)[0], readyB: (await readyB)[0]};
};

test('with CALL_PROVIDER=agora both people receive Agora details for the same channel, each for themselves', async () => {
  const url = await startServer({...LIVEKIT, ...AGORA, CALL_PROVIDER: 'agora'});
  const {callId, readyA, readyB} = await callAndAnswer(url);
  for (const [ready, account] of [[readyA, 'asha'], [readyB, 'bilal']]) {
    assert.deepEqual([ready.callId, ready.provider, ready.channel, ready.account], [callId, 'agora', `call-${callId}`, account]);
    assert.match(ready.token, /^007/);
  }
  assert.notEqual(readyA.token, readyB.token);
});

test('by default calls stay on LiveKit exactly as before', async () => {
  const url = await startServer({...LIVEKIT, ...AGORA});
  const {readyA, readyB} = await callAndAnswer(url);
  for (const ready of [readyA, readyB]) {
    assert.deepEqual([ready.provider, ready.serverUrl], ['livekit', LIVEKIT.LIVEKIT_URL]);
  }
});

test('a call on Agora cannot be recorded yet, because recording is built on LiveKit', async () => {
  const url = await startServer({...LIVEKIT, ...AGORA, CALL_PROVIDER: 'agora', R2_ENDPOINT: 'https://x.example', R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's', R2_BUCKET: 'b'});
  const {a, callId} = await callAndAnswer(url);
  assert.deepEqual(await emitAck(a, 'recording:request', {callId}), {ok: false, error: 'unavailable'});
});
