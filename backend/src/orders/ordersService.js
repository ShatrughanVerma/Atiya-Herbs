const {randomBytes} = require('node:crypto');
const {badRequest, conflict, notFound} = require('../common/errors');
const {pageArgs, pageOf} = require('../common/paging');
const {applyCoupon} = require('../catalog/coupons');

// What each status may become next. Cancelling is also allowed while the order is placed or confirmed.
const NEXT = {
  placed: ['confirmed', 'cancelled'],
  confirmed: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
};
const CANCELLABLE = ['placed', 'confirmed'];
const OPEN = ['placed', 'confirmed', 'shipped'];

// AH-<time>-<random>, easy to read out on the phone
const newOrderNumber = () => `AH-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString('hex').toUpperCase()}`;

const toOrder = (order, items) => ({
  id: order.id,
  orderNumber: order.orderNumber,
  status: order.status,
  paymentMethod: order.paymentMethod,
  subtotal: order.subtotal,
  discount: order.discount,
  shippingFee: order.shippingFee,
  total: order.total,
  couponCode: order.couponCode,
  shippingAddress: order.shippingAddress,
  items: items.map(i => ({productId: i.productId, name: i.name, image: i.image, price: i.price, qty: i.qty})),
  createdAt: order.createdAt,
  cancelledAt: order.cancelledAt,
});

function createOrdersService({prisma, audit}) {
  const itemsFor = async orderIds => {
    const map = new Map(orderIds.map(id => [id, []]));
    if (orderIds.length) {
      const rows = await prisma.orderItem.findMany({where: {orderId: {in: orderIds}}});
      rows.forEach(row => map.get(row.orderId)?.push(row));
    }
    return map;
  };

  const withItems = async orders => {
    const map = await itemsFor(orders.map(o => o.id));
    return orders.map(o => toOrder(o, map.get(o.id) ?? []));
  };

  // Puts the stock of a cancelled order back. Run inside the same transaction as the status change.
  const restoreStock = async (tx, orderId) => {
    const items = await tx.orderItem.findMany({where: {orderId}});
    for (const item of items) {
      await tx.product.updateMany({where: {id: item.productId}, data: {stock: {increment: item.qty}}});
    }
  };

  // Moves an order to 'cancelled' exactly once, even if two requests arrive together
  const cancelOrder = async (order, allowedFrom) => {
    await prisma.$transaction(async tx => {
      const claimed = await tx.order.updateMany({
        where: {id: order.id, status: {in: allowedFrom}},
        data: {status: 'cancelled', cancelledAt: new Date()},
      });
      if (claimed.count !== 1) {
        throw conflict('This order can no longer be cancelled.');
      }
      await restoreStock(tx, order.id);
    });
  };

  const service = {
    // Places an order for the logged-in person.
    async create(userId, input, ip) {
      const address = await prisma.address.findFirst({where: {id: input.addressId, userId}});
      if (!address) {
        throw notFound('Address not found.');
      }

      const fromCart = !input.items;

      const created = await prisma.$transaction(async tx => {
        // the same product twice in the list is one line
        const wanted = new Map();
        const source = fromCart
          ? (await tx.cartItem.findMany({where: {userId}, orderBy: {createdAt: 'asc'}})).map(row => ({productId: row.productId, qty: row.quantity}))
          : input.items;
        if (!source.length) {
          throw badRequest('Your cart is empty.');
        }
        for (const {productId, qty} of source) {
          wanted.set(productId, Math.min(20, (wanted.get(productId) ?? 0) + qty));
        }
        const lines = [];
        // always in the same order, so two orders for the same products never wait on each other
        for (const productId of [...wanted.keys()].sort()) {
          const qty = wanted.get(productId);
          const product = await tx.product.findUnique({where: {id: productId}});
          if (!product || !product.active) {
            throw badRequest('Some products in your cart are no longer available.');
          }
          // Take the stock only if enough is left. Two people buying the last one cannot both get it.
          const taken = await tx.product.updateMany({
            where: {id: productId, active: true, stock: {gte: qty}},
            data: {stock: {decrement: qty}},
          });
          if (taken.count !== 1) {
            throw conflict(`${product.name} does not have enough stock.`);
          }
          lines.push({productId, name: product.name, image: product.images?.[0] ?? null, price: product.price, qty});
        }

        const asOrdered = [...wanted.keys()];
        lines.sort((x, y) => asOrdered.indexOf(x.productId) - asOrdered.indexOf(y.productId)); // show them as the person listed them

        const subtotal = lines.reduce((sum, line) => sum + line.price * line.qty, 0);
        let discount = 0;
        let couponCode = null;
        if (input.couponCode) {
          const applied = await applyCoupon(tx, input.couponCode, subtotal);
          discount = applied.discount;
          couponCode = applied.coupon.code;
        }
        const shippingFee = 0; // delivery is free for now
        const order = await tx.order.create({
          data: {
            orderNumber: newOrderNumber(),
            userId,
            paymentMethod: input.paymentMethod,
            subtotal,
            discount,
            shippingFee,
            total: subtotal - discount + shippingFee,
            couponCode,
            // A copy: later edits to the address book never change an order already placed
            shippingAddress: {
              name: address.name,
              phone: address.phone,
              pincode: address.pincode,
              city: address.city,
              state: address.state,
              line1: address.line1,
              line2: address.line2,
            },
          },
        });
        await tx.orderItem.createMany({data: lines.map(line => ({...line, orderId: order.id}))});
        if (fromCart) {
          await tx.cartItem.deleteMany({where: {userId}}); // ordered: the cart starts again from empty
        }
        return toOrder(order, lines);
      });

      await audit.record({action: 'order.placed', userId, ip, metadata: {orderId: created.id, total: created.total}});
      return created;
    },

    async list(userId, query) {
      const where = {userId};
      const [rows, total] = await Promise.all([
        prisma.order.findMany({where, orderBy: {createdAt: 'desc'}, ...pageArgs(query)}),
        prisma.order.count({where}),
      ]);
      return pageOf(await withItems(rows), total, query);
    },

    async get(userId, id) {
      const order = await prisma.order.findFirst({where: {id, userId}});
      if (!order) {
        throw notFound('Order not found.');
      }
      return (await withItems([order]))[0];
    },

    async cancel(userId, id, ip) {
      const order = await prisma.order.findFirst({where: {id, userId}});
      if (!order) {
        throw notFound('Order not found.');
      }
      if (!CANCELLABLE.includes(order.status)) {
        throw conflict('This order can no longer be cancelled.');
      }
      await cancelOrder(order, CANCELLABLE);
      await audit.record({action: 'order.cancelled', userId, ip, metadata: {orderId: id}});
      return service.get(userId, id);
    },

    // ---------------- admin ----------------

    async listAll(query) {
      const where = query.status ? {status: query.status} : {};
      const [rows, total] = await Promise.all([
        prisma.order.findMany({where, orderBy: {createdAt: 'desc'}, ...pageArgs(query)}),
        prisma.order.count({where}),
      ]);
      return pageOf(await withItems(rows), total, query);
    },

    async setStatus(id, status, adminId, ip) {
      const order = await prisma.order.findUnique({where: {id}});
      if (!order) {
        throw notFound('Order not found.');
      }
      if (!NEXT[order.status].includes(status)) {
        throw conflict(`An order that is ${order.status} cannot become ${status}.`);
      }
      if (status === 'cancelled') {
        await cancelOrder(order, [order.status]);
      } else {
        const moved = await prisma.order.updateMany({where: {id, status: order.status}, data: {status}});
        if (moved.count !== 1) {
          throw conflict('The order was just changed. Please look again.');
        }
      }
      await audit.record({action: 'order.status.changed', userId: adminId, ip, metadata: {orderId: id, from: order.status, to: status}});
      return (await withItems([await prisma.order.findUnique({where: {id}})]))[0];
    },
  };
  return service;
}

module.exports = {createOrdersService, OPEN, NEXT};
