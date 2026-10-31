const crypto = require('node:crypto');

// Call invitations over Socket.IO. LiveKit carries the audio and video; this only rings the other
// phone and, once they accept, gives both people a token for that call's own LiveKit room.
//
// Client → server
//   call:start  {to, video}  (ack → {ok, callId} or {ok: false, error: 'offline'|'busy'|'in-call'|'self'|'not-configured'})
//   call:accept {callId}     callee picks up
//   call:reject {callId}     callee declines
//   call:end    {callId}     either side hangs up (or the caller cancels while it rings)
// Server → client
//   session       {activeCallId}                    on every (re)connect
//   users         [{id, name, busy}]                everyone online
//   call:incoming {callId, from: {id, name}, video}
//   call:ready    {callId, serverUrl, token}        both people, after accept: join the LiveKit room
//   call:ended    {callId, reason: 'rejected'|'cancelled'|'no-answer'|'ended'|'disconnected'}
//
// Recording (only during a connected call, and only after the OTHER person agrees)
//   recording:request {callId}        (ack → {ok} or {ok: false, error})  one person asks to record
//   recording:respond {callId, allow} the other person agrees or declines
//   recording:stop    {callId}        either person stops it (it also stops when the call ends)
//   recording:requested {callId, from: {id, name}}   → the other person: asked to record
//   recording:state     {callId, state: 'on'|'off', reason?}   → both people

const normalizeId = value => String(value || '').trim().toLowerCase().slice(0, 120);

const NO_RECORDING = {available: false, start: async () => ({ok: false, error: 'unavailable'}), stopAndFinish: async () => {}};

function attachSignaling(
  io,
  {tokens, recording = NO_RECORDING, ringTimeoutMs = 45000, reconnectGraceMs = 15000, log = () => {}},
) {
  const users = new Map(); // userId -> {id, name, socketId, callId, graceTimer}
  const calls = new Map(); // callId -> {id, room, caller, callee, video, state: 'ringing'|'active', ringTimer}

  // TODO (production): verify a signed login token here instead of trusting the userId the app sends
  io.use((socket, next) => {
    const id = normalizeId(socket.handshake.auth?.userId);
    if (!id) {
      return next(new Error('userId is required'));
    }
    socket.data.userId = id;
    socket.data.name = String(socket.handshake.auth?.name || id).trim().slice(0, 60);
    next();
  });

  const emitTo = (userId, event, payload) => {
    const socketId = users.get(userId)?.socketId;
    if (socketId) {
      io.to(socketId).emit(event, payload);
    }
  };

  const broadcastUsers = () => {
    io.emit(
      'users',
      [...users.values()].filter(u => u.socketId).map(u => ({id: u.id, name: u.name, busy: !!u.callId})),
    );
  };

  // Stops this call's recording (if one is running) and lets the upload finish in the background
  const stopRecording = call => {
    const current = call.recording;
    call.recording = null;
    if (current?.state === 'on') {
      recording.stopAndFinish(current.id).catch(e => log(`recording finish failed: ${e.message}`));
    }
  };

  const endCall = (callId, reason, endedBy) => {
    const call = calls.get(callId);
    if (!call) {
      return;
    }
    clearTimeout(call.ringTimer);
    stopRecording(call);
    calls.delete(callId);
    for (const userId of [call.caller, call.callee]) {
      const user = users.get(userId);
      if (user?.callId === callId) {
        user.callId = null;
      }
      if (userId !== endedBy) {
        emitTo(userId, 'call:ended', {callId, reason});
      }
    }
    log(`call ended (${reason}), ${calls.size} active`);
    broadcastUsers();
  };

  // The call this socket's user belongs to, or null. Anyone else's call id is ignored.
  const callFor = (socket, callId) => {
    const call = calls.get(callId);
    const me = socket.data.userId;
    return call && (call.caller === me || call.callee === me) ? call : null;
  };

  io.on('connection', socket => {
    const me = socket.data.userId;
    let user = users.get(me);
    if (user) {
      // Same person reconnecting (network blip) or signing in on a second phone: newest socket wins
      clearTimeout(user.graceTimer);
      const oldSocket = user.socketId && io.sockets.sockets.get(user.socketId);
      user.socketId = socket.id;
      user.name = socket.data.name;
      oldSocket?.disconnect(true);
    } else {
      user = {id: me, name: socket.data.name, socketId: socket.id, callId: null, graceTimer: null};
      users.set(me, user);
    }
    socket.emit('session', {activeCallId: user.callId, recordingAvailable: recording.available});
    broadcastUsers();

    socket.on('call:start', (payload, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      const to = normalizeId(payload?.to);
      const callee = users.get(to);
      if (!tokens.configured) {
        return reply({ok: false, error: 'not-configured'});
      }
      if (!to || to === me) {
        return reply({ok: false, error: 'self'});
      }
      if (user.callId) {
        return reply({ok: false, error: 'in-call'});
      }
      if (!callee?.socketId) {
        return reply({ok: false, error: 'offline'});
      }
      if (callee.callId) {
        return reply({ok: false, error: 'busy'});
      }
      const id = crypto.randomUUID();
      const call = {id, room: `call-${id}`, caller: me, callee: to, video: !!payload.video, state: 'ringing'};
      call.ringTimer = setTimeout(() => endCall(id, 'no-answer'), ringTimeoutMs);
      calls.set(id, call);
      user.callId = id;
      callee.callId = id;
      emitTo(to, 'call:incoming', {callId: id, from: {id: me, name: user.name}, video: call.video});
      reply({ok: true, callId: id});
      log(`call started (${call.video ? 'video' : 'voice'}), ${calls.size} active`);
      broadcastUsers();
    });

    socket.on('call:accept', async payload => {
      const call = callFor(socket, payload?.callId);
      if (!call || call.state !== 'ringing' || call.callee !== me) {
        return;
      }
      clearTimeout(call.ringTimer);
      call.state = 'active';
      try {
        // Each person gets their own token, made for this call's room only
        for (const userId of [call.caller, call.callee]) {
          const person = users.get(userId);
          const token = await tokens.issue({identity: userId, name: person?.name || userId, room: call.room});
          emitTo(userId, 'call:ready', {callId: call.id, serverUrl: tokens.serverUrl, token});
        }
      } catch (e) {
        log(`could not create call tokens: ${e.message}`);
        endCall(call.id, 'ended');
      }
    });

    socket.on('call:reject', payload => {
      const call = callFor(socket, payload?.callId);
      if (call?.state === 'ringing' && call.callee === me) {
        endCall(call.id, 'rejected', me);
      }
    });

    socket.on('call:end', payload => {
      const call = callFor(socket, payload?.callId);
      if (call) {
        endCall(call.id, call.state === 'ringing' ? 'cancelled' : 'ended', me);
      }
    });

    // ---- Recording: one person asks, the other must agree before anything is recorded ----
    const peerOf = call => (call.caller === me ? call.callee : call.caller);
    const tellBoth = (call, payload) => {
      emitTo(call.caller, 'recording:state', {callId: call.id, ...payload});
      emitTo(call.callee, 'recording:state', {callId: call.id, ...payload});
    };

    socket.on('recording:request', (payload, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      const call = callFor(socket, payload?.callId);
      if (!call || call.state !== 'active') {
        return reply({ok: false, error: 'not-active'});
      }
      if (!recording.available) {
        return reply({ok: false, error: 'unavailable'});
      }
      if (call.recording) {
        return reply({ok: false, error: 'already'});
      }
      call.recording = {state: 'requested', requestedBy: me};
      emitTo(peerOf(call), 'recording:requested', {callId: call.id, from: {id: me, name: user.name}});
      reply({ok: true});
    });

    socket.on('recording:respond', async payload => {
      const call = callFor(socket, payload?.callId);
      const pending = call?.recording;
      // Only the person who was asked can answer, and only while the question is open
      if (!call || pending?.state !== 'requested' || pending.requestedBy === me) {
        return;
      }
      if (!payload.allow) {
        call.recording = null;
        return tellBoth(call, {state: 'off', reason: 'declined'});
      }
      pending.state = 'starting'; // blocks a second answer while LiveKit starts
      const result = await recording.start(call, {requestedBy: pending.requestedBy, allowedBy: me});
      if (calls.get(call.id) !== call) {
        // The call ended while recording was starting
        if (result.ok) {
          recording.stopAndFinish(result.id).catch(() => {});
        }
        return;
      }
      if (!result.ok) {
        call.recording = null;
        return tellBoth(call, {state: 'off', reason: result.error});
      }
      call.recording = {state: 'on', id: result.id, requestedBy: pending.requestedBy, allowedBy: me};
      tellBoth(call, {state: 'on'});
    });

    socket.on('recording:stop', payload => {
      const call = callFor(socket, payload?.callId);
      if (call?.recording) {
        stopRecording(call);
        tellBoth(call, {state: 'off', reason: 'stopped'});
      }
    });

    socket.on('disconnect', () => {
      if (user.socketId !== socket.id) {
        return; // replaced by a newer socket for the same user
      }
      user.socketId = null;
      if (!user.callId) {
        users.delete(me);
        broadcastUsers();
        return;
      }
      // LiveKit keeps the media going through a short drop here, so give the app time to reconnect
      user.graceTimer = setTimeout(() => {
        if (!user.socketId) {
          endCall(user.callId, 'disconnected', me);
          users.delete(me);
          broadcastUsers();
        }
      }, reconnectGraceMs);
    });
  });

  return {users, calls};
}

module.exports = {attachSignaling, normalizeId};
