const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

// Call links that work on their own, without the app: someone makes an invite, and each person opens their link in
// a browser and joins an Agora call. Nothing here depends on the app's signaling or on LiveKit.
//
//   POST /agora/invites         (needs the INVITE_KEY header; body {people?}) -> {room, people, expiresAt, host: {url}, guest: {url}}
//   GET  /join/<code>           the page the person opens
//   POST /agora/join/<code>     {name} -> what the page needs to join (App ID, channel, token)
//
// There are no verified logins yet, so making an invite is protected by a secret key kept on the server (INVITE_KEY),
// and a link stops working after a while and can only be used a few times.
//
// A link's code is signed with INVITE_KEY and carries its own room, role and expiry, so the server remembers nothing
// about it: a link keeps working after the server restarts or wakes up from sleep (Render's free plan does both).
// Only the "used a few times" count is kept in memory, so it starts again after a restart. Changing INVITE_KEY
// makes every link made before it stop working.

const PAGE = fs.readFileSync(path.join(__dirname, 'joinPage.html'), 'utf8');

const sameSecret = (given, expected) => {
  const a = crypto.createHash('sha256').update(String(given || '')).digest();
  const b = crypto.createHash('sha256').update(String(expected || '')).digest();
  return crypto.timingSafeEqual(a, b);
};

function createInvites({env = process.env, agora, now = () => Date.now()}) {
  const key = (env.INVITE_KEY || '').trim();
  const ttlMs = (Number(env.INVITE_MINUTES) || 60) * 60_000;
  const maxJoins = Number(env.INVITE_MAX_JOINS) || 4; // per link, so a refresh or a dropped connection can rejoin
  const maxPeople = Number(env.INVITE_MAX_PEOPLE) || 50; // the most a group link can allow
  const joins = new Map(); // code -> {count, expiresAt}: how many times each link was used (in memory only)
  const hits = new Map(); // ip -> request times, to slow down guessing and abuse

  const tooMany = (ip, limit, windowMs) => {
    const t = now();
    const recent = (hits.get(ip) || []).filter(time => t - time < windowMs);
    recent.push(t);
    hits.set(ip, recent);
    return recent.length > limit;
  };
  const sweep = () => {
    const t = now();
    for (const [code, used] of joins) {
      if (used.expiresAt < t) {
        joins.delete(code);
      }
    }
    for (const [ip, times] of hits) {
      if (!times.some(time => t - time < 10 * 60_000)) {
        hits.delete(ip);
      }
    }
  };

  const sign = text => crypto.createHmac('sha256', key).update(text).digest('base64url');
  // code = <payload>.<signature>, where payload is "room|role|expiresAt|uses" (uses = how many times it may be opened)
  const makeCode = (room, role, expiresAt, uses) => {
    const payload = Buffer.from(`${room}|${role}|${expiresAt}|${uses}`).toString('base64url');
    return `${payload}.${sign(payload)}`;
  };
  // The invite a code stands for, or null when it was not made by this server's key (or was changed)
  const readCode = code => {
    const parts = String(code || '').split('.');
    if (!key || parts.length !== 2) {
      return null;
    }
    const [payload, signature] = parts;
    const expected = Buffer.from(sign(payload));
    const given = Buffer.from(signature);
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
      return null;
    }
    const [room, role, expiresAt, uses = maxJoins] = Buffer.from(payload, 'base64url').toString().split('|');
    if (!/^meet-[0-9a-f-]{36}$/.test(room) || !['host', 'guest'].includes(role) || !Number.isFinite(Number(expiresAt))) {
      return null;
    }
    return {room, role, expiresAt: Number(expiresAt), uses: Math.min(Math.max(Math.floor(Number(uses)) || maxJoins, 1), maxPeople)};
  };

  const router = express.Router();
  router.use(express.json({limit: '2kb'}));

  router.post('/agora/invites', (req, res) => {
    if (!key || !agora.configured) {
      return res.status(503).json({error: 'not-configured'});
    }
    if (tooMany(`create:${req.ip}`, 20, 10 * 60_000)) {
      return res.status(429).json({error: 'slow-down'});
    }
    if (!sameSecret(req.get('x-invite-key'), key)) {
      return res.status(401).json({error: 'unauthorized'});
    }
    sweep();
    // A group link: `people` is how many times the guest link may be opened (a refresh counts again), so with
    // people = 6 about 6 people can join one room. Without it the link allows maxJoins.
    const wanted = Math.floor(Number(req.body?.people));
    const people = Number.isFinite(wanted) && wanted >= 1 ? Math.min(wanted, maxPeople) : maxJoins;
    const room = `meet-${crypto.randomUUID()}`;
    const expiresAt = now() + ttlMs;
    const origin = (env.PUBLIC_URL || `${req.get('x-forwarded-proto') || req.protocol}://${req.get('host')}`).replace(/\/$/, '');
    const out = {room, people, expiresAt: new Date(expiresAt).toISOString()};
    for (const role of ['host', 'guest']) {
      out[role] = {url: `${origin}/join/${makeCode(room, role, expiresAt, role === 'guest' ? people : maxJoins)}`};
    }
    res.status(201).json(out);
  });

  router.get('/join/:code', (req, res) => {
    res.set({'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff'});
    res.type('html').send(PAGE);
  });

  router.post('/agora/join/:code', async (req, res) => {
    if (tooMany(`join:${req.ip}`, 30, 10 * 60_000)) {
      return res.status(429).json({error: 'slow-down'});
    }
    const invite = readCode(req.params.code);
    if (!invite) {
      return res.status(404).json({error: 'not-found'});
    }
    if (invite.expiresAt < now()) {
      return res.status(410).json({error: 'expired'});
    }
    const used = joins.get(req.params.code) || {count: 0, expiresAt: invite.expiresAt};
    if (used.count >= invite.uses) {
      return res.status(403).json({error: 'used-up'});
    }
    const name = String(req.body?.name || '').trim().slice(0, 40) || (invite.role === 'host' ? 'Host' : 'Guest');
    used.count += 1;
    joins.set(req.params.code, used);
    try {
      // a new account for each join, so two people never share one, and a rejoin is not mistaken for the first.
      // The person's name rides along after the dot (base64url, which Agora accepts in an account), so the others
      // in the call can show it on their tile without anything else being sent.
      const account = `${invite.role === 'host' ? 'h' : 'g'}-${crypto.randomBytes(6).toString('hex')}.${Buffer.from(name).toString('base64url')}`;
      const join = await agora.issue({identity: account, room: invite.room});
      res.set('Cache-Control', 'no-store').json({...join, name, role: invite.role});
    } catch {
      used.count -= 1;
      res.status(500).json({error: 'token-failed'});
    }
  });

  return {router};
}

module.exports = {createInvites};
