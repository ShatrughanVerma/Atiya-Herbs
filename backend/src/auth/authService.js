const {randomUUID} = require('node:crypto');
const {newOpaqueToken, sha256Hex} = require('../common/crypto');
const {forbidden, unauthorized} = require('../common/errors');
const {maskMobile} = require('../common/mobile');

const INVALID_SESSION = 'Your session has expired. Please log in again.';

const toPublicUser = user => ({id: user.id, mobile: user.mobile, name: user.name, email: user.email, role: user.role});

// ctx everywhere below is {ip, userAgent}, taken from the request.
function createAuthService({prisma, otp, tokens, audit, config}) {
  async function startSession(user, ctx, familyId, deviceName) {
    const refreshToken = newOpaqueToken();
    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256Hex(refreshToken), // only the hash is stored
        familyId,
        expiresAt: new Date(Date.now() + config.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
        userAgent: (deviceName ?? ctx.userAgent)?.slice(0, 255) ?? null,
        ip: ctx.ip?.slice(0, 64) ?? null,
      },
    });
    return {
      accessToken: tokens.signAccessToken(user),
      refreshToken,
      tokenType: 'Bearer',
      expiresInSeconds: config.JWT_ACCESS_TTL_SECONDS,
      user: toPublicUser(user),
    };
  }

  async function revokeFamily(record, reason, ctx) {
    await prisma.refreshToken.updateMany({where: {familyId: record.familyId, revokedAt: null}, data: {revokedAt: new Date()}});
    const action = reason === 'reuse' ? 'auth.refresh.reuse_detected' : reason === 'logout' ? 'auth.logout' : 'auth.session.revoked';
    await audit.record({action, userId: record.userId, ip: ctx.ip, userAgent: ctx.userAgent});
  }

  return {
    async requestOtp(mobile, ctx) {
      const result = await otp.request(mobile, ctx.ip);
      await audit.record({action: 'auth.otp.requested', ip: ctx.ip, userAgent: ctx.userAgent, metadata: {mobile: maskMobile(mobile)}});
      return result;
    },

    async verifyOtp(mobile, code, deviceName, ctx) {
      try {
        await otp.verify(mobile, code);
      } catch (error) {
        await audit.record({action: 'auth.otp.failed', ip: ctx.ip, userAgent: ctx.userAgent, metadata: {mobile: maskMobile(mobile)}});
        throw error;
      }

      const existing = await prisma.user.findUnique({where: {mobile}});
      if (existing && existing.status !== 'active') {
        await audit.record({action: 'auth.login.blocked', userId: existing.id, ip: ctx.ip, userAgent: ctx.userAgent});
        throw forbidden('This account cannot be used. Please contact support.');
      }
      const now = new Date();
      const user = existing
        ? await prisma.user.update({where: {id: existing.id}, data: {lastLoginAt: now}})
        : await prisma.user.create({data: {mobile, lastLoginAt: now}});

      const session = await startSession(user, ctx, randomUUID(), deviceName);
      await audit.record({action: existing ? 'auth.login' : 'auth.signup', userId: user.id, ip: ctx.ip, userAgent: ctx.userAgent});
      return session;
    },

    // Swaps a refresh token for a new pair. The old token stops working immediately. If an already-used token
    // shows up again, someone copied it, so every token from that login is cancelled.
    async refresh(refreshToken, ctx) {
      const record = await prisma.refreshToken.findUnique({where: {tokenHash: sha256Hex(refreshToken)}});
      if (!record) {
        throw unauthorized(INVALID_SESSION);
      }
      if (record.revokedAt) {
        await revokeFamily(record, 'reuse', ctx);
        throw unauthorized(INVALID_SESSION);
      }
      if (record.expiresAt <= new Date()) {
        throw unauthorized(INVALID_SESSION);
      }

      const user = await prisma.user.findUnique({where: {id: record.userId}});
      if (!user || user.status !== 'active') {
        await revokeFamily(record, 'blocked', ctx);
        throw unauthorized(INVALID_SESSION);
      }

      // Only one request can win this swap; a second, simultaneous use of the same token is treated as reuse
      const claimed = await prisma.refreshToken.updateMany({where: {id: record.id, revokedAt: null}, data: {revokedAt: new Date()}});
      if (claimed.count === 0) {
        await revokeFamily(record, 'reuse', ctx);
        throw unauthorized(INVALID_SESSION);
      }
      return startSession(user, ctx, record.familyId);
    },

    // Ends this login (all its tokens). Always succeeds, so it tells nobody whether a token was valid.
    async logout(refreshToken, ctx) {
      const record = await prisma.refreshToken.findUnique({where: {tokenHash: sha256Hex(refreshToken)}});
      if (record) {
        await revokeFamily(record, 'logout', ctx);
      }
    },
  };
}

module.exports = {createAuthService, toPublicUser};
