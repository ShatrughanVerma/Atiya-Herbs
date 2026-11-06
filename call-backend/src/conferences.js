const crypto = require('node:crypto');

// Conference calls: a one-to-one call that grows. When one of the two people on a call adds a third (and a fourth,
// up to 100), the call becomes a conference in its own Agora channel. It is a CALL, not a meeting: everybody has the
// same rights (no host, no lock, no chat), anyone in it can add more people by mobile number, and it ends by itself
// when only one person is left. It is separate from meetings.js (which it does not use) and from the one-to-one
// calls in signaling.js (which hands over to it).
//
// Client -> server (Socket.IO, each with an ack {ok, ...} or {ok: false, error}):
//   conference:join   {id}                  Accept an invitation, or come back after a dropped connection
//   conference:leave  {id}
//   conference:state  {id, muted?, cameraOn?}   your mic / camera, shown to the others
//   conference:invite {id, to}              anyone in it: ring a mobile number to join (Accept / Decline screen)
//   conference:decline {id}                 the person who was rung says no
//   conference:cancel-invite {id, userId}   the person who rang stops the ringing
//   conference:token  {id}                  a fresh Agora token (they expire; the app asks before that)
// Server -> client:
//   conference:update {id, video, startedAt, maxParticipants, participants: [...], invited: [...]}  on every change
//   conference:invitation {id, from, video, ttlMs}   you are being rung to join
//   conference:invitation-ended {id}        the ringing stopped (answered, cancelled, timed out, or it ended)
//   conference:invite-result {id, to, name, result}  to whoever rang: declined | no-answer
//   conference:ended {id, reason}           it is over: alone (one person left) | empty

const LETTERS = 'abcdefghjkmnpqrstuvwxyz'; // no i, l or o, which look like 1 and 0
const ID_LENGTH = 10;
const newId = () => Array.from({length: ID_LENGTH}, () => LETTERS[crypto.randomInt(LETTERS.length)]).join('');
const normalizeConferenceId = value => String(value || '').toLowerCase().replace(/[^a-z]/g, '');
const validId = id => id.length === ID_LENGTH && [...id].every(c => LETTERS.includes(c));
const normalizeUserId = value => String(value || '').trim().toLowerCase().slice(0, 120);
const iso = ms => new Date(ms).toISOString();

function createConferences({
  io,
  agora,
  isBusy = () => false, // a user id -> true when they are on a call or in a meeting
  findUser = () => null, // a user id -> {name, socketId} when they are connected (from signaling.js)
  env = process.env,
  log = () => {},
  now = () => Date.now(),
}) {
  const maxParticipants = Math.min(Number(env.CONFERENCE_MAX_PARTICIPANTS) || 100, 100);
  const graceMs = env.CONFERENCE_RECONNECT_GRACE_MS !== undefined ? Number(env.CONFERENCE_RECONNECT_GRACE_MS) : 20_000;
  const keepEndedMs = Number(env.CONFERENCE_KEEP_ENDED_MS) || 600_000;
  const inviteTtlMs = (Number(env.CONFERENCE_INVITE_SECONDS) || 45) * 1000;
  const invitesPerMinute = Number(env.CONFERENCE_INVITES_PER_MINUTE) || 20;

  const conferences = new Map(); // id -> live conference
  const inConference = new Map(); // user id -> conference id
  const inviteTimes = new Map(); // user id -> times they rang someone (to slow down abuse)

  const room = c => `conference:${c.id}`;
  const channelOf = c => `conf-${c.id}`;
  const socketOf = p => io.sockets.sockets.get(p.socketId);

  const snapshot = c => ({
    id: c.id,
    video: c.video,
    startedAt: iso(c.createdAt),
    maxParticipants: c.max,
    participants: [...c.participants.values()]
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map(p => ({id: p.id, name: p.name, muted: p.muted, cameraOn: p.cameraOn, offline: p.offline, joinedAt: iso(p.joinedAt)})),
    // people being rung right now, shown as "Ringing..." in the list
    invited: [...c.pending.entries()]
      .filter(([, p]) => !p.silent)
      .map(([id, p]) => ({id, name: findUser(id)?.name || id, by: p.by.id, expiresAt: iso(p.expiresAt)})),
  });
  const emitUpdate = c => io.to(room(c)).emit('conference:update', snapshot(c));

  function stopRinging(c, userId, {tell = false} = {}) {
    const p = c.pending.get(userId);
    if (!p) {
      return null;
    }
    clearTimeout(p.timer);
    c.pending.delete(userId);
    const target = tell && !p.silent ? findUser(userId) : null;
    if (target?.socketId) {
      io.to(target.socketId).emit('conference:invitation-ended', {id: c.id});
    }
    return p;
  }

  function tellInviter(c, p, userId, result) {
    const target = findUser(p.by.id);
    if (target?.socketId) {
      io.to(target.socketId).emit('conference:invite-result', {id: c.id, to: userId, name: findUser(userId)?.name || userId, result});
    }
  }

  function end(c, reason) {
    if (c.status === 'ended') {
      return;
    }
    c.status = 'ended';
    for (const userId of [...c.pending.keys()]) {
      stopRinging(c, userId, {tell: true});
    }
    io.to(room(c)).emit('conference:ended', {id: c.id, reason});
    for (const p of c.participants.values()) {
      clearTimeout(p.graceTimer);
      inConference.delete(p.id);
      const s = socketOf(p);
      s?.leave(room(c));
      if (s) {
        s.data.conferenceId = null;
      }
    }
    c.participants.clear();
    log(`conference ended (${reason}), ${liveCount()} live`);
    const timer = setTimeout(() => conferences.delete(c.id), keepEndedMs);
    timer.unref?.();
  }

  // A call needs at least two people: when one is left on their own and nobody is being rung, it is over
  function checkAlone(c) {
    if (c.status !== 'ended' && c.participants.size <= 1 && !c.pending.size) {
      end(c, c.participants.size ? 'alone' : 'empty');
      return true;
    }
    return false;
  }

  function removeParticipant(c, userId) {
    const p = c.participants.get(userId);
    if (!p) {
      return;
    }
    clearTimeout(p.graceTimer);
    c.participants.delete(userId);
    inConference.delete(userId);
    const s = socketOf(p);
    if (s) {
      s.leave(room(c));
      s.data.conferenceId = null;
    }
    if (!checkAlone(c)) {
      emitUpdate(c);
    }
  }

  // Why `by` cannot ring `targetId` into `c`, or null when they can
  function inviteProblem(c, by, targetId) {
    if (!targetId) {
      return 'not-found';
    }
    if (targetId === by.id) {
      return 'self';
    }
    if (c.participants.has(targetId)) {
      return 'already-in';
    }
    if (c.pending.has(targetId)) {
      return 'already-invited';
    }
    if (c.participants.size + c.pending.size >= c.max) {
      return 'full';
    }
    if (!findUser(targetId)?.socketId) {
      return 'offline';
    }
    if (isBusy(targetId) || inConference.has(targetId)) {
      return 'busy';
    }
    return null;
  }

  // Rings someone to join. `silent` is for the two people already on the call: they are told to move over by the call
  // itself, so they get no ringing screen.
  function ring(c, by, targetId, {silent = false} = {}) {
    const ttl = silent ? 30_000 : inviteTtlMs;
    const timer = setTimeout(() => {
      const gone = stopRinging(c, targetId, {tell: true});
      if (!gone) {
        return;
      }
      if (!gone.silent) {
        tellInviter(c, gone, targetId, 'no-answer');
      }
      if (!checkAlone(c)) {
        emitUpdate(c);
      }
    }, ttl);
    timer.unref?.();
    c.pending.set(targetId, {by: {id: by.id, name: by.name}, timer, silent, expiresAt: now() + ttl});
    if (!silent) {
      io.to(findUser(targetId).socketId).emit('conference:invitation', {
        id: c.id,
        from: {id: by.id, name: by.name},
        video: c.video,
        ttlMs: ttl,
      });
    }
  }

  async function addParticipant(socket, c) {
    const userId = socket.data.userId;
    const name = socket.data.name || userId;
    stopRinging(c, userId); // joining answers the ringing
    const existing = c.participants.get(userId);
    if (existing) {
      // coming back (the connection dropped and the app joined again): keep their place
      clearTimeout(existing.graceTimer);
      existing.offline = false;
      existing.socketId = socket.id;
      existing.name = name;
    } else {
      c.participants.set(userId, {
        id: userId,
        name,
        muted: false,
        cameraOn: c.video,
        joinedAt: now(),
        offline: false,
        socketId: socket.id,
        graceTimer: null,
      });
    }
    inConference.set(userId, c.id);
    socket.data.conferenceId = c.id;
    socket.join(room(c));
    const join = await agora.issue({identity: userId, room: channelOf(c)});
    emitUpdate(c);
    return {ok: true, conference: snapshot(c), join, you: {id: userId}};
  }

  const guard = (socket, payload, reply) => {
    const c = conferences.get(normalizeConferenceId(payload?.id));
    const me = c?.participants.get(socket.data.userId);
    if (!c || c.status !== 'live' || !me) {
      reply({ok: false, error: 'not-in-conference'});
      return null;
    }
    return {c, me};
  };

  function invitePerson(c, by, rawTarget) {
    const targetId = normalizeUserId(rawTarget);
    const problem = inviteProblem(c, by, targetId);
    if (problem) {
      return {ok: false, error: problem};
    }
    const t = now();
    const recent = (inviteTimes.get(by.id) || []).filter(time => t - time < 60_000);
    if (recent.length >= invitesPerMinute) {
      return {ok: false, error: 'slow-down'};
    }
    inviteTimes.set(by.id, [...recent, t]);
    ring(c, by, targetId);
    emitUpdate(c);
    return {ok: true, invited: {id: targetId, name: findUser(targetId)?.name || targetId}};
  }

  function bind(socket) {
    const userId = socket.data.userId;
    if (!userId) {
      return;
    }
    const ack = fn => (payload, cb) => {
      const reply = typeof cb === 'function' ? cb : () => {};
      Promise.resolve(fn(payload || {}, reply)).catch(e => {
        log(`conference error: ${e.message}`);
        reply({ok: false, error: 'failed'});
      });
    };

    socket.on('conference:join', ack(async (payload, reply) => {
      if (!agora.configured) {
        return reply({ok: false, error: 'not-configured'});
      }
      const id = normalizeConferenceId(payload.id);
      const c = validId(id) ? conferences.get(id) : null;
      if (!c) {
        return reply({ok: false, error: 'not-found'});
      }
      if (c.status === 'ended') {
        return reply({ok: false, error: 'ended'});
      }
      const already = c.participants.has(userId);
      if (!already && !c.pending.has(userId)) {
        return reply({ok: false, error: 'not-found'}); // only people who were added can join
      }
      if (!already && inConference.has(userId)) {
        return reply({ok: false, error: 'in-conference'});
      }
      if (!already && isBusy(userId)) {
        return reply({ok: false, error: 'in-call'});
      }
      if (!already && c.participants.size >= c.max) {
        return reply({ok: false, error: 'full'});
      }
      reply(await addParticipant(socket, c));
    }));

    socket.on('conference:leave', ack((payload, reply) => {
      const g = guard(socket, payload, reply);
      if (g) {
        removeParticipant(g.c, userId);
        reply({ok: true});
      }
    }));

    socket.on('conference:state', ack((payload, reply) => {
      const g = guard(socket, payload, reply);
      if (g) {
        if (typeof payload.muted === 'boolean') {
          g.me.muted = payload.muted;
        }
        if (typeof payload.cameraOn === 'boolean') {
          g.me.cameraOn = payload.cameraOn;
        }
        emitUpdate(g.c);
        reply({ok: true});
      }
    }));

    socket.on('conference:invite', ack((payload, reply) => {
      const g = guard(socket, payload, reply);
      if (g) {
        reply(invitePerson(g.c, g.me, payload.to));
      }
    }));

    socket.on('conference:decline', ack((payload, reply) => {
      const c = conferences.get(normalizeConferenceId(payload.id));
      const gone = c && c.status === 'live' ? stopRinging(c, userId) : null;
      if (gone) {
        if (!gone.silent) {
          tellInviter(c, gone, userId, 'declined');
        }
        if (!checkAlone(c)) {
          emitUpdate(c);
        }
      }
      reply({ok: true});
    }));

    socket.on('conference:cancel-invite', ack((payload, reply) => {
      const g = guard(socket, payload, reply);
      if (!g) {
        return;
      }
      const targetId = normalizeUserId(payload.userId);
      const ringing = g.c.pending.get(targetId);
      if (!ringing || ringing.silent || ringing.by.id !== userId) {
        return reply({ok: false, error: 'not-found'});
      }
      stopRinging(g.c, targetId, {tell: true});
      if (!checkAlone(g.c)) {
        emitUpdate(g.c);
      }
      reply({ok: true});
    }));

    socket.on('conference:token', ack(async (payload, reply) => {
      const g = guard(socket, payload, reply);
      if (g) {
        reply({ok: true, join: await agora.issue({identity: userId, room: channelOf(g.c)})});
      }
    }));

    socket.on('disconnect', () => {
      const c = conferences.get(socket.data.conferenceId);
      const p = c?.participants.get(userId);
      // only the connection the person is currently using counts; a newer one may already have taken over
      if (!c || !p || p.socketId !== socket.id || c.status !== 'live') {
        return;
      }
      p.offline = true;
      emitUpdate(c);
      clearTimeout(p.graceTimer);
      p.graceTimer = setTimeout(() => {
        if (c.participants.get(userId)?.offline) {
          removeParticipant(c, userId);
        }
      }, graceMs);
      p.graceTimer.unref?.();
    });
  }

  io.on('connection', bind);

  const liveCount = () => [...conferences.values()].filter(c => c.status === 'live').length;

  // A one-to-one call becomes a conference so a third person can be added: `hostId` pressed "add person", `members`
  // are the two on the call (they are told to move over and join), and `invitee` is rung. Nothing is created unless
  // the invitee can be rung. Returns {ok, conferenceId} or {ok: false, error}.
  function startFromCall({hostId, hostName, members, invitee, video}) {
    if (!agora.configured) {
      return {ok: false, error: 'not-configured'};
    }
    if (members.some(id => inConference.has(id))) {
      return {ok: false, error: 'in-conference'};
    }
    let id;
    do {
      id = newId();
    } while (conferences.has(id));
    const c = {
      id,
      video: !!video,
      status: 'live',
      createdAt: now(),
      max: maxParticipants,
      participants: new Map(),
      pending: new Map(), // user id -> {by, timer, silent, expiresAt}: people being rung to join
    };
    const by = {id: hostId, name: hostName || hostId};
    const wanted = normalizeUserId(invitee);
    const problem = inviteProblem(c, by, wanted);
    if (problem) {
      return {ok: false, error: problem};
    }
    conferences.set(id, c);
    for (const memberId of members) {
      ring(c, by, memberId, {silent: true});
    }
    ring(c, by, wanted);
    log(`conference started from a call, ${liveCount()} live`);
    return {ok: true, conferenceId: id};
  }

  return {
    startFromCall,
    isInConference: userId => inConference.has(userId),
    liveCount,
  };
}

module.exports = {createConferences, normalizeConferenceId};
