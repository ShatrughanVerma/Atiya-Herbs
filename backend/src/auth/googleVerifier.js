const {createPublicKey} = require('node:crypto');
const jwt = require('jsonwebtoken');
const {unauthorized, unavailable} = require('../common/errors');

// Checks the "ID token" the app gets from Google Sign-In, and says who the person is.
//  - The token is signed by Google (RS256). The public keys come from Google's address and are kept for as long as
//    Google says (Cache-Control max-age), so one request does not call Google every time.
//  - It must be made for THIS app (audience = one of GOOGLE_CLIENT_IDS), come from Google (issuer), not be expired,
//    and Google must have verified the email.
// Nothing from the token is logged. Returns {email, name, googleId}.
const CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const DEFAULT_KEEP_SECONDS = 3600;

function createGoogleVerifier({config, fetchImpl = globalThis.fetch, now = () => Date.now()}) {
  const audiences = config.googleClientIds;
  let keys = null; // {byId: Map(kid -> public key), expiresAt}

  async function loadKeys() {
    if (keys && keys.expiresAt > now()) {
      return keys.byId;
    }
    let response;
    try {
      response = await fetchImpl(CERTS_URL, {signal: AbortSignal.timeout(8_000)});
    } catch {
      throw unavailable('Google sign-in is not available right now. Please try again in a moment.');
    }
    if (!response.ok) {
      throw unavailable('Google sign-in is not available right now. Please try again in a moment.');
    }
    const body = await response.json();
    const byId = new Map(body.keys.map(jwk => [jwk.kid, createPublicKey({key: jwk, format: 'jwk'})]));
    const maxAge = /max-age=(\d+)/.exec(response.headers?.get?.('cache-control') ?? '');
    keys = {byId, expiresAt: now() + (maxAge ? Number(maxAge[1]) : DEFAULT_KEEP_SECONDS) * 1000};
    return byId;
  }

  return {
    available: audiences.length > 0,

    async verify(idToken) {
      const rejected = () => unauthorized('Google sign-in failed. Please try again.');
      const decoded = jwt.decode(idToken, {complete: true});
      if (!decoded?.header?.kid || decoded.header.alg !== 'RS256') {
        throw rejected();
      }
      let key = (await loadKeys()).get(decoded.header.kid);
      if (!key) {
        keys = null; // Google may have rotated its keys: look once more
        key = (await loadKeys()).get(decoded.header.kid);
      }
      if (!key) {
        throw rejected();
      }
      let claims;
      try {
        claims = jwt.verify(idToken, key, {algorithms: ['RS256'], audience: audiences, issuer: ISSUERS});
      } catch {
        throw rejected();
      }
      if (claims.email_verified !== true && claims.email_verified !== 'true') {
        throw unauthorized('Your Google email is not verified.');
      }
      if (typeof claims.email !== 'string' || !claims.email) {
        throw rejected();
      }
      return {email: claims.email.toLowerCase(), name: (claims.name || '').trim().slice(0, 100), googleId: claims.sub};
    },
  };
}

module.exports = {createGoogleVerifier};
