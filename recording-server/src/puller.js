const {DeleteObjectsCommand, GetObjectCommand, ListObjectsV2Command, S3Client} = require('@aws-sdk/client-s3');

// Pulls a call's recording chunks from the staging bucket (Backblaze B2, or any S3-style bucket) that LiveKit writes to.
//
// Why: the call backend lives on Render and cannot reach this PC, but this PC can reach the internet. So instead of
// the call backend pushing chunks here, this server looks at the bucket every few seconds, downloads each new chunk
// into its own disk (same code path as an upload, so checksums, database rows and the later FFmpeg join are identical),
// and, when LiveKit has finished the recording, says "finish" and clears the bucket.
//
// What LiveKit writes (see call-backend/src/recording.js), under <prefix>YYYY/MM/ :
//   video: a folder <callId>-<time>/ with part_00000.ts, part_00001.ts ... , live.m3u8 and, when the recording has ended,
//          playlist.m3u8 which ends with #EXT-X-ENDLIST
//   audio: one file <callId>-<time>.ogg (written when the recording ends)
// Nothing is deleted from the bucket until the chunks are safely on this disk and the call is queued for processing.

const SEGMENT = /_(\d+)\.ts$/;
const safeId = text => String(text).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 100);

function createPuller({config, store, ingest, logger, s3 = null, now = () => new Date(), setTimer = setTimeout, clearTimer = clearTimeout}) {
  const pull = config.pull;
  const available = !!(pull.endpoint && pull.bucket && pull.accessKeyId && pull.secretAccessKey);
  const client =
    s3 ||
    (available
      ? new S3Client({
          region: pull.region || 'auto',
          endpoint: pull.endpoint,
          credentials: {accessKeyId: pull.accessKeyId, secretAccessKey: pull.secretAccessKey},
          forcePathStyle: true,
        })
      : null);

  let timer = null;
  let running = false;
  let stopped = true;

  async function listAll() {
    const keys = [];
    let token;
    do {
      const page = await client.send(new ListObjectsV2Command({Bucket: pull.bucket, Prefix: pull.prefix, ContinuationToken: token}));
      keys.push(...(page.Contents || []).map(item => item.Key));
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return keys;
  }

  const read = async key => {
    const object = await client.send(new GetObjectCommand({Bucket: pull.bucket, Key: key}));
    return Buffer.from(await object.Body.transformToByteArray());
  };

  async function clear(keys, id) {
    if (!pull.deleteAfter) {
      return;
    }
    for (let i = 0; i < keys.length; i += 1000) {
      await client
        .send(new DeleteObjectsCommand({Bucket: pull.bucket, Delete: {Objects: keys.slice(i, i + 1000).map(Key => ({Key}))}, Quiet: true}))
        .catch(error => logger.warn('could not clear the bucket after pulling', {id, error: error.message}));
    }
  }

  // Groups the bucket's keys by recording: {id, keys, chunks: [{key, track, seq}], playlist, single}
  function group(keys) {
    const groups = new Map();
    const get = id => {
      if (!groups.has(id)) {
        groups.set(id, {id, keys: [], chunks: [], playlist: null, single: null});
      }
      return groups.get(id);
    };
    for (const key of keys) {
      const parts = key.slice(pull.prefix.length).split('/'); // YYYY/MM/<id>/<file>  or  YYYY/MM/<id>.<ext>
      if (parts.length >= 4) {
        const g = get(safeId(parts[parts.length - 2]));
        const name = parts[parts.length - 1];
        g.keys.push(key);
        if (SEGMENT.test(name)) {
          g.chunks.push({key, track: 'av', seq: Number(SEGMENT.exec(name)[1])});
        } else if (name === 'playlist.m3u8') {
          g.playlist = key;
        }
      } else if (parts.length === 3 && /\.(ogg|mp4)$/.test(parts[2])) {
        const g = get(safeId(parts[2].replace(/\.[^.]+$/, '')));
        g.keys.push(key);
        g.single = {key, track: parts[2].endsWith('.ogg') ? 'audio' : 'av'};
      }
    }
    return [...groups.values()];
  }

  async function handle(g) {
    const have = new Map((await store.listChunks(g.id)).filter(c => c.status !== 'deleted').map(c => [`${c.track}|${c.seq}`, c]));
    const recording = await store.getRecording(g.id);

    if (g.single) {
      // audio: the whole file is already there
      if (!have.has(`${g.single.track}|0`) && (!recording || recording.status === 'receiving')) {
        const result = await ingest.saveChunk({callId: g.id, track: g.single.track, seq: 0, bytes: await read(g.single.key)});
        if (result.status >= 400 && result.status !== 409) {
          throw new Error(`could not save ${g.id}: HTTP ${result.status} ${result.body.error}`);
        }
      }
      if (!recording || recording.status === 'receiving') {
        await store.requestFinish(g.id, 1, now());
        logger.info('recording pulled from the bucket', {id: g.id, chunks: 1});
      }
      await clear(g.keys, g.id);
      return;
    }

    if (recording && recording.status !== 'receiving') {
      // already finished here (for example closed because it went quiet): clear the bucket if everything is on this disk
      if (g.chunks.every(c => have.has(`${c.track}|${c.seq}`))) {
        await clear(g.keys, g.id);
      }
      return;
    }

    for (const chunk of g.chunks.filter(c => !have.has(`${c.track}|${c.seq}`)).sort((a, b) => a.seq - b.seq)) {
      const result = await ingest.saveChunk({callId: g.id, track: chunk.track, seq: chunk.seq, bytes: await read(chunk.key)});
      if (result.status >= 400) {
        if (result.status === 409) {
          return; // the call was closed meanwhile
        }
        throw new Error(`could not save chunk ${chunk.seq} of ${g.id}: HTTP ${result.status} ${result.body.error}`);
      }
    }

    // LiveKit writes playlist.m3u8 with #EXT-X-ENDLIST when the recording has ended
    if (g.playlist && g.chunks.length && /#EXT-X-ENDLIST/.test((await read(g.playlist)).toString('utf8'))) {
      const expected = Math.max(...g.chunks.map(c => c.seq)) + 1;
      await store.requestFinish(g.id, expected, now());
      logger.info('recording pulled from the bucket', {id: g.id, chunks: g.chunks.length});
      await clear(g.keys, g.id);
    }
  }

  // One look at the bucket. Returns how many recordings it touched (for tests).
  async function pollOnce() {
    const groups = group(await listAll());
    for (const g of groups) {
      try {
        await handle(g);
      } catch (error) {
        logger.warn('pulling a recording will be tried again', {id: g.id, error: error.message});
      }
    }
    return groups.length;
  }

  async function loop() {
    if (stopped) {
      return;
    }
    running = true;
    try {
      await pollOnce();
    } catch (error) {
      logger.error('could not look at the bucket', {error: error.message});
    }
    running = false;
    if (!stopped) {
      timer = setTimer(loop, pull.pollMs);
    }
  }

  return {
    available,
    pollOnce,
    start() {
      if (available) {
        stopped = false;
        logger.info('pulling recordings from the bucket', {bucket: pull.bucket, prefix: pull.prefix, everyMs: pull.pollMs});
        loop();
      }
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

module.exports = {createPuller};
