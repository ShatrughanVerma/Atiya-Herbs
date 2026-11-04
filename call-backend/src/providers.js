const {RtcRole, RtcTokenBuilder} = require('agora-token');
const {createTokenIssuer} = require('./livekitToken');

// Two calling providers can be set up side by side: LiveKit (the default) and Agora. CALL_PROVIDER says which one
// new calls use (livekit or agora). The choice is made once when a call starts, so both people are always on the
// same provider, and a call already in progress is never moved. If Agora is chosen but its settings are missing,
// calls keep using LiveKit rather than failing.
//
// issue() returns what the app needs to join, and the app picks its calling code from `provider`:
//   livekit: {provider, serverUrl, token}
//   agora:   {provider, appId, channel, account, token}

// An Agora token has to stay valid for the whole call (the person is removed when it runs out), unlike LiveKit's
// which only has to last until the person has joined
function createAgoraIssuer(env = process.env) {
  const appId = (env.AGORA_APP_ID || '').trim();
  const certificate = (env.AGORA_APP_CERTIFICATE || '').trim();
  const lifetimeSeconds = Math.round((Number(env.AGORA_TOKEN_HOURS) || 4) * 3600);

  return {
    configured: !!(appId && certificate),
    async issue({identity, room}) {
      const token = RtcTokenBuilder.buildTokenWithUserAccount(
        appId,
        certificate,
        room,
        identity,
        RtcRole.PUBLISHER,
        lifetimeSeconds,
        lifetimeSeconds,
      );
      return {provider: 'agora', appId, channel: room, account: identity, token};
    },
  };
}

function createProviders(env = process.env) {
  const livekit = createTokenIssuer(env);
  const agora = createAgoraIssuer(env);
  const wantsAgora = (env.CALL_PROVIDER || '').trim().toLowerCase() === 'agora';
  const provider = wantsAgora && agora.configured ? 'agora' : 'livekit';

  return {
    // the provider new calls will use
    provider,
    // whether new calls can be started at all
    configured: provider === 'agora' ? agora.configured : livekit.configured,
    livekitConfigured: livekit.configured,
    agoraConfigured: agora.configured,
    agora, // used on its own by the call links (invites.js)
    async issue(name, {identity, name: displayName, room}) {
      if (name === 'agora') {
        return agora.issue({identity, room});
      }
      return {provider: 'livekit', serverUrl: livekit.serverUrl, token: await livekit.issue({identity, name: displayName, room})};
    },
  };
}

module.exports = {createProviders};
