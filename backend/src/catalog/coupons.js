const {badRequest} = require('../common/errors');

// One answer for every way a coupon can fail (unknown, switched off, expired, order too small), so nobody can
// probe which codes exist.
const INVALID_COUPON = 'This coupon code is not valid.';

// The discount in whole rupees for this subtotal, or null when the coupon cannot be used.
const discountFor = (coupon, subtotal, now = new Date()) => {
  if (!coupon || !coupon.active) {
    return null;
  }
  if (coupon.expiresAt && coupon.expiresAt <= now) {
    return null;
  }
  if (subtotal < (coupon.minSubtotal ?? 0)) {
    return null;
  }
  const discount = Math.round((subtotal * coupon.percent) / 100);
  return coupon.maxDiscount !== null && coupon.maxDiscount !== undefined ? Math.min(discount, coupon.maxDiscount) : discount;
};

// Looks the coupon up in the database (db can be the Prisma client or a transaction). Throws a 400 if it cannot be used.
async function applyCoupon(db, rawCode, subtotal) {
  const code = String(rawCode ?? '').trim().toUpperCase();
  const coupon = code ? await db.coupon.findUnique({where: {code}}) : null;
  const discount = discountFor(coupon, subtotal);
  if (discount === null) {
    throw badRequest(INVALID_COUPON);
  }
  return {coupon, discount};
}

module.exports = {applyCoupon, discountFor, INVALID_COUPON};
