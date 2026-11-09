import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from '../../src/context/AuthContext';
import { CartProvider } from '../../src/context/CartContext';
import { CatalogProvider, useCatalog } from '../../src/context/CatalogContext';
import CartScreen from '../../src/screens/CartScreen';
import ExploreScreen from '../../src/screens/ExploreScreen';
import ProductListScreen from '../../src/screens/shop/ProductListScreen';
import { mockServer } from '../../test-utils/mockServer';
import { PRODUCTS, shopServer } from '../../test-utils/shopServer';

const { act } = ReactTestRenderer;
const METRICS = {
  frame: { x: 0, y: 0, width: 360, height: 800 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};
const navigation = {
  navigate: jest.fn(),
  goBack: jest.fn(),
  canGoBack: () => true,
};

let tree;
const ref = {};
function Capture() {
  ref.catalog = useCatalog();
  return null;
}
const flush = async () => {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });
  }
};
const mount = async children => {
  await act(async () => {
    tree = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={METRICS}>
        <AuthProvider>
          <CatalogProvider>
            <CartProvider>{children}</CartProvider>
          </CatalogProvider>
        </AuthProvider>
      </SafeAreaProvider>,
    );
  });
  await flush();
};
const texts = () =>
  tree.root
    .findAll(n => typeof n.type === 'string' && n.type === 'Text')
    .map(n => [].concat(n.props.children).join(''));
const hasText = pattern => texts().some(t => pattern.test(t));
const DOWN = {}; // a server that answers nothing: every request fails like a dead network

beforeEach(async () => {
  await AsyncStorage.clear();
  navigation.navigate.mockClear();
});

afterEach(async () => {
  await act(async () => {
    tree?.unmount();
  });
  tree = null;
});

describe('the catalog comes from the server', () => {
  test('online: the data is shown, and saved on the phone for later', async () => {
    mockServer(shopServer().routes);
    await mount(<Capture />);
    expect(ref.catalog.ready).toBe(true);
    expect(ref.catalog.stale).toBe(false);
    expect(ref.catalog.products.map(p => p.id)).toEqual(
      PRODUCTS.map(p => p.id),
    );
    expect(ref.catalog.getProduct('t-care').price).toBe(899);
    expect(ref.catalog.getCategory('vinegar').name).toMatch(/Vinegar/);
    expect(ref.catalog.banners[0].image).toBeTruthy(); // the bundled picture its key names
    const saved = JSON.parse(await AsyncStorage.getItem('atiya.catalog.v1'));
    expect(saved.products).toHaveLength(PRODUCTS.length);
  });

  test('offline with NO saved copy: no products at all, an error state, and Retry brings the data back', async () => {
    mockServer(DOWN);
    await mount(<Capture />);
    expect(ref.catalog.ready).toBe(false);
    expect(ref.catalog.status).toBe('error');
    expect(ref.catalog.products).toEqual([]);
    expect(ref.catalog.getProduct('t-care')).toBeUndefined();

    mockServer(shopServer().routes); // the server is back
    await act(async () => {
      await ref.catalog.retry();
    });
    expect(ref.catalog.ready).toBe(true);
    expect(ref.catalog.products).toHaveLength(PRODUCTS.length);
  });

  test('offline WITH a saved copy: that copy of real server data is shown, marked as stale', async () => {
    const cachedOnly = {
      ...PRODUCTS[0],
      id: 'cached-only',
      name: 'Saved Earlier',
    };
    await AsyncStorage.setItem(
      'atiya.catalog.v1',
      JSON.stringify({
        version: 1,
        savedAt: 1,
        categories: [],
        concerns: [],
        banners: [],
        products: [cachedOnly],
      }),
    );
    mockServer(DOWN);
    await mount(<Capture />);
    expect(ref.catalog.ready).toBe(true);
    expect(ref.catalog.stale).toBe(true);
    expect(ref.catalog.products.map(p => p.id)).toEqual(['cached-only']);
  });

  test('a damaged saved copy is ignored', async () => {
    await AsyncStorage.setItem('atiya.catalog.v1', '{not json');
    mockServer(DOWN);
    await mount(<Capture />);
    expect(ref.catalog.ready).toBe(false);
  });

  test('a saved copy written by another version of the app is ignored', async () => {
    await AsyncStorage.setItem(
      'atiya.catalog.v1',
      JSON.stringify({
        version: 99,
        categories: [],
        concerns: [],
        banners: [],
        products: [{ id: 'x' }],
      }),
    );
    mockServer(DOWN);
    await mount(<Capture />);
    expect(ref.catalog.ready).toBe(false);
    expect(ref.catalog.products).toEqual([]);
  });

  test('a fresh answer replaces a saved copy', async () => {
    await AsyncStorage.setItem(
      'atiya.catalog.v1',
      JSON.stringify({
        version: 1,
        savedAt: 1,
        categories: [],
        concerns: [],
        banners: [],
        products: [{ ...PRODUCTS[0], id: 'old' }],
      }),
    );
    mockServer(shopServer().routes);
    await mount(<Capture />);
    expect(ref.catalog.stale).toBe(false);
    expect(ref.catalog.products.map(p => p.id)).not.toContain('old');
  });
});

describe('screens without the server and without a saved copy', () => {
  test('Explore, the product list and the cart show "Server not reachable" with Retry, never products', async () => {
    mockServer(DOWN);
    for (const Screen of [ExploreScreen, ProductListScreen, CartScreen]) {
      await mount(<Screen navigation={navigation} route={{ params: {} }} />);
      expect(hasText(/Server not reachable/)).toBe(true);
      expect(hasText(/T Care|Capsules|Vinegar|Oil/)).toBe(false);
      expect(
        tree.root.findAll(n => n.props.accessibilityLabel === 'Retry').length,
      ).toBeGreaterThan(0);
      await act(async () => {
        tree.unmount();
      });
      tree = null;
    }
  });

  test("with the server up, Explore lists the server's categories and counts", async () => {
    mockServer(shopServer().routes);
    await mount(<ExploreScreen navigation={navigation} />);
    expect(hasText(/Server not reachable/)).toBe(false);
    expect(hasText(/^Herbal Medicine$/)).toBe(true);
    expect(hasText(/^2 products$/)).toBe(true);
  });

  test('offline with a saved copy: the screen works and says it is offline', async () => {
    await AsyncStorage.setItem(
      'atiya.catalog.v1',
      JSON.stringify({
        version: 1,
        savedAt: 1,
        categories: [{ id: 'c1', name: 'Saved Category', icon: 'leaf' }],
        concerns: [],
        banners: [],
        products: [{ ...PRODUCTS[0], category: 'c1' }],
      }),
    );
    mockServer(DOWN);
    await mount(<ExploreScreen navigation={navigation} />);
    expect(hasText(/Saved Category/)).toBe(true);
    expect(hasText(/Offline: showing saved products/)).toBe(true);
  });
});
