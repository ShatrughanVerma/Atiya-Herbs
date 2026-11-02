const {maskMobile} = require('../common/mobile');
const {unavailable} = require('../common/errors');

// How an OTP reaches the person. Each sender has one method: send(mobile, code, ttlSeconds).
// Swap the implementation to change the SMS provider; nothing else changes.

// Development only: prints the OTP in the server log, so no SMS is sent and nothing is paid.
// The configuration check refuses to start in production with this sender.
function createDevOtpSender(logger = console) {
  return {
    async send(mobile, code, ttlSeconds) {
      logger.warn(
        `[OTP development] OTP for ${maskMobile(mobile)} is ${code} (valid ${Math.round(ttlSeconds / 60)} min). Development only.`,
      );
    },
  };
}

// Placeholder for the real SMS provider (MSG91, Twilio, ...). Until it is written, production cannot send OTPs,
// which is the safe behaviour: it never falls back to printing codes.
function createSmsOtpSender() {
  return {
    async send() {
      throw unavailable('OTP delivery is not available right now. Please try again later.');
    },
  };
}

function createOtpSender(config, logger) {
  return config.OTP_SENDER === 'dev' ? createDevOtpSender(logger) : createSmsOtpSender();
}

module.exports = {createOtpSender, createDevOtpSender, createSmsOtpSender};
