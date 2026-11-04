const {RoomServiceClient} = require('livekit-server-sdk');
const {RtcRole, RtcTokenBuilder} = require('agora-token');
const {createTokenIssuer} = require('./livekitToken');

// Two calling providers can be set up side by side: LiveKit (the default) and Agora. CALL_PROVIDER says which one
// new calls use:
//   livekit  always LiveKit (the default)
//   agora    always Agora
//   auto     LiveKit while it answers; Agora while it does not (checked every minute)
// The choice is made once when a call starts, so both people are always on the same provider. A call that cannot
// connect through LiveKit can also be moved to Agora while it is starting (the phones ask, see signaling.js).
// If Agora is wanted but its settings are missing, calls keep using LiveKit rather than failing.
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

// Asks LiveKit's server a small question (the list of rooms). It answers only while the project can be used, so a
// failure here means calls through LiveKit would fail too.
function livekitProbe(env) {
  const host = (env.LIVEKIT_URL || '').replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
  const client = new RoomServiceClient(host, env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);
  return () =>
    Promise.race([
      client.listRooms(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('LiveKit did not answer in time')), 5000).unref()),
    ]);
}

function createProviders(env = process.env, {probe} = {}) {
  const livekit = createTokenIssuer(env);
  const agora = createAgoraIssuer(env);
  const mode = (env.CALL_PROVIDER || '').trim().toLowerCase();
  const check = probe || (livekit.configured ? livekitProbe(env) : null);
  let livekitUp = true; // assumed up until a check says otherwise

  const providers = {
    // the provider new calls will use
    get provider() {
      if (agora.configured && (mode === 'agora' || (mode === 'auto' && !livekitUp))) {
        return 'agora';
      }
      return 'livekit';
    },
    // whether new calls can be started at all
    get configured() {
      return providers.provider === 'agora' ? agora.configured : livekit.configured;
    },
    get livekitUp() {
      return livekitUp;
    },
    mode,
    livekitConfigured: livekit.configured,
    agoraConfigured: agora.configured,
    agora, // used on its own by the call links (invites.js)

    async issue(name, {identity, name: displayName, room}) {
      if (name === 'agora') {
        return agora.issue({identity, room});
      }
      return {provider: 'livekit', serverUrl: livekit.serverUrl, token: await livekit.issue({identity, name: displayName, room})};
    },

    // One check of LiveKit; the result decides the provider in auto mode
    async refresh(log = () => {}) {
      if (mode !== 'auto' || !check) {
        return livekitUp;
      }
      const was = livekitUp;
      try {
        await check();
        livekitUp = true;
      } catch (e) {
        livekitUp = false;
        if (was) {
          log(`LiveKit is not answering (${e.message}); new calls use Agora until it does`);
        }
      }
      if (!was && livekitUp) {
        log('LiveKit answers again; new calls use it');
      }
      return livekitUp;
    },

    // Checks now and then every minute (auto mode only). Returns a function that stops the checking.
    watch(log = () => {}, everyMs = 60_000) {
      if (mode !== 'auto') {
        return () => {};
      }
      providers.refresh(log);
      const timer = setInterval(() => providers.refresh(log), everyMs);
      timer.unref();
      return () => clearInterval(timer);
    },
  };
  return providers;
}

module.exports = {createProviders};
