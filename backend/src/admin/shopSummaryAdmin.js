const {DAY_MS, istDayOf, istStartOfDay} = require('../consultation/consultationService');

// The shop numbers on the dashboard. "Today" is the Indian day. Sales are the totals of orders that were not
// cancelled (cash on delivery, so this is the value ordered, not money already collected).
const LOW_STOCK = 5;
const LOW_STOCK_SHOWN = 10;
const NOT_CANCELLED = ['placed', 'confirmed', 'shipped', 'delivered'];

function createShopSummaryAdmin({prisma, now = () => new Date()}) {
  return {
    async summary() {
      const todayStart = istStartOfDay(istDayOf(now()));
      const today = {status: {in: NOT_CANCELLED}, createdAt: {gte: todayStart}};
      // today and the 29 days before it
      const month = {status: {in: NOT_CANCELLED}, createdAt: {gte: new Date(todayStart.getTime() - 29 * DAY_MS)}};
      const low = {active: true, stock: {lte: LOW_STOCK}};
      const [ordersToday, salesToday, sales30Days, toConfirm, toShip, toDeliver, lowStockCount, lowStock] = await Promise.all([
        prisma.order.count({where: today}),
        prisma.order.aggregate({where: today, _sum: {total: true}}),
        prisma.order.aggregate({where: month, _sum: {total: true}}),
        prisma.order.count({where: {status: 'placed'}}),
        prisma.order.count({where: {status: 'confirmed'}}),
        prisma.order.count({where: {status: 'shipped'}}),
        prisma.product.count({where: low}),
        prisma.product.findMany({where: low, orderBy: [{stock: 'asc'}, {name: 'asc'}], take: LOW_STOCK_SHOWN}),
      ]);
      return {
        ordersToday,
        salesToday: salesToday._sum.total ?? 0,
        sales30Days: sales30Days._sum.total ?? 0,
        toConfirm,
        toShip,
        toDeliver,
        lowStockCount,
        lowStock: lowStock.map(p => ({id: p.id, name: p.name, stock: p.stock})),
      };
    },
  };
}

module.exports = {createShopSummaryAdmin, LOW_STOCK};
