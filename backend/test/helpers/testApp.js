const request = require('supertest');
const {createApp} = require('../../src/app');
const {loadConfig} = require('../../src/config/env');
const {createFakePrisma} = require('./fakePrisma');

const silent = {info() {}, warn() {}, error() {}};

const BASE_ENV = {
  NODE_ENV: 'test',
  DB_USER: 'test',
  DB_PASSWORD: 'test',
  JWT_ACCESS_SECRET: 'test-access-secret-test-access-secret-0123456789',
  OTP_PEPPER: 'test-otp-pepper-test-otp-pepper-0123456789',
  RATE_LIMIT_MAX: '1000', // the tests send many requests; the rate-limit tests lower this on purpose
};

// A complete API wired to an in-memory database. `sent` collects every OTP "SMS" the API tried to send.
function buildTestApp(envOverrides = {}, {prisma = createFakePrisma(), logger = silent} = {}) {
  const config = loadConfig({...BASE_ENV, ...envOverrides});
  const sent = [];
  const sender = {
    async send(mobile, code) {
      sent.push({mobile, code});
    },
  };
  const app = createApp({config, prisma, sender, logger});
  const lastCode = () => sent[sent.length - 1]?.code;

  // Full login: asks for a code, then verifies it. Returns the session (tokens + user).
  const login = async (mobile = '9876543210') => {
    await request(app).post('/api/v1/auth/otp/request').send({mobile}).expect(200);
    const res = await request(app).post('/api/v1/auth/otp/verify').send({mobile, code: lastCode()}).expect(200);
    return res.body;
  };

  return {app, prisma, config, sent, lastCode, login};
}

module.exports = {buildTestApp, BASE_ENV, silent};
