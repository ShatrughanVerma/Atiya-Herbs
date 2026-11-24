// npm run redis:check
// Tries the "last 10 minutes of steps" on the REAL Redis of REDIS_URL (from the environment or backend/.env), with the same
// code the API uses (src/wellness/redisClient.js and stepWindow.js). It writes to a key of its own, checks what comes back,
// and deletes the key at the end. It never touches the key of a real person.
const {createRedisClient} = require('../src/wellness/redisClient');
const {createStepWindow, TTL_SECONDS, WINDOW_MS} = require('../src/wellness/stepWindow');

try {
  process.loadEnvFile('.env'); // the settings of the backend; a real environment variable wins
} catch {
  // no .env file: only the environment is used
}

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) {
    failed += 1;
  }
};

(async () => {
  if (!process.env.REDIS_URL) {
    console.log('REDIS_URL is empty: put it in backend/.env (for example REDIS_URL=redis://127.0.0.1:6379) and run again.');
    process.exit(2);
  }
  const warnings = [];
  const logger = {warn: message => warnings.push(message)};
  const redis = createRedisClient({REDIS_URL: process.env.REDIS_URL}, logger);
  const userId = `redis-check-${Date.now()}`;
  const key = `steps:window:${userId}`;
  const window = createStepWindow({redis, logger});

  try {
    // the connection needs a moment before it is ready (commands sent earlier fail on purpose, see redisClient.js)
    await new Promise((resolve, reject) => {
      if (redis.status === 'ready') {
        resolve();
        return;
      }
      const timer = setTimeout(() => reject(new Error(`could not connect in 8 seconds${warnings[0] ? `: ${warnings[0]}` : ''}`)), 8000);
      redis.once('ready', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    const pong = await redis.ping();
    check('connects and answers PING', pong === 'PONG', pong);

    const now = Date.now();
    await window.add(userId, [
      {batchId: 'check-batch-0001', steps: 100, recordedAtMs: now - 20_000},
      {batchId: 'check-batch-0002', steps: 120, recordedAtMs: now - 90_000},
      {batchId: 'check-batch-0003', steps: 150, recordedAtMs: now - 270_000},
      {batchId: 'check-batch-0004', steps: 999, recordedAtMs: now - WINDOW_MS - 60_000}, // too old: must not be added
    ]);
    const ttl = await redis.ttl(key);
    check('the key expires by itself (TTL set, 600 seconds at most)', ttl > 0 && ttl <= TTL_SECONDS, `TTL ${ttl}s`);

    const recent = await window.recent(userId);
    check('the window is available', recent.available === true, JSON.stringify(recent));
    check('it adds up the steps of the last 10 minutes (100 + 120 + 150)', recent.steps === 370, `steps ${recent.steps}`);
    check('a batch older than 10 minutes is left out', recent.batches === 3, `batches ${recent.batches}`);
    check('the minutes are 10 numbers, the newest last', recent.perMinute?.length === 10 && recent.perMinute[9] === 100 && recent.perMinute[8] === 120 && recent.perMinute[5] === 150, JSON.stringify(recent.perMinute));

    await window.add(userId, [{batchId: 'check-batch-0001', steps: 100, recordedAtMs: now - 20_000}]); // the same batch again
    check('the same batch sent again is not counted twice', (await window.recent(userId)).steps === 370);

    check('every key is made for one person (it has its own name)', (await redis.exists(key)) === 1, key);
  } catch (error) {
    check('everything above ran without an error', false, error.message);
  } finally {
    try {
      await redis.del(key);
    } catch {
      // nothing to clean
    }
    redis.disconnect();
  }
  if (warnings.length > 0) {
    console.log(`Redis warnings: ${[...new Set(warnings)].slice(0, 3).join(' | ')}`);
  }
  console.log(failed === 0 ? '\nRedis works for the step window.' : `\n${failed} check(s) failed.`);
  process.exit(failed === 0 ? 0 : 1);
})();
