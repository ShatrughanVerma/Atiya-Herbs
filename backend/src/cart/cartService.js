const {conflict, notFound} = require('../common/errors');
const {MAX_LINES, MAX_QTY} = require('./schemas');

// The cart of a logged-in person. Only product ids and quantities are stored: price, stock and "is it still on
// sale" are read from the product every time, so an old cart can never hold a stale price.
//
// Every line shows:  quantity     how many will be ordered (never more than the stock or MAX_QTY)
//                    requested    how many the person asked for (only when it was cut down)
//                    issue        null | 'limited' (less stock than asked) | 'out-of-stock' | 'unavailable' (removed from sale)
// Lines with an issue of 'out-of-stock' or 'unavailable' are not counted in the totals and cannot be ordered.

const toLine = (item, product) => {
  if (!product || !product.active) {
    return {
      productId: item.productId,
      name: product?.name ?? 'This product',
      image: null,
      size: null,
      price: 0,
      mrp: 0,
      quantity: 0,
      requested: item.quantity,
      available: 0,
      issue: 'unavailable',
      lineTotal: 0,
      lineSavings: 0,
    };
  }
  const base = {
    productId: product.id,
    name: product.name,
    image: product.images?.[0] ?? null,
    size: product.size,
    price: product.price,
    mrp: product.mrp,
    available: product.stock,
  };
  if (product.stock < 1) {
    return {...base, quantity: 0, requested: item.quantity, issue: 'out-of-stock', lineTotal: 0, lineSavings: 0};
  }
  const quantity = Math.min(item.quantity, product.stock, MAX_QTY);
  return {
    ...base,
    quantity,
    ...(quantity < item.quantity && {requested: item.quantity}),
    issue: quantity < item.quantity ? 'limited' : null,
    lineTotal: product.price * quantity,
    lineSavings: Math.max(0, product.mrp - product.price) * quantity,
  };
};

const summarise = lines => ({
  items: lines,
  itemCount: lines.reduce((sum, line) => sum + line.quantity, 0),
  subtotal: lines.reduce((sum, line) => sum + line.lineTotal, 0),
  savings: lines.reduce((sum, line) => sum + line.lineSavings, 0),
  hasIssues: lines.some(line => line.issue !== null),
});

function createCartService({prisma}) {
  const view = async (userId, db = prisma) => {
    const rows = await db.cartItem.findMany({where: {userId}, orderBy: {createdAt: 'asc'}});
    const products = rows.length ? await db.product.findMany({where: {id: {in: rows.map(r => r.productId)}}}) : [];
    const byId = new Map(products.map(p => [p.id, p]));
    return summarise(rows.map(row => toLine(row, byId.get(row.productId))));
  };

  // Sets one line to an exact quantity (creates it when missing). Runs on `db` so merge can use a transaction.
  const writeLine = async (db, userId, productId, quantity) => {
    const existing = await db.cartItem.findFirst({where: {userId, productId}});
    if (existing) {
      await db.cartItem.update({where: {id: existing.id}, data: {quantity}});
      return;
    }
    try {
      await db.cartItem.create({data: {userId, productId, quantity}});
    } catch (error) {
      if (error.code !== 'P2002') {
        throw error;
      }
      // two requests created the same line at once: the other one won, so update its row
      await db.cartItem.updateMany({where: {userId, productId}, data: {quantity}});
    }
  };

  const countLines = (db, userId) => db.cartItem.count({where: {userId}});

  return {
    view,

    async setQuantity(userId, productId, quantity) {
      if (quantity === 0) {
        await prisma.cartItem.deleteMany({where: {userId, productId}});
        return view(userId);
      }
      const product = await prisma.product.findUnique({where: {id: productId}});
      if (!product || !product.active) {
        throw notFound('This product is not available.');
      }
      if (product.stock < 1) {
        throw conflict(`${product.name} is out of stock.`);
      }
      const existing = await prisma.cartItem.findFirst({where: {userId, productId}});
      if (!existing && (await countLines(prisma, userId)) >= MAX_LINES) {
        throw conflict('Your cart is full. Please remove something first.');
      }
      await writeLine(prisma, userId, productId, Math.min(quantity, product.stock, MAX_QTY));
      return view(userId);
    },

    async remove(userId, productId) {
      await prisma.cartItem.deleteMany({where: {userId, productId}});
      return view(userId);
    },

    async clear(userId) {
      await prisma.cartItem.deleteMany({where: {userId}});
      return view(userId);
    },

    // A guest's local cart is added to the cart on the server (once, right after login). Unknown, switched-off and
    // sold-out products are skipped; amounts are added up and cut to what is allowed.
    async merge(userId, incoming) {
      const wanted = new Map();
      for (const {productId, quantity} of incoming) {
        wanted.set(productId, Math.min(MAX_QTY, (wanted.get(productId) ?? 0) + quantity));
      }
      await prisma.$transaction(async tx => {
        let lines = await countLines(tx, userId);
        for (const [productId, quantity] of wanted) {
          const product = await tx.product.findUnique({where: {id: productId}});
          if (!product || !product.active || product.stock < 1) {
            continue;
          }
          const existing = await tx.cartItem.findFirst({where: {userId, productId}});
          if (!existing && lines >= MAX_LINES) {
            continue;
          }
          const total = Math.min((existing?.quantity ?? 0) + quantity, product.stock, MAX_QTY);
          await writeLine(tx, userId, productId, total);
          if (!existing) {
            lines += 1;
          }
        }
      });
      return view(userId);
    },
  };
}

module.exports = {createCartService};
