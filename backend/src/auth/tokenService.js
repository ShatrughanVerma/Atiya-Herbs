const jwt = require('jsonwebtoken');

const ISSUER = 'atiyaherbs-api';
const AUDIENCE = 'atiyaherbs-app';

// Short-lived access tokens (JWT, 15 minutes). The algorithm is pinned on both sides, so a token cannot be
// forged by switching it to "none" or to a different algorithm.
function createTokenService(config) {
  return {
    signAccessToken(user) {
      return jwt.sign({role: user.role}, config.JWT_ACCESS_SECRET, {
        subject: user.id,
        expiresIn: config.JWT_ACCESS_TTL_SECONDS,
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithm: 'HS256',
      });
    },

    // Returns {sub, role, ...}; throws if the token is forged, expired or for another audience
    verifyAccessToken(token) {
      return jwt.verify(token, config.JWT_ACCESS_SECRET, {issuer: ISSUER, audience: AUDIENCE, algorithms: ['HS256']});
    },
  };
}

module.exports = {createTokenService};
