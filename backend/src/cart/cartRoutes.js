const express = require('express');
const {badRequest} = require('../common/errors');
const {createLimiter} = require('../common/rateLimit');
const {slug} = require('../common/schemas');
const {validateBody} = require('../common/validate');
const {mergeSchema, setQuantitySchema} = require('./schemas');

const checkProduct = (req, res, next) =>
  slug.safeParse(req.params.productId).success ? next() : next(badRequest('The product id is not valid.'));

// The server-side cart of the logged-in person (there is no way to name another user here).
function createCartRoutes({cart, requireAuth}) {
  const router = express.Router();
  router.use(requireAuth, createLimiter({limit: 120}));

  router.get('/', async (req, res) => res.json(await cart.view(req.user.id)));
  router.put('/items/:productId', checkProduct, validateBody(setQuantitySchema), async (req, res) => {
    res.json(await cart.setQuantity(req.user.id, req.params.productId, req.body.quantity));
  });
  router.delete('/items/:productId', checkProduct, async (req, res) => {
    res.json(await cart.remove(req.user.id, req.params.productId));
  });
  router.delete('/', async (req, res) => res.json(await cart.clear(req.user.id)));
  router.post('/merge', validateBody(mergeSchema), async (req, res) => {
    res.json(await cart.merge(req.user.id, req.body.items));
  });

  return router;
}

module.exports = {createCartRoutes};
