const request = require('supertest');
const {buildTestApp} = require('./helpers/testApp');
const {loadShop, ADDRESS} = require('./helpers/shop');
const {buildMysqlUrl} = require('../src/config/databaseUrl');

const API = '/api/v1';
const KEY = 'internal-key-internal-key-internal-key-1234';

describe('deleting my account', () => {
  async function setup() {
    const t = buildTestApp({INTERNAL_API_KEY: KEY});
    await loadShop(t.prisma);
    const me = await t.login('9876543210');
    const other = await t.login('9123456780');
    const address = (await request(t.app).post(`${API}/addresses`).set(t.bearer(me)).send(ADDRESS)).body;
    const order = (await request(t.app).post(`${API}/orders`).set(t.bearer(me)).send({items: [{productId: 't-care', qty: 1}], addressId: address.id, paymentMethod: 'cod'})).body;
    const internal = (path, body) => request(t.app).post(`${API}/internal/${path}`).set('X-Internal-Key', KEY).send(body).expect(201);
    const at = '2026-11-06T10:00:00.000Z';
    await internal('call-logs', {logs: [{externalId: 'c1', kind: 'voice', callerMobile: '9876543210', calleeMobile: '9123456780', outcome: 'completed', startedAt: at}]});
    await internal('meeting-messages', {
      messages: [
        {externalId: 'm1', meetingId: 'abc-defg-hij', fromMobile: '9876543210', fromName: 'Asha', text: 'hi', sentAt: at},
        {externalId: 'm2', meetingId: 'abc-defg-hij', fromMobile: '9123456780', fromName: 'Bilal', toMobile: '9876543210', text: 'private', sentAt: at},
        {externalId: 'm3', meetingId: 'abc-defg-hij', fromMobile: '9123456780', fromName: 'Bilal', text: 'to all', sentAt: at},
      ],
    });
    return {...t, me, other, order};
  }

  test('needs a login', async () => {
    const t = buildTestApp();
    await request(t.app).delete(`${API}/users/me`).expect(401);
  });

  test('is refused while an order is on its way', async () => {
    const t = await setup();
    const res = await request(t.app).delete(`${API}/users/me`).set(t.bearer(t.me)).expect(409);
    expect(res.body.message).toMatch(/order/);
    expect(t.prisma.user.rows).toHaveLength(2);
  });

  test('removes the person and their data, keeps what the shop needs without a link to them', async () => {
    const t = await setup();
    await request(t.app).post(`${API}/orders/${t.order.id}/cancel`).set(t.bearer(t.me)).expect(200);
    const refresh = t.me.refreshToken;
    await request(t.app).delete(`${API}/users/me`).set(t.bearer(t.me)).expect(204);

    expect(t.prisma.user.rows.map(u => u.mobile)).toEqual(['9123456780']);
    expect(t.prisma.refreshToken.rows.every(r => r.userId === t.other.user.id)).toBe(true);
    expect(t.prisma.address.rows).toHaveLength(0);
    // the order stays for the books, with no person and no address
    expect(t.prisma.order.rows[0]).toMatchObject({userId: null, shippingAddress: {removed: true}});
    // chat: everything Asha sent or received privately is gone; Bilal's message to everyone stays
    expect(t.prisma.meetingMessage.rows.map(m => m.text)).toEqual(['to all']);
    // call history of the other person no longer carries Asha's number
    expect(t.prisma.callLog.rows[0]).toMatchObject({callerMobile: 'deleted', calleeMobile: '9123456780'});
    // the audit trail has no link to the account and no full number
    expect(t.prisma.auditLog.rows.every(r => r.userId !== t.me.user.id)).toBe(true);
    const last = t.prisma.auditLog.rows.find(r => r.action === 'user.deleted');
    expect(last.metadata).toContain('******3210');
    expect(last.metadata).not.toContain('9876543210');

    // the old login stops working, and the number can sign up again as a new person
    await request(t.app).get(`${API}/users/me`).set(t.bearer(t.me)).expect(404);
    await request(t.app).post(`${API}/auth/refresh`).send({refreshToken: refresh}).expect(401);
    const again = await t.login('9876543210');
    expect(again.user.id).not.toBe(t.me.user.id);
  });

  test('one person cannot delete another: there is no way to name a user', async () => {
    const t = await setup();
    await request(t.app).delete(`${API}/users/9123456780`).set(t.bearer(t.me)).expect(404);
    await request(t.app).delete(`${API}/users/me`).set(t.bearer(t.other)).expect(204);
    expect(t.prisma.user.rows.map(u => u.mobile)).toEqual(['9876543210']);
  });
});

describe('database url for the command line', () => {
  test('builds a mysql url from separate settings, escaping the password', () => {
    const url = buildMysqlUrl({DB_HOST: 'db.example.com', DB_PORT: '3307', DB_NAME: 'atiyaherbs', DB_USER: 'atiya_app', DB_PASSWORD: 'p@ss:w/rd#1'});
    expect(url).toBe('mysql://atiya_app:p%40ss%3Aw%2Frd%231@db.example.com:3307/atiyaherbs');
  });

  test('uses the migration login for migrations and turns on strict SSL when asked', () => {
    const env = {DB_USER: 'app', DB_PASSWORD: 'one', MIGRATE_DB_USER: 'mig', MIGRATE_DB_PASSWORD: 'two', DB_SSL: 'true'};
    expect(buildMysqlUrl(env)).toContain('app:one@localhost:3306/atiyaherbs');
    expect(buildMysqlUrl(env)).toContain('sslaccept=strict');
    expect(buildMysqlUrl(env, {forMigrations: true})).toContain('mig:two@');
    expect(buildMysqlUrl({DB_USER: 'a', DB_PASSWORD: 'b'}, {forMigrations: true})).toBe('mysql://a:b@localhost:3306/atiyaherbs');
  });
});
