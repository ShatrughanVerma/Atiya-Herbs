const {randomUUID} = require('node:crypto');
const {newOpaqueToken, sha256Hex} = require('../common/crypto');
const {badRequest, conflict, forbidden, tooManyRequests, unauthorized} = require('../common/errors');
const {maskMobile, normalizeMobile} = require('../common/mobile');
const {hashPassword, passwordProblem, verifyAgainstDummy, verifyPassword} = require('./passwordService');
const {roleNameOf} = require('./roles');

const INVALID_SESSION = 'Your session has expired. Please log in again.';
const WRONG_LOGIN = 'Wrong login details.';
const MAX_FAILED_LOGINS = 5; // wrong passwords in a row ...
const LOCK_MINUTES = 15; // ... lock the account for this long

// For the security trail: enough to recognise the account, not enough to misuse it
const maskEmail = email => {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}***@${domain}`;
};
const maskIdentifier = identifier =>
  identifier.includes('@') ? maskEmail(identifier.toLowerCase()) : maskMobile(identifier.replace(/\D/g, ''));

// What to store after a wrong password: count it, and lock the account at the limit
const failureUpdate = user => {
  const failed = user.failedLoginCount + 1;
  const lock = failed >= MAX_FAILED_LOGINS;
  return {
    lock,
    data: lock ? {failedLoginCount: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000)} : {failedLoginCount: failed},
  };
};
const secondsLeft = user => (user.lockedUntil.getTime() - Date.now()) / 1000;

const toPublicUser = user => ({id: user.id, mobile: user.mobile, name: user.name, email: user.email, roleId: user.roleId, role: roleNameOf(user.roleId)});

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

  // The end of a successful login (password, and the code when it is required): reset the wrong-password count
  // and open the session
  async function finishLogin(user, deviceName, ctx) {
    const loggedIn = await prisma.user.update({where: {id: user.id}, data: {failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date()}});
    const session = await startSession(loggedIn, ctx, randomUUID(), deviceName);
    await audit.record({action: 'auth.login_success', userId: user.id, ip: ctx.ip, userAgent: ctx.userAgent});
    return session;
  }

  async function assertFree(mobile, email) {
    const taken = await prisma.user.findFirst({where: {OR: [{mobile}, {email}]}});
    if (taken) {
      throw taken.mobile === mobile
        ? conflict('This mobile number is already registered. Please log in.')
        : conflict('This email is already registered. Please log in.');
    }
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

    // Step 1 of a sign-up (only when OTP_REQUIRED is on): checks the number and email are free, then sends the
    // code to the number, so the account can only be made by someone who holds that phone.
    async requestSignupOtp({mobile, email}, ctx) {
      await assertFree(mobile, email);
      if (!config.OTP_REQUIRED) {
        return {otpRequired: false};
      }
      const result = {otpRequired: true, ...(await otp.request(mobile, ctx.ip))};
      await audit.record({action: 'auth.signup_otp.requested', ip: ctx.ip, userAgent: ctx.userAgent, metadata: {mobile: maskMobile(mobile)}});
      return result;
    },

    // New account with a mobile number, email and password. When OTP_REQUIRED is on, `code` (sent by
    // requestSignupOtp) must be right: that is the proof that the number belongs to this person.
    async register({name, email, mobile, password, code, deviceName}, ctx) {
      const problem = passwordProblem(password, {mobile, email});
      if (problem) {
        throw badRequest('Some details are not valid.', [{field: 'password', message: problem}]);
      }
      await assertFree(mobile, email);
      if (config.OTP_REQUIRED) {
        if (!code) {
          throw badRequest('Some details are not valid.', [{field: 'code', message: 'Enter the 6-digit code sent to your mobile number.'}]);
        }
        try {
          await otp.verify(mobile, code);
        } catch (error) {
          await audit.record({action: 'auth.otp.failed', ip: ctx.ip, userAgent: ctx.userAgent, metadata: {mobile: maskMobile(mobile)}});
          throw error;
        }
      }
      const passwordHash = await hashPassword(password);
      let user;
      try {
        user = await prisma.user.create({data: {mobile, name, email, passwordHash, lastLoginAt: new Date()}});
      } catch (error) {
        if (error.code === 'P2002') {
          // someone registered the same number or email a moment ago
          throw conflict('This mobile number or email is already registered. Please log in.');
        }
        throw error;
      }
      const session = await startSession(user, ctx, randomUUID(), deviceName);
      await audit.record({action: 'auth.register', userId: user.id, ip: ctx.ip, userAgent: ctx.userAgent, metadata: {mobile: maskMobile(mobile)}});
      return session;
    },

    // Login with an email or a mobile number and a password.
    //  - Wrong password, unknown account and an account without a password all give the same answer, and each does
    //    one full password check, so neither the message nor the time tells which one it was.
    //  - 5 wrong passwords in a row lock the account for 15 minutes (HTTP 429 with Retry-After).
    async login({identifier, password, deviceName}, ctx) {
      const lookup = identifier.includes('@') ? {email: identifier.toLowerCase()} : {mobile: normalizeMobile(identifier)};
      const user = lookup.email || lookup.mobile ? await prisma.user.findFirst({where: lookup}) : null;
      const masked = maskIdentifier(identifier);

      if (user?.lockedUntil && user.lockedUntil > new Date()) {
        await audit.record({action: 'auth.login_locked', userId: user.id, ip: ctx.ip, userAgent: ctx.userAgent, metadata: {identifier: masked}});
        throw tooManyRequests(WRONG_LOGIN, secondsLeft(user));
      }

      const right = user?.passwordHash ? await verifyPassword(password, user.passwordHash) : await verifyAgainstDummy(password);
      if (!user || !right) {
        if (user?.passwordHash) {
          const failure = failureUpdate(user);
          await prisma.user.update({where: {id: user.id}, data: failure.data});
          if (failure.lock) {
            await audit.record({action: 'auth.login_locked', userId: user.id, ip: ctx.ip, userAgent: ctx.userAgent, metadata: {identifier: masked}});
          }
        }
        await audit.record({action: 'auth.login_failed', userId: user?.id, ip: ctx.ip, userAgent: ctx.userAgent, metadata: {identifier: masked}});
        throw unauthorized(WRONG_LOGIN);
      }

      // Only someone who knows the password is told that the account is blocked
      if (user.status !== 'active') {
        await audit.record({action: 'auth.login.blocked', userId: user.id, ip: ctx.ip, userAgent: ctx.userAgent});
        throw forbidden('This account cannot be used. Please contact support.');
      }
      if (config.OTP_REQUIRED) {
        // Right password, but no session yet: a code goes to the number on the account, and the app comes back with it
        const sent = await otp.request(user.mobile, ctx.ip);
        await audit.record({action: 'auth.login_otp.requested', userId: user.id, ip: ctx.ip, userAgent: ctx.userAgent, metadata: {mobile: maskMobile(user.mobile)}});
        return {otpRequired: true, challengeToken: tokens.signLoginChallenge(user), mobile: maskMobile(user.mobile), ...sent};
      }
      return finishLogin(user, deviceName, ctx);
    },

    // Step 2 of a login: the proof that the password was right (challengeToken) plus the code sent by SMS
    async verifyLogin({challengeToken, code, deviceName}, ctx) {
      let userId;
      try {
        userId = tokens.verifyLoginChallenge(challengeToken).sub;
      } catch {
        throw unauthorized('Please log in again.');
      }
      const user = await prisma.user.findUnique({where: {id: userId}});
      if (!user || user.status !== 'active') {
        throw unauthorized('Please log in again.');
      }
      try {
        await otp.verify(user.mobile, code);
      } catch (error) {
        await audit.record({action: 'auth.login_otp.failed', userId: user.id, ip: ctx.ip, userAgent: ctx.userAgent});
        throw error;
      }
      return finishLogin(user, deviceName, ctx);
    },

    // Changes the password of the logged-in user. Every login of this account ends (all refresh tokens), and the
    // caller gets a fresh session so this phone stays logged in while any other phone has to log in again.
    // A wrong current password counts towards the same lock as a wrong login, so a stolen access token cannot be
    // used to guess the password.
    async changePassword(userId, {currentPassword, newPassword}, ctx) {
      const user = await prisma.user.findUnique({where: {id: userId}});
      if (!user || user.status !== 'active') {
        throw unauthorized(INVALID_SESSION);
      }
      if (user.lockedUntil && user.lockedUntil > new Date()) {
        throw tooManyRequests('Too many wrong attempts. Please try again later.', secondsLeft(user));
      }
      const right = user.passwordHash ? await verifyPassword(currentPassword, user.passwordHash) : await verifyAgainstDummy(currentPassword);
      if (!right) {
        await prisma.user.update({where: {id: user.id}, data: failureUpdate(user).data});
        await audit.record({action: 'auth.password_change_failed', userId, ip: ctx.ip, userAgent: ctx.userAgent});
        throw badRequest('Some details are not valid.', [{field: 'currentPassword', message: 'The current password is not correct.'}]);
      }
      const problem =
        newPassword === currentPassword
          ? 'The new password must be different from the current one.'
          : passwordProblem(newPassword, {mobile: user.mobile, email: user.email ?? undefined});
      if (problem) {
        throw badRequest('Some details are not valid.', [{field: 'newPassword', message: problem}]);
      }
      const updated = await prisma.user.update({
        where: {id: userId},
        data: {passwordHash: await hashPassword(newPassword), failedLoginCount: 0, lockedUntil: null},
      });
      await prisma.refreshToken.updateMany({where: {userId, revokedAt: null}, data: {revokedAt: new Date()}});
      const session = await startSession(updated, ctx, randomUUID());
      await audit.record({action: 'auth.password_changed', userId, ip: ctx.ip, userAgent: ctx.userAgent});
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
