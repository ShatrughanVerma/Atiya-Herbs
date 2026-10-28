import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {CartProvider, useCart} from '../src/context/CartContext';

function renderCart() {
  const ref = {};
  function Capture() {
    ref.current = useCart();
    return null;
  }
  ReactTestRenderer.act(() => {
    ReactTestRenderer.create(
      <CartProvider>
        <Capture />
      </CartProvider>,
    );
  });
  return ref;
}

const act = fn => ReactTestRenderer.act(fn);

test('adds items and calculates totals', () => {
  const cart = renderCart();
  act(() => cart.current.addToCart('t-care')); // 899, MRP 1099
  act(() => cart.current.addToCart('t-care'));
  act(() => cart.current.addToCart('pain-relief-oil')); // 349, MRP 399

  expect(cart.current.count).toBe(3);
  expect(cart.current.subtotal).toBe(899 * 2 + 349);
  expect(cart.current.mrpTotal).toBe(1099 * 2 + 399);
  expect(cart.current.total).toBe(899 * 2 + 349);
});

test('setting quantity to 0 removes the item', () => {
  const cart = renderCart();
  act(() => cart.current.addToCart('t-care'));
  act(() => cart.current.setQty('t-care', 0));
  expect(cart.current.lines).toHaveLength(0);
  expect(cart.current.count).toBe(0);
});

test('valid coupon gives a discount and invalid coupon is rejected', () => {
  const cart = renderCart();
  act(() => cart.current.addToCart('joints-forte')); // 999

  let ok;
  act(() => {
    ok = cart.current.applyCoupon('nope');
  });
  expect(ok).toBe(false);
  expect(cart.current.couponDiscount).toBe(0);

  act(() => {
    ok = cart.current.applyCoupon(' atiya10 ');
  });
  expect(ok).toBe(true);
  expect(cart.current.couponDiscount).toBe(100);
  expect(cart.current.total).toBe(899);
});

test('wishlist toggles on and off', () => {
  const cart = renderCart();
  act(() => cart.current.toggleWishlist('f-care'));
  expect(cart.current.isWishlisted('f-care')).toBe(true);
  act(() => cart.current.toggleWishlist('f-care'));
  expect(cart.current.isWishlisted('f-care')).toBe(false);
});

test('placing an order saves it and empties the cart', () => {
  const cart = renderCart();
  act(() => cart.current.addToCart('h-care-hair-oil'));
  act(() => cart.current.applyCoupon('APP5'));
  let order;
  act(() => {
    order = cart.current.placeOrder({address: {name: 'Test'}, paymentMethod: {id: 'cod', title: 'Cash on Delivery'}});
  });
  expect(order.total).toBe(499 - 25);
  expect(order.status).toBe('Placed');
  expect(cart.current.orders[0].id).toBe(order.id);
  expect(cart.current.count).toBe(0);
  expect(cart.current.coupon).toBeNull();
});
