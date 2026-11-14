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

// Real SMS through MSG91 (https://docs.msg91.com/otp). The template must be approved on DLT and contain ##OTP##.
// The key travels in a header, never in the URL, and neither the key nor the code is written to any log.
function createSmsOtpSender(config, {fetchImpl = globalThis.fetch, logger = console} = {}) {
  return {
    async send(mobile, code, ttlSeconds) {
      const params = new URLSearchParams({
        template_id: config.MSG91_TEMPLATE_ID,
        mobile: `91${mobile}`,
        otp: code,
        otp_expiry: String(Math.max(1, Math.round(ttlSeconds / 60))),
      });
      let body;
      try {
        const response = await fetchImpl(`https://control.msg91.com/api/v5/otp?${params}`, {
          method: 'POST',
          headers: {authkey: config.MSG91_AUTH_KEY, 'content-type': 'application/json'},
          body: '{}',
          signal: AbortSignal.timeout(10_000),
        });
        body = await response.json().catch(() => ({}));
        if (!response.ok || body.type === 'error') {
          throw new Error(body.message || `MSG91 answered ${response.status}`);
        }
      } catch (error) {
        logger.error(`[OTP] SMS to ${maskMobile(mobile)} failed: ${error.message}`);
        throw unavailable('We could not send the code right now. Please try again in a moment.');
      }
    },
  };
}

function createOtpSender(config, logger) {
  return config.OTP_SENDER === 'dev' ? createDevOtpSender(logger) : createSmsOtpSender(config, {logger});
}

module.exports = {createOtpSender, createDevOtpSender, createSmsOtpSender};
