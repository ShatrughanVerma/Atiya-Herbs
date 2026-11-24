// A small in-memory stand-in for Redis, with only the sorted-set commands the step window uses (ZADD, ZREMRANGEBYSCORE,
// ZRANGEBYSCORE, EXPIRE). It also remembers the TTL it was given. `breakIt()` makes every command fail, like a Redis
// that is down.
function createFakeRedis() {
  const sets = new Map(); // key -> Map(member -> score)
  const ttls = new Map(); // key -> seconds
  let broken = false;

  const guard = () => {
    if (broken) {
      throw new Error('Redis is down');
    }
  };
  const bound = (text, inclusiveDefault = true) => {
    if (text === '-inf') {
      return {value: -Infinity, inclusive: true};
    }
    if (text === '+inf') {
      return {value: Infinity, inclusive: true};
    }
    if (typeof text === 'string' && text.startsWith('(')) {
      return {value: Number(text.slice(1)), inclusive: false};
    }
    return {value: Number(text), inclusive: inclusiveDefault};
  };
  const inside = (score, min, max) => {
    const low = bound(min);
    const high = bound(max);
    return (low.inclusive ? score >= low.value : score > low.value) && (high.inclusive ? score <= high.value : score < high.value);
  };

  return {
    sets,
    ttls,
    breakIt: () => {
      broken = true;
    },
    fixIt: () => {
      broken = false;
    },
    async zadd(key, ...args) {
      guard();
      const set = sets.get(key) ?? new Map();
      for (let i = 0; i < args.length; i += 2) {
        set.set(String(args[i + 1]), Number(args[i]));
      }
      sets.set(key, set);
      return args.length / 2;
    },
    async expire(key, seconds) {
      guard();
      ttls.set(key, seconds);
      return 1;
    },
    async zremrangebyscore(key, min, max) {
      guard();
      const set = sets.get(key);
      let removed = 0;
      if (set) {
        for (const [member, score] of [...set]) {
          if (inside(score, min, max)) {
            set.delete(member);
            removed += 1;
          }
        }
        if (set.size === 0) {
          sets.delete(key);
        }
      }
      return removed;
    },
    async zrangebyscore(key, min, max, withScores) {
      guard();
      const set = sets.get(key) ?? new Map();
      const found = [...set].filter(([, score]) => inside(score, min, max)).sort((a, b) => a[1] - b[1]);
      return found.flatMap(([member, score]) => (withScores === 'WITHSCORES' ? [member, String(score)] : [member]));
    },
  };
}

module.exports = {createFakeRedis};
