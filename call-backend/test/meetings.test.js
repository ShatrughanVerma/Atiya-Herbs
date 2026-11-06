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
let store;
let clock;
const clients = [];

const start = async (env = {...LIVEKIT, ...AGORA}) => {
  store = new MemoryStore();
  clock = 1_800_000_000_000;
  ({server} = createCallBackend({RING_TIMEOUT_MS: '2000', MEETING_RECONNECT_GRACE_MS: '150', ...env}, () => {}, {store, now: () => clock}));
  server.listen(0);
  await once(server, 'listening');
  url = `http://127.0.0.1:${server.address().port}`;
};
beforeEach(() => start());
afterEach(async () => {
  clients.splice(0).forEach(c => c.disconnect());
  await new Promise(resolve => server.close(resolve));
});

const join = async (userId, name = userId) => {
  const socket = connect(url, {auth: {userId, name}, transports: ['websocket'], reconnection: false});
  clients.push(socket);
  socket.userId = userId;
  await once(socket, 'session');
  socket.events = [];
  for (const e of ['meeting:update', 'meeting:chat', 'meeting:chat-receipt', 'meeting:mute-request', 'meeting:removed', 'meeting:ended', 'meeting:invitation', 'meeting:invitation-ended', 'meeting:invite-result', 'call:upgrade', 'call:ended', 'call:ready']) {
    socket.on(e, data => socket.events.push({e, data}));
  }
  return socket;
};
const ask = (socket, event, payload) => new Promise(resolve => socket.emit(event, payload, resolve));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
// waits until the socket has received an event that matches, then returns it
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
const roster = (socket, ids) => seen(socket, 'meeting:update', d => d.participants.map(p => p.id).sort().join() === [...ids].sort().join());

// Asha starts a meeting; Bilal and Chandni join it by its id
const threePeople = async () => {
  const asha = await join('asha', 'Asha');
  const bilal = await join('bilal', 'Bilal');
  const chandni = await join('chandni', 'Chandni');
  const created = await ask(asha, 'meeting:create', {title: 'Clinic review'});
  const id = created.meeting.id;
  assert.equal((await ask(bilal, 'meeting:join', {id})).ok, true);
  assert.equal((await ask(chandni, 'meeting:join', {id})).ok, true);
  return {asha, bilal, chandni, id, created};
};

test('a meeting is created, and the host gets an Agora token for its own channel (never the certificate)', async () => {
  const asha = await join('asha', 'Asha');
  const res = await ask(asha, 'meeting:create', {title: 'Clinic review'});
  assert.equal(res.ok, true);
  assert.match(res.meeting.id, /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/);
  assert.deepEqual([res.meeting.title, res.meeting.hostId, res.you], ['Clinic review', 'asha', {id: 'asha', role: 'host'}]);
  assert.deepEqual([res.join.provider, res.join.appId, res.join.account], ['agora', AGORA.AGORA_APP_ID, 'asha']);
  assert.equal(res.join.channel, `mtg-${res.meeting.id.replaceAll('-', '')}`);
  assert.match(res.join.token, /^007/);
  assert.equal(JSON.stringify(res).includes(AGORA.AGORA_APP_CERTIFICATE), false);
  assert.deepEqual(res.meeting.participants.map(p => [p.id, p.role]), [['asha', 'host']]);
});

test('three people in one meeting: each joins with their own token, everybody sees the same list', async () => {
  const {asha, bilal, chandni, id, created} = await threePeople();
  const everyone = ['asha', 'bilal', 'chandni'];
  for (const s of [asha, bilal, chandni]) {
    const update = await roster(s, everyone);
    assert.equal(update.id, id);
    assert.equal(update.hostId, 'asha');
  }
  const again = await ask(await join('dev', 'Dev'), 'meeting:join', {id});
  assert.equal(again.join.channel, created.join.channel); // the same channel for everyone
  assert.equal(again.join.account, 'dev');
  assert.notEqual(again.join.token, created.join.token); // but each person's own token
});

test('the id works as typed: any case, with or without dashes and spaces', async () => {
  const asha = await join('asha');
  const bilal = await join('bilal');
  const {meeting} = await ask(asha, 'meeting:create', {});
  const loose = meeting.id.toUpperCase().replaceAll('-', ' ');
  assert.equal((await ask(bilal, 'meeting:join', {id: loose})).meeting.id, meeting.id);
});

test('an unknown, mistyped or ended meeting cannot be joined', async () => {
  const bilal = await join('bilal');
  for (const id of ['', 'nope', 'abc-defg-hij', 'iol-0000-000', undefined]) {
    assert.deepEqual(await ask(bilal, 'meeting:join', {id}), {ok: false, error: 'not-found'});
  }
  assert.deepEqual(await ask(bilal, 'meeting:leave', {id: 'abc-defg-hij'}), {ok: false, error: 'not-in-meeting'});
});

test('chat reaches everyone at once, a late joiner gets the earlier messages, and it is limited', async () => {
  const {asha, bilal, chandni, id} = await threePeople();
  const sent = await ask(bilal, 'meeting:chat', {id, to: 'all', text: '  Namaste sab  '});
  assert.deepEqual([sent.ok, sent.message.text, sent.message.from], [true, 'Namaste sab', {id: 'bilal', name: 'Bilal'}]);
  for (const s of [asha, bilal, chandni]) {
    assert.equal((await seen(s, 'meeting:chat')).message.text, 'Namaste sab');
  }
  const late = await ask(await join('dev', 'Dev'), 'meeting:join', {id});
  assert.deepEqual(late.chat.map(m => m.text), ['Namaste sab']);

  assert.deepEqual(await ask(asha, 'meeting:chat', {id, to: 'all', text: '   '}), {ok: false, error: 'empty'});
  assert.equal((await ask(asha, 'meeting:chat', {id, to: 'all', text: 'x'.repeat(5000)})).message.text.length, 1000);
  let last;
  for (let i = 0; i < 10; i++) {
    last = await ask(chandni, 'meeting:chat', {id, to: 'all', text: `spam ${i}`});
  }
  assert.deepEqual(last, {ok: false, error: 'slow-down'});
});

test('a message goes only to the person it is sent to, never to everybody by default', async () => {
  const {asha, bilal, chandni, id} = await threePeople();
  assert.deepEqual(await ask(bilal, 'meeting:chat', {id, text: 'hi'}), {ok: false, error: 'no-recipient'});
  assert.deepEqual(await ask(bilal, 'meeting:chat', {id, to: 'bilal', text: 'hi'}), {ok: false, error: 'no-recipient'});
  assert.deepEqual(await ask(bilal, 'meeting:chat', {id, to: 'nobody', text: 'hi'}), {ok: false, error: 'not-found'});
  const sent = await ask(bilal, 'meeting:chat', {id, to: 'asha', text: 'only you'});
  assert.deepEqual(sent.message.to, {id: 'asha', name: 'Asha'});
  assert.equal((await seen(asha, 'meeting:chat')).message.text, 'only you');
  await seen(bilal, 'meeting:chat');
  await wait(100);
  assert.equal(chandni.events.some(x => x.e === 'meeting:chat'), false);
  // a late joiner and the third person do not get it from the history either
  assert.deepEqual((await ask(await join('dev', 'Dev'), 'meeting:join', {id})).chat, []);
  // and cannot send receipts for it
  await ask(chandni, 'meeting:chat-receipt', {id, messageIds: [sent.message.id], state: 'seen'});
  assert.equal(bilal.events.some(x => x.e === 'meeting:chat-receipt'), false);
});

test('delivered and seen receipts go back to the sender only', async () => {
  const {asha, bilal, id} = await threePeople();
  const sent = await ask(bilal, 'meeting:chat', {id, to: 'asha', text: 'hello'});
  const mid = sent.message.id;
  await ask(asha, 'meeting:chat-receipt', {id, messageIds: [mid], state: 'delivered'});
  const got = await seen(bilal, 'meeting:chat-receipt', d => d.state === 'delivered');
  assert.deepEqual([got.messageIds, got.userId], [[mid], 'asha']);
  await ask(asha, 'meeting:chat-receipt', {id, messageIds: [mid], state: 'seen'});
  assert.equal((await seen(bilal, 'meeting:chat-receipt', d => d.state === 'seen')).userId, 'asha');
  // nobody gets a receipt for their own message
  await ask(bilal, 'meeting:chat-receipt', {id, messageIds: [mid], state: 'seen'});
  assert.equal(asha.events.some(x => x.e === 'meeting:chat-receipt'), false);
});

test('mic and camera changes are shown to everyone', async () => {
  const {asha, bilal, id} = await threePeople();
  await ask(bilal, 'meeting:state', {id, muted: true, cameraOn: true});
  const update = await seen(asha, 'meeting:update', d => d.participants.find(p => p.id === 'bilal')?.muted === true);
  assert.deepEqual(update.participants.find(p => p.id === 'bilal'), {...update.participants.find(p => p.id === 'bilal'), muted: true, cameraOn: true});
});

test('host controls: only the host can mute, remove, lock or end; mute-all skips the host', async () => {
  const {asha, bilal, chandni, id} = await threePeople();
  for (const [event, extra] of [['meeting:mute', {userId: 'chandni'}], ['meeting:remove', {userId: 'chandni'}], ['meeting:lock', {locked: true}], ['meeting:end', {}]]) {
    assert.deepEqual(await ask(bilal, event, {id, ...extra}), {ok: false, error: 'host-only'}, event);
  }

  assert.deepEqual(await ask(asha, 'meeting:mute', {id, userId: 'chandni'}), {ok: true, asked: 1});
  assert.equal((await seen(chandni, 'meeting:mute-request')).by.id, 'asha');
  assert.equal(bilal.events.some(x => x.e === 'meeting:mute-request'), false); // only the one asked

  assert.deepEqual(await ask(asha, 'meeting:mute', {id, userId: 'all'}), {ok: true, asked: 2});
  await seen(bilal, 'meeting:mute-request', d => d.all === true);
  assert.equal(asha.events.some(x => x.e === 'meeting:mute-request'), false); // the host is not asked
  assert.deepEqual(await ask(asha, 'meeting:mute', {id, userId: 'nobody'}), {ok: false, error: 'not-found'});
});

test('the host can remove someone: they are told, the list updates, and they cannot come back', async () => {
  const {asha, bilal, chandni, id} = await threePeople();
  assert.deepEqual(await ask(asha, 'meeting:remove', {id, userId: 'asha'}), {ok: false, error: 'not-found'}); // not yourself
  assert.deepEqual(await ask(asha, 'meeting:remove', {id, userId: 'chandni'}), {ok: true});
  assert.equal((await seen(chandni, 'meeting:removed')).by.id, 'asha');
  await roster(asha, ['asha', 'bilal']);
  await roster(bilal, ['asha', 'bilal']);
  assert.deepEqual(await ask(chandni, 'meeting:join', {id}), {ok: false, error: 'removed'});
  assert.deepEqual(await ask(chandni, 'meeting:chat', {id, to: 'asha', text: 'hello'}), {ok: false, error: 'not-in-meeting'});
});

test('a locked meeting turns new people away, and allows them again when unlocked', async () => {
  const {asha, id} = await threePeople();
  const dev = await join('dev');
  assert.deepEqual(await ask(asha, 'meeting:lock', {id, locked: true}), {ok: true, locked: true});
  assert.deepEqual(await ask(dev, 'meeting:join', {id}), {ok: false, error: 'locked'});
  assert.deepEqual(await ask(asha, 'meeting:lock', {id, locked: false}), {ok: true, locked: false});
  assert.equal((await ask(dev, 'meeting:join', {id})).ok, true);
});

test('a full meeting turns people away', async () => {
  const asha = await join('asha');
  const {meeting} = await ask(asha, 'meeting:create', {maxParticipants: 2});
  assert.equal((await ask(await join('bilal'), 'meeting:join', {id: meeting.id})).ok, true);
  assert.deepEqual(await ask(await join('chandni'), 'meeting:join', {id: meeting.id}), {ok: false, error: 'full'});
});

test('only one person shares their screen at a time', async () => {
  const {asha, bilal, chandni, id} = await threePeople();
  assert.deepEqual(await ask(bilal, 'meeting:share', {id, sharing: true}), {ok: true});
  const update = await seen(asha, 'meeting:update', d => d.sharingId === 'bilal');
  assert.equal(update.participants.find(p => p.id === 'bilal').sharing, true);
  assert.deepEqual(await ask(chandni, 'meeting:share', {id, sharing: true}), {ok: false, error: 'busy', by: 'Bilal'});
  await ask(chandni, 'meeting:share', {id, sharing: false}); // someone else cannot stop it
  assert.equal((await seen(asha, 'meeting:update', d => d.sharingId === 'bilal')).sharingId, 'bilal');
  await ask(bilal, 'meeting:share', {id, sharing: false});
  await seen(asha, 'meeting:update', d => d.sharingId === null && d.participants.every(p => !p.sharing));
  assert.deepEqual(await ask(chandni, 'meeting:share', {id, sharing: true}), {ok: true});
});

test('when the host leaves the longest-standing person becomes host; the last one out ends the meeting', async () => {
  const {asha, bilal, chandni, id} = await threePeople();
  assert.deepEqual(await ask(asha, 'meeting:leave', {id}), {ok: true});
  const update = await seen(bilal, 'meeting:update', d => d.hostId === 'bilal');
  assert.deepEqual(update.participants.map(p => [p.id, p.role]), [['bilal', 'host'], ['chandni', 'participant']]);
  assert.deepEqual(await ask(bilal, 'meeting:lock', {id, locked: true}), {ok: true, locked: true}); // and has the powers

  await ask(bilal, 'meeting:leave', {id});
  await ask(chandni, 'meeting:leave', {id});
  assert.deepEqual(await ask(await join('dev'), 'meeting:join', {id}), {ok: false, error: 'ended'});
});

test('ending a meeting tells everyone and closes it', async () => {
  const {asha, bilal, chandni, id} = await threePeople();
  assert.deepEqual(await ask(asha, 'meeting:end', {id}), {ok: true});
  for (const s of [bilal, chandni]) {
    assert.deepEqual(await seen(s, 'meeting:ended'), {id, reason: 'host', by: 'asha'});
  }
  assert.deepEqual(await ask(bilal, 'meeting:join', {id}), {ok: false, error: 'ended'});
  assert.deepEqual(await ask(bilal, 'meeting:chat', {id, text: 'hi'}), {ok: false, error: 'not-in-meeting'});
  // and everyone is free to start or join another one
  assert.equal((await ask(bilal, 'meeting:create', {})).ok, true);
});

test('a dropped connection keeps your place for a short while, and coming back keeps your role', async () => {
  const {asha, bilal, id} = await threePeople();
  asha.disconnect();
  const away = await seen(bilal, 'meeting:update', d => d.participants.find(p => p.id === 'asha')?.offline === true);
  assert.equal(away.hostId, 'asha');

  const back = await join('asha', 'Asha');
  const res = await ask(back, 'meeting:join', {id});
  assert.deepEqual([res.ok, res.you.role], [true, 'host']); // still the host
  await seen(bilal, 'meeting:update', d => d.participants.find(p => p.id === 'asha')?.offline === false);
  await wait(300); // longer than the grace period: the old connection must not remove them
  assert.equal((await ask(back, 'meeting:chat', {id, to: 'all', text: 'back'})).ok, true);
});

test('someone who does not come back is removed after the grace period, and the host passes on', async () => {
  const {asha, bilal, id} = await threePeople();
  asha.disconnect();
  const update = await seen(bilal, 'meeting:update', d => d.hostId === 'bilal');
  assert.deepEqual(update.participants.map(p => p.id), ['bilal', 'chandni']);
  assert.equal(id.length, 12);
});

test('a fresh token can be asked for before the first one runs out', async () => {
  const {bilal, id, created} = await threePeople();
  const res = await ask(bilal, 'meeting:token', {id});
  assert.equal(res.ok, true);
  assert.equal(res.join.channel, created.join.channel);
  assert.match(res.join.token, /^007/);
  assert.deepEqual(await ask(await join('dev'), 'meeting:token', {id}), {ok: false, error: 'not-in-meeting'}); // only members
});

test('a meeting link shows the basics without joining and without any token', async () => {
  const {id} = await threePeople();
  const res = await fetch(`${url}/meetings/${id.toUpperCase()}`);
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.deepEqual(JSON.parse(text), {id, title: 'Clinic review', hostName: 'Asha', status: 'live', locked: false, participants: 3, maxParticipants: 25});
  assert.equal(/token|007/.test(text), false);
  assert.equal((await fetch(`${url}/meetings/zzz-zzzz-zzz`)).status, 404);

  const dev = await join('dev');
  assert.deepEqual((await ask(dev, 'meeting:info', {id})).participants, 3);
});

test('your recent meetings are listed, newest first', async () => {
  const asha = await join('asha', 'Asha');
  const first = await ask(asha, 'meeting:create', {title: 'First'});
  await ask(asha, 'meeting:leave', {id: first.meeting.id});
  clock += 60_000;
  const second = await ask(asha, 'meeting:create', {title: 'Second'});
  const list = await ask(asha, 'meeting:list', {});
  assert.deepEqual(list.meetings.map(m => [m.title, m.status]), [['Second', 'live'], ['First', 'ended']]);
  assert.equal(list.meetings[0].id, second.meeting.id);
  assert.deepEqual(await ask(await join('nobody'), 'meeting:list', {}), {ok: true, meetings: []});
});

test('the database keeps who joined and left, who the host was, and when it ended', async () => {
  const {asha, bilal, id} = await threePeople();
  await ask(bilal, 'meeting:leave', {id});
  await ask(asha, 'meeting:end', {id});
  await wait(30);
  const meeting = await store.meetingGet(id);
  assert.deepEqual([meeting.host_id, meeting.status, meeting.ended_by, meeting.peak_participants], ['asha', 'ended', 'asha', 3]);
  const people = await store.participantsOf(id);
  assert.deepEqual(people.map(p => p.user_id).sort(), ['asha', 'bilal', 'chandni']);
  assert.equal(people.every(p => p.left_at), true);
});

test('a meeting needs Agora to be set up on the server', async () => {
  clients.splice(0).forEach(c => c.disconnect());
  await new Promise(resolve => server.close(resolve));
  await start({...LIVEKIT}); // LiveKit calls only, no Agora
  const asha = await join('asha');
  assert.deepEqual(await ask(asha, 'meeting:create', {}), {ok: false, error: 'not-configured'});
  assert.deepEqual(await ask(asha, 'meeting:join', {id: 'abc-defg-hij'}), {ok: false, error: 'not-configured'});
});

test('one-to-one LiveKit calls and group meetings do not get in each other\'s way', async () => {
  const {id} = await threePeople(); // asha, bilal, chandni are in a meeting
  const ravi = await join('ravi', 'Ravi');
  const sunita = await join('sunita', 'Sunita');

  // someone in a meeting cannot be called, and cannot call
  const asha = clients.find(c => c.userId === 'asha');
  assert.deepEqual(await ask(ravi, 'call:start', {to: 'asha', video: false}), {ok: false, error: 'busy'});
  assert.deepEqual(await ask(asha, 'call:start', {to: 'ravi', video: false}), {ok: false, error: 'in-meeting'});

  // two other people call each other on LiveKit exactly as before
  const {callId} = await ask(ravi, 'call:start', {to: 'sunita', video: true});
  const readyR = once(ravi, 'call:ready');
  const readyS = once(sunita, 'call:ready');
  sunita.emit('call:accept', {callId});
  const [[r], [s]] = [await readyR, await readyS];
  assert.deepEqual([r.provider, s.provider, r.serverUrl], ['livekit', 'livekit', LIVEKIT.LIVEKIT_URL]);

  // and someone on a call cannot join a meeting
  assert.deepEqual(await ask(ravi, 'meeting:join', {id}), {ok: false, error: 'in-call'});
  assert.deepEqual(await ask(ravi, 'meeting:create', {}), {ok: false, error: 'in-call'});
});

test('you can be in only one meeting at a time, and the list of people online shows who is busy', async () => {
  const {id} = await threePeople();
  const asha = clients.find(c => c.userId === 'asha');
  const other = await ask(await join('dev'), 'meeting:create', {});
  assert.deepEqual(await ask(asha, 'meeting:join', {id: other.meeting.id}), {ok: false, error: 'in-meeting'});
  assert.deepEqual(await ask(asha, 'meeting:create', {}), {ok: false, error: 'in-meeting'});
  const watcher = await join('watcher');
  const listed = new Promise(resolve => watcher.once('users', resolve)); // the list is sent again when anyone connects
  await join('someone-else');
  assert.equal((await listed).find(u => u.id === 'bilal').busy, true);
});

test('starting meetings too fast is slowed down', async () => {
  const asha = await join('asha');
  let last;
  for (let i = 0; i < 11; i++) {
    last = await ask(asha, 'meeting:create', {});
    if (last.ok) {
      await ask(asha, 'meeting:end', {id: last.meeting.id});
    }
  }
  assert.deepEqual(last, {ok: false, error: 'slow-down'});
});

test('six people can be in one meeting at once, and the list stays correct as people come and go', async () => {
  const asha = await join('asha', 'Asha');
  const {meeting} = await ask(asha, 'meeting:create', {});
  const others = [];
  for (const name of ['p1', 'p2', 'p3', 'p4', 'p5']) {
    const s = await join(name, name);
    assert.equal((await ask(s, 'meeting:join', {id: meeting.id})).ok, true);
    others.push(s);
  }
  await roster(asha, ['asha', 'p1', 'p2', 'p3', 'p4', 'p5']);
  await ask(others[2], 'meeting:leave', {id: meeting.id});
  await roster(asha, ['asha', 'p1', 'p2', 'p4', 'p5']);
  assert.equal((await ask(others[0], 'meeting:chat', {id: meeting.id, to: 'all', text: 'hi'})).ok, true);
  for (const s of [asha, others[1], others[4]]) {
    assert.equal((await seen(s, 'meeting:chat')).message.from.id, 'p1');
  }
});

// ---- ringing people into a meeting by their number, and adding a person to a call that is going on ----

const startWith = async env => {
  clients.splice(0).forEach(c => c.disconnect());
  await new Promise(resolve => server.close(resolve));
  await start({...LIVEKIT, ...AGORA, ...env});
};

// Two people on a normal one-to-one LiveKit call
const onACall = async (callerName = 'asha', calleeName = 'bilal') => {
  const caller = await join(callerName, callerName[0].toUpperCase() + callerName.slice(1));
  const callee = await join(calleeName, calleeName[0].toUpperCase() + calleeName.slice(1));
  const {callId} = await ask(caller, 'call:start', {to: calleeName, video: false});
  const ready = once(caller, 'call:ready');
  callee.emit('call:accept', {callId});
  assert.equal((await ready)[0].provider, 'livekit');
  return {caller, callee, callId};
};

test('anyone in a meeting can ring a number: the person gets an Accept / Decline screen, and accepting joins them', async () => {
  const {asha, bilal, id} = await threePeople();
  const dev = await join('dev', 'Dev');
  // Bilal is not the host, and can still add someone
  assert.deepEqual(await ask(bilal, 'meeting:invite', {id, to: 'dev'}), {ok: true, invited: {id: 'dev', name: 'Dev'}});
  const invitation = await seen(dev, 'meeting:invitation');
  assert.deepEqual([invitation.id, invitation.title, invitation.from], [id, 'Clinic review', {id: 'bilal', name: 'Bilal'}]);
  assert.equal(invitation.ttlMs, 45_000);

  const ringing = await seen(asha, 'meeting:update', d => d.invited.length === 1);
  assert.deepEqual(ringing.invited.map(i => [i.id, i.name, i.by]), [['dev', 'Dev', 'bilal']]); // everyone sees "ringing"

  const res = await ask(dev, 'meeting:join', {id}); // Accept
  assert.deepEqual([res.ok, res.you.role], [true, 'participant']);
  const done = await seen(asha, 'meeting:update', d => d.participants.length === 4);
  assert.deepEqual(done.invited, []);
});

test('the person rung can decline, and the one who rang is told', async () => {
  const {asha, id} = await threePeople();
  const dev = await join('dev', 'Dev');
  await ask(asha, 'meeting:invite', {id, to: 'dev'});
  await seen(dev, 'meeting:invitation');
  assert.deepEqual(await ask(dev, 'meeting:decline', {id}), {ok: true});
  assert.deepEqual(await seen(asha, 'meeting:invite-result'), {id, to: 'dev', name: 'Dev', result: 'declined'});
  await seen(asha, 'meeting:update', d => d.invited.length === 0 && d.participants.length === 3);
  assert.deepEqual(await ask(dev, 'meeting:decline', {id}), {ok: true}); // saying no twice does nothing
});

test('if nobody answers the ringing stops, and both sides are told', async () => {
  await startWith({MEETING_INVITE_SECONDS: '0.1'});
  const {asha, id} = await threePeople();
  const dev = await join('dev', 'Dev');
  await ask(asha, 'meeting:invite', {id, to: 'dev'});
  assert.equal((await seen(dev, 'meeting:invitation')).ttlMs, 100);
  assert.equal((await seen(asha, 'meeting:invite-result')).result, 'no-answer');
  assert.equal((await seen(dev, 'meeting:invitation-ended')).id, id);
  await seen(asha, 'meeting:update', d => d.invited.length === 0);
});

test('the person who rang, or the host, can stop the ringing; nobody else can', async () => {
  const {asha, bilal, chandni, id} = await threePeople();
  const dev = await join('dev', 'Dev');
  await ask(bilal, 'meeting:invite', {id, to: 'dev'});
  await seen(dev, 'meeting:invitation');
  assert.deepEqual(await ask(chandni, 'meeting:cancel-invite', {id, userId: 'dev'}), {ok: false, error: 'not-found'});
  assert.deepEqual(await ask(bilal, 'meeting:cancel-invite', {id, userId: 'dev'}), {ok: true});
  assert.equal((await seen(dev, 'meeting:invitation-ended')).id, id);

  await ask(chandni, 'meeting:invite', {id, to: 'dev'});
  assert.deepEqual(await ask(asha, 'meeting:cancel-invite', {id, userId: 'dev'}), {ok: true}); // the host may
});

test('ending the meeting closes the ringing screens', async () => {
  const {asha, id} = await threePeople();
  const dev = await join('dev', 'Dev');
  await ask(asha, 'meeting:invite', {id, to: 'dev'});
  await seen(dev, 'meeting:invitation');
  await ask(asha, 'meeting:end', {id});
  assert.equal((await seen(dev, 'meeting:invitation-ended')).id, id);
});

test('a number cannot be rung when it is yourself, nobody, offline, already in, already ringing, busy or removed', async () => {
  const {asha, bilal, id} = await threePeople();
  await join('dev', 'Dev');
  const ravi = await join('ravi', 'Ravi');
  const sunita = await join('sunita', 'Sunita');

  assert.deepEqual(await ask(asha, 'meeting:invite', {id, to: 'asha'}), {ok: false, error: 'self'});
  assert.deepEqual(await ask(asha, 'meeting:invite', {id, to: '9999999999'}), {ok: false, error: 'offline'});
  assert.deepEqual(await ask(asha, 'meeting:invite', {id, to: ''}), {ok: false, error: 'not-found'});
  assert.deepEqual(await ask(asha, 'meeting:invite', {id, to: 'bilal'}), {ok: false, error: 'already-in'});

  await ask(asha, 'meeting:invite', {id, to: 'dev'});
  assert.deepEqual(await ask(bilal, 'meeting:invite', {id, to: 'dev'}), {ok: false, error: 'already-invited'});

  // on a one-to-one call
  const {callId} = await ask(ravi, 'call:start', {to: 'sunita', video: false});
  const ready = once(ravi, 'call:ready');
  sunita.emit('call:accept', {callId});
  await ready;
  assert.deepEqual(await ask(asha, 'meeting:invite', {id, to: 'ravi'}), {ok: false, error: 'busy'});

  // removed by the host
  await ask(asha, 'meeting:remove', {id, userId: 'bilal'});
  assert.deepEqual(await ask(asha, 'meeting:invite', {id, to: 'bilal'}), {ok: false, error: 'removed'});
});

test('a person already in another meeting is busy', async () => {
  const {asha, id} = await threePeople();
  const dev = await join('dev', 'Dev');
  assert.equal((await ask(dev, 'meeting:create', {})).ok, true);
  assert.deepEqual(await ask(asha, 'meeting:invite', {id, to: 'dev'}), {ok: false, error: 'busy'});
});

test('only a member can ring someone; in a locked meeting only the host can, and the person rung may come in', async () => {
  const {asha, bilal, id} = await threePeople();
  const dev = await join('dev', 'Dev');
  await join('ravi', 'Ravi');
  assert.deepEqual(await ask(dev, 'meeting:invite', {id, to: 'ravi'}), {ok: false, error: 'not-in-meeting'});

  await ask(asha, 'meeting:lock', {id, locked: true});
  assert.deepEqual(await ask(bilal, 'meeting:invite', {id, to: 'dev'}), {ok: false, error: 'locked'});
  assert.deepEqual(await ask(dev, 'meeting:join', {id}), {ok: false, error: 'locked'}); // asking on their own still fails
  assert.deepEqual(await ask(asha, 'meeting:invite', {id, to: 'dev'}), {ok: true, invited: {id: 'dev', name: 'Dev'}});
  assert.equal((await ask(dev, 'meeting:join', {id})).ok, true); // but when the host rings, they can come in
});

test('a full meeting counts the people being rung, and ringing is slowed down', async () => {
  await startWith({MEETING_INVITES_PER_MINUTE: '2'});
  const asha = await join('asha', 'Asha');
  const {meeting} = await ask(asha, 'meeting:create', {maxParticipants: 3});
  for (const name of ['a1', 'a2', 'a3']) {
    await join(name, name);
  }
  assert.equal((await ask(asha, 'meeting:invite', {id: meeting.id, to: 'a1'})).ok, true);
  assert.equal((await ask(asha, 'meeting:invite', {id: meeting.id, to: 'a2'})).ok, true);
  assert.deepEqual(await ask(asha, 'meeting:invite', {id: meeting.id, to: 'a3'}), {ok: false, error: 'full'}); // 1 in + 2 ringing = 3
  await ask(asha, 'meeting:cancel-invite', {id: meeting.id, userId: 'a2'});
  assert.deepEqual(await ask(asha, 'meeting:invite', {id: meeting.id, to: 'a3'}), {ok: false, error: 'slow-down'}); // a third ring inside a minute
});
