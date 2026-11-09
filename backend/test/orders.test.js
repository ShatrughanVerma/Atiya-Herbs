const request = require('supertest');
const {buildTestApp} = require('./helpers/testApp');
const {loadShop, ADDRESS} = require('./helpers/shop');

const API = '/api/v1';

// A shop with one logged-in customer who has one saved address
async function setup() {
  const t = buildTestApp();
  await loadShop(t.prisma);
  const me = await t.login('9876543210');
  const address = (await request(t.app).post(`${API}/addresses`).set(t.bearer(me)).send(ADDRESS)).body;
  const place = (body, session = me) => request(t.app).post(`${API}/orders`).set(t.bearer(session)).send({addressId: address.id, paymentMethod: 'cod', ...body});
  const stockOf = id => t.prisma.product.rows.find(p => p.id === id).stock;
  return {...t, me, address, place, stockOf};
}

describe('placing an order', () => {
  test('works out prices and the total on the server, takes stock, and copies the address', async () => {
    const t = await setup();
    const res = await t.place({items: [{productId: 't-care', qty: 2}, {productId: 'cumin-vinegar', qty: 1}]}).expect(201);
    expect(res.body).toMatchObject({status: 'placed', paymentMethod: 'cod', subtotal: 2 * 899 + 250, discount: 0, shippingFee: 0, total: 2 * 899 + 250, couponCode: null});
    expect(res.body.orderNumber).toMatch(/^AH-[0-9A-Z]+-[0-9A-F]{6}$/);
    expect(res.body.items).toEqual([
      {productId: 't-care', name: 'T Care Capsules', image: 'https://example.com/t-care.jpg', price: 899, qty: 2},
      {productId: 'cumin-vinegar', name: 'Cumin Vinegar', image: 'https://example.com/cumin.jpg', price: 250, qty: 1},
    ]);
    expect(res.body.shippingAddress).toMatchObject({name: 'Asha Khan', city: 'Lucknow'});
    expect(t.stockOf('t-care')).toBe(98);
    expect(t.stockOf('cumin-vinegar')).toBe(99);
    expect(t.prisma.auditLog.rows.some(r => r.action === 'order.placed')).toBe(true);
  });

  test('a price, total or discount sent by the client is refused, never trusted', async () => {
    const t = await setup();
    await t.place({items: [{productId: 't-care', qty: 1, price: 1}]}).expect(400);
    await t.place({items: [{productId: 't-care', qty: 1}], total: 1}).expect(400);
    await t.place({items: [{productId: 't-care', qty: 1}], discount: 500}).expect(400);
    await t.place({items: [{productId: 't-care', qty: 1}], paymentMethod: 'card'}).expect(400);
    expect(t.prisma.order.rows).toHaveLength(0);
    expect(t.stockOf('t-care')).toBe(100);
  });

  test('a coupon is checked and worked out on the server', async () => {
    const t = await setup();
    const res = await t.place({items: [{productId: 't-care', qty: 1}], couponCode: 'atiya10'}).expect(201);
    expect(res.body).toMatchObject({subtotal: 899, discount: 90, total: 809, couponCode: 'ATIYA10'});
    await t.place({items: [{productId: 't-care', qty: 1}], couponCode: 'FAKE50'}).expect(400);
    expect(t.stockOf('t-care')).toBe(99); // the refused order took nothing
  });

  test('the same product twice becomes one line', async () => {
    const t = await setup();
    const res = await t.place({items: [{productId: 't-care', qty: 1}, {productId: 't-care', qty: 2}]}).expect(201);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].qty).toBe(3);
    expect(t.stockOf('t-care')).toBe(97);
  });

  test('not enough stock, a sold-out or a missing product: nothing is taken from any product', async () => {
    const t = await setup();
    await t.prisma.product.update({where: {id: 'cumin-vinegar'}, data: {stock: 1}});
    const short = await t.place({items: [{productId: 't-care', qty: 5}, {productId: 'cumin-vinegar', qty: 2}]}).expect(409);
    expect(short.body.message).toMatch(/Cumin Vinegar/);
    expect(t.stockOf('t-care')).toBe(100); // rolled back
    expect(t.stockOf('cumin-vinegar')).toBe(1);
    await t.place({items: [{productId: 'sold-out', qty: 1}]}).expect(409);
    await t.place({items: [{productId: 'nope', qty: 1}]}).expect(400);
    await t.prisma.product.update({where: {id: 't-care'}, data: {active: false}});
    await t.place({items: [{productId: 't-care', qty: 1}]}).expect(400);
    expect(t.prisma.order.rows).toHaveLength(0);
  });

  test('the last item cannot be bought twice', async () => {
    const t = await setup();
    await t.prisma.product.update({where: {id: 't-care'}, data: {stock: 1}});
    const results = await Promise.all([t.place({items: [{productId: 't-care', qty: 1}]}), t.place({items: [{productId: 't-care', qty: 1}]})]);
    expect(results.map(r => r.status).sort()).toEqual([201, 409]);
    expect(t.stockOf('t-care')).toBe(0);
  });

  test('refuses bad quantities, empty carts and someone else\'s address', async () => {
    const t = await setup();
    for (const items of [[], [{productId: 't-care', qty: 0}], [{productId: 't-care', qty: 21}], [{productId: 't-care', qty: 1.5}], [{productId: 't-care', qty: '2'}]]) {
      await t.place({items}).expect(400);
    }
    const bilal = await t.login('9123456780');
    await t.place({items: [{productId: 't-care', qty: 1}]}, bilal).expect(404); // Asha's address id
    await request(t.app).post(`${API}/orders`).send({}).expect(401);
    expect(t.stockOf('t-care')).toBe(100);
  });
});

describe('looking at and cancelling orders', () => {
  test('a person sees only their own orders', async () => {
    const t = await setup();
    const mine = (await t.place({items: [{productId: 't-care', qty: 1}]})).body;
    const bilal = await t.login('9123456780');
    expect((await request(t.app).get(`${API}/orders`).set(t.bearer(bilal))).body).toMatchObject({items: [], total: 0});
    await request(t.app).get(`${API}/orders/${mine.id}`).set(t.bearer(bilal)).expect(404);
    await request(t.app).post(`${API}/orders/${mine.id}/cancel`).set(t.bearer(bilal)).expect(404);
    const list = await request(t.app).get(`${API}/orders`).set(t.bearer(t.me)).expect(200);
    expect(list.body.total).toBe(1);
    expect(list.body.items[0].items[0].name).toBe('T Care Capsules');
    expect((await request(t.app).get(`${API}/orders/${mine.id}`).set(t.bearer(t.me)).expect(200)).body.id).toBe(mine.id);
  });

  test('cancelling puts the stock back, and only works once', async () => {
    const t = await setup();
    const order = (await t.place({items: [{productId: 't-care', qty: 4}]})).body;
    expect(t.stockOf('t-care')).toBe(96);
    const res = await request(t.app).post(`${API}/orders/${order.id}/cancel`).set(t.bearer(t.me)).expect(200);
    expect(res.body.status).toBe('cancelled');
    expect(res.body.cancelledAt).toBeTruthy();
    expect(t.stockOf('t-care')).toBe(100);
    await request(t.app).post(`${API}/orders/${order.id}/cancel`).set(t.bearer(t.me)).expect(409);
    expect(t.stockOf('t-care')).toBe(100); // not restored twice
  });

  test('a shipped order cannot be cancelled by the customer', async () => {
    const t = await setup();
    const order = (await t.place({items: [{productId: 't-care', qty: 1}]})).body;
    await t.prisma.order.update({where: {id: order.id}, data: {status: 'shipped'}});
    await request(t.app).post(`${API}/orders/${order.id}/cancel`).set(t.bearer(t.me)).expect(409);
    expect(t.stockOf('t-care')).toBe(99);
  });

  test('an old order keeps its prices and address after the catalog or address book changes', async () => {
    const t = await setup();
    const order = (await t.place({items: [{productId: 't-care', qty: 1}]})).body;
    await t.prisma.product.update({where: {id: 't-care'}, data: {price: 999, name: 'Renamed'}});
    await request(t.app).patch(`${API}/addresses/${t.address.id}`).set(t.bearer(t.me)).send({city: 'Delhi'}).expect(200);
    const again = (await request(t.app).get(`${API}/orders/${order.id}`).set(t.bearer(t.me))).body;
    expect(again.items[0]).toMatchObject({name: 'T Care Capsules', price: 899});
    expect(again.shippingAddress.city).toBe('Lucknow');
    expect(again.total).toBe(899);
  });

  test('orders are paged, newest first', async () => {
    const t = await setup();
    for (let i = 0; i < 3; i++) {
      await t.place({items: [{productId: 'cumin-vinegar', qty: 1}]}).expect(201);
    }
    const page = await request(t.app).get(`${API}/orders?pageSize=2`).set(t.bearer(t.me)).expect(200);
    expect(page.body).toMatchObject({page: 1, pageSize: 2, total: 3});
    expect(page.body.items).toHaveLength(2);
    expect((await request(t.app).get(`${API}/orders?pageSize=2&page=2`).set(t.bearer(t.me))).body.items).toHaveLength(1);
  });
});

describe('admin orders', () => {
  test('only an admin can see all orders or change a status', async () => {
    const t = await setup();
    const order = (await t.place({items: [{productId: 't-care', qty: 1}]})).body;
    await request(t.app).get(`${API}/admin/orders`).expect(401);
    await request(t.app).get(`${API}/admin/orders`).set(t.bearer(t.me)).expect(403);
    await request(t.app).patch(`${API}/admin/orders/${order.id}/status`).set(t.bearer(t.me)).send({status: 'delivered'}).expect(403);
    expect(t.prisma.order.rows[0].status).toBe('placed');
  });

  test('moves an order along placed, confirmed, shipped, delivered, and no other way', async () => {
    const t = await setup();
    const order = (await t.place({items: [{productId: 't-care', qty: 1}]})).body;
    const admin = await t.loginAs('admin', '9000000001');
    const set = status => request(t.app).patch(`${API}/admin/orders/${order.id}/status`).set(t.bearer(admin)).send({status});
    await set('shipped').expect(409); // cannot skip a step
    await set('placed').expect(409);
    expect((await set('confirmed').expect(200)).body.status).toBe('confirmed');
    expect((await set('shipped').expect(200)).body.status).toBe('shipped');
    await set('cancelled').expect(409); // too late to cancel
    expect((await set('delivered').expect(200)).body.status).toBe('delivered');
    await set('confirmed').expect(409);
    await set('teleported').expect(400);
    const all = await request(t.app).get(`${API}/admin/orders?status=delivered`).set(t.bearer(admin)).expect(200);
    expect(all.body.total).toBe(1);
    expect((await request(t.app).get(`${API}/admin/orders?status=placed`).set(t.bearer(admin))).body.total).toBe(0);
  });

  test('an admin cancelling an order puts the stock back', async () => {
    const t = await setup();
    const order = (await t.place({items: [{productId: 't-care', qty: 3}]})).body;
    const admin = await t.loginAs('admin', '9000000001');
    await request(t.app).patch(`${API}/admin/orders/${order.id}/status`).set(t.bearer(admin)).send({status: 'cancelled'}).expect(200);
    expect(t.stockOf('t-care')).toBe(100);
    expect(t.prisma.auditLog.rows.some(r => r.action === 'order.status.changed')).toBe(true);
  });
});
