const request = require('supertest');
const {buildTestApp} = require('./helpers/testApp');
const {ADDRESS} = require('./helpers/shop');

const API = '/api/v1/addresses';

describe('saved addresses', () => {
  test('need a login', async () => {
    const t = buildTestApp();
    await request(t.app).get(API).expect(401);
    await request(t.app).post(API).send(ADDRESS).expect(401);
  });

  test('the first address is the default, and a new default replaces it', async () => {
    const t = buildTestApp();
    const me = await t.login();
    const first = await request(t.app).post(API).set(t.bearer(me)).send(ADDRESS).expect(201);
    expect(first.body).toMatchObject({city: 'Lucknow', isDefault: true});
    const second = await request(t.app).post(API).set(t.bearer(me)).send({...ADDRESS, line1: '5 New Road, Aminabad', isDefault: true}).expect(201);
    expect(second.body.isDefault).toBe(true);
    const third = await request(t.app).post(API).set(t.bearer(me)).send({...ADDRESS, line1: '9 Old Road, Hazratganj'}).expect(201);
    expect(third.body.isDefault).toBe(false);

    const list = (await request(t.app).get(API).set(t.bearer(me)).expect(200)).body;
    expect(list.filter(a => a.isDefault)).toHaveLength(1);
    expect(list[0].id).toBe(second.body.id); // default first

    await request(t.app).post(`${API}/${third.body.id}/default`).set(t.bearer(me)).expect(200);
    expect((await request(t.app).get(API).set(t.bearer(me))).body.filter(a => a.isDefault).map(a => a.id)).toEqual([third.body.id]);
  });

  test('edit and delete; deleting the default promotes another one', async () => {
    const t = buildTestApp();
    const me = await t.login();
    const a = (await request(t.app).post(API).set(t.bearer(me)).send(ADDRESS)).body;
    const b = (await request(t.app).post(API).set(t.bearer(me)).send({...ADDRESS, line1: '5 New Road, Aminabad'})).body;
    const edited = await request(t.app).patch(`${API}/${b.id}`).set(t.bearer(me)).send({city: 'Kanpur'}).expect(200);
    expect(edited.body.city).toBe('Kanpur');
    await request(t.app).patch(`${API}/${b.id}`).set(t.bearer(me)).send({}).expect(400);
    await request(t.app).delete(`${API}/${a.id}`).set(t.bearer(me)).expect(204);
    expect((await request(t.app).get(`${API}/${b.id}`).set(t.bearer(me))).body.isDefault).toBe(true);
    await request(t.app).delete(`${API}/${a.id}`).set(t.bearer(me)).expect(404);
  });

  test('at most 10 addresses', async () => {
    const t = buildTestApp();
    const me = await t.login();
    for (let i = 0; i < 10; i++) {
      await request(t.app).post(API).set(t.bearer(me)).send({...ADDRESS, line1: `${i + 1} Some Road, Area`}).expect(201);
    }
    await request(t.app).post(API).set(t.bearer(me)).send(ADDRESS).expect(409);
  });

  test('one person can never see, change or delete another person\'s address', async () => {
    const t = buildTestApp();
    const asha = await t.login('9876543210');
    const bilal = await t.login('9123456780');
    const mine = (await request(t.app).post(API).set(t.bearer(asha)).send(ADDRESS)).body;
    await request(t.app).get(`${API}/${mine.id}`).set(t.bearer(bilal)).expect(404);
    await request(t.app).patch(`${API}/${mine.id}`).set(t.bearer(bilal)).send({city: 'Delhi'}).expect(404);
    await request(t.app).delete(`${API}/${mine.id}`).set(t.bearer(bilal)).expect(404);
    await request(t.app).post(`${API}/${mine.id}/default`).set(t.bearer(bilal)).expect(404);
    expect((await request(t.app).get(API).set(t.bearer(bilal))).body).toEqual([]);
    expect(t.prisma.address.rows[0].city).toBe('Lucknow');
  });

  test('checks every field with the same rules as the checkout screen, and refuses extra fields', async () => {
    const t = buildTestApp();
    const me = await t.login();
    const bad = [
      {...ADDRESS, name: 'A'},
      {...ADDRESS, phone: '12345'},
      {...ADDRESS, pincode: '012345'},
      {...ADDRESS, city: ''},
      {...ADDRESS, line1: 'abc'},
      {...ADDRESS, line1: '<b>12 Road</b>'},
      {...ADDRESS, userId: 'someone-else'},
      {...ADDRESS, id: 'x'},
    ];
    for (const body of bad) {
      await request(t.app).post(API).set(t.bearer(me)).send(body).expect(400);
    }
    expect(t.prisma.address.rows).toHaveLength(0);
  });

  test('a bad id in the address is not echoed back', async () => {
    const t = buildTestApp();
    const me = await t.login();
    const res = await request(t.app).get(`${API}/..%2F..%2Fsecret`).set(t.bearer(me));
    expect([400, 404]).toContain(res.status);
    expect(JSON.stringify(res.body)).not.toContain('secret');
  });
});
