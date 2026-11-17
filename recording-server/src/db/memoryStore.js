// Same interface as the MySQL store, kept in memory. Used by the tests (and nothing else).
function createMemoryStore() {
  const chunks = new Map(); // `${callId}|${track}|${seq}` -> chunk
  const recordings = new Map(); // callId -> recording
  const key = (callId, track, seq) => `${callId}|${track}|${seq}`;

  return {
    async init() {},

    async ensureRecording(callId, now) {
      if (!recordings.has(callId)) {
        recordings.set(callId, {
          callId,
          status: 'receiving',
          expectedChunks: null,
          finishRequested: false,
          finalPath: null,
          sizeBytes: null,
          durationSec: null,
          missingChunks: null,
          corruptChunks: 0,
          attempts: 0,
          nextAttemptAt: null,
          error: null,
          createdAt: now,
          lastChunkAt: null,
          completedAt: null,
        });
      }
      return {...recordings.get(callId)};
    },

    async getRecording(callId) {
      const found = recordings.get(callId);
      return found ? {...found} : null;
    },

    async updateRecording(callId, patch) {
      const found = recordings.get(callId);
      if (found) {
        Object.assign(found, patch);
      }
    },

    // Adds a chunk. Returns {created: false, chunk} when that call/track/seq already exists.
    async insertChunk(chunk) {
      const k = key(chunk.callId, chunk.track, chunk.seq);
      if (chunks.has(k)) {
        return {created: false, chunk: {...chunks.get(k)}};
      }
      chunks.set(k, {...chunk});
      return {created: true, chunk: {...chunk}};
    },

    async updateChunk(callId, track, seq, patch) {
      const found = chunks.get(key(callId, track, seq));
      if (found) {
        Object.assign(found, patch);
      }
    },

    async listChunks(callId) {
      return [...chunks.values()].filter(c => c.callId === callId).sort((a, b) => a.seq - b.seq).map(c => ({...c}));
    },

    async requestFinish(callId, expectedChunks, now) {
      await this.ensureRecording(callId, now);
      const found = recordings.get(callId);
      if (found.status === 'receiving') {
        found.status = 'pending';
        found.nextAttemptAt = now;
      }
      found.finishRequested = true;
      if (expectedChunks != null) {
        found.expectedChunks = expectedChunks;
      }
      return {...found};
    },

    // Calls that stopped getting chunks without anyone saying "finish"
    async closeIdle(cutoff, now) {
      const closed = [];
      for (const rec of recordings.values()) {
        if (rec.status === 'receiving' && rec.lastChunkAt && rec.lastChunkAt < cutoff) {
          rec.status = 'pending';
          rec.nextAttemptAt = now;
          closed.push(rec.callId);
        }
      }
      return closed;
    },

    // Takes the next call that is ready to be processed and marks it as processing
    async claimNext(now) {
      const ready = [...recordings.values()]
        .filter(r => r.status === 'pending' && (!r.nextAttemptAt || r.nextAttemptAt <= now))
        .sort((a, b) => a.createdAt - b.createdAt)[0];
      if (!ready) {
        return null;
      }
      ready.status = 'processing';
      ready.attempts += 1;
      return {...ready};
    },

    // A server that died mid-processing leaves calls stuck in "processing"; put them back in the queue
    async requeueStuck() {
      let count = 0;
      for (const rec of recordings.values()) {
        if (rec.status === 'processing') {
          rec.status = 'pending';
          count += 1;
        }
      }
      return count;
    },

    // Finished calls whose chunks are still on disk and are older than the cutoff
    async listChunkCleanup(cutoff, limit = 50) {
      return [...recordings.values()]
        .filter(r => r.status === 'completed' && r.completedAt && r.completedAt < cutoff)
        .filter(r => [...chunks.values()].some(c => c.callId === r.callId && c.status !== 'deleted'))
        .slice(0, limit)
        .map(r => r.callId);
    },

    async markChunksDeleted(callId) {
      for (const c of chunks.values()) {
        if (c.callId === callId) {
          c.status = 'deleted';
        }
      }
    },

    async close() {},
  };
}

module.exports = {createMemoryStore};
