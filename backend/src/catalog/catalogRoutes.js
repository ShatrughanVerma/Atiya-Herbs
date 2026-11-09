const express = require('express');
const {createLimiter} = require('../common/rateLimit');
const {idParam} = require('../common/schemas');
const {badRequest} = require('../common/errors');
const {validateBody, validateQuery} = require('../common/validate');
const {
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
} = require('./schemas');

const ip = req => req.ip ?? null;

// A bad id in the URL is a plain 400 (never echoed back)
const checkId = (req, res, next) => (idParam.safeParse(req.params.id).success ? next() : next(badRequest('The id is not valid.')));

// The shop: public reads for everyone, changes for admins only.
function createCatalogRoutes({catalog, requireAuth, requireRole}) {
  const router = express.Router();
  const admin = [requireAuth, requireRole('admin')];

  // ---- public ----
  router.get('/categories', async (req, res) => res.json(await catalog.listCategories()));
  router.get('/concerns', async (req, res) => res.json(await catalog.listConcerns()));
  router.get('/banners', async (req, res) => res.json(await catalog.listBanners()));

  router.get('/products', validateQuery(productQuerySchema), async (req, res) => {
    res.json(await catalog.listProducts(req.parsedQuery));
  });
  router.get('/products/:id', checkId, async (req, res) => res.json(await catalog.getProduct(req.params.id)));

  // Public, but limited per IP, so nobody can guess coupon codes quickly
  router.post('/coupons/validate', createLimiter({limit: 20}), validateBody(couponValidateSchema), async (req, res) => {
    res.json(await catalog.validateCoupon(req.body));
  });

  // ---- admin ----
  router.get('/admin/products', ...admin, validateQuery(productQuerySchema), async (req, res) => {
    res.json(await catalog.listProducts(req.parsedQuery, {includeInactive: true}));
  });
  router.post('/products', ...admin, validateBody(createProductSchema), async (req, res) => {
    res.status(201).json(await catalog.createProduct(req.body, req.user.id, ip(req)));
  });
  router.patch('/products/:id', ...admin, checkId, validateBody(updateProductSchema), async (req, res) => {
    res.json(await catalog.updateProduct(req.params.id, req.body, req.user.id, ip(req)));
  });
  router.delete('/products/:id', ...admin, checkId, async (req, res) => {
    res.json(await catalog.deleteProduct(req.params.id, req.user.id, ip(req)));
  });

  router.post('/categories', ...admin, validateBody(createCategorySchema), async (req, res) => {
    res.status(201).json(await catalog.createCategory(req.body, req.user.id, ip(req)));
  });
  router.patch('/categories/:id', ...admin, checkId, validateBody(updateCategorySchema), async (req, res) => {
    res.json(await catalog.updateCategory(req.params.id, req.body, req.user.id, ip(req)));
  });
  router.delete('/categories/:id', ...admin, checkId, async (req, res) => {
    await catalog.deleteCategory(req.params.id, req.user.id, ip(req));
    res.status(204).end();
  });

  router.post('/banners', ...admin, validateBody(createBannerSchema), async (req, res) => {
    res.status(201).json(await catalog.createBanner(req.body, req.user.id, ip(req)));
  });
  router.patch('/banners/:id', ...admin, checkId, validateBody(updateBannerSchema), async (req, res) => {
    res.json(await catalog.updateBanner(req.params.id, req.body, req.user.id, ip(req)));
  });
  router.delete('/banners/:id', ...admin, checkId, async (req, res) => {
    await catalog.deleteBanner(req.params.id, req.user.id, ip(req));
    res.status(204).end();
  });

  router.get('/coupons', ...admin, async (req, res) => res.json(await catalog.listCoupons()));
  router.post('/coupons', ...admin, validateBody(createCouponSchema), async (req, res) => {
    res.status(201).json(await catalog.createCoupon(req.body, req.user.id, ip(req)));
  });
  router.patch('/coupons/:id', ...admin, checkId, validateBody(updateCouponSchema), async (req, res) => {
    res.json(await catalog.updateCoupon(req.params.id, req.body, req.user.id, ip(req)));
  });
  router.delete('/coupons/:id', ...admin, checkId, async (req, res) => {
    await catalog.deleteCoupon(req.params.id, req.user.id, ip(req));
    res.status(204).end();
  });

  return router;
}

module.exports = {createCatalogRoutes};
