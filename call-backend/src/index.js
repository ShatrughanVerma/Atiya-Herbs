const http = require('node:http');
const os = require('node:os');
const express = require('express');
const {Server} = require('socket.io');
const {attachSignaling} = require('./signaling');
const {createTokenIssuer} = require('./livekitToken');
const {createRecordingStore} = require('./recordingStore');
const {createEgressClient, createRecordingService} = require('./recording');
const {createCloudinaryArchiver} = require('./cloudinaryArchive');

// `overrides` lets tests replace the LiveKit egress client and the details store with fakes
function createCallBackend(env = process.env, log = console.log, overrides = {}) {
  const app = express();
  app.disable('x-powered-by');

  const server = http.createServer(app);
  const io = new Server(server, {maxHttpBufferSize: 16 * 1024, pingInterval: 10000, pingTimeout: 10000});
  const tokens = createTokenIssuer(env);
  const store = overrides.store || createRecordingStore(env, log);
  const recording = createRecordingService({
    env,
    store,
    egress: overrides.egress || createEgressClient(env),
    archiver: overrides.archiver || createCloudinaryArchiver({env, log}),
    livekitConfigured: tokens.configured,
    log,
  });

  const state = attachSignaling(io, {
    tokens,
    recording,
    ringTimeoutMs: Number(env.RING_TIMEOUT_MS) || 45000,
    reconnectGraceMs: Number(env.RECONNECT_GRACE_MS) || 15000,
    log,
  });

  // Open http://<PC IP>:4000/health in a browser to check the server is up and LiveKit is set
  app.get('/health', (req, res) => {
    res.json({
      ok: true,
      livekitConfigured: tokens.configured,
      recordingAvailable: recording.available,
      recordingDestination: recording.destination,
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
  // Creates the recordings table in Cloudflare D1 if it isn't there yet
  store.init().catch(e => console.warn(`  Could not prepare the recordings database: ${e.message}`));
  server.listen(port, '0.0.0.0', () => {
    console.log(`Atiya Herbs call backend listening on port ${port}`);
    for (const ip of lanAddresses()) {
      console.log(`  Phones on this Wi-Fi can use: http://${ip}:${port}`);
    }
    console.log(
      `  Call recording: ${recording.available ? `on (${recording.mode} only, stored in ${recording.destination})` : 'off (needs Cloudflare R2 settings)'}`,
    );
    if (!tokens.configured) {
      console.warn('  LiveKit is NOT configured: fill LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET in .env');
    }
  });
}

module.exports = {createCallBackend};
