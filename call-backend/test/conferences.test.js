const {test, beforeEach, afterEach} = require('node:test');
const assert = require('node:assert/strict');
const {once} = require('node:events');
const {io: connect} = require('socket.io-client');
const {createCallBackend} = require('../src');
const {MemoryStore} = require('../src/recordingStore');

const AGORA = {AGORA_APP_ID: '0123456789abcdef0123456789abcdef', AGORA_APP_CERTIFICATE: 'fedcba9876543210fedcba9876543210'};
const LIVEKIT = {
  LIVEKIT_URL: 'wss://example.livekit.cloud',
  LIVEKIT_API_KEY: 'devkey',
  LIVEKIT_API_SECRET: 'a-long-test-secret-that-is-at-least-32-chars',
};

let server;
let url;
const clients = [];

const start = async (env = {}) => {
  ({server} = createCallBackend(
    {RING_TIMEOUT_MS: '2000', CONFERENCE_RECONNECT_GRACE_MS: '150', ...LIVEKIT, ...AGORA, ...env},
    () => {},
    {store: new MemoryStore()},
  ));
  server.listen(0);
  await once(server, 'listening');
  url = `http://127.0.0.1:${server.address().port}`;
};
const restartWith = async env => {
  clients.splice(0).forEach(c => c.disconnect());
  await new Promise(resolve => server.close(resolve));
  await start(env);
};
beforeEach(() => start());
afterEach(async () => {
  clients.splice(0).forEach(c => c.disconnect());
  await new Promise(resolve => server.close(resolve));
});

const EVENTS = [
  'conference:update',
  'conference:invitation',
  'conference:invitation-ended',
  'conference:invite-result',
  'conference:ended',
  'meeting:update',
  'meeting:invitation',
  'call:upgrade',
  'call:ended',
  'call:ready',
  'call:incoming',
  'users',
];
const join = async (userId, name = userId[0].toUpperCase() + userId.slice(1)) => {
  const socket = connect(url, {auth: {userId, name}, transports: ['websocket'], reconnection: false});
  clients.push(socket);
  socket.userId = userId;
  await once(socket, 'session');
  socket.events = [];
  for (const e of EVENTS) {
    socket.on(e, data => socket.events.push({e, data}));
  }
  return socket;
};
const ask = (socket, event, payload) => new Promise(resolve => socket.emit(event, payload, resolve));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const seen = async (socket, e, match = () => true) => {
  for (let i = 0; i < 100; i++) {
    const hit = socket.events.find(x => x.e === e && match(x.data));
    if (hit) {
      return hit.data;
    }
    await wait(10);
  }
  throw new Error(`${socket.userId} never saw ${e}`);
};
const roster = (socket, ids) => seen(socket, 'conference:update', d => d.participants.map(p => p.id).sort().join() === [...ids].sort().join());

// Two people on a normal one-to-one LiveKit call
const onACall = async (video = false) => {
  const caller = await join('asha');
  const callee = await join('bilal');
  const {callId} = await ask(caller, 'call:start', {to: 'bilal', video});
  const ready = once(caller, 'call:ready');
  callee.emit('call:accept', {callId});
  assert.equal((await ready)[0].provider, 'livekit');
  return {caller, callee, callId};
};

// Asha adds Chandni; Asha, Bilal and Chandni all end up in the conference
const threePeople = async (video = false) => {
  const {caller: asha, callee: bilal, callId} = await onACall(video);
  const chandni = await join('chandni');
  const res = await ask(asha, 'call:add', {callId, to: 'chandni'});
  assert.equal(res.ok, true);
  const id = res.conferenceId;
  const a = await ask(asha, 'conference:join', {id});
  const b = await ask(bilal, 'conference:join', {id});
  const c = await ask(chandni, 'conference:join', {id});
  assert.deepEqual([a.ok, b.ok, c.ok], [true, true, true]);
  return {asha, bilal, chandni, id, callId, joined: {a, b, c}};
};

test('adding a person to a call turns it into a conference call: both are told, the new person is rung, all three end up together', async () => {
  const {caller: asha, callee: bilal, callId} = await onACall();
  const chandni = await join('chandni');

  const res = await ask(asha, 'call:add', {callId, to: 'chandni'});
  assert.equal(res.ok, true);
  assert.match(res.conferenceId, /^[a-z]{10}$/);
  assert.equal(res.meetingId, undefined); // not a meeting

  for (const s of [asha, bilal]) {
    assert.deepEqual(await seen(s, 'call:upgrade'), {callId, conferenceId: res.conferenceId});
    assert.equal((await seen(s, 'call:ended')).reason, 'upgraded');
  }
  const invitation = await seen(chandni, 'conference:invitation');
  assert.deepEqual([invitation.id, invitation.from, invitation.video], [res.conferenceId, {id: 'asha', name: 'Asha'}, false]);
  assert.equal(bilal.events.some(x => x.e === 'conference:invitation'), false); // the two on the call get no ringing screen

  // the two on the call move over, then the new person accepts
  const a = await ask(asha, 'conference:join', {id: res.conferenceId});
  const b = await ask(bilal, 'conference:join', {id: res.conferenceId});
  const c = await ask(chandni, 'conference:join', {id: res.conferenceId});
  assert.deepEqual([a.ok, b.ok, c.ok], [true, true, true]);
  assert.equal(new Set([a.join.channel, b.join.channel, c.join.channel]).size, 1); // one room
  assert.deepEqual([a.join.provider, a.join.appId, a.join.account], ['agora', AGORA.AGORA_APP_ID, 'asha']);
  assert.equal(a.join.channel, `conf-${res.conferenceId}`);
  assert.match(a.join.token, /^007/);
  assert.equal(JSON.stringify(a).includes(AGORA.AGORA_APP_CERTIFICATE), false); // the certificate never leaves the server
  assert.notEqual(a.join.token, b.join.token); // each person has their own token
  const all = await roster(asha, ['asha', 'bilal', 'chandni']);
  assert.deepEqual(all.invited, []);
  assert.equal(all.maxParticipants, 100);
  assert.equal(Object.hasOwn(all, 'hostId'), false); // everybody has the same rights
});

test('a video call becomes a video conference (camera on to start with), a voice call a voice one', async () => {
  const {joined} = await threePeople(true);
  assert.equal(joined.a.conference.video, true);
  assert.deepEqual(joined.a.conference.participants.map(p => p.cameraOn), [true]); // asha joined first, camera on
});

test('a voice call becomes a voice conference', async () => {
  const {joined} = await threePeople(false);
  assert.equal(joined.a.conference.video, false);
  assert.deepEqual(joined.a.conference.participants.map(p => p.cameraOn), [false]);
});

test('either person on the call can add someone', async () => {
  const {caller: asha, callee: bilal, callId} = await onACall();
  await join('chandni');
  const res = await ask(bilal, 'call:add', {callId, to: 'chandni'}); // the one who was called adds
  assert.equal(res.ok, true);
  await seen(asha, 'call:upgrade');
  assert.equal((await ask(bilal, 'conference:join', {id: res.conferenceId})).ok, true);
});

test('anyone in the conference can add more people by number; the person rung can accept', async () => {
  const {bilal, chandni, id} = await threePeople();
  const dev = await join('dev');
  const res = await ask(chandni, 'conference:invite', {id, to: 'dev'}); // not the one who started it
  assert.deepEqual(res, {ok: true, invited: {id: 'dev', name: 'Dev'}});
  const invitation = await seen(dev, 'conference:invitation');
  assert.deepEqual([invitation.id, invitation.from.id, invitation.ttlMs], [id, 'chandni', 45000]);
  const ringing = await seen(bilal, 'conference:update', d => d.invited.some(i => i.id === 'dev'));
  assert.deepEqual(ringing.invited.map(i => [i.id, i.name, i.by]), [['dev', 'Dev', 'chandni']]);

  assert.equal((await ask(dev, 'conference:join', {id})).ok, true); // Accept
  const done = await seen(bilal, 'conference:update', d => d.participants.length === 4);
  assert.deepEqual(done.invited, []);
});

test('the person rung can decline, and the one who rang is told', async () => {
  const {asha, id} = await threePeople();
  const dev = await join('dev');
  await ask(asha, 'conference:invite', {id, to: 'dev'});
  assert.deepEqual(await ask(dev, 'conference:decline', {id}), {ok: true});
  assert.deepEqual(await seen(asha, 'conference:invite-result'), {id, to: 'dev', name: 'Dev', result: 'declined'});
  await seen(asha, 'conference:update', d => d.invited.length === 0 && d.participants.length === 3);
  assert.deepEqual(await ask(dev, 'conference:decline', {id}), {ok: true}); // saying no twice does nothing
});

test('if nobody answers the ringing stops, and both sides are told', async () => {
  await restartWith({CONFERENCE_INVITE_SECONDS: '0.1'});
  const {asha, id} = await threePeople();
  const dev = await join('dev');
  await ask(asha, 'conference:invite', {id, to: 'dev'});
  assert.equal((await seen(dev, 'conference:invitation')).ttlMs, 100);
  assert.equal((await seen(asha, 'conference:invite-result')).result, 'no-answer');
  assert.equal((await seen(dev, 'conference:invitation-ended')).id, id);
  assert.deepEqual(await ask(dev, 'conference:join', {id}), {ok: false, error: 'not-found'}); // too late
});

test('only the person who rang can stop the ringing', async () => {
  const {asha, bilal, id} = await threePeople();
  const dev = await join('dev');
  await ask(asha, 'conference:invite', {id, to: 'dev'});
  await seen(dev, 'conference:invitation');
  assert.deepEqual(await ask(bilal, 'conference:cancel-invite', {id, userId: 'dev'}), {ok: false, error: 'not-found'});
  assert.deepEqual(await ask(asha, 'conference:cancel-invite', {id, userId: 'dev'}), {ok: true});
  assert.equal((await seen(dev, 'conference:invitation-ended')).id, id);
});

test('a number cannot be rung when it is yourself, nobody, offline, already in, already ringing or busy', async () => {
  const {asha, id} = await threePeople();
  const dev = await join('dev');
  const ravi = await join('ravi');
  const sunita = await join('sunita');
  const second = await ask(ravi, 'call:start', {to: 'sunita', video: false}); // Ravi is on another call
  sunita.emit('call:accept', {callId: second.callId});
  await seen(ravi, 'call:ready');

  const problem = to => ask(asha, 'conference:invite', {id, to}).then(r => r.error);
  assert.equal(await problem('asha'), 'self');
  assert.equal(await problem(''), 'not-found');
  assert.equal(await problem('9999999999'), 'offline');
  assert.equal(await problem('bilal'), 'already-in');
  assert.equal(await problem('ravi'), 'busy');
  assert.equal(await problem('dev'), undefined);
  assert.equal(await problem('dev'), 'already-invited');
  assert.ok(dev);
});

test('a person in a meeting is busy for conference calls, and a person in a conference for meetings', async () => {
  const {id} = await threePeople();
  const dev = await join('dev');
  const created = await ask(dev, 'meeting:create', {title: 'x'});
  assert.equal(created.ok, true);
  const asha = clients.find(c => c.userId === 'asha');
  assert.equal((await ask(asha, 'conference:invite', {id, to: 'dev'})).error, 'busy');

  // and the other way round: Asha (in the conference) cannot start or join a meeting
  assert.equal((await ask(asha, 'meeting:create', {})).error, 'in-call');
  assert.equal((await ask(asha, 'meeting:join', {id: created.meeting.id})).error, 'in-call');
  // nor start a call
  assert.equal((await ask(asha, 'call:start', {to: 'ravi'})).error, 'in-meeting');
});

test('people in a conference show as busy in the list of people online', async () => {
  const {id} = await threePeople();
  const ravi = await join('ravi');
  await join('late'); // somebody else coming online sends everyone the list
  const list = await seen(ravi, 'users', users => users.find(u => u.id === 'asha')?.busy === true);
  assert.equal(list.find(u => u.id === 'chandni').busy, true);
  assert.ok(id);
});

test('adding a person fails cleanly: the call goes on if the person cannot be rung', async () => {
  const {caller: asha, callee: bilal, callId} = await onACall();
  await join('dev');
  assert.deepEqual(await ask(asha, 'call:add', {callId, to: '9999999999'}), {ok: false, error: 'offline'});
  assert.deepEqual(await ask(asha, 'call:add', {callId, to: 'asha'}), {ok: false, error: 'self'});
  assert.deepEqual(await ask(asha, 'call:add', {callId, to: 'bilal'}), {ok: false, error: 'busy'}); // already on this call
  assert.equal(asha.events.some(x => x.e === 'call:upgrade'), false);
  assert.equal(bilal.events.some(x => x.e === 'call:ended'), false); // the call is still on

  asha.emit('call:end', {callId});
  assert.equal((await seen(bilal, 'call:ended')).reason, 'ended'); // and it ends the normal way
});

test('adding a person is refused when the call is not going on, or the person is on another call', async () => {
  const asha = await join('asha');
  const bilal = await join('bilal');
  const ravi = await join('ravi');
  const sunita = await join('sunita');

  assert.deepEqual(await ask(asha, 'call:add', {callId: 'nope', to: 'ravi'}), {ok: false, error: 'not-active'});
  const {callId} = await ask(asha, 'call:start', {to: 'bilal', video: false}); // still ringing
  assert.deepEqual(await ask(asha, 'call:add', {callId, to: 'ravi'}), {ok: false, error: 'not-active'});
  bilal.emit('call:accept', {callId});
  await seen(asha, 'call:ready');

  const other = await ask(ravi, 'call:start', {to: 'sunita', video: false});
  sunita.emit('call:accept', {callId: other.callId});
  await seen(ravi, 'call:ready');
  assert.deepEqual(await ask(asha, 'call:add', {callId, to: 'ravi'}), {ok: false, error: 'busy'});
  assert.deepEqual(await ask(asha, 'call:add', {callId: other.callId, to: 'ravi'}), {ok: false, error: 'not-active'}); // not your call
});

test('a conference call needs Agora to be set up, and the call goes on without it', async () => {
  await restartWith({AGORA_APP_ID: '', AGORA_APP_CERTIFICATE: ''});
  const {caller: asha, callee: bilal, callId} = await onACall();
  await join('chandni');
  assert.deepEqual(await ask(asha, 'call:add', {callId, to: 'chandni'}), {ok: false, error: 'not-configured'});
  assert.equal(bilal.events.some(x => x.e === 'call:ended'), false);
});

test('only people who were added can join, and a stranger guessing an id gets nothing', async () => {
  const {id} = await threePeople();
  const stranger = await join('stranger');
  assert.deepEqual(await ask(stranger, 'conference:join', {id}), {ok: false, error: 'not-found'});
  assert.deepEqual(await ask(stranger, 'conference:join', {id: 'nope'}), {ok: false, error: 'not-found'});
  assert.deepEqual(await ask(stranger, 'conference:leave', {id}), {ok: false, error: 'not-in-conference'});
  assert.deepEqual(await ask(stranger, 'conference:invite', {id, to: 'dev'}), {ok: false, error: 'not-in-conference'});
});

test('mic and camera changes are shown to everyone', async () => {
  const {asha, bilal, id} = await threePeople();
  assert.deepEqual(await ask(bilal, 'conference:state', {id, muted: true, cameraOn: true}), {ok: true});
  const update = await seen(asha, 'conference:update', d => d.participants.find(p => p.id === 'bilal')?.muted === true);
  assert.equal(update.participants.find(p => p.id === 'bilal').cameraOn, true);
});

test('anyone can leave; when only one person is left the conference ends for them', async () => {
  const {asha, bilal, chandni, id} = await threePeople();
  assert.deepEqual(await ask(chandni, 'conference:leave', {id}), {ok: true});
  await roster(asha, ['asha', 'bilal']); // two are still a call
  assert.equal(asha.events.some(x => x.e === 'conference:ended'), false);

  assert.deepEqual(await ask(bilal, 'conference:leave', {id}), {ok: true});
  assert.deepEqual(await seen(asha, 'conference:ended'), {id, reason: 'alone'});
  // everybody is free again
  assert.equal((await ask(asha, 'call:start', {to: 'bilal', video: false})).ok, true);
});

test('a person who is still being rung keeps the conference going when everybody else leaves', async () => {
  const {asha, bilal, chandni, id} = await threePeople();
  const dev = await join('dev');
  await ask(asha, 'conference:invite', {id, to: 'dev'});
  await ask(bilal, 'conference:leave', {id});
  await ask(chandni, 'conference:leave', {id});
  await wait(60);
  assert.equal(asha.events.some(x => x.e === 'conference:ended'), false); // Dev is still ringing
  assert.equal((await ask(dev, 'conference:join', {id})).ok, true);
  await roster(asha, ['asha', 'dev']);
});

test('if the new person says no before the others have even moved over, nothing is left behind', async () => {
  const {caller: asha, callId} = await onACall();
  const chandni = await join('chandni');
  const {conferenceId} = await ask(asha, 'call:add', {callId, to: 'chandni'});
  await seen(chandni, 'conference:invitation');
  assert.equal((await ask(asha, 'conference:join', {id: conferenceId})).ok, true);
  await ask(chandni, 'conference:decline', {id: conferenceId});
  // Bilal has not joined yet (still pending), so it goes on; when he joins it is a normal two-person call
  assert.equal((await ask(clients.find(c => c.userId === 'bilal'), 'conference:join', {id: conferenceId})).ok, true);
  await roster(asha, ['asha', 'bilal']);
});

test('a dropped connection keeps your place for a short while; someone who does not come back is removed', async () => {
  const {asha, bilal, chandni, id} = await threePeople();
  chandni.disconnect();
  const offline = await seen(asha, 'conference:update', d => d.participants.find(p => p.id === 'chandni')?.offline === true);
  assert.equal(offline.participants.length, 3); // still listed

  const back = await join('chandni'); // the app reconnects
  const res = await ask(back, 'conference:join', {id});
  assert.equal(res.ok, true);
  await seen(asha, 'conference:update', d => d.participants.find(p => p.id === 'chandni')?.offline === false);

  bilal.disconnect(); // and this one never comes back
  await roster(asha, ['asha', 'chandni']);
});

test('a fresh token can be asked for before the first one runs out', async () => {
  const {asha, id, joined} = await threePeople();
  const res = await ask(asha, 'conference:token', {id});
  assert.equal(res.ok, true);
  assert.equal(res.join.channel, joined.a.join.channel);
  assert.equal(res.join.account, 'asha');
  assert.deepEqual(await ask(await join('stranger'), 'conference:token', {id}), {ok: false, error: 'not-in-conference'});
});

test('up to 100 people fit, and the limit can be lowered', async () => {
  await restartWith({CONFERENCE_MAX_PARTICIPANTS: '4'});
  const {asha, id} = await threePeople();
  const a = await join('a1');
  const b = await join('b1');
  assert.equal((await ask(asha, 'conference:invite', {id, to: 'a1'})).ok, true); // 3 in + 1 ringing = 4
  assert.deepEqual(await ask(asha, 'conference:invite', {id, to: 'b1'}), {ok: false, error: 'full'});
  assert.ok(a && b);

  await restartWith({CONFERENCE_MAX_PARTICIPANTS: '500'}); // cannot go over 100
  const again = await threePeople();
  assert.equal((await seen(again.asha, 'conference:update')).maxParticipants, 100);
});

test('ringing people is slowed down so it cannot be used to pester', async () => {
  await restartWith({CONFERENCE_INVITES_PER_MINUTE: '2'});
  const {asha, id} = await threePeople();
  for (const name of ['a1', 'a2', 'a3']) {
    await join(name);
  }
  assert.equal((await ask(asha, 'conference:invite', {id, to: 'a1'})).ok, true);
  assert.equal((await ask(asha, 'conference:invite', {id, to: 'a2'})).ok, true);
  assert.deepEqual(await ask(asha, 'conference:invite', {id, to: 'a3'}), {ok: false, error: 'slow-down'});
});

test('the health page shows how many conferences are live', async () => {
  await threePeople();
  const health = await (await fetch(`${url}/health`)).json();
  assert.equal(health.conferences, 1);
  assert.equal(health.meetings, 0);
});
