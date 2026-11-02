const {hashOtp, randomOtpCode, safeEqualHex} = require('../common/crypto');
const {tooManyRequests, unauthorized} = require('../common/errors');

// The same message for every kind of failure, so a caller cannot tell "no code", "wrong code" and "expired"
// apart, and cannot learn anything about other people's numbers.
const INVALID_CODE = 'The code is wrong or has expired.';

function createOtpService({prisma, config, sender}) {
  return {
    // Returns {expiresInSeconds, devCode?}. devCode is only there when OTP_DEV_ECHO is on (never in production).
    async request(mobile, ip, now = new Date()) {
      // Limit per mobile number, so one number cannot be flooded with SMS (and our SMS bill cannot be run up)
      const windowStart = new Date(now.getTime() - config.OTP_REQUEST_WINDOW_SECONDS * 1000);
      const recent = await prisma.otpChallenge.count({where: {mobile, createdAt: {gte: windowStart}}});
      if (recent >= config.OTP_MAX_REQUESTS_PER_WINDOW) {
        throw tooManyRequests('Too many codes requested for this number. Please wait a few minutes.');
      }

      const code = randomOtpCode();
      // Only the newest code works: older unused ones are cancelled first
      await prisma.otpChallenge.updateMany({where: {mobile, consumedAt: null}, data: {consumedAt: now}});
      const challenge = await prisma.otpChallenge.create({
        data: {
          mobile,
          codeHash: hashOtp(config.OTP_PEPPER, mobile, code),
          expiresAt: new Date(now.getTime() + config.OTP_TTL_SECONDS * 1000),
          requestIp: ip?.slice(0, 64) ?? null,
        },
      });

      try {
        await sender.send(mobile, code, config.OTP_TTL_SECONDS);
      } catch (error) {
        await prisma.otpChallenge.updateMany({where: {id: challenge.id}, data: {consumedAt: now}});
        throw error;
      }

      const result = {expiresInSeconds: config.OTP_TTL_SECONDS};
      if (config.OTP_DEV_ECHO && !config.isProduction) {
        result.devCode = code;
      }
      return result;
    },

    // Returns normally only when the code is right. Every attempt is counted, and the code stops working
    // after OTP_MAX_ATTEMPTS tries, so it cannot be guessed (1 million codes, 5 tries).
    async verify(mobile, code, now = new Date()) {
      const challenge = await prisma.otpChallenge.findFirst({
        where: {mobile, consumedAt: null, expiresAt: {gt: now}},
        orderBy: {createdAt: 'desc'},
      });
      if (!challenge) {
        throw unauthorized(INVALID_CODE);
      }

      // Count the attempt first, in one step, so two parallel guesses cannot both slip past the limit
      const counted = await prisma.otpChallenge.updateMany({
        where: {id: challenge.id, consumedAt: null, attempts: {lt: config.OTP_MAX_ATTEMPTS}},
        data: {attempts: {increment: 1}},
      });
      if (counted.count === 0) {
        throw unauthorized(INVALID_CODE);
      }

      if (!safeEqualHex(challenge.codeHash, hashOtp(config.OTP_PEPPER, mobile, code))) {
        throw unauthorized(INVALID_CODE);
      }

      // A correct code works once: only the request that flips consumedAt wins
      const used = await prisma.otpChallenge.updateMany({where: {id: challenge.id, consumedAt: null}, data: {consumedAt: now}});
      if (used.count === 0) {
        throw unauthorized(INVALID_CODE);
      }
    },
  };
}

module.exports = {createOtpService};
