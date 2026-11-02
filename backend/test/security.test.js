const request = require('supertest');
const {loadConfig} = require('../src/config/env');
const {createAuthMiddleware} = require('../src/auth/authMiddleware');
const {createTokenService} = require('../src/auth/tokenService');
const {buildTestApp, BASE_ENV} = require('./helpers/testApp');
const {createFakePrisma} = require('./helpers/fakePrisma');

describe('security headers and caching', () => {
  test('sends security headers, hides the framework and forbids caching of API answers', async () => {
    const t = buildTestApp();
    const res = await request(t.app).post('/api/v1/auth/otp/request').send({mobile: '9876543210'});

    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeDefined();
    expect(res.headers['strict-transport-security']).toBeDefined();
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('rate limiting', () => {
  test('a client that sends too many requests is told to slow down', async () => {
    const t = buildTestApp({RATE_LIMIT_MAX: '5'});
    const statuses = [];
    for (let i = 0; i < 7; i++) {
      statuses.push((await request(t.app).get('/api/v1/users/me')).status);
    }
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses.slice(5)).toEqual([429, 429]);
  });

  test('the OTP endpoint has a stricter limit per IP than the rest of the API', async () => {
    const t = buildTestApp();
    const statuses = [];
    for (let i = 0; i < 7; i++) {
      // different numbers, so only the per-IP limit (5 a minute) can stop this
      statuses.push(
        (
          await request(t.app)
            .post('/api/v1/auth/otp/request')
            .send({mobile: `98765432${10 + i}`})
        ).status,
      );
    }
    expect(statuses.filter(code => code === 200)).toHaveLength(5);
    expect(statuses.filter(code => code === 429)).toHaveLength(2);
  });

  test('health checks are never rate limited', async () => {
    const t = buildTestApp({RATE_LIMIT_MAX: '2'});
    for (let i = 0; i < 10; i++) {
      await request(t.app).get('/api/v1/health').expect(200);
    }
  });
});

describe('CORS', () => {
  test('browsers are blocked by default (no CORS header at all)', async () => {
    const t = buildTestApp();
    const res = await request(t.app).get('/api/v1/health').set('Origin', 'https://evil.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  test('only listed websites are allowed', async () => {
    const t = buildTestApp({CORS_ORIGINS: 'https://admin.atiyaherbs.com'});
    const allowed = await request(t.app).get('/api/v1/health').set('Origin', 'https://admin.atiyaherbs.com');
    const other = await request(t.app).get('/api/v1/health').set('Origin', 'https://evil.example');
    expect(allowed.headers['access-control-allow-origin']).toBe('https://admin.atiyaherbs.com');
    expect(other.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('bad requests and errors', () => {
  test('oversized and malformed bodies get clear, safe answers', async () => {
    const t = buildTestApp();
    const big = await request(t.app)
      .post('/api/v1/auth/otp/request')
      .send({mobile: '9876543210', pad: 'x'.repeat(200_000)});
    expect(big.status).toBe(413);

    const broken = await request(t.app).post('/api/v1/auth/otp/request').set('Content-Type', 'application/json').send('{"mobile": ');
    expect(broken.status).toBe(400);
    expect(broken.body.message).toBe('The request is not valid JSON.');
  });

  test('unknown routes answer 404 in JSON', async () => {
    const t = buildTestApp();
    const res = await request(t.app).get('/api/v1/nothing-here');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({statusCode: 404, message: 'Not found.'});
  });

  test('an unexpected failure shows nothing about the system to the caller', async () => {
    const prisma = createFakePrisma();
    prisma.otpChallenge.count = async () => {
      throw new Error('Login failed for user sa at server SQL-PROD-01 (secret details)');
    };
    const logged = [];
    const t = buildTestApp({}, {prisma, logger: {info() {}, warn() {}, error: message => logged.push(message)}});

    const res = await request(t.app).post('/api/v1/auth/otp/request').send({mobile: '9876543210'});
    expect(res.status).toBe(500);
    expect(res.body).toEqual({statusCode: 500, message: 'Internal server error'});
    expect(JSON.stringify(res.body)).not.toMatch(/SQL-PROD|secret|sa at/);
    expect(logged.join('\n')).toContain('SQL-PROD-01'); // the details stay in the server log
  });
});

describe('health checks', () => {
  test('/health says the process is up, /health/ready checks the database', async () => {
    const t = buildTestApp();
    const alive = await request(t.app).get('/api/v1/health');
    expect(alive.body).toEqual({status: 'ok'});
    await request(t.app).get('/api/v1/health/ready').expect(200);

    t.prisma.ready = false;
    const down = await request(t.app).get('/api/v1/health/ready');
    expect(down.status).toBe(503);
    expect(down.body.message).toBe('Not ready'); // nothing about why
  });
});

describe('start-up configuration', () => {
  const base = {DB_USER: 'u', DB_PASSWORD: 'p', JWT_ACCESS_SECRET: 'a'.repeat(40), OTP_PEPPER: 'b'.repeat(40)};

  test('missing settings stop the server with a clear message', () => {
    expect(() => loadConfig({})).toThrow(/DB_USER[\s\S]*DB_PASSWORD[\s\S]*JWT_ACCESS_SECRET[\s\S]*OTP_PEPPER/);
  });

  test('short secrets are refused', () => {
    expect(() => loadConfig({...base, JWT_ACCESS_SECRET: 'short'})).toThrow(/JWT_ACCESS_SECRET must be at least 32/);
    expect(() => loadConfig({...base, OTP_PEPPER: 'short'})).toThrow(/OTP_PEPPER must be at least 32/);
  });

  test('production refuses the development OTP sender, OTP echo and unsafe database settings', () => {
    const production = {...base, NODE_ENV: 'production'};
    expect(() => loadConfig(production)).toThrow(/OTP_SENDER=dev/);
    expect(() => loadConfig({...production, OTP_SENDER: 'sms', OTP_DEV_ECHO: 'true'})).toThrow(/OTP_DEV_ECHO/);
    expect(() => loadConfig({...production, OTP_SENDER: 'sms', DB_ENCRYPT: 'false'})).toThrow(/DB_ENCRYPT/);
    expect(() => loadConfig({...production, OTP_SENDER: 'sms', DB_TRUST_SERVER_CERT: 'true'})).toThrow(/DB_TRUST_SERVER_CERT/);
    expect(loadConfig({...production, OTP_SENDER: 'sms'}).isProduction).toBe(true);
  });

  test('in production without an SMS provider, asking for an OTP fails safely and prints no code', async () => {
    const {createSmsOtpSender} = require('../src/otp/otpSender');
    const {createApp} = require('../src/app');
    const config = loadConfig({...base, NODE_ENV: 'production', OTP_SENDER: 'sms'});
    const printed = [];
    const logger = {info() {}, warn: m => printed.push(m), error: m => printed.push(m)};
    const app = createApp({config, prisma: createFakePrisma(), sender: createSmsOtpSender(), logger});

    const res = await request(app).post('/api/v1/auth/otp/request').send({mobile: '9876543210'});
    expect(res.status).toBe(503);
    expect(printed.join(' ')).not.toMatch(/\b\d{6}\b/);
  });
});

describe('roles', () => {
  test('requireRole lets only the listed roles through', () => {
    const tokens = createTokenService(loadConfig({...BASE_ENV}));
    const {requireRole} = createAuthMiddleware({tokens});
    const run = role => {
      let result = 'next';
      requireRole('doctor', 'admin')({user: role ? {id: '1', role} : undefined}, {}, error => {
        result = error ? error.status : 'next';
      });
      return result;
    };
    expect(run('doctor')).toBe('next');
    expect(run('admin')).toBe('next');
    expect(run('customer')).toBe(403);
    expect(run(undefined)).toBe(403);
  });
});
