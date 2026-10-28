const http = require('node:http');
const os = require('node:os');
const express = require('express');
const {Server} = require('socket.io');
const {attachSignaling} = require('./signaling');
const {createTokenIssuer} = require('./livekitToken');

function createCallBackend(env = process.env, log = console.log) {
  const app = express();
  app.disable('x-powered-by');

  const server = http.createServer(app);
  const io = new Server(server, {maxHttpBufferSize: 16 * 1024, pingInterval: 10000, pingTimeout: 10000});
  const tokens = createTokenIssuer(env);

  const state = attachSignaling(io, {
    tokens,
    ringTimeoutMs: Number(env.RING_TIMEOUT_MS) || 45000,
    reconnectGraceMs: Number(env.RECONNECT_GRACE_MS) || 15000,
    log,
  });

  // Open http://<PC IP>:4000/health in a browser to check the server is up and LiveKit is set
  app.get('/health', (req, res) => {
    res.json({
      ok: true,
      livekitConfigured: tokens.configured,
      online: [...state.users.values()].filter(u => u.socketId).length,
      calls: state.calls.size,
    });
  });

  return {app, server, io, state, tokens};
}

const lanAddresses = () =>
  Object.values(os.networkInterfaces())
    .flat()
    .filter(a => a && a.family === 'IPv4' && !a.internal)
    .map(a => a.address);

if (require.main === module) {
  const port = Number(process.env.PORT) || 4000;
  const {server, tokens} = createCallBackend();
  server.listen(port, '0.0.0.0', () => {
    console.log(`Atiya Herbs call backend listening on port ${port}`);
    for (const ip of lanAddresses()) {
      console.log(`  Phones on this Wi-Fi can use: http://${ip}:${port}`);
    }
    if (!tokens.configured) {
      console.warn('  LiveKit is NOT configured: fill LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET in .env');
    }
  });
}

module.exports = {createCallBackend};
