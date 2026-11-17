const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {chunkPath} = require('./paths');

// Saves one chunk: checks its checksum, writes it to the chunks folder (via a temp file, so a half-written chunk is never
// seen), records it in the database. Used by both the HTTP upload route and the B2 puller. Saving the same chunk twice
// is fine: the second time it is reported as a duplicate and nothing changes.
// Returns {status, body} (status is the HTTP code the upload route answers with).
function createIngest({config, store, logger, now = () => new Date()}) {
  async function saveChunk({callId, track, seq, bytes, claimedSha = ''}) {
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    if (claimedSha && claimedSha.toLowerCase() !== sha256) {
      // damaged on the way: the sender should send it again
      logger.warn('chunk checksum mismatch', {callId, track, seq});
      return {status: 422, body: {error: 'checksum_mismatch'}};
    }
    const when = now();
    try {
      const recording = await store.ensureRecording(callId, when);
      if (recording.status !== 'receiving') {
        return {status: 409, body: {error: 'call_closed', status: recording.status}};
      }
      const file = chunkPath(config.chunkDir, callId, track, seq);
      await fs.promises.mkdir(path.dirname(file), {recursive: true});
      const temp = `${file}.${process.pid}.tmp`;
      await fs.promises.writeFile(temp, bytes);
      await fs.promises.rename(temp, file);

      const {created, chunk} = await store.insertChunk({
        callId,
        track,
        seq,
        filePath: file,
        sizeBytes: bytes.length,
        sha256,
        status: 'received',
        transferError: null,
        receivedAt: when,
      });
      if (!created && chunk.sha256 !== sha256) {
        return {status: 409, body: {error: 'chunk_conflict'}};
      }
      await store.updateRecording(callId, {lastChunkAt: when});
      return {status: created ? 201 : 200, body: {ok: true, duplicate: !created, sha256}};
    } catch (error) {
      logger.error('chunk store failed', {callId, track, seq, error: error.message});
      return {status: 500, body: {error: 'store_failed'}};
    }
  }

  return {saveChunk};
}

module.exports = {createIngest};
