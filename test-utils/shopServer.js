/* eslint-env jest */
// A fake shop server for the tests: the same answers the real backend gives for the catalog, cart, coupons,
// addresses and orders, kept in memory. Use it with mockServer(shopServer().routes).

export const CATEGORIES = [
  {
    id: 'herbal-medicine',
    name: 'Herbal Medicine',
    icon: 'bottle-tonic-plus-outline',
  },
  { id: 'vinegar', name: 'Vinegars (Sirka)', icon: 'bottle-tonic-outline' },
];
export const CONCERNS = [
  {
    id: 'joint-pain',
    name: 'Joint Pain',
    icon: 'arm-flex-outline',
    tint: '#E8F5E9',
  },
  {
    id: 'skin',
    name: 'Skin',
    icon: 'face-woman-shimmer-outline',
    tint: '#FFF3E0',
  },
];

const product = (id, name, category, concerns, price, mrp, extra = {}) => ({
  id,
  name,
  category,
  concerns,
  size: '60 Capsules',
  price,
  mrp,
  discountPercent: Math.round(((mrp - price) / mrp) * 100),
  rating: 4.5,
  reviews: 10,
  inStock: true,
  badge: null,
  bestseller: false,
  image: `https://img.test/${id}.jpg`,
  images: [`https://img.test/${id}.jpg`],
  description: `${name} description`,
  benefits: ['Natural'],
  howToUse: '1 daily',
  ingredients: 'Herbs',
  ...extra,
});

export const PRODUCTS = [
  product(
    't-care',
    'T Care Capsules',
    'herbal-medicine',
    ['joint-pain'],
    899,
    1099,
    { bestseller: true, reviews: 342 },
  ),
  product(
    'pain-oil',
    'Pain Relief Oil',
    'herbal-medicine',
    ['joint-pain'],
    349,
    399,
  ),
  product('cumin-vinegar', 'Cumin Vinegar', 'vinegar', ['skin'], 250, 300),
  product('sold-out', 'Sold Out Oil', 'vinegar', [], 100, 120, {
    inStock: false,
  }),
];

export const BANNERS = [
  {
    id: 'b1',
    badge: 'NEW',
    title: 'Authentic remedies',
    image: 'banner_shilajit',
    gradient: null,
    concern: null,
    category: null,
  },
];

export const ADDRESS = {
  id: 'addr-1',
  name: 'Asha Khan',
  phone: '9876543210',
  pincode: '226001',
  city: 'Lucknow',
  state: 'Uttar Pradesh',
  line1: '12 Hakim Street, Chowk',
  line2: null,
  isDefault: true,
};

const json = (status, body) => [status, body];

export function shopServer({ stock: initialStock = {} } = {}) {
  const state = {
    stock: {
      't-care': 100,
      'pain-oil': 100,
      'cumin-vinegar': 100,
      'sold-out': 0,
      ...initialStock,
    },
    cart: [], // [{productId, quantity}]
    addresses: [{ ...ADDRESS }],
    orders: [],
    failNext: null, // e.g. 'PUT /cart/items/:productId' -> answers 500 once
    coupons: {
      ATIYA10: { code: 'ATIYA10', label: '10% off on your order', percent: 10 },
    },
  };
  const byId = id => PRODUCTS.find(p => p.id === id);
  const live = p => ({ ...p, inStock: state.stock[p.id] > 0 });

  const cartView = () => {
    const items = state.cart.map(row => {
      const p = byId(row.productId);
      const stock = state.stock[row.productId] ?? 0;
      const base = {
        productId: p.id,
        name: p.name,
        image: p.image,
        size: p.size,
        price: p.price,
        mrp: p.mrp,
        available: stock,
      };
      if (stock < 1) {
        return {
          ...base,
          quantity: 0,
          requested: row.quantity,
          issue: 'out-of-stock',
          lineTotal: 0,
          lineSavings: 0,
        };
      }
      const quantity = Math.min(row.quantity, stock, 10);
      return {
        ...base,
        quantity,
        ...(quantity < row.quantity && { requested: row.quantity }),
        issue: quantity < row.quantity ? 'limited' : null,
        lineTotal: p.price * quantity,
        lineSavings: (p.mrp - p.price) * quantity,
      };
    });
    return {
      items,
      itemCount: items.reduce((s, i) => s + i.quantity, 0),
      subtotal: items.reduce((s, i) => s + i.lineTotal, 0),
      savings: items.reduce((s, i) => s + i.lineSavings, 0),
      hasIssues: items.some(i => i.issue !== null),
    };
  };

  const failing = key => {
    if (state.failNext === key) {
      state.failNext = null;
      return json(500, { statusCode: 500, message: 'Internal server error' });
    }
    return null;
  };

  const routes = {
    'GET /categories': () => json(200, CATEGORIES),
    'GET /concerns': () => json(200, CONCERNS),
    'GET /banners': () => json(200, BANNERS),
    'GET /products': (body, headers, { query }) => {
      const page = Number(query.page || 1);
      const size = Number(query.pageSize || 20);
      const all = PRODUCTS.map(live);
      return json(200, {
        items: all.slice((page - 1) * size, page * size),
        page,
        pageSize: size,
        total: all.length,
      });
    },
    'GET /cart': () => failing('GET /cart') || json(200, cartView()),
    'PUT /cart/items/:productId': (body, headers, { params }) => {
      const failed = failing('PUT /cart/items/:productId');
      if (failed) {
        return failed;
      }
      const stock = state.stock[params.productId];
      if (stock === undefined) {
        return json(404, {
          statusCode: 404,
          message: 'This product is not available.',
        });
      }
      if (stock < 1) {
        return json(409, { statusCode: 409, message: 'Out of stock.' });
      }
      const quantity = Math.min(body.quantity, stock, 10);
      const row = state.cart.find(r => r.productId === params.productId);
      if (body.quantity === 0) {
        state.cart = state.cart.filter(r => r.productId !== params.productId);
      } else if (row) {
        row.quantity = quantity;
      } else {
        state.cart.push({ productId: params.productId, quantity });
      }
      return json(200, cartView());
    },
    'DELETE /cart/items/:productId': (body, headers, { params }) => {
      state.cart = state.cart.filter(r => r.productId !== params.productId);
      return json(200, cartView());
    },
    'POST /cart/merge': body => {
      for (const { productId, quantity } of body.items) {
        const stock = state.stock[productId];
        if (!stock) {
          continue;
        }
        const row = state.cart.find(r => r.productId === productId);
        const total = Math.min((row?.quantity ?? 0) + quantity, stock, 10);
        if (row) {
          row.quantity = total;
        } else {
          state.cart.push({ productId, quantity: total });
        }
      }
      return json(200, cartView());
    },
    'POST /coupons/validate': body => {
      const coupon = state.coupons[String(body.code).toUpperCase()];
      if (!coupon) {
        return json(400, {
          statusCode: 400,
          message: 'This coupon code is not valid.',
        });
      }
      const discount = Math.round((body.subtotal * coupon.percent) / 100);
      return json(200, {
        code: coupon.code,
        label: coupon.label,
        percent: coupon.percent,
        discount,
        total: body.subtotal - discount,
      });
    },
    'GET /addresses': () => json(200, state.addresses),
    'POST /addresses': body => {
      const created = {
        id: `addr-${state.addresses.length + 1}`,
        line2: null,
        ...body,
        isDefault: state.addresses.length === 0,
      };
      state.addresses.push(created);
      return json(201, created);
    },
    'PATCH /addresses/:id': (body, headers, { params }) => {
      const found = state.addresses.find(a => a.id === params.id);
      Object.assign(found, body);
      return json(200, found);
    },
    'DELETE /addresses/:id': (body, headers, { params }) => {
      state.addresses = state.addresses.filter(a => a.id !== params.id);
      return [204];
    },
    'POST /addresses/:id/default': (body, headers, { params }) => {
      state.addresses.forEach(a => {
        a.isDefault = a.id === params.id;
      });
      return json(
        200,
        state.addresses.find(a => a.id === params.id),
      );
    },
    'POST /orders': body => {
      if (!state.cart.length) {
        return json(400, { statusCode: 400, message: 'Your cart is empty.' });
      }
      const view = cartView();
      const blocked = view.items.find(i => i.issue === 'out-of-stock');
      if (blocked) {
        return json(409, {
          statusCode: 409,
          message: `${blocked.name} does not have enough stock.`,
        });
      }
      const address = state.addresses.find(a => a.id === body.addressId);
      if (!address) {
        return json(404, { statusCode: 404, message: 'Address not found.' });
      }
      const coupon = body.couponCode
        ? state.coupons[String(body.couponCode).toUpperCase()]
        : null;
      const discount = coupon
        ? Math.round((view.subtotal * coupon.percent) / 100)
        : 0;
      const order = {
        id: `order-${state.orders.length + 1}`,
        orderNumber: `AH-TEST-${state.orders.length + 1}`,
        status: 'placed',
        paymentMethod: body.paymentMethod,
        subtotal: view.subtotal,
        discount,
        shippingFee: 0,
        total: view.subtotal - discount,
        couponCode: coupon?.code ?? null,
        shippingAddress: address,
        items: view.items.map(i => ({
          productId: i.productId,
          name: i.name,
          image: i.image,
          price: i.price,
          qty: i.quantity,
        })),
        createdAt: '2026-11-07T10:00:00.000Z',
        cancelledAt: null,
      };
      state.orders.unshift(order);
      state.cart = [];
      return json(201, order);
    },
    'GET /orders': () =>
      json(200, {
        items: state.orders,
        page: 1,
        pageSize: 20,
        total: state.orders.length,
      }),
    'POST /orders/:id/cancel': (body, headers, { params }) => {
      const order = state.orders.find(o => o.id === params.id);
      if (!['placed', 'confirmed'].includes(order.status)) {
        return json(409, {
          statusCode: 409,
          message: 'This order can no longer be cancelled.',
        });
      }
      order.status = 'cancelled';
      order.cancelledAt = '2026-11-07T11:00:00.000Z';
      return json(200, order);
    },
  };

  return { routes, state, cartView };
}
