const {EgressClient} = require('livekit-server-sdk');
const {EgressStatus, EncodedFileOutput, EncodedFileType, S3Upload} = require('@livekit/protocol');
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
  const endpoint = env.R2_ENDPOINT || '';
  const accessKey = env.R2_ACCESS_KEY_ID || '';
  const secret = env.R2_SECRET_ACCESS_KEY || '';
  const bucket = env.R2_BUCKET || '';
  const mode = env.RECORDING_MODE === 'video' ? 'video' : 'audio'; // audio is much smaller and cheaper
  // LiveKit's free plan includes about 60 recording minutes a month, so stop a little before that
  const monthlyLimitSeconds = (Number(env.RECORDING_MONTHLY_MINUTES) || 50) * 60;
  const pollMs = Number(env.RECORDING_POLL_MS) || 2000;
  const pollAttempts = Number(env.RECORDING_POLL_ATTEMPTS) || 60;

  const available =
    env.RECORDING_ENABLED !== 'false' && !!(livekitConfigured && endpoint && accessKey && secret && bucket && egress);

  const objectKey = (callId, now = new Date()) =>
    `recordings/${now.getUTCFullYear()}/${pad(now.getUTCMonth() + 1)}/${callId}-${now.getTime()}.${mode === 'audio' ? 'ogg' : 'mp4'}`;

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
      const output = new EncodedFileOutput({
        fileType: mode === 'audio' ? EncodedFileType.OGG : EncodedFileType.MP4,
        filepath: key,
        output: {
          case: 's3',
          value: new S3Upload({accessKey, secret, region: 'auto', endpoint, bucket, forcePathStyle: true}),
        },
      });
      const info = await egress.startRoomCompositeEgress(call.room, output, {audioOnly: mode === 'audio'});
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
        const file = info.fileResults?.[0];
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
        return 'failed';
      }
      await sleepFn(pollMs);
    }
    await store.update(id, {status: 'unknown', error: 'timed out waiting for the upload', ended_at: new Date().toISOString()});
    return 'unknown';
  }

  // The file is now in the R2 staging bucket. If Cloudinary is set up, copy it there and clear R2.
  // If that fails the file simply stays in R2 and the row says so.
  async function moveToCloudinary(id, sizeBytes) {
    if (!archiver?.available) {
      return;
    }
    const row = await store.get(id);
    if (!row?.object_key) {
      return;
    }
    const result = await archiver.archive({
      bucket: row.bucket,
      objectKey: row.object_key,
      callId: row.call_id,
      sizeBytes,
    });
    if (result.ok) {
      await store.update(id, {
        destination: 'cloudinary',
        cloudinary_public_id: result.publicId,
        cloudinary_resource_type: result.resourceType,
        cloudinary_delivery_type: result.deliveryType,
        size_bytes: result.bytes || sizeBytes,
      });
    } else {
      await store.update(id, {error: `Cloudinary copy failed (${result.error}); the file is still in R2`});
    }
  }

  return {available, mode, destination: archiver?.available ? 'cloudinary' : 'r2', start, stopAndFinish, monthKey};
}

// The real LiveKit client; tests pass a fake instead
function createEgressClient(env = process.env) {
  if (!(env.LIVEKIT_URL && env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET)) {
    return null;
  }
  return new EgressClient(env.LIVEKIT_URL.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:'), env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);
}

module.exports = {createRecordingService, createEgressClient};
