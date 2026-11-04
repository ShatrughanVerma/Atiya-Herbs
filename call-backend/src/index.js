const http = require('node:http');
const os = require('node:os');
const express = require('express');
const {Server} = require('socket.io');
const {attachSignaling} = require('./signaling');
const {createProviders} = require('./providers');
const {createInvites} = require('./invites');
const {createRecordingStore} = require('./recordingStore');
const {createEgressClient, createRecordingService} = require('./recording');
const {createCloudinaryArchiver} = require('./cloudinaryArchive');

// `overrides` lets tests replace the LiveKit egress client and the details store with fakes
function createCallBackend(env = process.env, log = console.log, overrides = {}) {
  const app = express();
  app.disable('x-powered-by');

  const server = http.createServer(app);
  const io = new Server(server, {maxHttpBufferSize: 16 * 1024, pingInterval: 10000, pingTimeout: 10000});
  const tokens = createProviders(env, {probe: overrides.probe});
  const store = overrides.store || createRecordingStore(env, log);
  const recording = createRecordingService({
    env,
    store,
    egress: overrides.egress || createEgressClient(env),
    archiver: overrides.archiver || createCloudinaryArchiver({env, log}),
    livekitConfigured: tokens.livekitConfigured,
    log,
  });

  const state = attachSignaling(io, {
    tokens,
    recording,
    ringTimeoutMs: Number(env.RING_TIMEOUT_MS) || 45000,
    reconnectGraceMs: Number(env.RECONNECT_GRACE_MS) || 15000,
    log,
  });

  // Call links that work in a browser without the app (Agora, independent of the app's own calling)
  const invites = createInvites({env, agora: tokens.agora, now: overrides.now});
  app.use(invites.router);

  // Open http://<PC IP>:4000/health in a browser to check the server is up and LiveKit is set
  app.get('/health', (req, res) => {
    res.json({
      ok: true,
      livekitConfigured: tokens.livekitConfigured,
      agoraConfigured: tokens.agoraConfigured,
      callProvider: tokens.provider, // which one new calls use (CALL_PROVIDER)
      callProviderMode: tokens.mode || 'livekit',
      livekitUp: tokens.livekitUp, // in auto mode: did LiveKit answer at the last check
      recordingAvailable: recording.available,
      recordingDestination: recording.destination,
      recordingCompression: recording.compression,
      recordingDetailsStore: store.kind,
      online: [...state.users.values()].filter(u => u.socketId).length,
      calls: state.calls.size,
    });
  });

  return {app, server, io, state, tokens, store, recording};
}

const lanAddresses = () =>
  Object.values(os.networkInterfaces())
    .flat()
    .filter(a => a && a.family === 'IPv4' && !a.internal)
    .map(a => a.address);

if (require.main === module) {
  const port = Number(process.env.PORT) || 4000;
  const {server, tokens, store, recording} = createCallBackend();
  tokens.watch(msg => console.log(`  ${msg}`)); // CALL_PROVIDER=auto: keep checking that LiveKit answers
  // Creates the recordings table in Cloudflare D1 if it isn't there yet, then moves any recording that is still
  // waiting in R2 (for example after a restart) to Cloudinary, and checks again every 15 minutes
  const sweep = () => recording.retryPendingArchives().catch(e => console.warn(`  Recording sweep failed: ${e.message}`));
  store
    .init()
    .then(() => setTimeout(sweep, 30_000).unref())
    .catch(e => console.warn(`  Could not prepare the recordings database: ${e.message}`));
  setInterval(sweep, 15 * 60_000).unref();
  server.listen(port, '0.0.0.0', () => {
    console.log(`Atiya Herbs call backend listening on port ${port}`);
    for (const ip of lanAddresses()) {
      console.log(`  Phones on this Wi-Fi can use: http://${ip}:${port}`);
    }
    console.log(
      `  Call recording: ${recording.available ? `on (${recording.mode} only, stored in ${recording.destination}${recording.compression ? ', compressed' : ''})` : 'off (needs Cloudflare R2 settings)'}`,
    );
    console.log(`  Calls use: ${tokens.provider}${tokens.agoraConfigured ? '' : ' (Agora not set up)'}`);
    if (!tokens.configured) {
      console.warn('  Calling is NOT configured: fill LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET (or the AGORA_* values) in .env');
    }
  });
}

module.exports = {createCallBackend};
