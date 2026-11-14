const jwt = require('jsonwebtoken');

const ISSUER = 'atiyaherbs-api';
const AUDIENCE = 'atiyaherbs-app';
// A different audience, so a login-code token can never be used as an access token (and the other way round)
const LOGIN_OTP_AUDIENCE = 'atiyaherbs-login-otp';
const LOGIN_OTP_TTL_SECONDS = 600;

// Short-lived access tokens (JWT, 15 minutes). The algorithm is pinned on both sides, so a token cannot be
// forged by switching it to "none" or to a different algorithm.
function createTokenService(config) {
  return {
    signAccessToken(user) {
      return jwt.sign({roleId: user.roleId}, config.JWT_ACCESS_SECRET, {
        subject: user.id,
        expiresIn: config.JWT_ACCESS_TTL_SECONDS,
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithm: 'HS256',
      });
    },

    // Proof that the password was right, waiting for the code sent by SMS. Carries only the user id.
    signLoginChallenge(user) {
      return jwt.sign({purpose: 'login-otp'}, config.JWT_ACCESS_SECRET, {
        subject: user.id,
        expiresIn: LOGIN_OTP_TTL_SECONDS,
        issuer: ISSUER,
        audience: LOGIN_OTP_AUDIENCE,
        algorithm: 'HS256',
      });
    },

    // Returns {sub}; throws if forged, expired or not a login-code token
    verifyLoginChallenge(token) {
      const claims = jwt.verify(token, config.JWT_ACCESS_SECRET, {issuer: ISSUER, audience: LOGIN_OTP_AUDIENCE, algorithms: ['HS256']});
      if (claims.purpose !== 'login-otp') {
        throw new Error('wrong token');
      }
      return claims;
    },

    // Returns {sub, roleId, ...}; throws if the token is forged, expired or for another audience
    verifyAccessToken(token) {
      return jwt.verify(token, config.JWT_ACCESS_SECRET, {issuer: ISSUER, audience: AUDIENCE, algorithms: ['HS256']});
    },
  };
}

module.exports = {createTokenService};
