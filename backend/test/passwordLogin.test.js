const request = require('supertest');
const {buildTestApp} = require('./helpers/testApp');
const {hashPassword, passwordProblem, verifyAgainstDummy, verifyPassword} = require('../src/auth/passwordService');

const ASHA = {name: 'Asha Verma', email: 'Asha@Example.com', mobile: '98765 43210', password: 'Herbal-Tea-42'};

const register = (t, body = ASHA) => request(t.app).post('/api/v1/auth/register').send(body);
const login = (t, identifier, password) => request(t.app).post('/api/v1/auth/login').send({identifier, password});

describe('password hashing', () => {
  test('hashes carry their own settings, differ for the same password, and verify only the right one', async () => {
    const a = await hashPassword('Herbal-Tea-42');
    const b = await hashPassword('Herbal-Tea-42');
    expect(a).toMatch(/^scrypt\$32768\$8\$1\$[\w-]{22}\$[\w-]{43}$/);
    expect(a).not.toBe(b); // a new random salt every time
    expect(a).not.toContain('Herbal');
    expect(await verifyPassword('Herbal-Tea-42', a)).toBe(true);
    expect(await verifyPassword('Herbal-Tea-43', a)).toBe(false);
    expect(await verifyPassword('', a)).toBe(false);
  });

  test('a damaged, unknown or dangerous hash is simply "no"', async () => {
    for (const stored of [null, undefined, '', 'plain', 'bcrypt$x$y', 'scrypt$32768$8$1$AAAA', 'scrypt$3$8$1$AAAAAAAAAAAAAAAAAAAAAA$x', 'scrypt$4294967296$8$1$AAAAAAAAAAAAAAAAAAAAAA$x']) {
      expect(await verifyPassword('Herbal-Tea-42', stored)).toBe(false);
    }
  });

  test('the dummy check runs a real verification and never succeeds', async () => {
    expect(await verifyAgainstDummy('Herbal-Tea-42')).toBe(false);
  });

  test('the password rules', () => {
    expect(passwordProblem('Herbal-Tea-42')).toBe('');
    expect(passwordProblem('short1')).toMatch(/at least 8/);
    expect(passwordProblem('x'.repeat(129) + '1')).toMatch(/at most 128/);
    expect(passwordProblem('onlyletters')).toMatch(/letter and one number/);
    expect(passwordProblem('12345678')).toMatch(/letter and one number/);
    expect(passwordProblem('Password123')).toMatch(/too common/);
    expect(passwordProblem('9876543210a', {mobile: '9876543210a'})).toMatch(/not be your mobile/);
    expect(passwordProblem('asha1234', {email: 'asha1234@example.com'})).toMatch(/not be your mobile number or email/);
  });
});

describe('register', () => {
  test('creates the account in the database, stores only a hash, and returns a session like the OTP login', async () => {
    const t = buildTestApp();
    const res = await register(t).expect(201);
    expect(Object.keys(res.body).sort()).toEqual(['accessToken', 'expiresInSeconds', 'refreshToken', 'tokenType', 'user']);
    expect(res.body.user).toEqual({id: expect.any(String), mobile: '9876543210', name: 'Asha Verma', email: 'asha@example.com', roleId: 14, role: 'customer'});

    const row = t.prisma.user.rows[0];
    expect(row.passwordHash).toMatch(/^scrypt\$/);
    expect(row.passwordHash).not.toContain(ASHA.password);
    expect(row.email).toBe('asha@example.com'); // kept in lower case

    // the new tokens work
    const me = await request(t.app).get('/api/v1/users/me').set(t.bearer(res.body)).expect(200);
    expect(me.body.email).toBe('asha@example.com');
    expect(JSON.stringify(me.body)).not.toMatch(/scrypt|password/i);
    const refreshed = await request(t.app).post('/api/v1/auth/refresh').send({refreshToken: res.body.refreshToken}).expect(200);
    expect(refreshed.body.refreshToken).not.toBe(res.body.refreshToken);
  });

  test('a mobile number or an email already registered is a 409 with a clear message', async () => {
    const t = buildTestApp();
    await register(t).expect(201);
    const sameMobile = await register(t, {...ASHA, email: 'other@example.com'}).expect(409);
    expect(sameMobile.body.message).toMatch(/mobile number is already registered/);
    const sameEmail = await register(t, {...ASHA, mobile: '9123456780', email: 'ASHA@example.com'}).expect(409);
    expect(sameEmail.body.message).toMatch(/email is already registered/);
    expect(t.prisma.user.rows).toHaveLength(1);
  });

  test('a registration that races another one is also a 409, never a 500', async () => {
    const t = buildTestApp();
    const realFindFirst = t.prisma.user.findFirst;
    t.prisma.user.findFirst = async () => null; // both requests "saw" no account
    await register(t).expect(201);
    const res = await register(t).expect(409);
    t.prisma.user.findFirst = realFindFirst;
    expect(res.body.message).toMatch(/already registered/);
  });

  test('bad input is refused field by field, weak passwords and unknown fields included', async () => {
    const t = buildTestApp();
    const fields = async body => (await register(t, body).expect(400)).body.details.map(d => d.field);
    expect(await fields({...ASHA, name: 'A'})).toEqual(['name']);
    expect(await fields({...ASHA, email: 'not-an-email'})).toEqual(['email']);
    expect(await fields({...ASHA, mobile: '12345'})).toEqual(['mobile']);
    expect(await fields({...ASHA, password: 'short1'})).toEqual(['password']);
    expect(await fields({...ASHA, password: 'onlyletters'})).toEqual(['password']);
    expect(await fields({...ASHA, password: 'Password123'})).toEqual(['password']);
    expect(await fields({...ASHA, role: 'admin'})).toEqual(['body']);
    expect(t.prisma.user.rows).toHaveLength(0);
  });

  test('the answer never echoes the password, and the audit trail has no secrets', async () => {
    const t = buildTestApp();
    const res = await register(t, {...ASHA, password: 'weak'}).expect(400);
    expect(JSON.stringify(res.body)).not.toContain('weak');
    await register(t).expect(201);
    await login(t, ASHA.email, 'Wrong-Pass-9').expect(401);
    const trail = JSON.stringify(t.prisma.auditLog.rows);
    expect(trail).toContain('auth.register');
    expect(trail).not.toContain(ASHA.password);
    expect(trail).not.toContain('Wrong-Pass-9');
    expect(trail).not.toContain('scrypt');
    expect(trail).not.toContain('9876543210'); // only the masked number
    expect(trail).not.toContain('asha@example.com'); // only the masked email
  });

  test('registering is limited per IP', async () => {
    const t = buildTestApp();
    let last;
    for (let i = 0; i < 11; i++) {
      last = await register(t, {...ASHA, mobile: `98765432${10 + i}`, email: `a${i}@example.com`, password: 'x'});
    }
    expect(last.status).toBe(429);
  });
});

describe('login', () => {
  const setup = async (overrides = {}) => {
    const t = buildTestApp(overrides);
    await register(t).expect(201);
    return t;
  };

  test('works with the email (any capitals) or the mobile (any format) and the password', async () => {
    const t = await setup();
    for (const who of ['asha@example.com', 'ASHA@Example.COM', ' asha@example.com ', '9876543210', '+91 98765-43210', '09876543210']) {
      const res = await login(t, who, ASHA.password).expect(200);
      expect(res.body.user.mobile).toBe('9876543210');
      expect(res.body.accessToken).toEqual(expect.any(String));
    }
    expect(t.prisma.user.rows[0].lastLoginAt).toBeInstanceOf(Date);
    expect(JSON.stringify(t.prisma.auditLog.rows)).toContain('auth.login_success');
  });

  test('a wrong password, an unknown account and an account with no password all get the same answer', async () => {
    const t = await setup();
    t.prisma.user.rows.push({id: 'otp-only', mobile: '9111111111', name: null, email: null, roleId: 14, status: 'active', passwordHash: null, failedLoginCount: 0, lockedUntil: null});
    const answers = [
      await login(t, ASHA.email, 'Wrong-Pass-9'),
      await login(t, 'nobody@example.com', ASHA.password),
      await login(t, '9000000000', ASHA.password),
      await login(t, '9111111111', ASHA.password), // made by OTP earlier: cannot use a password
      await login(t, 'not a valid identifier', ASHA.password),
    ];
    for (const res of answers) {
      expect(res.status).toBe(401);
      expect(res.body).toEqual({statusCode: 401, message: 'Wrong login details.'});
    }
  });

  test('five wrong passwords lock the account for 15 minutes: 429 with Retry-After, even for the right password', async () => {
    const t = await setup();
    for (let i = 0; i < 5; i++) {
      await login(t, ASHA.email, 'Wrong-Pass-9').expect(401);
    }
    const locked = await login(t, ASHA.email, ASHA.password).expect(429);
    expect(locked.body.message).toBe('Wrong login details.'); // same generic message
    const wait = Number(locked.headers['retry-after']);
    expect(wait).toBeGreaterThan(14 * 60);
    expect(wait).toBeLessThanOrEqual(15 * 60);
    expect(JSON.stringify(t.prisma.auditLog.rows)).toContain('auth.login_locked');

    // after the lock runs out the right password works again and the counter starts from zero
    t.prisma.user.rows[0].lockedUntil = new Date(Date.now() - 1000);
    await login(t, ASHA.email, ASHA.password).expect(200);
    expect(t.prisma.user.rows[0].failedLoginCount).toBe(0);
    expect(t.prisma.user.rows[0].lockedUntil).toBe(null);
  });

  test('wrong passwords in a row are counted, and a good login clears the count', async () => {
    const t = await setup();
    for (let i = 0; i < 4; i++) {
      await login(t, ASHA.mobile, 'Wrong-Pass-9').expect(401);
    }
    expect(t.prisma.user.rows[0].failedLoginCount).toBe(4);
    await login(t, ASHA.mobile, ASHA.password).expect(200);
    expect(t.prisma.user.rows[0].failedLoginCount).toBe(0);
    for (let i = 0; i < 4; i++) {
      await login(t, ASHA.mobile, 'Wrong-Pass-9').expect(401);
    }
    await login(t, ASHA.mobile, ASHA.password).expect(200); // four more wrong ones did not lock it
  });

  test('a blocked account is refused only for someone who knows the password', async () => {
    const t = await setup();
    t.prisma.user.rows[0].status = 'blocked';
    const withPassword = await login(t, ASHA.email, ASHA.password).expect(403);
    expect(withPassword.body.message).toMatch(/cannot be used/);
    const wrong = await login(t, ASHA.email, 'Wrong-Pass-9').expect(401);
    expect(wrong.body.message).toBe('Wrong login details.');
  });

  test('every try does a full password check, so unknown accounts take about as long as wrong passwords', async () => {
    const t = await setup();
    const time = async (who, password) => {
      const started = process.hrtime.bigint();
      await login(t, who, password);
      return Number(process.hrtime.bigint() - started) / 1e6;
    };
    const unknown = await time('nobody@example.com', 'Wrong-Pass-9');
    const wrong = await time(ASHA.email, 'Wrong-Pass-9');
    expect(unknown).toBeGreaterThan(20); // a real scrypt run, not an early return
    expect(wrong).toBeGreaterThan(20);
  });

  test('is limited per IP', async () => {
    const t = await setup();
    let last;
    for (let i = 0; i < 16; i++) {
      last = await login(t, `nobody${i}@example.com`, 'Wrong-Pass-9');
    }
    expect(last.status).toBe(429);
  });

  test('the OTP login still works for the same number (kept for number verification later)', async () => {
    const t = await setup();
    const session = await t.login('9876543210');
    expect(session.user.email).toBe('asha@example.com');
  });
});

describe('change password', () => {
  const sessionFor = async t => (await register(t).expect(201)).body;

  test('needs a login, checks the current password, and ends every other login while this phone stays in', async () => {
    const t = buildTestApp();
    const phone = await sessionFor(t);
    const other = (await login(t, ASHA.email, ASHA.password).expect(200)).body; // a second phone

    await request(t.app).post('/api/v1/users/me/password').send({currentPassword: ASHA.password, newPassword: 'Another-Pass-7'}).expect(401);

    const wrong = await request(t.app).post('/api/v1/users/me/password').set(t.bearer(phone)).send({currentPassword: 'Wrong-Pass-9', newPassword: 'Another-Pass-7'}).expect(400);
    expect(wrong.body.details).toEqual([{field: 'currentPassword', message: 'The current password is not correct.'}]);

    const res = await request(t.app).post('/api/v1/users/me/password').set(t.bearer(phone)).send({currentPassword: ASHA.password, newPassword: 'Another-Pass-7'}).expect(200);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(JSON.stringify(res.body)).not.toMatch(/Another-Pass-7|scrypt/);

    // this phone has a fresh session ...
    await request(t.app).post('/api/v1/auth/refresh').send({refreshToken: res.body.refreshToken}).expect(200);
    // ... and the old logins are over
    await request(t.app).post('/api/v1/auth/refresh').send({refreshToken: other.refreshToken}).expect(401);
    await request(t.app).post('/api/v1/auth/refresh').send({refreshToken: phone.refreshToken}).expect(401);

    await login(t, ASHA.email, ASHA.password).expect(401);
    await login(t, ASHA.email, 'Another-Pass-7').expect(200);
    expect(JSON.stringify(t.prisma.auditLog.rows)).toContain('auth.password_changed');
  });

  test('the new password must follow the rules and differ from the current one', async () => {
    const t = buildTestApp();
    const phone = await sessionFor(t);
    const change = newPassword => request(t.app).post('/api/v1/users/me/password').set(t.bearer(phone)).send({currentPassword: ASHA.password, newPassword});
    expect((await change('Password123').expect(400)).body.details[0].field).toBe('newPassword');
    expect((await change('onlyletters').expect(400)).body.details[0].field).toBe('newPassword');
    expect((await change(ASHA.password).expect(400)).body.details[0].message).toMatch(/different/);
    expect((await change('short1').expect(400)).body.details[0].field).toBe('newPassword');
    await login(t, ASHA.email, ASHA.password).expect(200); // nothing changed
  });

  test('wrong current passwords lock the account just like wrong logins', async () => {
    const t = buildTestApp();
    const phone = await sessionFor(t);
    const attempt = () => request(t.app).post('/api/v1/users/me/password').set(t.bearer(phone)).send({currentPassword: 'Wrong-Pass-9', newPassword: 'Another-Pass-7'});
    for (let i = 0; i < 5; i++) {
      await attempt().expect(400);
    }
    const locked = await attempt().expect(429);
    expect(Number(locked.headers['retry-after'])).toBeGreaterThan(0);
  });
});

describe('profile email is unique', () => {
  test('changing to an email another account uses is a 409; the capitals do not matter', async () => {
    const t = buildTestApp();
    const asha = (await register(t).expect(201)).body;
    const bilal = (await register(t, {name: 'Bilal Khan', email: 'bilal@example.com', mobile: '9123456780', password: 'Bilal-Pass-77'}).expect(201)).body;
    const res = await request(t.app).patch('/api/v1/users/me').set(t.bearer(bilal)).send({email: 'ASHA@example.com'}).expect(409);
    expect(res.body.message).toMatch(/already used/);
    const ok = await request(t.app).patch('/api/v1/users/me').set(t.bearer(asha)).send({email: 'Asha.New@Example.com'}).expect(200);
    expect(ok.body.email).toBe('asha.new@example.com');
  });
});
