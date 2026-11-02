const {forbidden, unauthorized} = require('../common/errors');
const {ROLES} = require('./roles');

// requireAuth: put on any route that needs a logged-in user. The user id comes only from the signed token,
// never from anything the client sends in the body or URL. Sets req.user = {id, role}.
// requireRole('doctor', 'admin'): use after requireAuth to limit a route to some roles.
function createAuthMiddleware({tokens}) {
  const requireAuth = (req, res, next) => {
    const [scheme, token] = (req.headers.authorization ?? '').split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      return next(unauthorized('Please log in.'));
    }
    try {
      const payload = tokens.verifyAccessToken(token);
      if (!payload.sub || !ROLES.includes(payload.role)) {
        throw new Error('bad claims');
      }
      req.user = {id: payload.sub, role: payload.role};
      return next();
    } catch {
      return next(unauthorized('Your session has expired. Please log in again.'));
    }
  };

  const requireRole =
    (...allowed) =>
    (req, res, next) =>
      req.user && allowed.includes(req.user.role) ? next() : next(forbidden('You do not have permission to do this.'));

  return {requireAuth, requireRole};
}

module.exports = {createAuthMiddleware};
