const fs = require('node:fs');
const path = require('node:path');

// Takes one finished call at a time from the database queue and processes it.
// A failure is retried with a growing wait (30 s, 60 s, 120 s ... by default); after MAX_ATTEMPTS the call is
// marked "failed" with the reason, the chunks stay on disk, and the log has the error, so nothing is thrown away.
function createWorker({config, store, processor, logger, now = () => new Date(), setTimer = setTimeout, clearTimer = clearTimeout}) {
  let timer = null;
  let running = false;
  let stopped = true;

  const backoffMs = attempts => config.retryBaseMs * 2 ** Math.max(0, attempts - 1);

  async function checkDisk() {
    try {
      const stats = await fs.promises.statfs(config.recordingDir);
      const freeGb = (stats.bavail * stats.bsize) / 1024 ** 3;
      if (freeGb < config.minFreeGb) {
        logger.warn('recordings drive is nearly full', {freeGb: Math.round(freeGb * 10) / 10, minFreeGb: config.minFreeGb});
      }
    } catch {
      // folder not created yet
    }
  }

  // Chunks are kept for CHUNK_RETENTION_DAYS after the MP4 is made, then removed. The MP4 stays. A chunk folder is
  // removed only when the final MP4 is still on disk, and only for fully complete recordings (partial or failed
  // ones keep their chunks for investigation).
  async function cleanupChunks() {
    if (config.deleteChunksAfter || !config.chunkRetentionDays) {
      return 0;
    }
    const cutoff = new Date(now().getTime() - config.chunkRetentionDays * 24 * 3600 * 1000);
    let removed = 0;
    for (const callId of await store.listChunkCleanup(cutoff)) {
      try {
        const recording = await store.getRecording(callId);
        const stat = await fs.promises.stat(recording.finalPath);
        if (!stat.isFile() || stat.size === 0) {
          throw new Error('final recording is missing or empty');
        }
        await fs.promises.rm(path.join(config.chunkDir, callId), {recursive: true, force: true});
        await store.markChunksDeleted(callId);
        removed += 1;
        logger.info('old chunks removed, the MP4 is kept', {callId, olderThanDays: config.chunkRetentionDays});
      } catch (error) {
        logger.warn('chunks not removed', {callId, error: error.message});
      }
    }
    return removed;
  }

  // One round: close calls that went quiet, then process one call if any is ready. Returns what it did (for tests).
  async function tick() {
    const when = now();
    const closed = await store.closeIdle(new Date(when.getTime() - config.idleFinishMs), when);
    for (const callId of closed) {
      logger.warn('call closed because no chunk arrived for a while', {callId});
    }
    const recording = await store.claimNext(when);
    if (!recording) {
      return null;
    }
    const {callId} = recording;
    try {
      const result = await processor.process(recording);
      if (result.outcome === 'retry') {
        const wait = backoffMs(recording.attempts);
        await store.updateRecording(callId, {status: 'pending', nextAttemptAt: new Date(now().getTime() + wait)});
        logger.warn('chunks missing, will look again', {callId, missing: result.missing.slice(0, 20), inMs: wait});
        return {callId, outcome: 'retry'};
      }
      logger.info(`recording ${result.outcome}`, {callId, missing: result.missing, corrupt: result.corrupt});
      return {callId, outcome: result.outcome};
    } catch (error) {
      const message = String(error.message || error).slice(0, 1000);
      if (recording.attempts >= config.maxAttempts) {
        await store.updateRecording(callId, {status: 'failed', error: message});
        logger.error('recording failed for good', {callId, attempts: recording.attempts, error: message});
        return {callId, outcome: 'failed'};
      }
      const wait = backoffMs(recording.attempts);
      await store.updateRecording(callId, {status: 'pending', error: message, nextAttemptAt: new Date(now().getTime() + wait)});
      logger.warn('recording attempt failed, will retry', {callId, attempts: recording.attempts, inMs: wait, error: message});
      return {callId, outcome: 'error'};
    }
  }

  async function loop() {
    if (stopped) {
      return;
    }
    running = true;
    let didWork = false;
    try {
      didWork = !!(await tick());
    } catch (error) {
      logger.error('worker round failed', {error: error.message});
    }
    running = false;
    if (!stopped) {
      timer = setTimer(loop, didWork ? 0 : config.workerPollMs);
    }
  }

  return {
    tick,
    cleanupChunks,
    async start() {
      stopped = false;
      const stuck = await store.requeueStuck();
      if (stuck) {
        logger.warn('calls left half-processed by a restart were queued again', {count: stuck});
      }
      await checkDisk();
      setInterval(checkDisk, 10 * 60 * 1000).unref();
      const sweep = () => cleanupChunks().catch(error => logger.error('chunk cleanup failed', {error: error.message}));
      sweep();
      setInterval(sweep, 60 * 60 * 1000).unref();
      loop();
    },
    async stop() {
      stopped = true;
      clearTimer(timer);
      while (running) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    },
  };
}

module.exports = {createWorker};
