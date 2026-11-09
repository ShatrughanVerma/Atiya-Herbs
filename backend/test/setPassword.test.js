const request = require('supertest');
const {applyPassword} = require('../prisma/setPassword');
const {buildTestApp} = require('./helpers/testApp');

describe('company tool: set a new password', () => {
  async function build() {
    const t = buildTestApp();
    // a person with a password and 4 wrong tries behind them
    await request(t.app).post('/api/v1/auth/register').send({name: 'Asha Khan', email: 'asha@example.com', mobile: '9876543210', password: 'Old-Pass-2026'}).expect(201);
    return t;
  }

  test('the new password works, the old one does not, and the lock is removed', async () => {
    const t = await build();
    const row = t.prisma.user.rows[0];
    row.failedLoginCount = 4;
    row.lockedUntil = new Date(Date.now() + 600_000);
    await applyPassword(t.prisma, 'ASHA@example.com', 'New-Pass-2026');
    expect(row).toMatchObject({failedLoginCount: 0, lockedUntil: null});
    await request(t.app).post('/api/v1/auth/login').send({identifier: 'asha@example.com', password: 'Old-Pass-2026'}).expect(401);
    await request(t.app).post('/api/v1/auth/login').send({identifier: 'asha@example.com', password: 'New-Pass-2026'}).expect(200);
    await request(t.app).post('/api/v1/auth/login').send({identifier: '9876543210', password: 'New-Pass-2026'}).expect(200);
  });

  test('every earlier login of the account is ended and the action is recorded without the password', async () => {
    const t = await build();
    const session = (await request(t.app).post('/api/v1/auth/login').send({identifier: 'asha@example.com', password: 'Old-Pass-2026'}).expect(200)).body;
    await applyPassword(t.prisma, '9876543210', 'New-Pass-2026');
    await request(t.app).post('/api/v1/auth/refresh').send({refreshToken: session.refreshToken}).expect(401);
    expect(t.prisma.auditLog.rows.map(r => r.action)).toContain('admin.password.reset');
    expect(JSON.stringify(t.prisma.auditLog.rows)).not.toContain('New-Pass');
  });

  test('refuses an unknown account, a bad identifier and a weak password, and changes nothing', async () => {
    const t = await build();
    const before = t.prisma.user.rows[0].passwordHash;
    await expect(applyPassword(t.prisma, 'nobody@example.com', 'New-Pass-2026')).rejects.toThrow(/No account/);
    await expect(applyPassword(t.prisma, '12345', 'New-Pass-2026')).rejects.toThrow(/email or a 10-digit/);
    await expect(applyPassword(t.prisma, 'asha@example.com', 'short1')).rejects.toThrow(/at least 8/);
    await expect(applyPassword(t.prisma, 'asha@example.com', '9876543210')).rejects.toThrow();
    expect(t.prisma.user.rows[0].passwordHash).toBe(before);
  });
});
