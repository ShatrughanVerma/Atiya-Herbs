const {conflict, notFound} = require('../common/errors');
const {pageArgs, pageOf} = require('../common/paging');
const {withJsonNulls} = require('../common/json');
const {applyCoupon} = require('./coupons');

const discountPercent = p => (p.mrp > 0 ? Math.round(((p.mrp - p.price) / p.mrp) * 100) : 0);

// What the app sees of a product. `admin` adds the exact stock and the switched-off flag.
const toProduct = (p, concernIds, {admin = false} = {}) => ({
  id: p.id,
  name: p.name,
  category: p.categoryId,
  concerns: concernIds,
  size: p.size,
  price: p.price,
  mrp: p.mrp,
  discountPercent: discountPercent(p),
  rating: p.rating,
  reviews: p.reviewCount,
  inStock: p.stock > 0,
  badge: p.badge,
  bestseller: p.bestseller,
  image: p.images?.[0] ?? null,
  images: p.images,
  description: p.description,
  benefits: Array.isArray(p.benefits) ? p.benefits : [],
  howToUse: p.howToUse,
  ingredients: p.ingredients,
  ...(admin && {stock: p.stock, active: p.active}),
});

const toBanner = b => ({
  id: b.id,
  badge: b.badge,
  title: b.title,
  image: b.image,
  gradient: b.gradient,
  concern: b.concernId,
  category: b.categoryId,
});

const toCoupon = c => ({
  code: c.code,
  percent: c.percent,
  label: c.label,
  minSubtotal: c.minSubtotal,
  maxDiscount: c.maxDiscount,
  expiresAt: c.expiresAt,
  active: c.active,
});

const BY_ORDER = [{sortOrder: 'asc'}, {id: 'asc'}];

function createCatalogService({prisma, audit}) {
  const concernsOf = async productIds => {
    const map = new Map(productIds.map(id => [id, []]));
    if (productIds.length) {
      const links = await prisma.productConcern.findMany({where: {productId: {in: productIds}}});
      links.forEach(link => map.get(link.productId)?.push(link.concernId));
    }
    return map;
  };

  const withConcerns = async (rows, options) => {
    const map = await concernsOf(rows.map(r => r.id));
    return rows.map(row => toProduct(row, map.get(row.id) ?? [], options));
  };

  const requireCategory = async id => {
    if (!(await prisma.category.findUnique({where: {id}}))) {
      throw notFound('That category does not exist.');
    }
  };

  const requireConcerns = async ids => {
    for (const id of ids) {
      if (!(await prisma.concern.findUnique({where: {id}}))) {
        throw notFound(`The concern "${id}" does not exist.`);
      }
    }
  };

  const setConcerns = async (db, productId, ids) => {
    await db.productConcern.deleteMany({where: {productId}});
    if (ids.length) {
      await db.productConcern.createMany({data: [...new Set(ids)].map(concernId => ({productId, concernId}))});
    }
  };

  const record = (action, userId, ip, metadata) => audit.record({action, userId, ip, metadata});

  const service = {
    listCategories: () => prisma.category.findMany({orderBy: BY_ORDER}).then(rows => rows.map(({id, name, icon}) => ({id, name, icon}))),

    listConcerns: () => prisma.concern.findMany({orderBy: BY_ORDER}).then(rows => rows.map(({id, name, icon, tint}) => ({id, name, icon, tint}))),

    async listProducts(query, {includeInactive = false} = {}) {
      const where = {...(!includeInactive && {active: true})};
      if (query.category) {
        where.categoryId = query.category;
      }
      if (query.bestseller) {
        where.bestseller = query.bestseller === 'true';
      }
      if (query.q) {
        where.OR = [{name: {contains: query.q}}, {description: {contains: query.q}}];
      }
      if (query.concern) {
        const links = await prisma.productConcern.findMany({where: {concernId: query.concern}});
        where.id = {in: links.map(link => link.productId)};
      }
      const [rows, total] = await Promise.all([
        prisma.product.findMany({where, orderBy: [{bestseller: 'desc'}, {name: 'asc'}], ...pageArgs(query)}),
        prisma.product.count({where}),
      ]);
      return pageOf(await withConcerns(rows, {admin: includeInactive}), total, query);
    },

    async getProduct(id, {includeInactive = false} = {}) {
      const row = await prisma.product.findUnique({where: {id}});
      if (!row || (!row.active && !includeInactive)) {
        throw notFound('Product not found.');
      }
      return (await withConcerns([row], {admin: includeInactive}))[0];
    },

    listBanners: () =>
      prisma.banner.findMany({where: {active: true}, orderBy: BY_ORDER}).then(rows => rows.map(toBanner)),

    // Tells the app what a coupon would take off this subtotal (the order itself always works it out again)
    async validateCoupon({code, subtotal}) {
      const {coupon, discount} = await applyCoupon(prisma, code, subtotal);
      return {code: coupon.code, label: coupon.label, percent: coupon.percent, discount, total: subtotal - discount};
    },

    // ---------------- admin ----------------

    async createProduct(input, adminId, ip) {
      if (await prisma.product.findUnique({where: {id: input.id}})) {
        throw conflict('A product with this id already exists.');
      }
      await requireCategory(input.categoryId);
      await requireConcerns(input.concernIds);
      const {concernIds, ...fields} = input;
      await prisma.$transaction(async tx => {
        await tx.product.create({data: withJsonNulls(fields)});
        await setConcerns(tx, input.id, concernIds);
      });
      await record('catalog.product.created', adminId, ip, {id: input.id});
      return service.getProduct(input.id, {includeInactive: true});
    },

    async updateProduct(id, changes, adminId, ip) {
      const existing = await prisma.product.findUnique({where: {id}});
      if (!existing) {
        throw notFound('Product not found.');
      }
      const {concernIds, ...fields} = changes;
      if (fields.categoryId) {
        await requireCategory(fields.categoryId);
      }
      if (concernIds) {
        await requireConcerns(concernIds);
      }
      if ((fields.price ?? existing.price) > (fields.mrp ?? existing.mrp)) {
        throw conflict('The price cannot be more than the MRP.');
      }
      await prisma.$transaction(async tx => {
        if (Object.keys(fields).length) {
          await tx.product.update({where: {id}, data: withJsonNulls(fields)});
        }
        if (concernIds) {
          await setConcerns(tx, id, concernIds);
        }
      });
      await record('catalog.product.updated', adminId, ip, {id, fields: Object.keys(changes)});
      return service.getProduct(id, {includeInactive: true});
    },

    // A product that was ever ordered is only switched off (old orders keep pointing at it)
    async deleteProduct(id, adminId, ip) {
      if (!(await prisma.product.findUnique({where: {id}}))) {
        throw notFound('Product not found.');
      }
      if ((await prisma.orderItem.count({where: {productId: id}})) > 0) {
        await prisma.product.update({where: {id}, data: {active: false}});
        await record('catalog.product.deactivated', adminId, ip, {id});
        return {deleted: false, deactivated: true};
      }
      await prisma.productConcern.deleteMany({where: {productId: id}});
      await prisma.product.delete({where: {id}});
      await record('catalog.product.deleted', adminId, ip, {id});
      return {deleted: true, deactivated: false};
    },

    async createCategory(input, adminId, ip) {
      if (await prisma.category.findUnique({where: {id: input.id}})) {
        throw conflict('A category with this id already exists.');
      }
      const row = await prisma.category.create({data: input});
      await record('catalog.category.created', adminId, ip, {id: input.id});
      return {id: row.id, name: row.name, icon: row.icon};
    },

    async updateCategory(id, changes, adminId, ip) {
      if (!(await prisma.category.findUnique({where: {id}}))) {
        throw notFound('Category not found.');
      }
      const row = await prisma.category.update({where: {id}, data: changes});
      await record('catalog.category.updated', adminId, ip, {id});
      return {id: row.id, name: row.name, icon: row.icon};
    },

    async deleteCategory(id, adminId, ip) {
      if (!(await prisma.category.findUnique({where: {id}}))) {
        throw notFound('Category not found.');
      }
      if ((await prisma.product.count({where: {categoryId: id}})) > 0) {
        throw conflict('Move or remove the products in this category first.');
      }
      await prisma.category.delete({where: {id}});
      await record('catalog.category.deleted', adminId, ip, {id});
    },

    async createBanner(input, adminId, ip) {
      const row = await prisma.banner.create({data: input});
      await record('catalog.banner.created', adminId, ip, {id: row.id});
      return toBanner(row);
    },

    async updateBanner(id, changes, adminId, ip) {
      if (!(await prisma.banner.findUnique({where: {id}}))) {
        throw notFound('Banner not found.');
      }
      const row = await prisma.banner.update({where: {id}, data: changes});
      await record('catalog.banner.updated', adminId, ip, {id});
      return toBanner(row);
    },

    async deleteBanner(id, adminId, ip) {
      if (!(await prisma.banner.findUnique({where: {id}}))) {
        throw notFound('Banner not found.');
      }
      await prisma.banner.delete({where: {id}});
      await record('catalog.banner.deleted', adminId, ip, {id});
    },

    listCoupons: () => prisma.coupon.findMany({orderBy: {code: 'asc'}}).then(rows => rows.map(toCoupon)),

    async createCoupon(input, adminId, ip) {
      if (await prisma.coupon.findUnique({where: {code: input.code}})) {
        throw conflict('A coupon with this code already exists.');
      }
      const {expiresAt, ...rest} = input;
      const row = await prisma.coupon.create({data: {...rest, ...(expiresAt !== undefined && {expiresAt: expiresAt && new Date(expiresAt)})}});
      await record('catalog.coupon.created', adminId, ip, {code: row.code});
      return toCoupon(row);
    },

    async updateCoupon(code, changes, adminId, ip) {
      const key = String(code).toUpperCase();
      if (!(await prisma.coupon.findUnique({where: {code: key}}))) {
        throw notFound('Coupon not found.');
      }
      const {expiresAt, ...rest} = changes;
      const row = await prisma.coupon.update({
        where: {code: key},
        data: {...rest, ...(expiresAt !== undefined && {expiresAt: expiresAt && new Date(expiresAt)})},
      });
      await record('catalog.coupon.updated', adminId, ip, {code: key});
      return toCoupon(row);
    },

    async deleteCoupon(code, adminId, ip) {
      const key = String(code).toUpperCase();
      if (!(await prisma.coupon.findUnique({where: {code: key}}))) {
        throw notFound('Coupon not found.');
      }
      await prisma.coupon.delete({where: {code: key}});
      await record('catalog.coupon.deleted', adminId, ip, {code: key});
    },
  };
  return service;
}

module.exports = {createCatalogService, toProduct};
