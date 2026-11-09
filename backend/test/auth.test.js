const jwt = require('jsonwebtoken');
const request = require('supertest');
const {sha256Hex} = require('../src/common/crypto');
const {buildTestApp, BASE_ENV} = require('./helpers/testApp');

const MOBILE = '9876543210';
const asJson = value => JSON.stringify(value);

describe('requesting an OTP', () => {
  test('sends a 6-digit code, stores only its hash, and never returns it', async () => {
    const t = buildTestApp();
    const res = await request(t.app).post('/api/v1/auth/otp/request').send({mobile: MOBILE});

    expect(res.status).toBe(200);
    expect(res.body).toEqual({expiresInSeconds: 300});
    expect(t.sent).toHaveLength(1);
    expect(t.lastCode()).toMatch(/^\d{6}$/);

    const stored = t.prisma.otpChallenge.rows[0];
    expect(stored.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(asJson(stored)).not.toContain(t.lastCode());
  });

  test('only in development, OTP_DEV_ECHO also returns the code in the response', async () => {
    const t = buildTestApp({OTP_DEV_ECHO: 'true'});
    const res = await request(t.app).post('/api/v1/auth/otp/request').send({mobile: MOBILE});
    expect(res.body.devCode).toBe(t.lastCode());
  });

  test('accepts +91, spaces and a leading 0 for the same number', async () => {
    const t = buildTestApp();
    for (const written of ['+91 98765-43210', '098765 43210', '9876543210']) {
      await request(t.app).post('/api/v1/auth/otp/request').send({mobile: written}).expect(200);
    }
    expect(new Set(t.sent.map(s => s.mobile))).toEqual(new Set([MOBILE]));
  });

  test('allows only a few codes per number in a short time (stops SMS flooding)', async () => {
    const t = buildTestApp();
    for (let i = 0; i < 3; i++) {
      await request(t.app).post('/api/v1/auth/otp/request').send({mobile: MOBILE}).expect(200);
    }
    const res = await request(t.app).post('/api/v1/auth/otp/request').send({mobile: MOBILE});
    expect(res.status).toBe(429);
    expect(t.sent).toHaveLength(3); // the 4th was never sent
    // another number is not affected
    await request(t.app).post('/api/v1/auth/otp/request').send({mobile: '9123456780'}).expect(200);
  });

  test('rejects invalid numbers without echoing what was sent', async () => {
    const t = buildTestApp();
    // 5 requests: the OTP endpoint allows 5 a minute per IP, and invalid requests count too
    for (const mobile of ['12345', '5876543210', "9876543210' OR 1=1--", 9876543210, null]) {
      const res = await request(t.app).post('/api/v1/auth/otp/request').send({mobile});
      expect([asJson(mobile), res.status]).toEqual([asJson(mobile), 400]);
      expect(res.body.message).toBe('Some details are not valid.');
      expect(asJson(res.body)).not.toContain('OR 1=1'); // the bad value is never echoed back
    }
    expect(t.sent).toHaveLength(0);
  });

  test('rejects fields it does not know', async () => {
    const t = buildTestApp();
    const res = await request(t.app).post('/api/v1/auth/otp/request').send({mobile: MOBILE, role: 'admin'});
    expect(res.status).toBe(400);
  });

  test('a new code cancels the older one', async () => {
    const t = buildTestApp();
    await request(t.app).post('/api/v1/auth/otp/request').send({mobile: MOBILE});
    const first = t.lastCode();
    await request(t.app).post('/api/v1/auth/otp/request').send({mobile: MOBILE});
    const second = t.lastCode();
    if (first !== second) {
      const old = await request(t.app).post('/api/v1/auth/otp/verify').send({mobile: MOBILE, code: first});
      expect(old.status).toBe(401);
    }
    await request(t.app).post('/api/v1/auth/otp/verify').send({mobile: MOBILE, code: second}).expect(200);
  });
});

describe('verifying an OTP', () => {
  test('logs in, creates the account on first login, and returns tokens', async () => {
    const t = buildTestApp();
    const session = await t.login();

    expect(session.tokenType).toBe('Bearer');
    expect(session.expiresInSeconds).toBe(900);
    expect(session.user).toMatchObject({mobile: MOBILE, roleId: 14, role: 'customer', name: null});
    expect(session.accessToken.split('.')).toHaveLength(3);
    expect(t.prisma.user.rows).toHaveLength(1);

    // the refresh token is stored only as a hash
    const stored = t.prisma.refreshToken.rows[0];
    expect(stored.tokenHash).toBe(sha256Hex(session.refreshToken));
    expect(asJson(stored)).not.toContain(session.refreshToken);

    // second login: same account, no duplicate
    await t.login();
    expect(t.prisma.user.rows).toHaveLength(1);
  });

  test('a code works once only', async () => {
    const t = buildTestApp();
    await request(t.app).post('/api/v1/auth/otp/request').send({mobile: MOBILE});
    const code = t.lastCode();
    await request(t.app).post('/api/v1/auth/otp/verify').send({mobile: MOBILE, code}).expect(200);
    const again = await request(t.app).post('/api/v1/auth/otp/verify').send({mobile: MOBILE, code});
    expect(again.status).toBe(401);
  });

  test('wrong, missing and expired codes all give the same answer', async () => {
    const t = buildTestApp();
    const wrong = await request(t.app).post('/api/v1/auth/otp/verify').send({mobile: MOBILE, code: '000000'}); // no code requested yet
    await request(t.app).post('/api/v1/auth/otp/request').send({mobile: MOBILE});
    const code = t.lastCode();
    const wrongCode = code === '123456' ? '654321' : '123456';
    const bad = await request(t.app).post('/api/v1/auth/otp/verify').send({mobile: MOBILE, code: wrongCode});
    t.prisma.otpChallenge.rows[0].expiresAt = new Date(Date.now() - 1000);
    const expired = await request(t.app).post('/api/v1/auth/otp/verify').send({mobile: MOBILE, code});

    for (const res of [wrong, bad, expired]) {
      expect(res.status).toBe(401);
      expect(res.body).toEqual({statusCode: 401, message: 'The code is wrong or has expired.'});
    }
  });

  test('after 5 wrong tries even the right code stops working (cannot be guessed)', async () => {
    const t = buildTestApp();
    await request(t.app).post('/api/v1/auth/otp/request').send({mobile: MOBILE});
    const code = t.lastCode();
    const wrongCode = code === '123456' ? '654321' : '123456';
    for (let i = 0; i < 5; i++) {
      await request(t.app).post('/api/v1/auth/otp/verify').send({mobile: MOBILE, code: wrongCode}).expect(401);
    }
    const res = await request(t.app).post('/api/v1/auth/otp/verify').send({mobile: MOBILE, code});
    expect(res.status).toBe(401);
    expect(t.prisma.user.rows).toHaveLength(0);
  });

  test('a blocked account cannot log in', async () => {
    const t = buildTestApp();
    await t.login();
    t.prisma.user.rows[0].status = 'blocked';
    await request(t.app).post('/api/v1/auth/otp/request').send({mobile: MOBILE});
    const res = await request(t.app).post('/api/v1/auth/otp/verify').send({mobile: MOBILE, code: t.lastCode()});
    expect(res.status).toBe(403);
    expect(t.prisma.auditLog.rows.map(r => r.action)).toContain('auth.login.blocked');
  });
});

describe('refresh tokens', () => {
  test('swap for a new pair, and the old refresh token stops working', async () => {
    const t = buildTestApp();
    const first = await t.login();
    const res = await request(t.app).post('/api/v1/auth/refresh').send({refreshToken: first.refreshToken}).expect(200);

    expect(res.body.refreshToken).not.toBe(first.refreshToken);
    expect(res.body.accessToken).toBeTruthy();
    await request(t.app).get('/api/v1/users/me').set('Authorization', `Bearer ${res.body.accessToken}`).expect(200);
  });

  test('replaying an old token cancels that whole login (theft detection)', async () => {
    const t = buildTestApp();
    const first = await t.login();
    const second = await request(t.app).post('/api/v1/auth/refresh').send({refreshToken: first.refreshToken}).expect(200);

    // someone replays the first token
    await request(t.app).post('/api/v1/auth/refresh').send({refreshToken: first.refreshToken}).expect(401);
    // the newer token, from the same login, is now dead too
    await request(t.app).post('/api/v1/auth/refresh').send({refreshToken: second.body.refreshToken}).expect(401);
    expect(t.prisma.auditLog.rows.map(r => r.action)).toContain('auth.refresh.reuse_detected');
  });

  test('an expired or unknown token is refused', async () => {
    const t = buildTestApp();
    const session = await t.login();
    await request(t.app)
      .post('/api/v1/auth/refresh')
      .send({refreshToken: 'x'.repeat(64)})
      .expect(401);
    t.prisma.refreshToken.rows[0].expiresAt = new Date(Date.now() - 1000);
    await request(t.app).post('/api/v1/auth/refresh').send({refreshToken: session.refreshToken}).expect(401);
  });

  test('a blocked user cannot refresh', async () => {
    const t = buildTestApp();
    const session = await t.login();
    t.prisma.user.rows[0].status = 'blocked';
    await request(t.app).post('/api/v1/auth/refresh').send({refreshToken: session.refreshToken}).expect(401);
  });

  test('logout ends the login, and always answers the same way', async () => {
    const t = buildTestApp();
    const session = await t.login();
    await request(t.app).post('/api/v1/auth/logout').send({refreshToken: session.refreshToken}).expect(204);
    await request(t.app).post('/api/v1/auth/refresh').send({refreshToken: session.refreshToken}).expect(401);
    // a token that never existed gives the same answer, so nothing is revealed
    await request(t.app)
      .post('/api/v1/auth/logout')
      .send({refreshToken: 'y'.repeat(64)})
      .expect(204);
  });
});

describe('the logged-in user', () => {
  test('GET /users/me needs a valid token', async () => {
    const t = buildTestApp();
    const session = await t.login();

    const ok = await request(t.app).get('/api/v1/users/me').set('Authorization', `Bearer ${session.accessToken}`);
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({mobile: MOBILE, roleId: 14, role: 'customer'});

    await request(t.app).get('/api/v1/users/me').expect(401);
    await request(t.app).get('/api/v1/users/me').set('Authorization', 'Bearer not-a-token').expect(401);
    await request(t.app).get('/api/v1/users/me').set('Authorization', `Basic ${session.accessToken}`).expect(401);
  });

  test('forged, expired and wrong-audience tokens are refused', async () => {
    const t = buildTestApp();
    const session = await t.login();
    const userId = session.user.id;
    const secret = BASE_ENV.JWT_ACCESS_SECRET;
    const claims = {roleId: 1};
    const good = {subject: userId, issuer: 'atiyaherbs-api', audience: 'atiyaherbs-app'};

    const tokens = {
      wrongSecret: jwt.sign(claims, 'another-secret-another-secret-0123456789', good),
      expired: jwt.sign(claims, secret, {...good, expiresIn: -10}),
      wrongAudience: jwt.sign(claims, secret, {...good, audience: 'someone-else'}),
      wrongIssuer: jwt.sign(claims, secret, {...good, issuer: 'someone-else'}),
      unknownRole: jwt.sign({roleId: 999}, secret, good),
      algNone: `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({sub: userId, roleId: 1, iss: 'atiyaherbs-api', aud: 'atiyaherbs-app'})).toString('base64url')}.`,
    };
    for (const [name, token] of Object.entries(tokens)) {
      const res = await request(t.app).get('/api/v1/users/me').set('Authorization', `Bearer ${token}`);
      expect([name, res.status]).toEqual([name, 401]);
    }
  });

  test('a blocked account stops working even with a still-valid access token', async () => {
    const t = buildTestApp();
    const session = await t.login();
    t.prisma.user.rows[0].status = 'blocked';
    await request(t.app).get('/api/v1/users/me').set('Authorization', `Bearer ${session.accessToken}`).expect(404);
  });

  test('PATCH /users/me changes only name and email', async () => {
    const t = buildTestApp();
    const session = await t.login();
    const auth = {Authorization: `Bearer ${session.accessToken}`};

    const res = await request(t.app).patch('/api/v1/users/me').set(auth).send({name: '  Asha Khan ', email: 'asha@example.com'});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({name: 'Asha Khan', email: 'asha@example.com'});

    // a user can never promote or move themselves
    for (const body of [{role: 'admin'}, {status: 'active'}, {mobile: '9000000000'}, {id: 'someone-else'}]) {
      const bad = await request(t.app).patch('/api/v1/users/me').set(auth).send(body);
      expect([asJson(body), bad.status]).toEqual([asJson(body), 400]);
    }
    expect(t.prisma.user.rows[0].roleId).toBe(14);
  });

  test('profile fields are checked, and quotes are stored safely, not run as SQL', async () => {
    const t = buildTestApp();
    const session = await t.login();
    const auth = {Authorization: `Bearer ${session.accessToken}`};

    for (const body of [{name: '<script>alert(1)</script>'}, {name: 'A'}, {name: 'x'.repeat(101)}, {email: 'not-an-email'}, {name: 5}]) {
      const res = await request(t.app).patch('/api/v1/users/me').set(auth).send(body);
      expect([asJson(body), res.status]).toEqual([asJson(body), 400]);
    }

    const odd = "O'Brien; DROP TABLE users;--";
    const res = await request(t.app).patch('/api/v1/users/me').set(auth).send({name: odd});
    expect(res.body.name).toBe(odd);
    expect(t.prisma.user.rows).toHaveLength(1);
  });
});

describe('the audit trail', () => {
  test('records logins and changes, and never contains a code or a token', async () => {
    const t = buildTestApp();
    const session = await t.login();
    await request(t.app).patch('/api/v1/users/me').set('Authorization', `Bearer ${session.accessToken}`).send({name: 'Asha Khan'});
    await request(t.app).post('/api/v1/auth/logout').send({refreshToken: session.refreshToken});

    const actions = t.prisma.auditLog.rows.map(row => row.action);
    expect(actions).toEqual(expect.arrayContaining(['auth.otp.requested', 'auth.signup', 'user.profile.updated', 'auth.logout']));

    const everything = asJson(t.prisma.auditLog.rows);
    expect(everything).not.toContain(t.sent[0].code);
    expect(everything).not.toContain(session.accessToken);
    expect(everything).not.toContain(session.refreshToken);
    expect(everything).not.toContain(MOBILE); // only the masked number is kept
    expect(everything).toContain('******3210');
  });

  test('a problem writing the audit trail does not break the login', async () => {
    const t = buildTestApp();
    t.prisma.auditLog.create = async () => {
      throw new Error('audit table unavailable');
    };
    await t.login();
  });
});
