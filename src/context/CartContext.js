import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Alert } from 'react-native';
import { hasSession } from '../services/session';
import {
  cancelOrder as cancelOrderApi,
  deleteCartItem,
  fetchCart,
  listOrders,
  mergeCart,
  placeOrder as placeOrderApi,
  putCartItem,
  validateCoupon,
} from '../services/shopApi';
import { useAuth } from './AuthContext';
import { useCatalog } from './CatalogContext';

const CartContext = createContext(null);

const MAX_QTY = 10; // the same limit the server has for one product

const BLOCKING = ['out-of-stock', 'unavailable'];

const summarise = items => ({
  items,
  itemCount: items.reduce((sum, i) => sum + i.quantity, 0),
  subtotal: items.reduce((sum, i) => sum + i.lineTotal, 0),
  savings: items.reduce((sum, i) => sum + i.lineSavings, 0),
  hasIssues: items.some(i => i.issue !== null),
});

// What one cart line from the server looks like to the screens. `product` carries the PRICE THE SERVER GAVE,
// so what is shown is what will be charged.
const lineFromServer = (line, catalogProduct) => ({
  productId: line.productId,
  qty: BLOCKING.includes(line.issue)
    ? line.requested ?? 1
    : line.quantity,
  issue: line.issue,
  available: line.available,
  product: {
    ...(catalogProduct ?? {}),
    id: line.productId,
    name: line.name,
    image: line.image,
    size: line.size,
    price: line.price,
    mrp: line.mrp,
  },
});

// Shows the change at once; the server's answer replaces it a moment later
const applyLocally = (cart, productId, qty, product) => {
  const items = cart?.items ?? [];
  if (qty <= 0) {
    return summarise(items.filter(i => i.productId !== productId));
  }
  const quantity = Math.min(qty, MAX_QTY);
  if (items.some(i => i.productId === productId)) {
    return summarise(
      items.map(i =>
        i.productId === productId
          ? {
              ...i,
              quantity,
              lineTotal: i.price * quantity,
              lineSavings: Math.max(0, i.mrp - i.price) * quantity,
            }
          : i,
      ),
    );
  }
  if (!product) {
    return cart ?? summarise([]);
  }
  return summarise([
    ...items,
    {
      productId,
      name: product.name,
      image: product.image ?? null,
      size: product.size ?? null,
      price: product.price,
      mrp: product.mrp,
      available: product.inStock === false ? 0 : quantity,
      quantity,
      issue: null,
      lineTotal: product.price * quantity,
      lineSavings: Math.max(0, product.mrp - product.price) * quantity,
    },
  ]);
};

export function CartProvider({ children }) {
  const { user } = useAuth();
  const { getProduct } = useCatalog();
  // Logged in = the phone holds login tokens. A Google-only account has none: it shops as a guest.
  const loggedIn = !!user && hasSession();

  const [local, setLocal] = useState([]); // a guest's cart: [{productId, qty}]
  const [server, setServer] = useState(null); // a logged-in person's cart, as the server last said
  const [cartLoading, setCartLoading] = useState(false);
  const [cartError, setCartError] = useState(null);
  const [wishlist, setWishlist] = useState([]); // [productId]
  const [coupon, setCoupon] = useState(null); // {code, label, percent}
  const [couponDiscount, setCouponDiscount] = useState(0);
  const [orders, setOrders] = useState([]); // newest first, from the server
  const [ordersTotal, setOrdersTotal] = useState(0);
  const [ordersStatus, setOrdersStatus] = useState('idle'); // idle | loading | ready | error

  const localRef = useRef([]);
  const serverRef = useRef(null);
  const queue = useRef(Promise.resolve());
  const pending = useRef(0);
  const validated = useRef('');

  const setLocalBoth = useCallback(next => {
    localRef.current = typeof next === 'function' ? next(localRef.current) : next;
    setLocal(localRef.current);
  }, []);
  const setServerBoth = useCallback(next => {
    serverRef.current = typeof next === 'function' ? next(serverRef.current) : next;
    setServer(serverRef.current);
  }, []);

  const refreshCart = useCallback(async () => {
    try {
      setServerBoth(await fetchCart());
      setCartError(null);
    } catch (error) {
      setCartError(error.message);
    }
  }, [setServerBoth]);

  const refreshOrders = useCallback(async () => {
    setOrdersStatus('loading');
    try {
      const res = await listOrders(1, 20);
      setOrders(res.items);
      setOrdersTotal(res.total);
      setOrdersStatus('ready');
    } catch {
      setOrdersStatus('error');
    }
  }, []);

  // Right after login: the guest's cart joins the one on the server, which then follows the person everywhere.
  // On logout everything of the account is forgotten here.
  useEffect(() => {
    if (!loggedIn) {
      setServerBoth(null);
      setOrders([]);
      setOrdersTotal(0);
      setOrdersStatus('idle');
      return undefined;
    }
    let cancelled = false;
    (async () => {
      setCartLoading(true);
      try {
        const guestItems = localRef.current;
        const res = guestItems.length
          ? await mergeCart(
              guestItems.map(i => ({
                productId: i.productId,
                quantity: Math.min(i.qty, MAX_QTY),
              })),
            )
          : await fetchCart();
        if (!cancelled) {
          setServerBoth(res);
          setCartError(null);
          if (guestItems.length) {
            setLocalBoth([]);
          }
        }
      } catch (error) {
        if (!cancelled) {
          setCartError(error.message);
        }
      } finally {
        if (!cancelled) {
          setCartLoading(false);
        }
      }
    })();
    refreshOrders();
    return () => {
      cancelled = true;
    };
  }, [loggedIn, refreshOrders, setLocalBoth, setServerBoth]);

  const getQty = productId => {
    if (loggedIn) {
      return (
        serverRef.current?.items.find(i => i.productId === productId)?.quantity ?? 0
      );
    }
    return localRef.current.find(i => i.productId === productId)?.qty ?? 0;
  };

  const setQty = (productId, qty) => {
    if (!loggedIn) {
      setLocalBoth(prev => {
        if (qty <= 0) {
          return prev.filter(i => i.productId !== productId);
        }
        const capped = Math.min(qty, MAX_QTY);
        return prev.some(i => i.productId === productId)
          ? prev.map(i => (i.productId === productId ? { ...i, qty: capped } : i))
          : [...prev, { productId, qty: capped }];
      });
      return;
    }
    const before = serverRef.current;
    setServerBoth(prev => applyLocally(prev, productId, qty, getProduct(productId)));
    pending.current += 1;
    queue.current = queue.current.then(async () => {
      try {
        const res =
          qty <= 0
            ? await deleteCartItem(productId)
            : await putCartItem(productId, qty);
        if (pending.current === 1) {
          setServerBoth(res); // the last change in line: the server's answer is the truth
        }
      } catch (error) {
        Alert.alert('Cart', error.message || 'The cart could not be changed.');
        try {
          setServerBoth(await fetchCart());
        } catch {
          setServerBoth(before);
        }
      } finally {
        pending.current -= 1;
      }
    });
  };

  const addToCart = (productId, qty = 1) => setQty(productId, getQty(productId) + qty);

  const toggleWishlist = productId =>
    setWishlist(prev =>
      prev.includes(productId) ? prev.filter(id => id !== productId) : [...prev, productId],
    );

  const value = useMemo(() => {
    const lines = loggedIn
      ? (server?.items ?? []).map(line => lineFromServer(line, getProduct(line.productId)))
      : local
          .map(i => ({ productId: i.productId, qty: i.qty, issue: null, product: getProduct(i.productId) }))
          .filter(l => l.product);
    const buyable = lines.filter(l => !BLOCKING.includes(l.issue));
    const count = buyable.reduce((sum, l) => sum + l.qty, 0);
    const mrpTotal = buyable.reduce((sum, l) => sum + l.product.mrp * l.qty, 0);
    const subtotal = buyable.reduce((sum, l) => sum + l.product.price * l.qty, 0);
    const discount = coupon ? Math.min(couponDiscount, subtotal) : 0;
    return {
      lines,
      count,
      mrpTotal,
      subtotal,
      couponDiscount: discount,
      total: subtotal - discount,
      hasBlocking: lines.some(l => BLOCKING.includes(l.issue)),
      coupon,
    };
  }, [loggedIn, server, local, getProduct, coupon, couponDiscount]);

  const { subtotal } = value;

  // The server decides if a coupon works and how much it takes off. Asked again when the cart's total changes.
  useEffect(() => {
    if (!coupon) {
      return undefined;
    }
    if (subtotal <= 0) {
      setCoupon(null);
      setCouponDiscount(0);
      return undefined;
    }
    const key = `${coupon.code}:${subtotal}`;
    if (validated.current === key) {
      return undefined;
    }
    let cancelled = false;
    validateCoupon(coupon.code, subtotal)
      .then(res => {
        validated.current = key;
        if (!cancelled) {
          setCouponDiscount(res.discount);
        }
      })
      .catch(error => {
        if (!cancelled && error.kind === 'validation') {
          setCoupon(null);
          setCouponDiscount(0);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [coupon, subtotal]);

  const applyCoupon = async code => {
    if (subtotal <= 0) {
      return { ok: false, message: 'Add something to your cart first.' };
    }
    try {
      const res = await validateCoupon(code.trim(), subtotal);
      validated.current = `${res.code}:${subtotal}`;
      setCoupon({ code: res.code, label: res.label, percent: res.percent });
      setCouponDiscount(res.discount);
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error.message || 'This coupon code is not valid.' };
    }
  };

  const removeCoupon = () => {
    setCoupon(null);
    setCouponDiscount(0);
  };

  // Makes the order from the cart on the server (cash on delivery). Throws the ApiError so the screen can say why.
  const placeOrder = async ({ addressId }) => {
    await queue.current; // let any change still on its way reach the server first
    const order = await placeOrderApi({ addressId, couponCode: coupon?.code });
    setServerBoth(summarise([]));
    removeCoupon();
    setOrders(prev => [order, ...prev]);
    setOrdersTotal(total => total + 1);
    return order;
  };

  const cancelOrder = async id => {
    const updated = await cancelOrderApi(id);
    setOrders(prev => prev.map(o => (o.id === id ? updated : o)));
    return updated;
  };

  const api = {
    ...value,
    loggedIn,
    cartLoading,
    cartError,
    refreshCart,
    wishlist,
    orders,
    ordersTotal,
    ordersStatus,
    refreshOrders,
    getQty,
    setQty,
    addToCart,
    toggleWishlist,
    isWishlisted: productId => wishlist.includes(productId),
    applyCoupon,
    removeCoupon,
    placeOrder,
    cancelOrder,
  };

  return <CartContext.Provider value={api}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) {
    throw new Error('useCart must be used inside CartProvider');
  }
  return ctx;
}
