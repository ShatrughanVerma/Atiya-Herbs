const {EgressClient} = require('livekit-server-sdk');
const {
  EgressStatus,
  EncodedFileOutput,
  EncodedFileType,
  EncodingOptions,
  S3Upload,
  SegmentedFileOutput,
  SegmentedFileProtocol,
} = require('@livekit/protocol');
const {monthKey} = require('./recordingStore');

// Call recording. LiveKit Egress records the call's room and uploads the file straight to our
// Cloudflare R2 bucket (R2 speaks the S3 protocol). The details of each recording go to the store
// (Cloudflare D1). This only ever runs after both people have agreed (see signaling.js).
//
// There is deliberately no way to download or list recordings here: that needs verified logins,
// which don't exist yet. Recordings sit in the private bucket until that is built.

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const pad = n => String(n).padStart(2, '0');

function createRecordingService({
  env = process.env,
  store,
  egress,
  archiver = null,
  livekitConfigured,
  log = () => {},
  sleepFn = sleep,
}) {
  // trimmed because a stray space or newline pasted into the dashboard breaks the upload's Authorization header
  const endpoint = (env.R2_ENDPOINT || '').trim();
  const accessKey = (env.R2_ACCESS_KEY_ID || '').trim();
  const secret = (env.R2_SECRET_ACCESS_KEY || '').trim();
  const bucket = (env.R2_BUCKET || '').trim();
  const region = (env.R2_REGION || '').trim() || 'auto'; // R2 uses 'auto'; Backblaze B2 needs its own, e.g. us-west-004
  const mode = env.RECORDING_MODE === 'video' ? 'video' : 'audio'; // audio is much smaller and cheaper
  // Video is recorded small from the start: LiveKit's default is 720p at 30 fps, several MB a minute. The defaults
  // here (360p, 15 fps, 150 kbit/s video + 32 kbit/s audio) come to about 80 MB an hour, under Cloudinary's
  // 100 MB free upload limit. Each can be changed with a RECORDING_VIDEO_* / RECORDING_AUDIO_KBPS variable.
  const number = (value, fallback, min, max) => {
    const n = Number(value);
    return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : fallback;
  };
  const videoEncoding = new EncodingOptions({
    width: number(env.RECORDING_VIDEO_WIDTH, 640, 160, 1920),
    height: number(env.RECORDING_VIDEO_HEIGHT, 360, 90, 1080),
    framerate: number(env.RECORDING_VIDEO_FPS, 15, 5, 30),
    videoBitrate: number(env.RECORDING_VIDEO_KBPS, 150, 50, 5000),
    audioBitrate: number(env.RECORDING_AUDIO_KBPS, 32, 16, 128),
  });
  // How the people are arranged in the video. LiveKit's own default is "speaker" (whoever talks is big, the other
  // a thin strip); "grid" gives every person a tile of the same size. Also: speaker, single-speaker, grid-light...
  const layout = /^[a-z][a-z-]{1,30}$/.test(env.RECORDING_LAYOUT || '') ? env.RECORDING_LAYOUT : 'grid';
  // Video is recorded in short chunks (5 seconds by default) that are uploaded while the call is still going, so a
  // crash or a lost connection loses at most a few seconds, and a long call never has to fit in one big file.
  // When the call ends the chunks are joined into one file (see cloudinaryArchive.js). Audio stays one small file.
  const segmentSeconds = number(env.RECORDING_SEGMENT_SECONDS, 5, 2, 30);
  const chunked = mode === 'video' && env.RECORDING_CHUNKS !== 'false';
  // LiveKit's free plan includes about 60 recording minutes a month, so stop a little before that
  const monthlyLimitSeconds = (Number(env.RECORDING_MONTHLY_MINUTES) || 50) * 60;
  const pollMs = Number(env.RECORDING_POLL_MS) || 2000;
  const pollAttempts = Number(env.RECORDING_POLL_ATTEMPTS) || 60;

  const available =
    env.RECORDING_ENABLED !== 'false' && !!(livekitConfigured && endpoint && accessKey && secret && bucket && egress);

  const baseKey = (callId, now) => `recordings/${now.getUTCFullYear()}/${pad(now.getUTCMonth() + 1)}/${callId}-${now.getTime()}`;
  // One file for audio; for chunked video a folder named after the call, and the key is its playlist
  const objectKey = (callId, now = new Date()) =>
    chunked ? `${baseKey(callId, now)}/playlist.m3u8` : `${baseKey(callId, now)}.${mode === 'audio' ? 'ogg' : 'mp4'}`;
  const isChunked = key => !!key && key.endsWith('.m3u8');

  // Starts recording the call's room. Returns {ok: true, id} or {ok: false, error}.
  async function start(call, {requestedBy, allowedBy}) {
    if (!available) {
      return {ok: false, error: 'unavailable'};
    }
    const used = await store.secondsRecordedInMonth().catch(() => 0);
    if (used >= monthlyLimitSeconds) {
      return {ok: false, error: 'quota'};
    }
    const now = new Date();
    const key = objectKey(call.id, now);
    try {
      const s3Output = {
        case: 's3',
        value: new S3Upload({accessKey, secret, region, endpoint, bucket, forcePathStyle: true}),
      };
      const folder = key.slice(0, key.lastIndexOf('/') + 1);
      const output = chunked
        ? new SegmentedFileOutput({
            protocol: SegmentedFileProtocol.HLS_PROTOCOL,
            filenamePrefix: `${folder}part`, // pieces are named part_00000.ts, part_00001.ts, ...
            playlistName: key,
            livePlaylistName: `${folder}live.m3u8`,
            segmentDuration: segmentSeconds,
            output: s3Output,
          })
        : new EncodedFileOutput({
            fileType: mode === 'audio' ? EncodedFileType.OGG : EncodedFileType.MP4,
            filepath: key,
            output: s3Output,
          });
      const options = {audioOnly: mode === 'audio'};
      if (mode === 'video') {
        options.encodingOptions = videoEncoding;
        options.layout = layout;
      }
      const info = await egress.startRoomCompositeEgress(call.room, output, options);
      await store.insert({
        id: info.egressId,
        call_id: call.id,
        room: call.room,
        caller: call.caller,
        callee: call.callee,
        requested_by: requestedBy,
        allowed_by: allowedBy,
        consent_at: now.toISOString(),
        mode,
        status: 'recording',
        destination: 'r2',
        bucket,
        object_key: key,
        started_at: now.toISOString(),
        created_at: now.toISOString(),
      });
      return {ok: true, id: info.egressId};
    } catch (e) {
      log(`could not start recording: ${e.message}`);
      return {ok: false, error: 'failed'};
    }
  }

  // Stops the recording, then waits for LiveKit to finish uploading and saves the final details.
  // Runs in the background; nothing waits for it.
  async function stopAndFinish(id) {
    try {
      await egress.stopEgress(id);
    } catch (e) {
      log(`could not stop recording ${id}: ${e.message}`); // it may already have ended with the room
    }
    for (let attempt = 0; attempt < pollAttempts; attempt++) {
      let info;
      try {
        [info] = await egress.listEgress({egressId: id});
      } catch (e) {
        log(`could not check recording ${id}: ${e.message}`);
      }
      if (info && info.status === EgressStatus.EGRESS_COMPLETE) {
        const file = info.fileResults?.[0] || info.segmentResults?.[0]; // chunked recordings report segmentResults
        const details = {
          status: 'complete',
          size_bytes: file ? Number(file.size) : null,
          duration_seconds: file ? Math.round(Number(file.duration) / 1e9) : null,
          ended_at: new Date().toISOString(),
        };
        await store.update(id, details);
        await moveToCloudinary(id, details.size_bytes);
        return 'complete';
      }
      if (info && (info.status === EgressStatus.EGRESS_FAILED || info.status === EgressStatus.EGRESS_ABORTED)) {
        await store.update(id, {status: 'failed', error: info.error || 'recording failed', ended_at: new Date().toISOString()});
        // A chunked recording that stopped early still has its uploaded pieces: keep what was recorded
        const row = await store.get(id);
        if (isChunked(row?.object_key)) {
          await moveToCloudinary(id, undefined, {salvage: true});
        }
        return 'failed';
      }
      await sleepFn(pollMs);
    }
    await store.update(id, {status: 'unknown', error: 'timed out waiting for the upload', ended_at: new Date().toISOString()});
    return 'unknown';
  }

  // The file is now in the R2 staging bucket. If Cloudinary is set up, compress it, copy it there and clear R2.
  // If that fails the file simply stays in R2 and the row says so (and it is tried again later).
  const inProgress = new Set(); // recordings being moved right now, so none is moved twice
  async function moveToCloudinary(id, sizeBytes, {salvage = false} = {}) {
    if (!archiver?.available || inProgress.has(id)) {
      return;
    }
    inProgress.add(id);
    try {
      const row = await store.get(id);
      if (!row?.object_key) {
        return;
      }
      const result = await archiver.archive({
        bucket: row.bucket,
        objectKey: row.object_key,
        callId: row.call_id,
        sizeBytes,
        mode: row.mode,
      });
      if (result.ok) {
        await store.update(id, {
          ...(salvage ? {status: 'partial'} : {}), // the call's recording stopped early; this is the part that was saved
          destination: 'cloudinary',
          cloudinary_public_id: result.publicId,
          cloudinary_resource_type: result.resourceType,
          cloudinary_delivery_type: result.deliveryType,
          size_bytes: result.bytes || sizeBytes,
          original_size_bytes: sizeBytes ?? null,
          compressed: result.compressed ? 1 : 0,
          error: null,
        });
        log(`recording ${id} stored in Cloudinary (${sizeBytes ?? '?'} -> ${result.bytes ?? '?'} bytes${result.compressed ? ', compressed' : ''})`);
      } else if (!salvage) {
        // (when salvaging, the recording's own failure message is kept instead)
        await store.update(id, {error: `Cloudinary copy failed (${result.error}); the file is still in R2`});
      }
    } finally {
      inProgress.delete(id);
    }
  }

  // Safety net: finished recordings still sitting in R2 (the server restarted in the middle, or Cloudinary was
  // down) are moved now. Run at start-up and every few minutes. Returns how many it handled.
  async function retryPendingArchives() {
    if (!archiver?.available) {
      return 0;
    }
    const ids = await store.listPendingArchive();
    for (const id of ids) {
      const row = await store.get(id);
      await moveToCloudinary(id, row?.size_bytes ?? undefined);
    }
    return ids.length;
  }

  return {
    available,
    mode,
    destination: archiver?.available ? 'cloudinary' : 'r2',
    compression: !!(archiver?.available && archiver.compression),
    start,
    stopAndFinish,
    retryPendingArchives,
    monthKey,
  };
}

// The real LiveKit client; tests pass a fake instead
function createEgressClient(env = process.env) {
  if (!(env.LIVEKIT_URL && env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET)) {
    return null;
  }
  return new EgressClient(env.LIVEKIT_URL.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:'), env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);
}

module.exports = {createRecordingService, createEgressClient};
