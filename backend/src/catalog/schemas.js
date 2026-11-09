const {z} = require('zod');
const {pagination, safeText, slug} = require('../common/schemas');

// ---- public queries ----

const productQuerySchema = z
  .object({
    category: slug.optional(),
    concern: slug.optional(),
    q: z.string().trim().min(1).max(60).optional(),
    bestseller: z.enum(['true', 'false']).optional(),
    ...pagination,
  })
  .strict();

const couponValidateSchema = z
  .object({
    code: z.string().trim().min(2).max(32),
    subtotal: z.number().int().min(1).max(10_000_000),
  })
  .strict();

// ---- admin bodies (every schema is strict: unknown fields are refused) ----

// An image is an https link (or a key of an image bundled with the app, for banners)
const imageUrl = z
  .string()
  .max(500)
  .regex(/^https:\/\/[^\s<>"']+$/, 'Use a full https:// link.');

const money = z.number().int().min(0).max(10_000_000);

const productFields = {
  name: safeText(2, 150),
  categoryId: slug,
  concernIds: z.array(slug).max(10).default([]),
  price: money,
  mrp: money,
  stock: z.number().int().min(0).max(1_000_000),
  images: z.array(imageUrl).min(1).max(10),
  description: z.string().trim().max(5000),
  benefits: z.array(safeText(1, 200)).max(12).nullable().optional(),
  howToUse: z.string().trim().max(2000).nullable().optional(),
  ingredients: z.string().trim().max(2000).nullable().optional(),
  size: safeText(1, 60).nullable().optional(),
  badge: safeText(1, 40).nullable().optional(),
  bestseller: z.boolean().optional(),
  active: z.boolean().optional(),
};

const priceOrder = {message: 'The price cannot be more than the MRP.', path: ['price']};

const createProductSchema = z
  .object({id: slug, ...productFields})
  .strict()
  .refine(p => p.price <= p.mrp, priceOrder);

// Every field may be left out; at least one must be sent
const updateProductSchema = z
  .object(Object.fromEntries(Object.entries(productFields).map(([key, rule]) => [key, key === 'concernIds' ? z.array(slug).max(10).optional() : rule.optional()])))
  .strict()
  .refine(p => Object.keys(p).length > 0, {message: 'Send at least one field to change.'})
  .refine(p => p.price === undefined || p.mrp === undefined || p.price <= p.mrp, priceOrder);

const categoryFields = {name: safeText(2, 100), icon: z.string().trim().min(2).max(64), sortOrder: z.number().int().min(0).max(1000).optional()};
const createCategorySchema = z.object({id: slug, ...categoryFields}).strict();
const updateCategorySchema = z
  .object({name: categoryFields.name.optional(), icon: categoryFields.icon.optional(), sortOrder: categoryFields.sortOrder})
  .strict()
  .refine(c => Object.keys(c).length > 0, {message: 'Send at least one field to change.'});

const bannerFields = {
  badge: safeText(1, 60).nullable().optional(),
  title: safeText(2, 150),
  image: z.union([imageUrl, z.string().regex(/^[a-z0-9_-]{1,64}$/, 'Use a full https:// link or an image key.')]),
  gradient: z.string().trim().max(200).regex(/^[a-zA-Z0-9#%(),.\s-]+$/, 'This has characters that are not allowed.').nullable().optional(),
  concernId: slug.nullable().optional(),
  categoryId: slug.nullable().optional(),
  sortOrder: z.number().int().min(0).max(1000).optional(),
  active: z.boolean().optional(),
};
const createBannerSchema = z.object(bannerFields).strict();
const updateBannerSchema = z
  .object(Object.fromEntries(Object.entries(bannerFields).map(([key, rule]) => [key, key === 'badge' ? rule : rule.optional()])))
  .strict()
  .refine(b => Object.keys(b).length > 0, {message: 'Send at least one field to change.'});

const couponFields = {
  label: safeText(2, 120),
  percent: z.number().int().min(1).max(100),
  minSubtotal: money.optional(),
  maxDiscount: money.nullable().optional(),
  expiresAt: z.iso.datetime().nullable().optional(),
  active: z.boolean().optional(),
};
const createCouponSchema = z
  .object({code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{3,32}$/, 'Use 3-32 letters and numbers.'), ...couponFields})
  .strict();
const updateCouponSchema = z
  .object(Object.fromEntries(Object.entries(couponFields).map(([key, rule]) => [key, rule.optional()])))
  .strict()
  .refine(c => Object.keys(c).length > 0, {message: 'Send at least one field to change.'});

module.exports = {
  productQuerySchema,
  couponValidateSchema,
  createProductSchema,
  updateProductSchema,
  createCategorySchema,
  updateCategorySchema,
  createBannerSchema,
  updateBannerSchema,
  createCouponSchema,
  updateCouponSchema,
};
