const {randomBytes, scrypt, timingSafeEqual} = require('node:crypto');

// Password hashing with Node's built-in scrypt (a slow, memory-hungry hash, so guessing passwords from a stolen
// database is expensive). Stored as  scrypt$N$r$p$salt$hash  (salt and hash in base64url) so the cost can be raised
// later without breaking old hashes: each hash carries the settings it was made with.
const N = 2 ** 15; // memory/CPU cost: about 100 ms on a normal server
const R = 8;
const P = 1;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const MAX_MEMORY = 128 * N * R * 2; // scrypt needs 128*N*r bytes; Node's default limit (32 MB) is exactly too small

const derive = (password, salt, n, r, p) =>
  new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, {N: n, r, p, maxmem: Math.max(MAX_MEMORY, 128 * n * r * 2)}, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });

async function hashPassword(password) {
  const salt = randomBytes(SALT_LENGTH);
  const key = await derive(password, salt, N, R, P);
  return ['scrypt', N, R, P, salt.toString('base64url'), key.toString('base64url')].join('$');
}

// true only for the right password. A damaged or unknown hash format is simply "no".
async function verifyPassword(password, stored) {
  const parts = typeof stored === 'string' ? stored.split('$') : [];
  if (parts.length !== 6 || parts[0] !== 'scrypt') {
    return false;
  }
  const [n, r, p] = parts.slice(1, 4).map(Number);
  // refuse absurd settings, so a tampered row cannot make the server use gigabytes of memory
  if (!Number.isInteger(n) || n < 2 ** 10 || n > 2 ** 17 || (n & (n - 1)) !== 0 || !Number.isInteger(r) || r < 1 || r > 16 || !Number.isInteger(p) || p < 1 || p > 4) {
    return false;
  }
  const salt = Buffer.from(parts[4], 'base64url');
  const expected = Buffer.from(parts[5], 'base64url');
  if (!salt.length || expected.length !== KEY_LENGTH) {
    return false;
  }
  const actual = await derive(password, salt, n, r, p);
  return timingSafeEqual(actual, expected);
}

// A real hash of a random password nobody knows. Logging in to an account that does not exist still does one full
// verification against it, so the answer takes the same time and does not reveal whether the account exists.
let dummyHash;
function verifyAgainstDummy(password) {
  dummyHash ??= hashPassword(randomBytes(24).toString('base64url'));
  return dummyHash.then(hash => verifyPassword(password, hash));
}

// ---- the rules for a new password ----
const MIN_LENGTH = 8;
const MAX_LENGTH = 128; // also stops someone sending a megabyte "password" to burn CPU

// A short list of the passwords everyone tries first (all lower case). Meets "a letter and a digit" yet is hopeless.
const COMMON = new Set([
  'password1',
  'password12',
  'password123',
  'password1234',
  'passw0rd',
  'p@ssw0rd',
  'qwerty123',
  'qwerty1234',
  'qwertyuiop1',
  'abc12345',
  'abcd1234',
  'abc123456',
  'admin123',
  'admin1234',
  'welcome1',
  'welcome123',
  'letmein123',
  'iloveyou1',
  'iloveyou123',
  'india123',
  'india@123',
  'india1234',
  'atiya123',
  'atiya1234',
  'atiyaherbs1',
  'atiyaherbs123',
  'herbs123',
  'test1234',
  'user1234',
  'changeme1',
  'monkey123',
  'dragon123',
  'football1',
  'cricket123',
  'sachin123',
  'krishna123',
  'ganesh123',
  'sharma123',
  'khan12345',
  '1q2w3e4r',
  '1qaz2wsx',
  'a1b2c3d4',
  '12345678a',
  'a12345678',
  '123456789a',
  'a123456789',
]);

// Returns a message for the first rule broken, or '' when the password is acceptable.
// `context` is {mobile?, email?}: a password equal to the person's own number or email is refused.
function passwordProblem(password, context = {}) {
  if (typeof password !== 'string' || password.length < MIN_LENGTH) {
    return `Password must be at least ${MIN_LENGTH} characters.`;
  }
  if (password.length > MAX_LENGTH) {
    return `Password must be at most ${MAX_LENGTH} characters.`;
  }
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return 'Password must contain at least one letter and one number.';
  }
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) {
    return 'This password is too common. Please choose another one.';
  }
  const own = [context.mobile, context.email, context.email?.split('@')[0]].filter(Boolean).map(value => value.toLowerCase());
  if (own.includes(lower)) {
    return 'Password must not be your mobile number or email.';
  }
  return '';
}

module.exports = {hashPassword, verifyPassword, verifyAgainstDummy, passwordProblem, MIN_LENGTH, MAX_LENGTH};
