const request = require('supertest');
const {buildTestApp} = require('./helpers/testApp');
const {loadShop, ADDRESS} = require('./helpers/shop');

const API = '/api/v1';

// A shop with one logged-in customer
async function setup() {
  const t = buildTestApp();
  await loadShop(t.prisma);
  const me = await t.login('9876543210');
  const call = (method, path, body, session = me) => {
    const req = request(t.app)[method](`${API}${path}`).set(t.bearer(session));
    return body === undefined ? req : req.send(body);
  };
  const setProduct = (id, changes) => Object.assign(t.prisma.product.rows.find(p => p.id === id), changes);
  return {...t, me, call, setProduct};
}

describe('the server-side cart', () => {
  test('needs a login, and an empty cart is empty', async () => {
    const t = await setup();
    await request(t.app).get(`${API}/cart`).expect(401);
    await request(t.app).put(`${API}/cart/items/t-care`).send({quantity: 1}).expect(401);
    const res = await t.call('get', '/cart').expect(200);
    expect(res.body).toEqual({items: [], itemCount: 0, subtotal: 0, savings: 0, hasIssues: false});
  });

  test('adding sets an exact quantity and prices come from the product, with line totals and savings', async () => {
    const t = await setup();
    await t.call('put', '/cart/items/t-care', {quantity: 2}).expect(200);
    const res = await t.call('put', '/cart/items/cumin-vinegar', {quantity: 1}).expect(200);
    expect(res.body.items).toEqual([
      expect.objectContaining({productId: 't-care', name: 'T Care Capsules', price: 899, mrp: 1099, quantity: 2, lineTotal: 1798, lineSavings: 400, issue: null, image: 'https://example.com/t-care.jpg'}),
      expect.objectContaining({productId: 'cumin-vinegar', quantity: 1, lineTotal: 250, lineSavings: 50}),
    ]);
    expect(res.body).toMatchObject({itemCount: 3, subtotal: 2048, savings: 450, hasIssues: false});
    // setting again replaces the quantity, it does not add to it
    const again = await t.call('put', '/cart/items/t-care', {quantity: 5}).expect(200);
    expect(again.body.items[0].quantity).toBe(5);
    expect(t.prisma.cartItem.rows).toHaveLength(2);
  });

  test('quantity 0 removes the line; DELETE removes one line or the whole cart', async () => {
    const t = await setup();
    await t.call('put', '/cart/items/t-care', {quantity: 2});
    await t.call('put', '/cart/items/cumin-vinegar', {quantity: 1});
    expect((await t.call('put', '/cart/items/t-care', {quantity: 0}).expect(200)).body.items.map(i => i.productId)).toEqual(['cumin-vinegar']);
    await t.call('put', '/cart/items/t-care', {quantity: 1});
    expect((await t.call('delete', '/cart/items/t-care').expect(200)).body.items).toHaveLength(1);
    expect((await t.call('delete', '/cart').expect(200)).body.items).toEqual([]);
    expect(t.prisma.cartItem.rows).toHaveLength(0);
  });

  test('refuses a bad quantity, unknown fields, an unknown or switched-off product and a sold-out one', async () => {
    const t = await setup();
    await t.call('put', '/cart/items/t-care', {quantity: -1}).expect(400);
    await t.call('put', '/cart/items/t-care', {quantity: 11}).expect(400);
    await t.call('put', '/cart/items/t-care', {quantity: 1.5}).expect(400);
    await t.call('put', '/cart/items/t-care', {quantity: 1, price: 1}).expect(400);
    await t.call('put', '/cart/items/Not A Slug', {quantity: 1}).expect(400);
    await t.call('put', '/cart/items/nothing-here', {quantity: 1}).expect(404);
    await t.call('put', '/cart/items/sold-out', {quantity: 1}).expect(409);
    t.setProduct('t-care', {active: false});
    await t.call('put', '/cart/items/t-care', {quantity: 1}).expect(404);
    expect(t.prisma.cartItem.rows).toHaveLength(0);
  });

  test('a quantity above the stock is cut down to the stock', async () => {
    const t = await setup();
    t.setProduct('t-care', {stock: 3});
    const res = await t.call('put', '/cart/items/t-care', {quantity: 8}).expect(200);
    expect(res.body.items[0]).toMatchObject({quantity: 3, lineTotal: 2697});
  });

  test('when stock falls later, the line says so and the totals leave out what cannot be ordered', async () => {
    const t = await setup();
    await t.call('put', '/cart/items/t-care', {quantity: 5});
    await t.call('put', '/cart/items/cumin-vinegar', {quantity: 2});
    t.setProduct('t-care', {stock: 2});
    t.setProduct('cumin-vinegar', {stock: 0});
    const res = await t.call('get', '/cart').expect(200);
    expect(res.body.items[0]).toMatchObject({productId: 't-care', quantity: 2, requested: 5, issue: 'limited'});
    expect(res.body.items[1]).toMatchObject({productId: 'cumin-vinegar', quantity: 0, issue: 'out-of-stock', lineTotal: 0});
    expect(res.body).toMatchObject({itemCount: 2, subtotal: 1798, hasIssues: true});
    t.setProduct('t-care', {active: false});
    const gone = await t.call('get', '/cart').expect(200);
    expect(gone.body.items[0]).toMatchObject({issue: 'unavailable', quantity: 0});
    expect(gone.body.subtotal).toBe(0);
    // reading a cart never changes it
    expect(t.prisma.cartItem.rows.find(r => r.productId === 't-care').quantity).toBe(5);
  });

  test('carts are private: another person sees nothing of mine', async () => {
    const t = await setup();
    await t.call('put', '/cart/items/t-care', {quantity: 2});
    const other = await t.login('9123456780');
    expect((await t.call('get', '/cart', undefined, other).expect(200)).body.items).toEqual([]);
    await t.call('delete', '/cart', undefined, other).expect(200);
    expect((await t.call('get', '/cart').expect(200)).body.items).toHaveLength(1);
  });
});

describe('merging a guest cart after login', () => {
  test('adds quantities to what is already there, adds up repeats, and caps them', async () => {
    const t = await setup();
    await t.call('put', '/cart/items/t-care', {quantity: 3});
    const res = await t
      .call('post', '/cart/merge', {items: [{productId: 't-care', quantity: 4}, {productId: 'cumin-vinegar', quantity: 6}, {productId: 'cumin-vinegar', quantity: 6}]})
      .expect(200);
    expect(res.body.items.map(i => [i.productId, i.quantity])).toEqual([
      ['t-care', 7],
      ['cumin-vinegar', 10],
    ]);
  });

  test('skips unknown, switched-off and sold-out products, and cuts to the stock', async () => {
    const t = await setup();
    t.setProduct('cumin-vinegar', {active: false});
    t.setProduct('t-care', {stock: 2});
    const res = await t
      .call('post', '/cart/merge', {items: [{productId: 't-care', quantity: 5}, {productId: 'cumin-vinegar', quantity: 1}, {productId: 'sold-out', quantity: 1}, {productId: 'never-existed', quantity: 1}]})
      .expect(200);
    expect(res.body.items.map(i => [i.productId, i.quantity])).toEqual([['t-care', 2]]);
  });

  test('is strict about what it accepts', async () => {
    const t = await setup();
    await t.call('post', '/cart/merge', {}).expect(400);
    await t.call('post', '/cart/merge', {items: [{productId: 't-care', quantity: 0}]}).expect(400);
    await t.call('post', '/cart/merge', {items: [{productId: 't-care', quantity: 1, price: 1}]}).expect(400);
    await t.call('post', '/cart/merge', {items: Array.from({length: 31}, (_, i) => ({productId: `p-${i}`, quantity: 1}))}).expect(400);
    await t.call('post', '/cart/merge', {items: []}).expect(200);
  });
});

describe('ordering from the cart', () => {
  const placeFromCart = async t => {
    const address = (await t.call('post', '/addresses', ADDRESS)).body;
    return t.call('post', '/orders', {addressId: address.id, paymentMethod: 'cod'});
  };

  test('makes the order from the server cart, takes the stock and empties the cart', async () => {
    const t = await setup();
    await t.call('put', '/cart/items/t-care', {quantity: 2});
    await t.call('put', '/cart/items/cumin-vinegar', {quantity: 1});
    const res = await placeFromCart(t).then(r => {
      expect(r.status).toBe(201);
      return r;
    });
    expect(res.body).toMatchObject({status: 'placed', subtotal: 2048, total: 2048});
    expect(res.body.items.map(i => [i.productId, i.qty])).toEqual([
      ['t-care', 2],
      ['cumin-vinegar', 1],
    ]);
    expect(t.prisma.product.rows.find(p => p.id === 't-care').stock).toBe(98);
    expect(t.prisma.cartItem.rows).toHaveLength(0);
    expect((await t.call('get', '/cart')).body.items).toEqual([]);
  });

  test('an empty cart cannot be ordered', async () => {
    const t = await setup();
    const res = await placeFromCart(t);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/cart is empty/i);
    expect(t.prisma.order.rows).toHaveLength(0);
  });

  test('when something in the cart cannot be had, nothing is ordered and the cart stays', async () => {
    const t = await setup();
    await t.call('put', '/cart/items/t-care', {quantity: 2});
    await t.call('put', '/cart/items/cumin-vinegar', {quantity: 1});
    t.setProduct('cumin-vinegar', {stock: 0});
    const res = await placeFromCart(t);
    expect(res.status).toBe(409);
    expect(t.prisma.order.rows).toHaveLength(0);
    expect(t.prisma.product.rows.find(p => p.id === 't-care').stock).toBe(100);
    expect(t.prisma.cartItem.rows).toHaveLength(2);
  });

  test('the items-based order still works and leaves the cart alone', async () => {
    const t = await setup();
    await t.call('put', '/cart/items/cumin-vinegar', {quantity: 1});
    const address = (await t.call('post', '/addresses', ADDRESS)).body;
    await t.call('post', '/orders', {addressId: address.id, paymentMethod: 'cod', items: [{productId: 't-care', qty: 1}]}).expect(201);
    expect(t.prisma.cartItem.rows).toHaveLength(1);
    await t.call('post', '/orders', {addressId: address.id, paymentMethod: 'cod', items: []}).expect(400);
  });

  test('a coupon works on a cart order too', async () => {
    const t = await setup();
    await t.call('put', '/cart/items/t-care', {quantity: 1});
    const address = (await t.call('post', '/addresses', ADDRESS)).body;
    const res = await t.call('post', '/orders', {addressId: address.id, paymentMethod: 'cod', couponCode: 'ATIYA10'}).expect(201);
    expect(res.body).toMatchObject({subtotal: 899, discount: 90, total: 809});
  });

  test('deleting the account removes the cart', async () => {
    const t = await setup();
    await t.call('put', '/cart/items/t-care', {quantity: 1});
    await t.call('delete', '/users/me').expect(204);
    expect(t.prisma.cartItem.rows).toHaveLength(0);
  });
});
