const request = require('supertest');
const {buildTestApp} = require('./helpers/testApp');
const {loadShop} = require('./helpers/shop');

const API = '/api/v1';
const ADDRESS = {name: 'Asha Khan', phone: '9123456780', pincode: '226023', city: 'Lucknow', state: 'Uttar Pradesh', line1: '12 Vijay Nagar'};

async function withOrder() {
  const t = buildTestApp();
  await loadShop(t.prisma);
  const admin = await t.loginAs('admin');
  const buyer = await t.login('9123456780');
  const address = await request(t.app).post(`${API}/addresses`).set(t.bearer(buyer)).send(ADDRESS).expect(201);
  await request(t.app).post(`${API}/orders`).set(t.bearer(buyer)).send({addressId: address.body.id, paymentMethod: 'cod', items: [{productId: 't-care', qty: 2}]}).expect(201);
  const as = (method, path) => request(t.app)[method](`${API}/admin${path}`).set(t.bearer(admin));
  return {t, admin, buyer, as};
}

test('customers and shop numbers are for admins only', async () => {
  const {t, buyer} = await withOrder();
  for (const path of ['/customers', `/customers/${buyer.user.id}`, '/shop-summary']) {
    await request(t.app).get(`${API}/admin${path}`).expect(401);
    await request(t.app).get(`${API}/admin${path}`).set(t.bearer(buyer)).expect(403);
  }
  await request(t.app).patch(`${API}/admin/customers/${buyer.user.id}`).set(t.bearer(buyer)).send({status: 'blocked'}).expect(403);
});

test('lists and searches customers only, with no password data', async () => {
  const {buyer, admin, as} = await withOrder();
  const list = await as('get', '/customers').expect(200);
  expect(list.body.total).toBe(1); // the admin is not a customer
  expect(JSON.stringify(list.body)).not.toMatch(/passwordHash|roleId/);
  expect((await as('get', '/customers?q=912345').expect(200)).body.total).toBe(1);
  expect((await as('get', `/customers?q=${list.body.items[0].patientCode}`).expect(200)).body.total).toBe(1);
  expect((await as('get', '/customers?q=nobody').expect(200)).body.total).toBe(0);
  await as('get', `/customers/${admin.user.id}`).expect(404);

  const one = await as('get', `/customers/${buyer.user.id}`).expect(200);
  expect(one.body).toMatchObject({orderCount: 1, appointmentCount: 0});
  expect(one.body.orders[0]).toMatchObject({status: 'placed', total: 1798});
});

test('blocking ends the sessions, unblocking allows login again, and staff cannot be blocked', async () => {
  const {t, admin, buyer, as} = await withOrder();
  await as('patch', `/customers/${admin.user.id}`).send({status: 'blocked'}).expect(404);
  await as('patch', `/customers/${buyer.user.id}`).send({status: 'deleted'}).expect(400);
  expect((await as('patch', `/customers/${buyer.user.id}`).send({status: 'blocked'}).expect(200)).body.status).toBe('blocked');
  await as('patch', `/customers/${buyer.user.id}`).send({status: 'blocked'}).expect(409);
  await request(t.app).post(`${API}/auth/refresh`).send({refreshToken: buyer.refreshToken}).expect(401);
  expect((await as('patch', `/customers/${buyer.user.id}`).send({status: 'active'}).expect(200)).body.status).toBe('active');
  await t.login('9123456780');
  expect(t.prisma.auditLog.rows.map(r => r.action)).toEqual(expect.arrayContaining(['admin.customer.block', 'admin.customer.unblock']));
});

test('the shop numbers count orders and low stock, and leave cancelled orders out of sales', async () => {
  const {t, as} = await withOrder();
  const first = (await as('get', '/shop-summary').expect(200)).body;
  expect(first).toMatchObject({ordersToday: 1, salesToday: 1798, sales30Days: 1798, toConfirm: 1, toShip: 0, toDeliver: 0});
  expect(first.lowStock).toContainEqual({id: 'sold-out', name: expect.any(String), stock: 0});

  const [order] = t.prisma.order.rows;
  await as('patch', `/orders/${order.id}/status`).send({status: 'cancelled'}).expect(200);
  expect((await as('get', '/shop-summary').expect(200)).body).toMatchObject({ordersToday: 0, salesToday: 0, sales30Days: 0, toConfirm: 0});
});

test('each order shows its customer, and can be searched by order number, mobile or patient id', async () => {
  const {t, buyer, as} = await withOrder();
  const [order] = (await as('get', '/orders').expect(200)).body.items;
  expect(order.customer).toMatchObject({id: buyer.user.id, mobile: '9123456780', patientCode: expect.stringMatching(/^P\d{6}$/)});
  for (const q of [order.orderNumber, '912345', order.customer.patientCode]) {
    expect((await as('get', `/orders?q=${q}`).expect(200)).body.total).toBe(1);
  }
  expect((await as('get', '/orders?q=nothing').expect(200)).body.total).toBe(0);
  expect((await as('get', `/orders?q=912345&status=shipped`).expect(200)).body.total).toBe(0);
  const mine = await request(t.app).get(`${API}/orders`).set(t.bearer(buyer)).expect(200);
  expect(mine.body.items[0].customer).toBeUndefined();
});

test('a tracking id is given only after confirming, is unique, and the customer sees it', async () => {
  const {t, buyer, as} = await withOrder();
  const [order] = t.prisma.order.rows;
  const track = body => as('patch', `/orders/${order.id}/tracking`).send(body);
  await request(t.app).patch(`${API}/admin/orders/${order.id}/tracking`).set(t.bearer(buyer)).send({trackingId: 'DL12345'}).expect(403);
  await track({trackingId: 'DL12345'}).expect(409); // still only placed
  await as('patch', `/orders/${order.id}/status`).send({status: 'confirmed'}).expect(200);
  await track({trackingId: 'a b'}).expect(400);
  const saved = await track({trackingId: 'DL12345', courier: 'Delhivery'}).expect(200);
  expect(saved.body).toMatchObject({trackingId: 'DL12345', courier: 'Delhivery', customer: {id: buyer.user.id}});
  await t.prisma.order.create({data: {orderNumber: 'AH-OTHER', userId: null, subtotal: 1, total: 1, status: 'confirmed', shippingAddress: {}}});
  const other = t.prisma.order.rows.find(o => o.orderNumber === 'AH-OTHER');
  await as('patch', `/orders/${other.id}/tracking`).send({trackingId: 'DL12345'}).expect(409);
  const mine = await request(t.app).get(`${API}/orders`).set(t.bearer(buyer)).expect(200);
  expect(mine.body.items[0]).toMatchObject({trackingId: 'DL12345', courier: 'Delhivery'});
});

test('admins see carts that were not ordered; ordering empties them', async () => {
  const {t, buyer, as} = await withOrder();
  await request(t.app).get(`${API}/admin/carts`).set(t.bearer(buyer)).expect(403);
  expect((await as('get', '/carts').expect(200)).body.total).toBe(0);

  await request(t.app).put(`${API}/cart/items/t-care`).set(t.bearer(buyer)).send({quantity: 3}).expect(200);
  const {body} = await as('get', '/carts').expect(200);
  expect(body.total).toBe(1);
  expect(body.items[0]).toMatchObject({total: 2697, customer: {id: buyer.user.id, mobile: '9123456780'}, items: [{productId: 't-care', quantity: 3, available: true}]});

  const [address] = t.prisma.address.rows;
  await request(t.app).post(`${API}/orders`).set(t.bearer(buyer)).send({addressId: address.id, paymentMethod: 'cod'}).expect(201);
  expect((await as('get', '/carts').expect(200)).body.total).toBe(0);
});
