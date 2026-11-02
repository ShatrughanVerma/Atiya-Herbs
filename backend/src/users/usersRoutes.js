const express = require('express');
const {validateBody} = require('../common/validate');
const {updateProfileSchema} = require('./schemas');

// "me" always means the user in the verified token. There is no route that takes a user id from the client,
// so one user can never read or change another user's data.
function createUsersRoutes({users, requireAuth}) {
  const router = express.Router();
  router.use(requireAuth);

  router.get('/me', async (req, res) => {
    res.json(await users.getById(req.user.id));
  });

  router.patch('/me', validateBody(updateProfileSchema), async (req, res) => {
    res.json(await users.updateProfile(req.user.id, req.body, req.ip ?? null));
  });

  return router;
}

module.exports = {createUsersRoutes};
