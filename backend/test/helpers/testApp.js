const request = require('supertest');
const {createApp} = require('../../src/app');
const {loadConfig} = require('../../src/config/env');
const {createFakePrisma} = require('./fakePrisma');
const {ROLE_IDS} = require('../../src/auth/roles');
const {unauthorized} = require('../../src/common/errors');

const silent = {info() {}, warn() {}, error() {}};

const BASE_ENV = {
  NODE_ENV: 'test',
  DB_USER: 'test',
  DB_PASSWORD: 'test',
  JWT_ACCESS_SECRET: 'test-access-secret-test-access-secret-0123456789',
  OTP_PEPPER: 'test-otp-pepper-test-otp-pepper-0123456789',
  VIDEO_STORAGE: 'folder', // the video tests read the files on disk; the database kind has its own tests
  RATE_LIMIT_MAX: '1000', // the tests send many requests; the rate-limit tests lower this on purpose
};

// Stands in for Google: the "ID token" is `good:<email>|<name>` (or `unverified:<email>`), anything else is refused.
const fakeGoogle = config => ({
  available: config.googleClientIds.length > 0,
  async verify(idToken) {
    const [kind, rest = ''] = idToken.split(':');
    const [email, name = ''] = rest.split('|');
    if (kind === 'good') {
      return {email: email.toLowerCase(), name, googleId: `g-${email}`};
    }
    throw unauthorized(kind === 'unverified' ? 'Your Google email is not verified.' : 'Google sign-in failed. Please try again.');
  },
});

// A complete API wired to an in-memory database. `sent` collects every OTP "SMS" the API tried to send.
function buildTestApp(envOverrides = {}, {prisma = createFakePrisma(), logger = silent} = {}) {
  const config = loadConfig({...BASE_ENV, ...envOverrides});
  const sent = [];
  const sender = {
    async send(mobile, code) {
      sent.push({mobile, code});
    },
  };
  const app = createApp({config, prisma, sender, logger, google: fakeGoogle(config)});
  const lastCode = () => sent[sent.length - 1]?.code;

  // Full login: asks for a code, then verifies it. Returns the session (tokens + user).
  const login = async (mobile = '9876543210') => {
    await request(app).post('/api/v1/auth/otp/request').send({mobile}).expect(200);
    const res = await request(app).post('/api/v1/auth/otp/verify').send({mobile, code: lastCode()}).expect(200);
    return res.body;
  };

  // Logs in as a person with the given role (the role is set in the database, then a fresh login picks it up)
  const loginAs = async (role, mobile = '9876543210') => {
    await login(mobile);
    const row = prisma.user.rows.find(user => user.mobile === mobile);
    row.roleId = ROLE_IDS[role];
    return login(mobile);
  };
  const bearer = session => ({Authorization: `Bearer ${session.accessToken}`});

  return {app, prisma, config, sent, lastCode, login, loginAs, bearer};
}

module.exports = {buildTestApp, BASE_ENV, silent};
