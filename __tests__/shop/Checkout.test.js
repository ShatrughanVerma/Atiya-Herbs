import React from 'react';
import { Alert } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from '../../src/context/AuthContext';
import { CartProvider } from '../../src/context/CartContext';
import { CatalogProvider } from '../../src/context/CatalogContext';
import CheckoutScreen from '../../src/screens/shop/CheckoutScreen';
import OrdersScreen from '../../src/screens/shop/OrdersScreen';
import {
  endSession,
  setSessionExpiredHandler,
} from '../../src/services/session';
import { saveTokens } from '../../src/services/tokenStore';
import { mockServer } from '../../test-utils/mockServer';
import { shopServer } from '../../test-utils/shopServer';

jest.mock('../../src/utils/googleAuth', () => ({
  signOutFromGoogle: jest.fn(async () => {}),
}));

const { act } = ReactTestRenderer;
const METRICS = {
  frame: { x: 0, y: 0, width: 360, height: 800 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};
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
const navigation = {
  navigate: jest.fn(),
  goBack: jest.fn(),
  reset: jest.fn(),
  canGoBack: () => true,
};

let tree;
const flush = async () => {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });
  }
};
const mount = async (Screen, { loggedIn = true, shop = shopServer() } = {}) => {
  const calls = mockServer({
    ...shop.routes,
    'GET /users/me': () => [200, ME],
  });
  if (loggedIn) {
    await saveTokens({ accessToken: 'a1', refreshToken: 'r1' });
    await AsyncStorage.setItem('atiya.session.v1', JSON.stringify(PROFILE));
  }
  await act(async () => {
    tree = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={METRICS}>
        <AuthProvider>
          <CatalogProvider>
            <CartProvider>
              <Screen navigation={navigation} route={{ params: {} }} />
            </CartProvider>
          </CatalogProvider>
        </AuthProvider>
      </SafeAreaProvider>,
    );
  });
  await flush();
  return { calls, shop };
};
const texts = () =>
  tree.root
    .findAll(n => typeof n.type === 'string' && n.type === 'Text')
    .map(n => [].concat(n.props.children).join(''));
const hasText = pattern => texts().some(t => pattern.test(t));
const byLabel = label =>
  tree.root.findAll(
    n =>
      n.props.accessibilityLabel === label &&
      typeof n.props.onPress === 'function',
  );
const press = async label => {
  const found = byLabel(label);
  expect(found.length).toBeGreaterThan(0);
  await act(async () => {
    await found[0].props.onPress();
  });
  await flush();
};
const typeInto = async (label, value) => {
  const box = tree.root.findAll(
    n =>
      n.props.accessibilityLabel === label &&
      typeof n.props.onChangeText === 'function',
  )[0];
  await act(async () => {
    box.props.onChangeText(value);
  });
};

beforeEach(async () => {
  await AsyncStorage.clear();
  Keychain.__store.clear();
  setSessionExpiredHandler(null);
  await endSession();
  Object.values(navigation).forEach(fn => fn.mockClear?.());
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(async () => {
  await act(async () => {
    tree?.unmount();
  });
  tree = null;
  jest.restoreAllMocks();
});

describe('checkout', () => {
  test('a guest is asked to log in first and the cart is kept', async () => {
    await mount(CheckoutScreen, { loggedIn: false });
    expect(hasText(/Log in to place your order/)).toBe(true);
    expect(byLabel('Place order')).toHaveLength(0);
    await act(async () => {
      tree.root
        .findAll(
          n =>
            typeof n.props.onPress === 'function' &&
            n.findAll(c => c.type === 'Text' && c.props.children === 'Log in')
              .length > 0,
        )[0]
        .props.onPress();
    });
    expect(navigation.navigate).toHaveBeenCalledWith('Login');
  });

  test('the saved addresses come from the server, the default is chosen, and the order is placed on cash on delivery', async () => {
    const shop = shopServer();
    shop.state.cart.push({ productId: 't-care', quantity: 2 });
    const { calls } = await mount(CheckoutScreen, { shop });
    expect(hasText(/Asha Khan · 9876543210\s+\(Default\)/)).toBe(true);
    expect(hasText(/Cash on Delivery/)).toBe(true);
    expect(hasText(/UPI|Credit|Net Banking/)).toBe(false); // no card or online payment
    expect(hasText(/T Care Capsules × 2/)).toBe(true);

    await press('Place order');
    expect(calls.find(c => c.key === 'POST /orders').body).toEqual({
      addressId: 'addr-1',
      paymentMethod: 'cod',
    });
    expect(navigation.reset).toHaveBeenCalledWith({
      index: 1,
      routes: [
        { name: 'Main' },
        { name: 'OrderSuccess', params: { orderId: 'order-1' } },
      ],
    });
    expect(shop.state.cart).toEqual([]);
  });

  test("a refused order shows the server's reason and stays on checkout", async () => {
    const shop = shopServer();
    shop.state.cart.push({ productId: 't-care', quantity: 1 });
    await mount(CheckoutScreen, { shop });
    shop.state.stock['t-care'] = 0; // someone else bought the last one
    await press('Place order');
    expect(Alert.alert).toHaveBeenCalledWith(
      'Order not placed',
      expect.stringMatching(/does not have enough stock/),
    );
    expect(navigation.reset).not.toHaveBeenCalled();
  });

  test('an item that cannot be ordered stops the checkout before any address is asked', async () => {
    const shop = shopServer({ stock: { 'pain-oil': 0 } });
    shop.state.cart.push({ productId: 'pain-oil', quantity: 1 });
    await mount(CheckoutScreen, { shop });
    expect(hasText(/Some items cannot be ordered/)).toBe(true);
    expect(byLabel('Place order')).toHaveLength(0);
  });

  test('with no saved address the form opens by itself; saving it creates the address on the server and selects it', async () => {
    const shop = shopServer();
    shop.state.addresses = [];
    shop.state.cart.push({ productId: 't-care', quantity: 1 });
    const { calls } = await mount(CheckoutScreen, { shop });
    await typeInto('Full name', 'Bilal Khan');
    await typeInto('Mobile number', '9123456780');
    await typeInto('Pincode', '110001');
    await typeInto('City', 'Delhi');
    await typeInto('House no., building, street', '5 Chandni Chowk');
    await typeInto('State', 'Delhi');
    await press('Save address');
    const created = calls.find(c => c.key === 'POST /addresses');
    expect(created.body).toEqual({
      name: 'Bilal Khan',
      phone: '9123456780',
      pincode: '110001',
      city: 'Delhi',
      state: 'Delhi',
      line1: '5 Chandni Chowk',
      line2: null,
    });
    expect(hasText(/Bilal Khan · 9123456780/)).toBe(true);
    await press('Place order');
    expect(calls.find(c => c.key === 'POST /orders').body.addressId).toBe(
      'addr-1',
    );
  });

  test('a mistake in the form is caught on the phone and nothing is sent', async () => {
    const shop = shopServer();
    shop.state.addresses = [];
    shop.state.cart.push({ productId: 't-care', quantity: 1 });
    const { calls } = await mount(CheckoutScreen, { shop });
    await typeInto('Mobile number', '12345');
    await press('Save address');
    expect(hasText(/Enter a valid 10-digit mobile number/)).toBe(true);
    expect(hasText(/Enter your full name/)).toBe(true);
    expect(calls.some(c => c.key === 'POST /addresses')).toBe(false);
  });

  test('an address can be removed after asking', async () => {
    const shop = shopServer();
    shop.state.cart.push({ productId: 't-care', quantity: 1 });
    const { calls } = await mount(CheckoutScreen, { shop });
    const removeRow = tree.root.findAll(
      n =>
        typeof n.props.onPress === 'function' &&
        n.findAll(c => c.type === 'Text' && c.props.children === 'Remove')
          .length > 0,
    );
    await act(async () => {
      removeRow[removeRow.length - 1].props.onPress();
    });
    const [, , buttons] =
      Alert.alert.mock.calls[Alert.alert.mock.calls.length - 1];
    await act(async () => {
      await buttons.find(b => b.text === 'Remove').onPress();
    });
    await flush();
    expect(calls.some(c => c.key === 'DELETE /addresses/addr-1')).toBe(true);
  });
});

describe('my orders', () => {
  test("lists the server's orders and cancels one after asking", async () => {
    const shop = shopServer();
    shop.state.cart.push({ productId: 't-care', quantity: 1 });
    shop.routes['POST /orders']({ addressId: 'addr-1', paymentMethod: 'cod' }); // an order placed earlier
    const { calls } = await mount(OrdersScreen, { shop });
    expect(hasText(/Order #AH-TEST-1/)).toBe(true);
    expect(hasText(/^Placed$/)).toBe(true);
    expect(hasText(/Cash on Delivery/)).toBe(true);

    await press('Cancel order AH-TEST-1');
    const [, , buttons] =
      Alert.alert.mock.calls[Alert.alert.mock.calls.length - 1];
    await act(async () => {
      await buttons.find(b => b.text === 'Cancel order').onPress();
    });
    await flush();
    expect(calls.some(c => c.key === 'POST /orders/order-1/cancel')).toBe(true);
    expect(hasText(/^Cancelled$/)).toBe(true);
    expect(byLabel('Cancel order AH-TEST-1')).toHaveLength(0);
  });

  test('a guest is asked to log in', async () => {
    await mount(OrdersScreen, { loggedIn: false });
    expect(hasText(/Log in to see your orders/)).toBe(true);
  });
});
