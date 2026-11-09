import React from 'react';
import { Alert } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';
import { AuthProvider, useAuth } from '../../src/context/AuthContext';
import { CartProvider, useCart } from '../../src/context/CartContext';
import { CatalogProvider } from '../../src/context/CatalogContext';
import {
  endSession,
  setSessionExpiredHandler,
  startSession,
} from '../../src/services/session';
import { saveTokens } from '../../src/services/tokenStore';
import { mockServer } from '../../test-utils/mockServer';
import { ADDRESS, shopServer } from '../../test-utils/shopServer';

jest.mock('../../src/utils/googleAuth', () => ({
  signOutFromGoogle: jest.fn(async () => {}),
}));

const { act } = ReactTestRenderer;
const ME = {
  id: 'u1',
  mobile: '9876543210',
  name: 'Asha Khan',
  email: 'asha@b.co',
  role: 'customer',
};
const PROFILE = {
  name: 'Asha Khan',
  email: 'asha@b.co',
  mobile: '9876543210',
  provider: 'password',
  role: 'customer',
};

let tree;
const ref = {};
function Capture() {
  ref.cart = useCart();
  ref.auth = useAuth();
  return null;
}
const flush = async () => {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });
  }
};

// loggedIn: the phone already holds a saved login (like reopening the app)
const mount = async ({
  loggedIn = false,
  shop = shopServer(),
  extra = {},
} = {}) => {
  const calls = mockServer({
    ...shop.routes,
    'GET /users/me': () => [200, ME],
    ...extra,
  });
  if (loggedIn) {
    await saveTokens({ accessToken: 'a1', refreshToken: 'r1' });
    await AsyncStorage.setItem('atiya.session.v1', JSON.stringify(PROFILE));
  }
  await act(async () => {
    tree = ReactTestRenderer.create(
      <AuthProvider>
        <CatalogProvider>
          <CartProvider>
            <Capture />
          </CartProvider>
        </CatalogProvider>
      </AuthProvider>,
    );
  });
  await flush();
  return { calls, shop };
};

beforeEach(async () => {
  await AsyncStorage.clear();
  Keychain.__store.clear();
  setSessionExpiredHandler(null);
  await endSession();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(async () => {
  await act(async () => {
    tree?.unmount();
  });
  tree = null;
  jest.restoreAllMocks();
});

describe('a guest cart (not logged in)', () => {
  test('prices come from the server catalog and totals add up', async () => {
    await mount();
    await act(async () => ref.cart.addToCart('t-care'));
    await act(async () => ref.cart.addToCart('t-care'));
    await act(async () => ref.cart.addToCart('pain-oil'));
    expect(ref.cart.loggedIn).toBe(false);
    expect(ref.cart.count).toBe(3);
    expect(ref.cart.subtotal).toBe(899 * 2 + 349);
    expect(ref.cart.mrpTotal).toBe(1099 * 2 + 399);
    expect(ref.cart.total).toBe(899 * 2 + 349);
  });

  test('quantity 0 removes the item', async () => {
    await mount();
    await act(async () => ref.cart.addToCart('t-care'));
    await act(async () => ref.cart.setQty('t-care', 0));
    expect(ref.cart.lines).toHaveLength(0);
    expect(ref.cart.count).toBe(0);
  });

  test('without the server there are no prices at all: the cart shows nothing instead of invented lines', async () => {
    await mount({ shop: { routes: {} } }); // every request fails
    await act(async () => ref.cart.addToCart('t-care'));
    expect(ref.cart.lines).toEqual([]);
    expect(ref.cart.subtotal).toBe(0);
  });

  test('a coupon is checked by the server; an unknown code is refused with its message', async () => {
    await mount();
    await act(async () => ref.cart.addToCart('t-care'));
    let result;
    await act(async () => {
      result = await ref.cart.applyCoupon('nope');
    });
    expect(result).toEqual({
      ok: false,
      message: 'This coupon code is not valid.',
    });
    expect(ref.cart.couponDiscount).toBe(0);
    await act(async () => {
      result = await ref.cart.applyCoupon(' atiya10 ');
    });
    expect(result.ok).toBe(true);
    expect(ref.cart.couponDiscount).toBe(90);
    expect(ref.cart.total).toBe(899 - 90);
    await act(async () => ref.cart.removeCoupon());
    expect(ref.cart.total).toBe(899);
  });

  test('a coupon needs something in the cart, and is asked again when the total changes', async () => {
    const { calls } = await mount();
    let result;
    await act(async () => {
      result = await ref.cart.applyCoupon('ATIYA10');
    });
    expect(result.ok).toBe(false);
    expect(calls.some(c => c.key === 'POST /coupons/validate')).toBe(false);
    await act(async () => ref.cart.addToCart('t-care'));
    await act(async () => {
      await ref.cart.applyCoupon('ATIYA10');
    });
    await act(async () => ref.cart.addToCart('t-care'));
    await flush();
    expect(ref.cart.couponDiscount).toBe(180); // 10% of 1798, worked out by the server
  });

  test('the wishlist toggles on and off', async () => {
    await mount();
    await act(async () => ref.cart.toggleWishlist('t-care'));
    expect(ref.cart.isWishlisted('t-care')).toBe(true);
    await act(async () => ref.cart.toggleWishlist('t-care'));
    expect(ref.cart.isWishlisted('t-care')).toBe(false);
  });
});

describe('the cart of a logged-in person lives on the server', () => {
  test("it is loaded at start, with the server's prices", async () => {
    const shop = shopServer();
    shop.state.cart.push({ productId: 't-care', quantity: 2 });
    await mount({ loggedIn: true, shop });
    expect(ref.cart.loggedIn).toBe(true);
    expect(ref.cart.lines).toHaveLength(1);
    expect(ref.cart.lines[0]).toMatchObject({
      productId: 't-care',
      qty: 2,
      issue: null,
    });
    expect(ref.cart.lines[0].product.price).toBe(899);
    expect(ref.cart.subtotal).toBe(1798);
    expect(ref.cart.count).toBe(2);
  });

  test("a change shows at once and then the server's answer replaces it", async () => {
    const shop = shopServer();
    shop.state.cart.push({ productId: 't-care', quantity: 1 });
    const { calls } = await mount({ loggedIn: true, shop });
    act(() => {
      ref.cart.setQty('t-care', 3); // not awaited: look at the screen before the server answers
    });
    expect(ref.cart.count).toBe(3); // before the server has answered
    await flush();
    expect(calls.find(c => c.key === 'PUT /cart/items/t-care').body).toEqual({
      quantity: 3,
    });
    expect(shop.state.cart).toEqual([{ productId: 't-care', quantity: 3 }]);
    expect(ref.cart.subtotal).toBe(899 * 3);
    // adding a product the cart does not hold yet
    await act(async () => ref.cart.addToCart('pain-oil'));
    await flush();
    expect(shop.state.cart.map(r => r.productId)).toEqual([
      't-care',
      'pain-oil',
    ]);
    // and removing it
    await act(async () => ref.cart.setQty('pain-oil', 0));
    await flush();
    expect(calls.some(c => c.key === 'DELETE /cart/items/pain-oil')).toBe(true);
    expect(ref.cart.lines.map(l => l.productId)).toEqual(['t-care']);
  });

  test('when the server refuses a change it is undone, and the person is told', async () => {
    const shop = shopServer();
    shop.state.cart.push({ productId: 't-care', quantity: 1 });
    await mount({ loggedIn: true, shop });
    shop.state.failNext = 'PUT /cart/items/:productId';
    act(() => {
      ref.cart.setQty('t-care', 5); // not awaited: look at the screen before the server answers
    });
    expect(ref.cart.count).toBe(5); // optimistic first
    await flush();
    expect(Alert.alert).toHaveBeenCalledWith('Cart', expect.any(String));
    expect(ref.cart.count).toBe(1); // back to what the server holds
    expect(shop.state.cart).toEqual([{ productId: 't-care', quantity: 1 }]);
  });

  test('an item that is out of stock is flagged and left out of the totals', async () => {
    const shop = shopServer({ stock: { 'pain-oil': 0 } });
    shop.state.cart.push(
      { productId: 't-care', quantity: 1 },
      { productId: 'pain-oil', quantity: 2 },
    );
    await mount({ loggedIn: true, shop });
    expect(ref.cart.hasBlocking).toBe(true);
    expect(ref.cart.lines.find(l => l.productId === 'pain-oil')).toMatchObject({
      issue: 'out-of-stock',
      qty: 2,
    });
    expect(ref.cart.count).toBe(1);
    expect(ref.cart.subtotal).toBe(899);
  });

  test('less stock than asked: the line says "limited" and counts only what is left', async () => {
    const shop = shopServer({ stock: { 't-care': 2 } });
    shop.state.cart.push({ productId: 't-care', quantity: 5 });
    await mount({ loggedIn: true, shop });
    expect(ref.cart.lines[0]).toMatchObject({
      issue: 'limited',
      qty: 2,
      available: 2,
    });
    expect(ref.cart.hasBlocking).toBe(false);
    expect(ref.cart.subtotal).toBe(1798);
  });

  test("logging in joins the guest's cart to the server cart, once", async () => {
    const shop = shopServer();
    shop.state.cart.push({ productId: 'cumin-vinegar', quantity: 1 }); // already on the server
    const { calls } = await mount({ shop });
    await act(async () => ref.cart.addToCart('t-care', 2));
    expect(ref.cart.loggedIn).toBe(false);

    await act(async () => {
      await startSession({ accessToken: 'a1', refreshToken: 'r1' });
      ref.auth.completeLogin(ME);
    });
    await flush();
    const merge = calls.filter(c => c.key === 'POST /cart/merge');
    expect(merge).toHaveLength(1);
    expect(merge[0].body).toEqual({
      items: [{ productId: 't-care', quantity: 2 }],
    });
    expect(ref.cart.loggedIn).toBe(true);
    expect(ref.cart.lines.map(l => [l.productId, l.qty])).toEqual([
      ['cumin-vinegar', 1],
      ['t-care', 2],
    ]);
  });

  test("logging out forgets the account's cart and orders on this phone", async () => {
    const shop = shopServer();
    shop.state.cart.push({ productId: 't-care', quantity: 1 });
    await mount({
      loggedIn: true,
      shop,
      extra: { 'POST /auth/logout': () => [204] },
    });
    expect(ref.cart.count).toBe(1);
    await act(async () => {
      await ref.auth.signOut();
    });
    await flush();
    expect(ref.cart.loggedIn).toBe(false);
    expect(ref.cart.lines).toEqual([]);
    expect(ref.cart.orders).toEqual([]);
  });
});

describe('ordering and orders', () => {
  test('placing an order uses the server cart, takes the coupon, empties the cart and lists the order', async () => {
    const shop = shopServer();
    shop.state.cart.push({ productId: 't-care', quantity: 1 });
    const { calls } = await mount({ loggedIn: true, shop });
    await act(async () => {
      await ref.cart.applyCoupon('ATIYA10');
    });
    let order;
    await act(async () => {
      order = await ref.cart.placeOrder({ addressId: ADDRESS.id });
    });
    expect(calls.find(c => c.key === 'POST /orders').body).toEqual({
      addressId: 'addr-1',
      paymentMethod: 'cod',
      couponCode: 'ATIYA10',
    });
    expect(order).toMatchObject({
      orderNumber: 'AH-TEST-1',
      total: 899 - 90,
      status: 'placed',
    });
    expect(ref.cart.lines).toEqual([]);
    expect(ref.cart.coupon).toBeNull();
    expect(ref.cart.orders[0].id).toBe(order.id);
    expect(ref.cart.ordersTotal).toBe(1);
  });

  test('an order the server refuses throws its message and keeps the cart', async () => {
    const shop = shopServer({ stock: { 't-care': 0 } });
    shop.state.cart.push({ productId: 't-care', quantity: 1 });
    await mount({ loggedIn: true, shop });
    let error;
    await act(async () => {
      try {
        await ref.cart.placeOrder({ addressId: ADDRESS.id });
      } catch (e) {
        error = e;
      }
    });
    expect(error.message).toMatch(/does not have enough stock/);
    expect(ref.cart.lines).toHaveLength(1);
    expect(ref.cart.orders).toEqual([]);
  });

  test('an order can be cancelled while it is placed', async () => {
    const shop = shopServer();
    shop.state.cart.push({ productId: 't-care', quantity: 1 });
    await mount({ loggedIn: true, shop });
    let order;
    await act(async () => {
      order = await ref.cart.placeOrder({ addressId: ADDRESS.id });
    });
    await act(async () => {
      await ref.cart.cancelOrder(order.id);
    });
    expect(ref.cart.orders[0].status).toBe('cancelled');
  });
});
