const express = require('express');
const {badRequest} = require('../common/errors');
const {idParam} = require('../common/schemas');
const {validateBody} = require('../common/validate');
const {createAddressSchema, updateAddressSchema} = require('./schemas');

const checkId = (req, res, next) => (idParam.safeParse(req.params.id).success ? next() : next(badRequest('The id is not valid.')));

// Delivery addresses of the logged-in person (there is no way to name another user here).
function createAddressesRoutes({addresses, requireAuth}) {
  const router = express.Router();
  router.use(requireAuth);

  router.get('/', async (req, res) => res.json(await addresses.list(req.user.id)));
  router.post('/', validateBody(createAddressSchema), async (req, res) => {
    res.status(201).json(await addresses.create(req.user.id, req.body));
  });
  router.get('/:id', checkId, async (req, res) => res.json(await addresses.get(req.user.id, req.params.id)));
  router.patch('/:id', checkId, validateBody(updateAddressSchema), async (req, res) => {
    res.json(await addresses.update(req.user.id, req.params.id, req.body));
  });
  router.post('/:id/default', checkId, async (req, res) => res.json(await addresses.setDefault(req.user.id, req.params.id)));
  router.delete('/:id', checkId, async (req, res) => {
    await addresses.remove(req.user.id, req.params.id);
    res.status(204).end();
  });

  return router;
}

module.exports = {createAddressesRoutes};
