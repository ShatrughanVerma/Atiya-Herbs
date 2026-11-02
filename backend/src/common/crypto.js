const {createHash, createHmac, randomBytes, randomInt, timingSafeEqual} = require('node:crypto');

const sha256Hex = value => createHash('sha256').update(value).digest('hex');

// A random 6-digit code. randomInt is a cryptographically secure generator.
const randomOtpCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0');

// HMAC with a server-side secret ("pepper"): a stolen database cannot be used to work out OTPs offline
const hashOtp = (pepper, mobile, code) => createHmac('sha256', pepper).update(`${mobile}:${code}`).digest('hex');

const safeEqualHex = (a, b) => {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
};

// 48 random bytes = 384 bits: not guessable
const newOpaqueToken = () => randomBytes(48).toString('base64url');

module.exports = {sha256Hex, randomOtpCode, hashOtp, safeEqualHex, newOpaqueToken};
