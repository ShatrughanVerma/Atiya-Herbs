const {DeleteObjectsCommand, GetObjectCommand, ListObjectsV2Command, S3Client} = require('@aws-sdk/client-s3');
const crypto = require('node:crypto');

// Sends a call's recording chunks to the separate Recording Server (see ../../recording-server) instead of Cloudinary.
//
// LiveKit Egress can only write to an S3-style bucket, so it still writes the short .ts chunks to the R2 staging bucket
// while the call is going. This forwarder moves them on:
//   - watch():   during the call, every few seconds, sends each new chunk (so a crash loses at most a few seconds)
//   - archive(): after the call, sends whatever is left, says "finish" (with how many chunks to expect), and only then
//                clears the chunks from R2. If anything fails the chunks stay in R2 and the normal sweep tries again.
// The Recording Server joins and compresses them into one MP4 on its own disk.
// A chunk sent twice is stored once by the Recording Server, so retrying is always safe.

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const SEGMENT = /_(\d+)\.ts$/;

// The Recording Server accepts only letters, digits, _ and - in a call id
const safeId = text => String(text).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 100);

function createRecordingServerArchiver({
  env = process.env,
  s3 = null,
  fetchFn = globalThis.fetch,
  log = () => {},
  sleepFn = sleep,
  setTimer = setInterval,
  clearTimer = clearInterval,
} = {}) {
  const baseUrl = (env.RECORDING_SERVER_URL || '').trim().replace(/\/+$/, '');
  const key = (env.RECORDING_SERVER_KEY || '').trim();
  const available = !!(baseUrl && key);
  const liveMs = (Number(env.RECORDING_SERVER_LIVE_SECONDS) || 5) * 1000;
  const keepStagingCopy = env.RECORDING_KEEP_R2_COPY === 'true';
  const attempts = Number(env.RECORDING_SERVER_ATTEMPTS) || 4;

  const stagingClient = () =>
    s3 ||
    new S3Client({
      region: (env.R2_REGION || '').trim() || 'auto',
      endpoint: (env.R2_ENDPOINT || '').trim(),
      credentials: {accessKeyId: (env.R2_ACCESS_KEY_ID || '').trim(), secretAccessKey: (env.R2_SECRET_ACCESS_KEY || '').trim()},
      forcePathStyle: true,
    });

  const isChunked = objectKey => objectKey.endsWith('.m3u8');
  // one recording = one folder (chunked) or one file (audio); its name is unique per recording
  const recordingId = objectKey => {
    const parts = objectKey.split('/');
    const last = parts.pop();
    return safeId(isChunked(objectKey) ? parts.pop() : last.replace(/\.[^.]+$/, ''));
  };

  async function request(method, path, {body, headers = {}} = {}) {
    return fetchFn(`${baseUrl}${path}`, {
      method,
      headers: {Authorization: `Bearer ${key}`, ...headers},
      body,
      signal: AbortSignal.timeout(60_000),
    });
  }

  // Sends one chunk, retrying with a growing wait. Returns when the Recording Server has it (or already had it).
  async function sendChunk(id, track, seq, bytes) {
    const sha = crypto.createHash('sha256').update(bytes).digest('hex');
    let lastError = 'unknown';
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const res = await request('PUT', `/calls/${id}/tracks/${track}/chunks/${seq}`, {
          body: bytes,
          headers: {'Content-Type': 'application/octet-stream', 'x-chunk-sha256': sha},
        });
        if (res.ok) {
          return;
        }
        const text = await res.text().catch(() => '');
        if (res.status === 409 && /call_closed/.test(text)) {
          return; // the call was already finished there: this chunk was delivered earlier
        }
        lastError = `HTTP ${res.status} ${text.slice(0, 120)}`;
        if (res.status === 400 || res.status === 401 || res.status === 413) {
          break; // retrying cannot fix these
        }
      } catch (e) {
        lastError = e.message;
      }
      if (attempt < attempts) {
        await sleepFn(500 * 2 ** (attempt - 1));
      }
    }
    throw new Error(`chunk ${track}/${seq} not delivered: ${lastError}`);
  }

  async function listKeys(client, bucket, prefix) {
    const keys = [];
    const sizes = new Map();
    let token;
    do {
      const page = await client.send(new ListObjectsV2Command({Bucket: bucket, Prefix: prefix, ContinuationToken: token}));
      for (const item of page.Contents || []) {
        keys.push(item.Key);
        sizes.set(item.Key, Number(item.Size) || 0);
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    keys.sizes = sizes;
    return keys;
  }

  const readObject = async (client, bucket, objectKey) => {
    const object = await client.send(new GetObjectCommand({Bucket: bucket, Key: objectKey}));
    return Buffer.from(await object.Body.transformToByteArray());
  };

  // chunks of one recording as [{objectKey, track, seq}]
  async function findChunks(client, {bucket, objectKey, mode}) {
    if (!isChunked(objectKey)) {
      return [{objectKey, track: mode === 'audio' ? 'audio' : 'av', seq: 0}];
    }
    const prefix = objectKey.slice(0, objectKey.lastIndexOf('/') + 1);
    const keys = await listKeys(client, bucket, prefix);
    return {
      all: keys,
      chunks: keys
        .filter(k => SEGMENT.test(k))
        .map(k => ({objectKey: k, track: 'av', seq: Number(SEGMENT.exec(k)[1]), size: keys.sizes.get(k)}))
        .sort((a, b) => a.seq - b.seq),
    };
  }

  // ---- during the call ----
  const watchers = new Map(); // recording id -> {timer, sent, busy}

  function watch({bucket, objectKey, mode}) {
    if (!available || !isChunked(objectKey) || watchers.has(recordingId(objectKey))) {
      return;
    }
    const id = recordingId(objectKey);
    const state = {sent: new Set(), busy: null, timer: null, startedAt: Date.now()};
    const tick = async () => {
      if (state.busy) {
        return;
      }
      state.busy = (async () => {
        try {
          const client = stagingClient();
          const {chunks} = await findChunks(client, {bucket, objectKey, mode});
          for (const chunk of chunks.filter(c => !state.sent.has(c.seq))) {
            await sendChunk(id, chunk.track, chunk.seq, await readObject(client, bucket, chunk.objectKey));
            state.sent.add(chunk.seq);
          }
        } catch (e) {
          log(`live chunk forwarding for ${id} will retry: ${e.message}`); // archive() sends the rest after the call
        }
      })();
      await state.busy;
      state.busy = null;
      if (Date.now() - state.startedAt > 6 * 3600 * 1000) {
        stopWatching(id); // a call never lasts this long; do not leave a timer running forever
      }
    };
    state.timer = setTimer(tick, liveMs);
    state.timer.unref?.();
    watchers.set(id, state);
  }

  async function stopWatching(id) {
    const state = watchers.get(id);
    if (!state) {
      return new Set();
    }
    clearTimer(state.timer);
    watchers.delete(id);
    if (state.busy) {
      await state.busy.catch(() => {});
    }
    return state.sent;
  }

  // ---- after the call ----
  // Returns {ok: true, destination, bytes, ...} or {ok: false, error}; the chunks stay in R2 when it fails.
  async function archive({bucket, objectKey, callId, mode = 'audio'}) {
    if (!available) {
      return {ok: false, error: 'not-configured'};
    }
    const id = recordingId(objectKey) || safeId(callId);
    const alreadySent = await stopWatching(id);
    try {
      const client = stagingClient();
      const found = await findChunks(client, {bucket, objectKey, mode});
      const chunks = Array.isArray(found) ? found : found.chunks;
      if (!chunks.length) {
        return {ok: false, error: 'no-segments'};
      }
      let bytes = 0;
      for (const chunk of chunks) {
        bytes += chunk.size || 0;
        if (isChunked(objectKey) && alreadySent.has(chunk.seq)) {
          continue; // the live forwarder already delivered this one
        }
        await sendChunk(id, chunk.track, chunk.seq, await readObject(client, bucket, chunk.objectKey));
      }
      const expected = Math.max(...chunks.map(c => c.seq)) + 1;
      const res = await request('POST', `/calls/${id}/finish`, {
        body: JSON.stringify({expectedChunks: expected}),
        headers: {'Content-Type': 'application/json'},
      });
      if (!res.ok) {
        throw new Error(`finish not accepted: HTTP ${res.status}`);
      }
      if (!keepStagingCopy) {
        const toDelete = Array.isArray(found) ? [objectKey] : found.all;
        for (let i = 0; i < toDelete.length; i += 1000) {
          await client
            .send(new DeleteObjectsCommand({Bucket: bucket, Delete: {Objects: toDelete.slice(i, i + 1000).map(Key => ({Key}))}, Quiet: true}))
            .catch(e => log(`could not clear the staging chunks for ${id}: ${e.message}`));
        }
      }
      log(`recording ${id}: ${chunks.length} chunk(s) sent to the recording server`);
      return {ok: true, destination: 'recording-server', recordingServerId: id, bytes, compressed: false, chunks: chunks.length};
    } catch (e) {
      log(`could not send the recording ${id} to the recording server: ${e.message}`);
      return {ok: false, error: 'send-failed'};
    }
  }

  return {available, destination: 'recording-server', compression: false, watch, archive};
}

module.exports = {createRecordingServerArchiver};
