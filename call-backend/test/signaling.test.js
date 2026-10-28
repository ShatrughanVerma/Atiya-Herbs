const {test, beforeEach, afterEach} = require('node:test');
const assert = require('node:assert/strict');
const {Buffer} = require('node:buffer');
const {once} = require('node:events');
const {io: connect} = require('socket.io-client');
const {createCallBackend} = require('../src');

const LIVEKIT = {
  LIVEKIT_URL: 'wss://example.livekit.cloud',
  LIVEKIT_API_KEY: 'devkey',
  LIVEKIT_API_SECRET: 'a-long-test-secret-that-is-at-least-32-chars',
};

let server;
let url;
const clients = [];

const start = async env => {
  ({server} = createCallBackend({RING_TIMEOUT_MS: '300', RECONNECT_GRACE_MS: '300', ...env}, () => {}));
  server.listen(0);
  await once(server, 'listening');
  url = `http://127.0.0.1:${server.address().port}`;
};

beforeEach(() => start(LIVEKIT));

afterEach(async () => {
  clients.splice(0).forEach(c => c.disconnect());
  await new Promise(resolve => server.close(resolve));
});

const join = async (userId, name = userId) => {
  const socket = connect(url, {auth: {userId, name}, transports: ['websocket'], reconnection: false});
  clients.push(socket);
  const [session] = await once(socket, 'session');
  socket.session = session;
  return socket;
};

const startCall = (socket, to, video = true) => new Promise(resolve => socket.emit('call:start', {to, video}, resolve));
const decode = jwt => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());

test('rings, then gives each person their own token for the call room only', async () => {
  const a = await join('A@x.com', 'Asha');
  const b = await join('b@x.com', 'Bilal');
  const c = await join('c@x.com');

  const incoming = once(b, 'call:incoming');
  const res = await startCall(a, 'b@x.com', true);
  assert.equal(res.ok, true);
  assert.deepEqual((await incoming)[0], {callId: res.callId, from: {id: 'a@x.com', name: 'Asha'}, video: true});

  // A third person can't call either of them while busy, and can't accept someone else's call
  assert.deepEqual(await startCall(c, 'a@x.com'), {ok: false, error: 'busy'});
  let cGotToken = false;
  c.on('call:ready', () => (cGotToken = true));
  c.emit('call:accept', {callId: res.callId});

  const readyA = once(a, 'call:ready');
  const readyB = once(b, 'call:ready');
  b.emit('call:accept', {callId: res.callId});
  const [forA] = await readyA;
  const [forB] = await readyB;

  assert.equal(forA.serverUrl, LIVEKIT.LIVEKIT_URL);
  const claimsA = decode(forA.token);
  const claimsB = decode(forB.token);
  assert.equal(claimsA.sub, 'a@x.com');
  assert.equal(claimsB.sub, 'b@x.com');
  assert.equal(claimsA.video.room, `call-${res.callId}`);
  assert.equal(claimsA.video.room, claimsB.video.room);
  assert.equal(claimsA.video.roomJoin, true);
  assert.ok(claimsA.exp - claimsA.nbf <= 600); // short-lived
  assert.equal(cGotToken, false);

  const ended = once(a, 'call:ended');
  b.emit('call:end', {callId: res.callId});
  assert.deepEqual((await ended)[0], {callId: res.callId, reason: 'ended'});
});

test('the caller cannot accept their own call, so no token is issued early', async () => {
  const a = await join('a');
  const b = await join('b');
  const res = await startCall(a, 'b');
  let got = false;
  a.on('call:ready', () => (got = true));
  a.emit('call:accept', {callId: res.callId});
  await new Promise(r => setTimeout(r, 100));
  assert.equal(got, false);
  b.emit('call:reject', {callId: res.callId});
});

test('reports offline users, rejections and unanswered calls', async () => {
  const a = await join('a');
  const b = await join('b');
  assert.deepEqual(await startCall(a, 'nobody'), {ok: false, error: 'offline'});
  assert.deepEqual(await startCall(a, 'a'), {ok: false, error: 'self'});

  let res = await startCall(a, 'b');
  let ended = once(a, 'call:ended');
  b.emit('call:reject', {callId: res.callId});
  assert.equal((await ended)[0].reason, 'rejected');

  res = await startCall(a, 'b');
  const endedForB = once(b, 'call:ended');
  ended = once(a, 'call:ended');
  assert.equal((await ended)[0].reason, 'no-answer');
  assert.equal((await endedForB)[0].reason, 'no-answer');
});

test('keeps a call through a short reconnect, ends it if the user stays away', async () => {
  const a = await join('a');
  const b = await join('b');
  const res = await startCall(a, 'b');
  b.emit('call:accept', {callId: res.callId});
  await once(a, 'call:ready');

  b.disconnect();
  const b2 = await join('b');
  assert.equal(b2.session.activeCallId, res.callId);

  const ended = once(b2, 'call:ended');
  a.disconnect();
  assert.equal((await ended)[0].reason, 'disconnected');
});

test('without LiveKit settings, calls are refused with a clear reason', async () => {
  clients.splice(0).forEach(c => c.disconnect());
  await new Promise(resolve => server.close(resolve));
  await start({});

  const a = await join('a');
  await join('b');
  assert.deepEqual(await startCall(a, 'b'), {ok: false, error: 'not-configured'});
  const res = await fetch(`${url}/health`);
  assert.equal((await res.json()).livekitConfigured, false);
});
