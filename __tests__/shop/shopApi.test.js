import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';
import { ApiError } from '../../src/services/http';
import {
  endSession,
  setSessionExpiredHandler,
  startSession,
} from '../../src/services/session';
import {
  cancelOrder,
  createAddress,
  fetchAllProducts,
  fetchCart,
  listOrders,
  mergeCart,
  placeOrder,
  putCartItem,
  validateCoupon,
} from '../../src/services/shopApi';
import { bannerImageSource } from '../../src/data/bannerImages';
import { mockServer } from '../../test-utils/mockServer';

beforeEach(async () => {
  await AsyncStorage.clear();
  Keychain.__store.clear();
  setSessionExpiredHandler(null);
  await endSession();
});

describe('products', () => {
  test('reads every page until the total is reached', async () => {
    const page = n => Array.from({ length: n }, (_, i) => ({ id: `p${i}` }));
    const calls = mockServer({
      'GET /products': (body, headers, { query }) =>
        query.page === '1'
          ? [200, { items: page(50), page: 1, pageSize: 50, total: 60 }]
          : [200, { items: page(10), page: 2, pageSize: 50, total: 60 }],
    });
    const all = await fetchAllProducts();
    expect(all).toHaveLength(60);
    expect(calls.map(c => c.key)).toEqual([
      'GET /products?page=1&pageSize=50',
      'GET /products?page=2&pageSize=50',
    ]);
  });

  test('an empty shop is an empty list, and a failing server throws a typed error', async () => {
    mockServer({
      'GET /products': () => [
        200,
        { items: [], page: 1, pageSize: 50, total: 0 },
      ],
    });
    expect(await fetchAllProducts()).toEqual([]);
    mockServer({
      'GET /products': () => [
        500,
        { statusCode: 500, message: 'secret detail' },
      ],
    });
    await expect(fetchAllProducts()).rejects.toMatchObject({
      kind: 'server',
      message: expect.not.stringContaining('secret'),
    });
    mockServer({});
    await expect(fetchAllProducts()).rejects.toBeInstanceOf(ApiError);
  });
});

describe('coupons', () => {
  test("sends the code and the subtotal and returns the server's discount", async () => {
    const calls = mockServer({
      'POST /coupons/validate': body => [
        200,
        { code: body.code, discount: 90, total: body.subtotal - 90 },
      ],
    });
    expect(await validateCoupon('ATIYA10', 899)).toMatchObject({
      discount: 90,
      total: 809,
    });
    expect(calls[0].body).toEqual({ code: 'ATIYA10', subtotal: 899 });
  });

  test("an invalid code is a validation error carrying the server's message", async () => {
    mockServer({
      'POST /coupons/validate': () => [
        400,
        { statusCode: 400, message: 'This coupon code is not valid.' },
      ],
    });
    await expect(validateCoupon('NOPE', 100)).rejects.toMatchObject({
      kind: 'validation',
      message: 'This coupon code is not valid.',
    });
  });
});

describe('the calls that need a login', () => {
  test('refuse to run without one, and send the bearer token with one', async () => {
    const calls = mockServer({
      'GET /cart': () => [200, { items: [] }],
      'PUT /cart/items/:productId': () => [200, { items: [] }],
      'POST /cart/merge': () => [200, { items: [] }],
    });
    await expect(fetchCart()).rejects.toMatchObject({ kind: 'unauthorized' });
    expect(calls).toHaveLength(0);

    await startSession({ accessToken: 'a1', refreshToken: 'r1' });
    await fetchCart();
    await putCartItem('t-care', 2);
    await mergeCart([{ productId: 't-care', quantity: 1 }]);
    expect(calls.map(c => [c.key, c.auth])).toEqual([
      ['GET /cart', 'Bearer a1'],
      ['PUT /cart/items/t-care', 'Bearer a1'],
      ['POST /cart/merge', 'Bearer a1'],
    ]);
    expect(calls[1].body).toEqual({ quantity: 2 });
    expect(calls[2].body).toEqual({
      items: [{ productId: 't-care', quantity: 1 }],
    });
  });

  test('an order always says cash on delivery, and a coupon only when there is one', async () => {
    await startSession({ accessToken: 'a1', refreshToken: 'r1' });
    const calls = mockServer({
      'POST /orders': () => [201, { id: 'o1' }],
      'GET /orders': () => [
        200,
        { items: [], page: 1, pageSize: 20, total: 0 },
      ],
      'POST /orders/:id/cancel': () => [200, { id: 'o1', status: 'cancelled' }],
      'POST /addresses': () => [201, { id: 'a1' }],
    });
    await placeOrder({ addressId: 'addr-1' });
    await placeOrder({ addressId: 'addr-1', couponCode: 'ATIYA10' });
    expect(calls[0].body).toEqual({
      addressId: 'addr-1',
      paymentMethod: 'cod',
    });
    expect(calls[1].body).toEqual({
      addressId: 'addr-1',
      paymentMethod: 'cod',
      couponCode: 'ATIYA10',
    });
    await listOrders();
    await cancelOrder('o1');
    await createAddress({ name: 'A' });
    expect(calls.map(c => c.key)).toEqual([
      'POST /orders',
      'POST /orders',
      'GET /orders?page=1&pageSize=20',
      'POST /orders/o1/cancel',
      'POST /addresses',
    ]);
  });
});

describe('banner pictures', () => {
  test('a key names a picture bundled in the app, a https address is used as it is, anything else is no picture', () => {
    expect(bannerImageSource('banner_shilajit')).toBeTruthy();
    expect(bannerImageSource('https://img.test/x.jpg')).toEqual({
      uri: 'https://img.test/x.jpg',
    });
    expect(bannerImageSource('http://insecure.test/x.jpg')).toBeNull();
    expect(bannerImageSource('no_such_key')).toBeNull();
    expect(bannerImageSource(null)).toBeNull();
  });
});
