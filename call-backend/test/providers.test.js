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

let serverProviders;
const startServer = async (env, overrides = {}) => {
  const egress = {async startRoomCompositeEgress() { return {egressId: 'EG_1'}; }, async stopEgress() {}, async listEgress() { return []; }};
  let tokens;
  ({server, tokens} = createCallBackend({RING_TIMEOUT_MS: '2000', ...env}, () => {}, {store: new MemoryStore(), egress, ...overrides}));
  serverProviders = tokens;
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

// ---- auto mode and moving a call to Agora ----

test('auto mode uses LiveKit while it answers and Agora while it does not, and goes back when it recovers', async () => {
  let up = true;
  const probe = async () => {
    if (!up) {
      throw new Error('quota used up');
    }
  };
  const logs = [];
  const providers = createProviders({...LIVEKIT, ...AGORA, CALL_PROVIDER: 'auto'}, {probe});
  assert.equal(providers.provider, 'livekit'); // assumed up before the first check

  await providers.refresh(m => logs.push(m));
  assert.deepEqual([providers.provider, providers.livekitUp], ['livekit', true]);

  up = false;
  await providers.refresh(m => logs.push(m));
  assert.deepEqual([providers.provider, providers.livekitUp, providers.configured], ['agora', false, true]);
  await providers.refresh(m => logs.push(m)); // a second failure does not repeat the log line
  assert.equal(logs.length, 1);
  assert.match(logs[0], /LiveKit is not answering \(quota used up\)/);

  up = true;
  await providers.refresh(m => logs.push(m));
  assert.deepEqual([providers.provider, providers.livekitUp], ['livekit', true]);
  assert.match(logs[1], /answers again/);
});

test('auto mode without Agora set up keeps using LiveKit, and other modes ignore the check', async () => {
  const failing = async () => {
    throw new Error('down');
  };
  const noAgora = createProviders({...LIVEKIT, CALL_PROVIDER: 'auto'}, {probe: failing});
  await noAgora.refresh();
  assert.equal(noAgora.provider, 'livekit');

  const fixed = createProviders({...LIVEKIT, ...AGORA}, {probe: failing});
  await fixed.refresh();
  assert.deepEqual([fixed.provider, fixed.livekitUp], ['livekit', true]); // not auto: the check is never run
});

test('watch() checks right away, keeps checking, and can be stopped; it does nothing outside auto mode', async () => {
  let checks = 0;
  const probe = async () => {
    checks += 1;
  };
  const stopped = createProviders({...LIVEKIT, ...AGORA}, {probe}).watch();
  stopped();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(checks, 0);

  const providers = createProviders({...LIVEKIT, ...AGORA, CALL_PROVIDER: 'auto'}, {probe});
  const stop = providers.watch(() => {}, 5);
  await new Promise(resolve => setTimeout(resolve, 60));
  stop();
  assert.ok(checks >= 3, `expected repeated checks, got ${checks}`);
});

test('in auto mode a new call starts on Agora while LiveKit is down', async () => {
  const url = await startServer({...LIVEKIT, ...AGORA, CALL_PROVIDER: 'auto'}, {probe: async () => { throw new Error('down'); }});
  const health = await (await fetch(`${url}/health`)).json();
  assert.equal(health.callProviderMode, 'auto');
  // the first check runs when the server starts for real; here it is run by hand
  await serverProviders.refresh();
  const {readyA, readyB} = await callAndAnswer(url);
  assert.deepEqual([readyA.provider, readyB.provider], ['agora', 'agora']);
});

test('a phone that cannot connect through LiveKit gets the call moved to Agora, for both people, once', async () => {
  const url = await startServer({...LIVEKIT, ...AGORA});
  const {a, b, callId, readyA, readyB} = await callAndAnswer(url);
  assert.deepEqual([readyA.provider, readyB.provider], ['livekit', 'livekit']);

  const movedA = once(a, 'call:ready');
  const movedB = once(b, 'call:ready');
  assert.deepEqual(await emitAck(a, 'call:fallback', {callId}), {ok: true});
  const [[a2], [b2]] = [await movedA, await movedB];
  for (const [ready, account] of [[a2, 'asha'], [b2, 'bilal']]) {
    assert.deepEqual([ready.callId, ready.provider, ready.channel, ready.account], [callId, 'agora', `call-${callId}`, account]);
    assert.match(ready.token, /^007/);
  }

  // the other phone asking at the same moment is fine and does not move the call again
  assert.deepEqual(await emitAck(b, 'call:fallback', {callId}), {ok: true, already: true});
});

test('moving a call to Agora is refused when Agora is not set up, or the call is not active, or it is not your call', async () => {
  let url = await startServer({...LIVEKIT});
  const {a, callId} = await callAndAnswer(url);
  assert.deepEqual(await emitAck(a, 'call:fallback', {callId}), {ok: false, error: 'unavailable'});
  clients.splice(0).forEach(c => c.disconnect());
  await new Promise(resolve => server.close(resolve));

  url = await startServer({...LIVEKIT, ...AGORA});
  const x = await join(url, 'asha');
  const y = await join(url, 'bilal');
  const z = await join(url, 'carol');
  const started = await emitAck(x, 'call:start', {to: 'bilal', video: false});
  assert.deepEqual(await emitAck(x, 'call:fallback', {callId: started.callId}), {ok: false, error: 'not-active'}); // still ringing
  assert.deepEqual(await emitAck(z, 'call:fallback', {callId: started.callId}), {ok: false, error: 'not-active'}); // someone else's call
  assert.deepEqual(await emitAck(y, 'call:fallback', {callId: 'nope'}), {ok: false, error: 'not-active'});
});
