const path = require('node:path');

const int = (value, fallback, min, max) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : fallback;
};

function loadConfig(env = process.env) {
  return {
    port: int(env.PORT, 5000, 1, 65535),
    host: env.HOST || '127.0.0.1',
    tlsKey: env.TLS_KEY || '',
    tlsCert: env.TLS_CERT || '',
    ingestKey: (env.INGEST_KEY || '').trim(),
    readKey: (env.READ_KEY || '').trim(),
    chunkDir: path.resolve(env.CHUNK_DIR || './data/chunks'),
    recordingDir: path.resolve(env.RECORDING_DIR || './data/final'),
    logDir: path.resolve(env.LOG_DIR || './data/logs'),
    ffmpeg: env.FFMPEG_PATH || 'ffmpeg',
    videoCrf: int(env.RECORDING_VIDEO_CRF, 28, 18, 40),
    // Video wider than this is made smaller (never bigger); frames per second above this are dropped
    videoMaxWidth: int(env.RECORDING_VIDEO_MAX_WIDTH, 640, 160, 3840),
    videoMaxFps: int(env.RECORDING_VIDEO_MAX_FPS, 15, 5, 60),
    audioKbps: int(env.RECORDING_AUDIO_KBPS, 64, 16, 192),
    maxChunkBytes: int(env.MAX_CHUNK_MB, 50, 1, 500) * 1024 * 1024,
    idleFinishMs: int(env.IDLE_FINISH_SECONDS, 120, 10, 86400) * 1000,
    maxAttempts: int(env.MAX_ATTEMPTS, 5, 1, 20),
    retryBaseMs: int(env.RETRY_BASE_SECONDS, 30, 1, 3600) * 1000,
    deleteChunksAfter: env.DELETE_CHUNKS_AFTER !== 'false',
    // When chunks are kept (DELETE_CHUNKS_AFTER=false), they are removed this many days after the MP4 was made. 0 = keep forever.
    chunkRetentionDays: int(env.CHUNK_RETENTION_DAYS, 2, 0, 3650),
    workerPollMs: int(env.WORKER_POLL_MS, 3000, 200, 60000),
    minFreeGb: int(env.MIN_FREE_GB, 20, 0, 100000),
    // Pull chunks from the staging bucket LiveKit writes to (Backblaze B2 or any S3-style bucket). Empty = off.
    pull: {
      endpoint: (env.PULL_ENDPOINT || '').trim(),
      region: (env.PULL_REGION || '').trim(),
      bucket: (env.PULL_BUCKET || '').trim(),
      accessKeyId: (env.PULL_ACCESS_KEY_ID || '').trim(),
      secretAccessKey: (env.PULL_SECRET_ACCESS_KEY || '').trim(),
      prefix: (env.PULL_PREFIX || 'recordings/').trim(),
      pollMs: int(env.PULL_POLL_SECONDS, 10, 2, 3600) * 1000,
      deleteAfter: env.PULL_DELETE_AFTER !== 'false',
    },
    mysql: {
      host: env.MYSQL_HOST || 'localhost',
      port: int(env.MYSQL_PORT, 3306, 1, 65535),
      database: env.MYSQL_DATABASE || 'recordings',
      user: env.MYSQL_USER || '',
      password: env.MYSQL_PASSWORD || '',
    },
  };
}

module.exports = {loadConfig};
