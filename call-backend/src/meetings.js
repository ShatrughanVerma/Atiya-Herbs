const crypto = require('node:crypto');
const express = require('express');

// Group video meetings (Zoom / Google Meet style) on Agora. Several people join ONE Agora channel; this module keeps
// who is in it, lets the host manage it, carries the chat, and makes each person's Agora token on the server (the
// Agora App Certificate never leaves the server). It is separate from the one-to-one LiveKit calls in signaling.js,
// which it does not change.
//
// People are known by the same id the rest of the app uses: the mobile number sent when the app connects (there is
// no verified login yet, so a host's powers rest on that same unverified id).
//
// Client -> server (Socket.IO, each with an ack {ok, ...} or {ok: false, error}):
//   meeting:create {title?, maxParticipants?}  makes a meeting and puts you in it as the host
//   meeting:join   {id}                        join by meeting id (also used to come back after a dropped connection)
//   meeting:leave  {id}
//   meeting:end    {id}                        host: ends it for everyone
//   meeting:state  {id, muted?, cameraOn?}     your mic / camera, shown to the others
//   meeting:chat   {id, text}
//   meeting:mute   {id, userId | 'all'}        host: asks someone (or everyone) to mute
//   meeting:remove {id, userId}                host: takes someone out (they cannot rejoin)
//   meeting:lock   {id, locked}                host: stop (or allow) new people joining
//   meeting:share  {id, sharing}               start / stop sharing your screen (one person at a time)
//   meeting:token  {id}                        a fresh Agora token (they expire; the app asks before that)
//   meeting:info   {id}                        what a meeting link shows before joining
//   meeting:list                               your recent meetings
// Server -> client:
//   meeting:update {id, title, hostId, locked, startedAt, sharingId, participants: [...]}  on every change
//   meeting:chat   {id, message}
//   meeting:mute-request {id, by, all}   the host asks you to mute (the app does it)
//   meeting:removed {id, by}             the host took you out
//   meeting:ended   {id, reason, by?}    the meeting is over

const LETTERS = 'abcdefghjkmnpqrstuvwxyz'; // no i, l or o, which look like 1 and 0
const ID_LENGTH = 10;

const newRawId = () => Array.from({length: ID_LENGTH}, () => LETTERS[crypto.randomInt(LETTERS.length)]).join('');
const format = raw => `${raw.slice(0, 3)}-${raw.slice(3, 7)}-${raw.slice(7)}`; // abc-defg-hij
// Accepts the id as typed or pasted: any case, with or without dashes and spaces
const normalizeMeetingId = value => String(value || '').toLowerCase().replace(/[^a-z]/g, '');
const validId = raw => raw.length === ID_LENGTH && [...raw].every(c => LETTERS.includes(c));

const CHAT_KEEP = 200;
const CHAT_MAX_LENGTH = 1000;
const iso = ms => new Date(ms).toISOString();

function createMeetings({
  io,
  agora,
  store,
  isInCall = () => false,
  env = process.env,
  log = () => {},
  now = () => Date.now(),
}) {
  const maxParticipants = Math.min(Number(env.MEETING_MAX_PARTICIPANTS) || 25, 100);
  const graceMs = env.MEETING_RECONNECT_GRACE_MS !== undefined ? Number(env.MEETING_RECONNECT_GRACE_MS) : 20_000;
  const createPerHour = Number(env.MEETING_CREATE_PER_HOUR) || 10;
  const keepEndedMs = Number(env.MEETING_KEEP_ENDED_MS) || 3_600_000;

  const meetings = new Map(); // raw id -> live meeting
  const inMeeting = new Map(); // user id -> raw id of the meeting they are in
  const createdBy = new Map(); // user id -> times of the meetings they made (to slow down abuse)
  const hits = new Map(); // ip -> request times for the public info route

  const room = m => `meeting:${m.raw}`;
  const channelOf = m => `mtg-${m.raw}`;
  // Saving to the database must never slow a meeting down or break it
  const save = fn => Promise.resolve().then(fn).catch(e => log(`meeting database: ${e.message}`));

  const publicParticipant = p => ({
    id: p.id,
    name: p.name,
    role: p.role,
    muted: p.muted,
    cameraOn: p.cameraOn,
    sharing: p.sharing,
    joinedAt: iso(p.joinedAt),
    offline: p.offline,
  });
  const snapshot = m => ({
    id: format(m.raw),
    title: m.title,
    hostId: m.hostId,
    locked: m.locked,
    status: m.status,
    startedAt: iso(m.createdAt),
    sharingId: m.sharingId,
    maxParticipants: m.max,
    participants: [...m.participants.values()].sort((a, b) => a.joinedAt - b.joinedAt).map(publicParticipant),
  });
  const emitUpdate = m => io.to(room(m)).emit('meeting:update', snapshot(m));
  const socketOf = p => io.sockets.sockets.get(p.socketId);

  const forget = m => {
    const timer = setTimeout(() => meetings.delete(m.raw), keepEndedMs);
    timer.unref?.();
  };

  function endMeeting(m, reason, by) {
    if (m.status === 'ended') {
      return;
    }
    m.status = 'ended';
    io.to(room(m)).emit('meeting:ended', {id: format(m.raw), reason, ...(by ? {by} : {})});
    const endedAt = iso(now());
    for (const p of m.participants.values()) {
      clearTimeout(p.graceTimer);
      inMeeting.delete(p.id);
      socketOf(p)?.leave(room(m));
      if (socketOf(p)) {
        socketOf(p).data.meetingId = null;
      }
      save(() => store.participantLeft?.(format(m.raw), p.id, endedAt));
    }
    m.participants.clear();
    m.sharingId = null;
    save(() => store.meetingUpdate?.(format(m.raw), {status: 'ended', ended_at: endedAt, ended_by: by || null}));
    log(`meeting ended (${reason}), ${[...meetings.values()].filter(x => x.status === 'live').length} live`);
    forget(m);
  }

  // Takes a person out of the meeting. If they were the host, the longest-standing person becomes the host.
  function removeParticipant(m, userId, {removed = false} = {}) {
    const p = m.participants.get(userId);
    if (!p) {
      return;
    }
    clearTimeout(p.graceTimer);
    m.participants.delete(userId);
    inMeeting.delete(userId);
    const s = socketOf(p);
    if (s) {
      s.leave(room(m));
      s.data.meetingId = null;
    }
    if (m.sharingId === userId) {
      m.sharingId = null;
    }
    save(() => store.participantLeft?.(format(m.raw), userId, iso(now()), removed));

    if (!m.participants.size) {
      return endMeeting(m, 'empty');
    }
    if (m.hostId === userId) {
      const next = [...m.participants.values()].sort((a, b) => a.joinedAt - b.joinedAt)[0];
      next.role = 'host';
      m.hostId = next.id;
      save(() => store.meetingUpdate?.(format(m.raw), {host_id: next.id, host_name: next.name}));
    }
    emitUpdate(m);
  }

  async function joinDetails(m, userId) {
    return agora.issue({identity: userId, room: channelOf(m)});
  }

  // Puts the person in the meeting (new, or coming back). Returns an ack-shaped result.
  async function addParticipant(socket, m, {role} = {}) {
    const userId = socket.data.userId;
    const name = socket.data.name || userId;
    const existing = m.participants.get(userId);
    if (existing) {
      // coming back (the connection dropped and the app joined again): keep their place and role
      clearTimeout(existing.graceTimer);
      existing.offline = false;
      existing.socketId = socket.id;
      existing.name = name;
    } else {
      const p = {
        id: userId,
        name,
        role: role || 'participant',
        muted: false,
        cameraOn: false,
        sharing: false,
        joinedAt: now(),
        offline: false,
        socketId: socket.id,
        graceTimer: null,
        chatTimes: [],
      };
      m.participants.set(userId, p);
      save(() => store.participantJoined?.({meeting_id: format(m.raw), user_id: userId, name, role: p.role, joined_at: iso(p.joinedAt)}));
    }
    inMeeting.set(userId, m.raw);
    socket.data.meetingId = m.raw;
    socket.join(room(m));
    if (m.participants.size > m.peak) {
      m.peak = m.participants.size;
      save(() => store.meetingUpdate?.(format(m.raw), {peak_participants: m.peak}));
    }
    const join = await joinDetails(m, userId);
    emitUpdate(m);
    return {ok: true, meeting: snapshot(m), join, chat: m.chat, you: {id: userId, role: m.participants.get(userId).role}};
  }

  const guard = (socket, payload, reply, {hostOnly = false} = {}) => {
    const m = meetings.get(normalizeMeetingId(payload?.id));
    const me = m?.participants.get(socket.data.userId);
    if (!m || m.status !== 'live' || !me) {
      reply({ok: false, error: 'not-in-meeting'});
      return null;
    }
    if (hostOnly && m.hostId !== me.id) {
      reply({ok: false, error: 'host-only'});
      return null;
    }
    return {m, me};
  };

  function bind(socket) {
    const userId = socket.data.userId;
    if (!userId) {
      return;
    }
    const ack = fn => (payload, cb) => {
      const reply = typeof cb === 'function' ? cb : () => {};
      Promise.resolve(fn(payload || {}, reply)).catch(e => {
        log(`meeting error: ${e.message}`);
        reply({ok: false, error: 'failed'});
      });
    };

    const checkCanEnter = reply => {
      if (!agora.configured) {
        reply({ok: false, error: 'not-configured'});
        return false;
      }
      if (isInCall(userId)) {
        reply({ok: false, error: 'in-call'});
        return false;
      }
      return true;
    };

    socket.on('meeting:create', ack(async (payload, reply) => {
      if (!checkCanEnter(reply)) {
        return;
      }
      if (inMeeting.has(userId)) {
        return reply({ok: false, error: 'in-meeting'});
      }
      const t = now();
      const recent = (createdBy.get(userId) || []).filter(time => t - time < 3_600_000);
      if (recent.length >= createPerHour) {
        return reply({ok: false, error: 'slow-down'});
      }
      createdBy.set(userId, [...recent, t]);

      let raw;
      do {
        raw = newRawId();
      } while (meetings.has(raw));
      const name = socket.data.name || userId;
      const wantedMax = Math.floor(Number(payload.maxParticipants));
      const m = {
        raw,
        title: String(payload.title || '').trim().slice(0, 80) || `${name}'s meeting`,
        hostId: userId,
        locked: false,
        status: 'live',
        createdAt: t,
        max: Number.isFinite(wantedMax) && wantedMax >= 2 ? Math.min(wantedMax, maxParticipants) : maxParticipants,
        participants: new Map(),
        banned: new Set(),
        chat: [],
        sharingId: null,
        peak: 0,
      };
      meetings.set(raw, m);
      save(() => store.meetingCreate?.({id: format(raw), title: m.title, host_id: userId, host_name: name, max_participants: m.max, status: 'live', created_at: iso(t)}));
      reply(await addParticipant(socket, m, {role: 'host'}));
      log(`meeting started, ${[...meetings.values()].filter(x => x.status === 'live').length} live`);
    }));

    socket.on('meeting:join', ack(async (payload, reply) => {
      if (!checkCanEnter(reply)) {
        return;
      }
      const raw = normalizeMeetingId(payload.id);
      const m = validId(raw) ? meetings.get(raw) : null;
      if (!m) {
        return reply({ok: false, error: 'not-found'});
      }
      if (m.status === 'ended') {
        return reply({ok: false, error: 'ended'});
      }
      if (m.banned.has(userId)) {
        return reply({ok: false, error: 'removed'});
      }
      const already = m.participants.has(userId);
      if (!already && inMeeting.has(userId)) {
        return reply({ok: false, error: 'in-meeting'});
      }
      if (!already && m.locked) {
        return reply({ok: false, error: 'locked'});
      }
      if (!already && m.participants.size >= m.max) {
        return reply({ok: false, error: 'full'});
      }
      reply(await addParticipant(socket, m));
    }));

    socket.on('meeting:leave', ack((payload, reply) => {
      const g = guard(socket, payload, reply);
      if (g) {
        removeParticipant(g.m, userId);
        reply({ok: true});
      }
    }));

    socket.on('meeting:end', ack((payload, reply) => {
      const g = guard(socket, payload, reply, {hostOnly: true});
      if (g) {
        endMeeting(g.m, 'host', userId);
        reply({ok: true});
      }
    }));

    socket.on('meeting:state', ack((payload, reply) => {
      const g = guard(socket, payload, reply);
      if (g) {
        if (typeof payload.muted === 'boolean') {
          g.me.muted = payload.muted;
        }
        if (typeof payload.cameraOn === 'boolean') {
          g.me.cameraOn = payload.cameraOn;
        }
        emitUpdate(g.m);
        reply({ok: true});
      }
    }));

    socket.on('meeting:chat', ack((payload, reply) => {
      const g = guard(socket, payload, reply);
      if (!g) {
        return;
      }
      const text = String(payload.text || '').trim().slice(0, CHAT_MAX_LENGTH);
      if (!text) {
        return reply({ok: false, error: 'empty'});
      }
      const t = now();
      g.me.chatTimes = g.me.chatTimes.filter(time => t - time < 10_000);
      if (g.me.chatTimes.length >= 8) {
        return reply({ok: false, error: 'slow-down'});
      }
      g.me.chatTimes.push(t);
      const message = {id: crypto.randomUUID(), from: {id: g.me.id, name: g.me.name}, text, at: iso(t)};
      g.m.chat.push(message);
      if (g.m.chat.length > CHAT_KEEP) {
        g.m.chat.shift();
      }
      io.to(room(g.m)).emit('meeting:chat', {id: format(g.m.raw), message});
      reply({ok: true, message});
    }));

    socket.on('meeting:mute', ack((payload, reply) => {
      const g = guard(socket, payload, reply, {hostOnly: true});
      if (!g) {
        return;
      }
      const everyone = payload.userId === 'all';
      const targets = everyone ? [...g.m.participants.values()].filter(p => p.id !== userId) : [g.m.participants.get(String(payload.userId))].filter(Boolean);
      if (!targets.length) {
        return reply({ok: false, error: 'not-found'});
      }
      for (const p of targets) {
        io.to(p.socketId).emit('meeting:mute-request', {id: format(g.m.raw), by: {id: g.me.id, name: g.me.name}, all: everyone});
      }
      reply({ok: true, asked: targets.length});
    }));

    socket.on('meeting:remove', ack((payload, reply) => {
      const g = guard(socket, payload, reply, {hostOnly: true});
      if (!g) {
        return;
      }
      const target = g.m.participants.get(String(payload.userId));
      if (!target || target.id === userId) {
        return reply({ok: false, error: 'not-found'});
      }
      io.to(target.socketId).emit('meeting:removed', {id: format(g.m.raw), by: {id: g.me.id, name: g.me.name}});
      g.m.banned.add(target.id);
      removeParticipant(g.m, target.id, {removed: true});
      reply({ok: true});
    }));

    socket.on('meeting:lock', ack((payload, reply) => {
      const g = guard(socket, payload, reply, {hostOnly: true});
      if (g) {
        g.m.locked = !!payload.locked;
        save(() => store.meetingUpdate?.(format(g.m.raw), {locked: g.m.locked ? 1 : 0}));
        emitUpdate(g.m);
        reply({ok: true, locked: g.m.locked});
      }
    }));

    socket.on('meeting:share', ack((payload, reply) => {
      const g = guard(socket, payload, reply);
      if (!g) {
        return;
      }
      if (payload.sharing) {
        if (g.m.sharingId && g.m.sharingId !== userId) {
          return reply({ok: false, error: 'busy', by: g.m.participants.get(g.m.sharingId)?.name});
        }
        g.m.sharingId = userId;
        g.me.sharing = true;
      } else if (g.m.sharingId === userId) {
        g.m.sharingId = null;
        g.me.sharing = false;
      }
      emitUpdate(g.m);
      reply({ok: true});
    }));

    socket.on('meeting:token', ack(async (payload, reply) => {
      const g = guard(socket, payload, reply);
      if (g) {
        reply({ok: true, join: await joinDetails(g.m, userId)});
      }
    }));

    socket.on('meeting:info', ack((payload, reply) => {
      const raw = normalizeMeetingId(payload.id);
      const m = validId(raw) ? meetings.get(raw) : null;
      reply(m ? {ok: true, ...info(m)} : {ok: false, error: 'not-found'});
    }));

    socket.on('meeting:list', ack(async (payload, reply) => {
      const rows = (await store.meetingsFor?.(userId, 20)) || [];
      reply({
        ok: true,
        meetings: rows.map(r => ({id: r.id, title: r.title, hostId: r.host_id, hostName: r.host_name, status: r.status, createdAt: r.created_at, endedAt: r.ended_at})),
      });
    }));

    socket.on('disconnect', () => {
      const raw = socket.data.meetingId;
      const m = raw && meetings.get(raw);
      const p = m?.participants.get(userId);
      // only the connection the person is currently using counts; a newer one may already have taken over
      if (!m || !p || p.socketId !== socket.id || m.status !== 'live') {
        return;
      }
      p.offline = true;
      emitUpdate(m);
      clearTimeout(p.graceTimer);
      p.graceTimer = setTimeout(() => {
        if (m.participants.get(userId)?.offline) {
          removeParticipant(m, userId);
        }
      }, graceMs);
      p.graceTimer.unref?.();
    });
  }

  const info = m => ({
    id: format(m.raw),
    title: m.title,
    hostName: m.participants.get(m.hostId)?.name || null,
    status: m.status,
    locked: m.locked,
    participants: m.participants.size,
    maxParticipants: m.max,
  });

  io.on('connection', bind);

  // GET /meetings/<id>: what a meeting link shows before anyone joins (no token, no names beyond the host's)
  const router = express.Router();
  router.get('/meetings/:id', (req, res) => {
    const t = now();
    const recent = (hits.get(req.ip) || []).filter(time => t - time < 600_000);
    recent.push(t);
    hits.set(req.ip, recent);
    if (recent.length > 60) {
      return res.status(429).json({error: 'slow-down'});
    }
    const raw = normalizeMeetingId(req.params.id);
    const m = validId(raw) ? meetings.get(raw) : null;
    res.set('Cache-Control', 'no-store');
    return m ? res.json(info(m)) : res.status(404).json({error: 'not-found'});
  });

  return {
    router,
    isInMeeting: userId => inMeeting.has(userId),
    liveCount: () => [...meetings.values()].filter(m => m.status === 'live').length,
  };
}

module.exports = {createMeetings, normalizeMeetingId};
