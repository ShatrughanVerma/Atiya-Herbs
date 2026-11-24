// The last 10 minutes of steps, kept in Redis (a sorted set per person): "what did I walk just now?"
//   key    steps:window:<userId>
//   score  when the batch of steps was counted (milliseconds)
//   member "<batchId>:<steps>"  (the same batch sent twice is the same member, so it is never counted twice)
// This is only a quick look. The permanent record is the MySQL table of step batches and the day's total, which Redis
// never replaces: when the key expires or Redis is down, nothing is lost. Every Redis problem is caught here, so a step
// batch is always saved even when Redis is not.
const WINDOW_MS = 10 * 60_000;
const TTL_SECONDS = 600; // the whole key expires 10 minutes after its last new batch
const MINUTES = 10;

function createStepWindow({redis, logger = console, now = () => Date.now()}) {
  const keyOf = userId => `steps:window:${userId}`;

  const safe = async (work, fallback) => {
    try {
      return await work();
    } catch (error) {
      logger.warn(`[steps] Redis could not be used: ${error.message}`);
      return fallback;
    }
  };

  return {
    available: Boolean(redis),

    // Adds the batches that are still inside the window (older ones are history, not "just now")
    async add(userId, batches) {
      if (!redis) {
        return;
      }
      const cutoff = now() - WINDOW_MS;
      const fresh = batches.filter(batch => batch.recordedAtMs > cutoff);
      await safe(async () => {
        if (fresh.length > 0) {
          await redis.zadd(keyOf(userId), ...fresh.flatMap(batch => [batch.recordedAtMs, `${batch.batchId}:${batch.steps}`]));
          await redis.expire(keyOf(userId), TTL_SECONDS); // renewed with every new batch
        }
        await redis.zremrangebyscore(keyOf(userId), '-inf', cutoff); // old entries leave the window
      }, undefined);
    },

    // {available, windowSeconds, steps, batches, perMinute: [10 numbers, the oldest minute first]}
    async recent(userId) {
      if (!redis) {
        return {available: false};
      }
      return safe(async () => {
        const at = now();
        const cutoff = at - WINDOW_MS;
        await redis.zremrangebyscore(keyOf(userId), '-inf', cutoff);
        const flat = await redis.zrangebyscore(keyOf(userId), `(${cutoff}`, '+inf', 'WITHSCORES');
        const perMinute = Array(MINUTES).fill(0);
        let steps = 0;
        let batches = 0;
        for (let i = 0; i < flat.length; i += 2) {
          const count = Number(flat[i].split(':').pop());
          const minutesAgo = Math.min(MINUTES - 1, Math.max(0, Math.floor((at - Number(flat[i + 1])) / 60_000)));
          perMinute[MINUTES - 1 - minutesAgo] += count;
          steps += count;
          batches += 1;
        }
        return {available: true, windowSeconds: WINDOW_MS / 1000, steps, batches, perMinute};
      }, {available: false});
    },
  };
}

module.exports = {createStepWindow, WINDOW_MS, TTL_SECONDS};
