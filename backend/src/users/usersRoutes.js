const express = require('express');
const {validateBody} = require('../common/validate');
const {createLimiter} = require('../common/rateLimit');
const {changePasswordSchema} = require('../auth/schemas');
const {updateProfileSchema} = require('./schemas');

// "me" always means the user in the verified token. There is no route that takes a user id from the client,
// so one user can never read or change another user's data.
function createUsersRoutes({users, auth, requireAuth}) {
  const router = express.Router();
  router.use(requireAuth);

  router.get('/me', async (req, res) => {
    res.json(await users.getById(req.user.id));
  });

  router.patch('/me', validateBody(updateProfileSchema), async (req, res) => {
    res.json(await users.updateProfile(req.user.id, req.body, req.ip ?? null));
  });

  // Returns a fresh session: every other login of this account ends, this phone stays logged in
  router.post('/me/password', createLimiter({limit: 10, windowSeconds: 600}), validateBody(changePasswordSchema), async (req, res) => {
    res.status(200).json(await auth.changePassword(req.user.id, req.body, {ip: req.ip ?? null, userAgent: req.headers['user-agent'] ?? null}));
  });

  router.delete('/me', async (req, res) => {
    await users.deleteAccount(req.user.id, req.ip ?? null);
    res.status(204).end();
  });

  return router;
}

module.exports = {createUsersRoutes};
