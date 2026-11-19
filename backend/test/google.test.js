const request = require('supertest');
const {generateKeyPairSync} = require('node:crypto');
const jwt = require('jsonwebtoken');
const {buildTestApp} = require('./helpers/testApp');
const {createGoogleVerifier} = require('../src/auth/googleVerifier');

const CLIENT_ID = '1234567890-abc.apps.googleusercontent.com';
const on = (extra = {}) => buildTestApp({GOOGLE_CLIENT_IDS: CLIENT_ID, ...extra});
const google = (t, body) => request(t.app).post('/api/v1/auth/google').send(body);

describe('POST /auth/google', () => {
  test('is switched off until a Google client id is set', async () => {
    const t = buildTestApp();
    const res = await google(t, {idToken: 'good:asha@example.com|Asha Verma'});
    expect(res.status).toBe(503);
  });

  test('a new person: first the server asks for a mobile number, then it makes the account and logs in', async () => {
    const t = on();
    const idToken = 'good:Asha@Example.com|Asha Verma';

    const first = await google(t, {idToken});
    expect(first.status).toBe(200);
    expect(first.body).toEqual({needsMobile: true, otpRequired: false, name: 'Asha Verma', email: 'asha@example.com'});
    expect(t.prisma.user.rows).toHaveLength(0); // nothing is saved yet

    const second = await google(t, {idToken, mobile: '98765 43210', deviceName: 'Pixel'});
    expect(second.status).toBe(200);
    expect(second.body.user).toMatchObject({mobile: '9876543210', name: 'Asha Verma', email: 'asha@example.com'});
    expect(second.body.accessToken).toBeTruthy();
    expect(t.prisma.user.rows[0].passwordHash ?? null).toBeNull();

    const me = await request(t.app).get('/api/v1/users/me').set(t.bearer(second.body)).expect(200);
    expect(me.body.email).toBe('asha@example.com');
  });

  test('a person who already has an account with that email just logs in, no mobile needed', async () => {
    const t = on();
    await request(t.app)
      .post('/api/v1/auth/register')
      .send({name: 'Asha Verma', email: 'asha@example.com', mobile: '9876543210', password: 'Herbal-Tea-42'})
      .expect(201);
    const res = await google(t, {idToken: 'good:asha@example.com|Asha V'});
    expect(res.status).toBe(200);
    expect(res.body.user.mobile).toBe('9876543210');
    expect(t.prisma.user.rows).toHaveLength(1);
  });

  test('a mobile number that is already registered is refused', async () => {
    const t = on();
    await t.login('9876543210');
    const res = await google(t, {idToken: 'good:new@example.com|New Person', mobile: '9876543210'});
    expect(res.status).toBe(409);
  });

  test('a token Google did not make, or with an unverified email, is refused', async () => {
    const t = on();
    expect((await google(t, {idToken: 'forged-token-forged-token'})).status).toBe(401);
    expect((await google(t, {idToken: 'unverified:asha@example.com'})).status).toBe(401);
    expect(t.prisma.user.rows).toHaveLength(0);
  });

  test('a blocked account cannot log in with Google', async () => {
    const t = on();
    await request(t.app).post('/api/v1/auth/register').send({name: 'Asha', email: 'asha@example.com', mobile: '9876543210', password: 'Herbal-Tea-42'});
    t.prisma.user.rows[0].status = 'blocked';
    expect((await google(t, {idToken: 'good:asha@example.com|Asha'})).status).toBe(403);
  });

  test('with OTP on, the mobile number must be proved with the SMS code', async () => {
    const t = on({OTP_REQUIRED: 'true'});
    const idToken = 'good:asha@example.com|Asha Verma';
    expect((await google(t, {idToken})).body.otpRequired).toBe(true);

    const noCode = await google(t, {idToken, mobile: '9876543210'});
    expect(noCode.status).toBe(400);

    await request(t.app).post('/api/v1/auth/register/otp').send({mobile: '9876543210', email: 'asha@example.com'}).expect(200);
    const wrong = await google(t, {idToken, mobile: '9876543210', code: '000000'});
    expect(wrong.status).toBeGreaterThanOrEqual(400);
    const ok = await google(t, {idToken, mobile: '9876543210', code: t.lastCode()});
    expect(ok.status).toBe(200);
  });

  test('unknown fields are rejected', async () => {
    const t = on();
    expect((await google(t, {idToken: 'good:asha@example.com|A', role: 'admin'})).status).toBe(400);
  });
});

describe('Google ID token check', () => {
  const {privateKey, publicKey} = generateKeyPairSync('rsa', {modulusLength: 2048});
  const jwk = {...publicKey.export({format: 'jwk'}), kid: 'key-1'};
  const config = {googleClientIds: [CLIENT_ID]};
  const sign = (claims = {}, options = {}) =>
    jwt.sign(
      {iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: '1001', email: 'Asha@Example.com', email_verified: true, name: 'Asha Verma', ...claims},
      privateKey,
      {algorithm: 'RS256', keyid: 'key-1', expiresIn: 600, ...options},
    );
  let calls;
  const verifier = () => {
    calls = 0;
    return createGoogleVerifier({
      config,
      fetchImpl: async () => {
        calls += 1;
        return {ok: true, headers: {get: () => 'public, max-age=3600'}, json: async () => ({keys: [jwk]})};
      },
    });
  };

  test('a good token gives the person; keys are fetched once and reused', async () => {
    const v = verifier();
    expect(await v.verify(sign())).toEqual({email: 'asha@example.com', name: 'Asha Verma', googleId: '1001'});
    await v.verify(sign());
    expect(calls).toBe(1);
  });

  test.each([
    ['another app (audience)', {aud: 'someone-else.apps.googleusercontent.com'}, {}],
    ['another issuer', {iss: 'https://evil.example.com'}, {}],
    ['an expired token', {}, {expiresIn: -10}],
  ])('refuses %s', async (_name, claims, options) => {
    await expect(verifier().verify(sign(claims, options))).rejects.toMatchObject({status: 401});
  });

  test('refuses an unverified email, a token with an unknown key and one signed by someone else', async () => {
    await expect(verifier().verify(sign({email_verified: false}))).rejects.toMatchObject({status: 401});
    await expect(verifier().verify(sign({}, {keyid: 'other'}))).rejects.toMatchObject({status: 401});
    const other = generateKeyPairSync('rsa', {modulusLength: 2048}).privateKey;
    const forged = jwt.sign({iss: 'accounts.google.com', aud: CLIENT_ID, email: 'a@b.com', email_verified: true}, other, {algorithm: 'RS256', keyid: 'key-1'});
    await expect(verifier().verify(forged)).rejects.toMatchObject({status: 401});
    await expect(verifier().verify('not-a-token')).rejects.toMatchObject({status: 401});
  });

  test('"alg: none" tokens are refused', async () => {
    const none = jwt.sign({iss: 'accounts.google.com', aud: CLIENT_ID, email: 'a@b.com', email_verified: true}, '', {algorithm: 'none', keyid: 'key-1'});
    await expect(verifier().verify(none)).rejects.toMatchObject({status: 401});
  });

  test('Google being unreachable is a 503, not a login', async () => {
    const v = createGoogleVerifier({
      config,
      fetchImpl: async () => {
        throw new Error('offline');
      },
    });
    await expect(v.verify(sign())).rejects.toMatchObject({status: 503});
  });
});
