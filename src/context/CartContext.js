import React, {createContext, useContext, useMemo, useState} from 'react';
import {COUPONS, getProduct} from '../data/catalog';

const CartContext = createContext(null);

export function CartProvider({children}) {
  const [items, setItems] = useState([]); // [{productId, qty}]
  const [wishlist, setWishlist] = useState([]); // [productId]
  const [coupon, setCoupon] = useState(null);
  const [orders, setOrders] = useState([]);

  const value = useMemo(() => {
    const lines = items
      .map(item => ({...item, product: getProduct(item.productId)}))
      .filter(line => line.product);
    const count = lines.reduce((sum, line) => sum + line.qty, 0);
    const mrpTotal = lines.reduce((sum, line) => sum + line.product.mrp * line.qty, 0);
    const subtotal = lines.reduce((sum, line) => sum + line.product.price * line.qty, 0);
    const couponDiscount = coupon ? Math.round((subtotal * coupon.percent) / 100) : 0;
    const total = subtotal - couponDiscount;

    const getQty = productId => items.find(i => i.productId === productId)?.qty || 0;

    const setQty = (productId, qty) =>
      setItems(prev => {
        if (qty <= 0) {
          return prev.filter(i => i.productId !== productId);
        }
        if (prev.some(i => i.productId === productId)) {
          return prev.map(i => (i.productId === productId ? {...i, qty} : i));
        }
        return [...prev, {productId, qty}];
      });

    const addToCart = (productId, qty = 1) => setQty(productId, getQty(productId) + qty);

    const toggleWishlist = productId =>
      setWishlist(prev =>
        prev.includes(productId) ? prev.filter(id => id !== productId) : [...prev, productId],
      );

    const applyCoupon = code => {
      const found = COUPONS[code.trim().toUpperCase()];
      setCoupon(found || null);
      return !!found;
    };

    const placeOrder = ({address, paymentMethod}) => {
      const order = {
        id: `AH${Date.now().toString().slice(-8)}`,
        date: new Date().toISOString(),
        lines,
        mrpTotal,
        subtotal,
        couponDiscount,
        coupon,
        total,
        address,
        paymentMethod,
        status: 'Placed',
      };
      setOrders(prev => [order, ...prev]);
      setItems([]);
      setCoupon(null);
      return order;
    };

    return {
      lines,
      count,
      mrpTotal,
      subtotal,
      couponDiscount,
      total,
      coupon,
      wishlist,
      orders,
      getQty,
      setQty,
      addToCart,
      toggleWishlist,
      isWishlisted: productId => wishlist.includes(productId),
      applyCoupon,
      removeCoupon: () => setCoupon(null),
      placeOrder,
    };
  }, [items, wishlist, coupon, orders]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) {
    throw new Error('useCart must be used inside CartProvider');
  }
  return ctx;
}
