import { request } from './http';
import { authFetch } from './session';

// The shop endpoints of the backend (see backend/README.md): products, cart, addresses, orders.
// Public ones use plain request(); everything about a person goes through authFetch (login + automatic refresh).

// ---- the shop (public) ----
export const fetchCategories = () => request('/categories');
export const fetchConcerns = () => request('/concerns');
export const fetchBanners = () => request('/banners');

const PAGE_SIZE = 50; // the most the server gives in one page
const MAX_PAGES = 20; // 1000 products: far more than the shop has

// Every active product, page by page
export async function fetchAllProducts() {
  const all = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const res = await request(`/products?page=${page}&pageSize=${PAGE_SIZE}`);
    const items = Array.isArray(res?.items) ? res.items : [];
    all.push(...items);
    if (items.length === 0 || all.length >= (res?.total ?? 0)) {
      break;
    }
  }
  return all;
}

// -> {code, label, percent, discount, total}. Throws ApiError (400 = not a valid coupon).
export const validateCoupon = (code, subtotal) =>
  request('/coupons/validate', { method: 'POST', body: { code, subtotal } });

// ---- the cart (login) ----
// Every answer is the whole cart: {items, itemCount, subtotal, savings, hasIssues}
export const fetchCart = () => authFetch('/cart');
export const putCartItem = (productId, quantity) =>
  authFetch(`/cart/items/${encodeURIComponent(productId)}`, {
    method: 'PUT',
    body: { quantity },
  });
export const deleteCartItem = productId =>
  authFetch(`/cart/items/${encodeURIComponent(productId)}`, {
    method: 'DELETE',
  });
// items: [{productId, quantity}] (a guest's local cart, sent once after login)
export const mergeCart = items =>
  authFetch('/cart/merge', { method: 'POST', body: { items } });

// ---- addresses (login) ----
export const listAddresses = () => authFetch('/addresses');
export const createAddress = address =>
  authFetch('/addresses', { method: 'POST', body: address });
export const updateAddress = (id, changes) =>
  authFetch(`/addresses/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: changes,
  });
export const deleteAddress = id =>
  authFetch(`/addresses/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const makeDefaultAddress = id =>
  authFetch(`/addresses/${encodeURIComponent(id)}/default`, {
    method: 'POST',
  });

// ---- orders (login, cash on delivery only) ----
// The order is made from the cart on the server. Prices, stock and the coupon are worked out there.
export const placeOrder = ({ addressId, couponCode }) =>
  authFetch('/orders', {
    method: 'POST',
    body: {
      addressId,
      paymentMethod: 'cod',
      ...(couponCode && { couponCode }),
    },
  });
// -> {items, page, pageSize, total}
export const listOrders = (page = 1, pageSize = 20) =>
  authFetch(`/orders?page=${page}&pageSize=${pageSize}`);
export const cancelOrder = id =>
  authFetch(`/orders/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
