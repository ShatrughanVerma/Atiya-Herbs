const express = require('express');
const {badRequest} = require('../common/errors');
const {createLimiter} = require('../common/rateLimit');
const {idParam} = require('../common/schemas');
const {validateBody, validateQuery} = require('../common/validate');
const {createOrderSchema, listOrdersQuerySchema, adminListQuerySchema, updateStatusSchema} = require('./schemas');

const checkId = (req, res, next) => (idParam.safeParse(req.params.id).success ? next() : next(badRequest('The id is not valid.')));

// Orders of the logged-in person, and (admin only) every order under /admin/orders.
function createOrdersRoutes({orders, requireAuth, requireRole}) {
  const router = express.Router();

  router.post('/orders', requireAuth, createLimiter({limit: 10}), validateBody(createOrderSchema), async (req, res) => {
    res.status(201).json(await orders.create(req.user.id, req.body, req.ip ?? null));
  });
  router.get('/orders', requireAuth, validateQuery(listOrdersQuerySchema), async (req, res) => {
    res.json(await orders.list(req.user.id, req.parsedQuery));
  });
  router.get('/orders/:id', requireAuth, checkId, async (req, res) => res.json(await orders.get(req.user.id, req.params.id)));
  router.post('/orders/:id/cancel', requireAuth, checkId, async (req, res) => {
    res.json(await orders.cancel(req.user.id, req.params.id, req.ip ?? null));
  });

  router.get('/admin/orders', requireAuth, requireRole('admin'), validateQuery(adminListQuerySchema), async (req, res) => {
    res.json(await orders.listAll(req.parsedQuery));
  });
  router.patch('/admin/orders/:id/status', requireAuth, requireRole('admin'), checkId, validateBody(updateStatusSchema), async (req, res) => {
    res.json(await orders.setStatus(req.params.id, req.body.status, req.user.id, req.ip ?? null));
  });

  return router;
}

module.exports = {createOrdersRoutes};
