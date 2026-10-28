const {AccessToken} = require('livekit-server-sdk');

// Creates the short-lived LiveKit access tokens that let a phone join one call room.
// The API secret stays here, on the server; the app only ever receives finished tokens.
function createTokenIssuer(env = process.env) {
  const serverUrl = env.LIVEKIT_URL || '';
  const apiKey = env.LIVEKIT_API_KEY || '';
  const apiSecret = env.LIVEKIT_API_SECRET || '';

  return {
    configured: !!(serverUrl && apiKey && apiSecret),
    serverUrl,
    // A token only works for the room it names, and only for joining it (10 minutes to join)
    async issue({identity, name, room}) {
      const token = new AccessToken(apiKey, apiSecret, {identity, name, ttl: '10m'});
      token.addGrant({roomJoin: true, room, canPublish: true, canSubscribe: true});
      return token.toJwt();
    },
  };
}

module.exports = {createTokenIssuer};
