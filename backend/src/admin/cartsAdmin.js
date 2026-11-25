const {pageOf} = require('../common/paging');
const {formatPatientCode} = require('../common/patientCode');

// Carts that still have something in them: what people put in but have not ordered (ordering empties the cart).
// Read only. Prices are today's prices of the products, as everywhere else for a cart.
function createCartsAdmin({prisma}) {
  return {
    async list(query) {
      const rows = await prisma.cartItem.findMany({orderBy: {updatedAt: 'desc'}});
      // one cart per person, the most recently changed first
      const carts = new Map();
      for (const row of rows) {
        if (!carts.has(row.userId)) {
          carts.set(row.userId, []);
        }
        carts.get(row.userId).push(row);
      }
      const page = [...carts.entries()].slice((query.page - 1) * query.pageSize, query.page * query.pageSize);

      const userIds = page.map(([userId]) => userId);
      const productIds = [...new Set(page.flatMap(([, items]) => items.map(i => i.productId)))];
      const [users, products] = await Promise.all([
        prisma.user.findMany({where: {id: {in: userIds}}}),
        prisma.product.findMany({where: {id: {in: productIds}}}),
      ]);
      const userById = new Map(users.map(u => [u.id, u]));
      const productById = new Map(products.map(p => [p.id, p]));

      const items = page.map(([userId, lines]) => {
        const user = userById.get(userId);
        const shown = lines.map(line => {
          const product = productById.get(line.productId);
          return {
            productId: line.productId,
            name: product?.name ?? line.productId,
            image: product?.images?.[0] ?? null,
            price: product?.price ?? 0,
            quantity: line.quantity,
            available: Boolean(product?.active && product.stock > 0),
          };
        });
        return {
          customer: user ? {id: user.id, patientCode: formatPatientCode(user.patientNo), name: user.name, mobile: user.mobile} : null,
          items: shown,
          // what cannot be bought today is not counted
          total: shown.reduce((sum, i) => sum + (i.available ? i.price * i.quantity : 0), 0),
          updatedAt: lines[0].updatedAt,
        };
      });
      return pageOf(items, carts.size, query);
    },
  };
}

module.exports = {createCartsAdmin};
