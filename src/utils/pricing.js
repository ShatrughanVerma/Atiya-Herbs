// How many percent a product is cheaper than its printed price (MRP)
export const discountPercent = product =>
  product && product.mrp > 0
    ? Math.round(((product.mrp - product.price) / product.mrp) * 100)
    : 0;
