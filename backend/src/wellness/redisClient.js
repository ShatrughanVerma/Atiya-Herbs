const Redis = require('ioredis');

// The Redis connection (REDIS_URL, for example redis://localhost:6379 or rediss://... of a hosted Redis).
// Empty REDIS_URL = no Redis: the "last 10 minutes" of steps is simply switched off and everything else works.
// The connection is built so that Redis being down never slows or breaks the API: a command fails at once
// (no waiting queue), and reconnecting goes on quietly in the background.
function createRedisClient(config, logger = console) {
  if (!config.REDIS_URL) {
    return null;
  }
  const client = new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 5_000,
    retryStrategy: attempt => Math.min(attempt * 1_000, 15_000),
  });
  client.on('error', error => logger.warn(`[redis] ${error.message}`));
  return client;
}

module.exports = {createRedisClient};
