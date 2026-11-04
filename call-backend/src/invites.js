const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

// Call links that work on their own, without the app: someone makes an invite, and each person opens their link in
// a browser and joins an Agora call. Nothing here depends on the app's signaling or on LiveKit.
//
//   POST /agora/invites         (needs the INVITE_KEY header) -> {room, expiresAt, host: {url}, guest: {url}}
//   GET  /join/<code>           the page the person opens
//   POST /agora/join/<code>     {name} -> what the page needs to join (App ID, channel, token)
//
// There are no verified logins yet, so making an invite is protected by a secret key kept on the server (INVITE_KEY),
// and a link is a long random code that stops working after a while and can only be used a few times.

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
  const byCode = new Map(); // code -> {room, role, expiresAt, joins}
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
    for (const [code, invite] of byCode) {
      if (invite.expiresAt < t) {
        byCode.delete(code);
      }
    }
    for (const [ip, times] of hits) {
      if (!times.some(time => t - time < 10 * 60_000)) {
        hits.delete(ip);
      }
    }
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
    const room = `meet-${crypto.randomUUID()}`;
    const expiresAt = now() + ttlMs;
    const origin = (env.PUBLIC_URL || `${req.get('x-forwarded-proto') || req.protocol}://${req.get('host')}`).replace(/\/$/, '');
    const out = {room, expiresAt: new Date(expiresAt).toISOString()};
    for (const role of ['host', 'guest']) {
      const code = crypto.randomBytes(18).toString('base64url'); // 144 bits: not guessable
      byCode.set(code, {room, role, expiresAt, joins: 0});
      out[role] = {url: `${origin}/join/${code}`};
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
    const invite = byCode.get(req.params.code);
    if (!invite) {
      return res.status(404).json({error: 'not-found'});
    }
    if (invite.expiresAt < now()) {
      byCode.delete(req.params.code);
      return res.status(410).json({error: 'expired'});
    }
    if (invite.joins >= maxJoins) {
      return res.status(403).json({error: 'used-up'});
    }
    const name = String(req.body?.name || '').trim().slice(0, 40) || (invite.role === 'host' ? 'Host' : 'Guest');
    invite.joins += 1;
    try {
      // a new account for each join, so two people never share one, and a rejoin is not mistaken for the first
      const account = `${invite.role === 'host' ? 'h' : 'g'}-${crypto.randomBytes(6).toString('hex')}`;
      const join = await agora.issue({identity: account, room: invite.room});
      res.set('Cache-Control', 'no-store').json({...join, name, role: invite.role});
    } catch {
      invite.joins -= 1;
      res.status(500).json({error: 'token-failed'});
    }
  });

  return {router, size: () => byCode.size};
}

module.exports = {createInvites};
