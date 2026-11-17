const path = require('node:path');
const express = require('express');
const {requireKey} = require('./auth');
const {createIngest} = require('./ingest');
const {isSafeId, isTrack} = require('./paths');

// The HTTP side of the recording server.
//
//   PUT  /calls/:callId/tracks/:track/chunks/:seq   (ingest key)  one chunk; header x-chunk-sha256 is checked
//   POST /calls/:callId/finish                       (ingest key)  the call is over; body {expectedChunks?: n}
//   GET  /calls/:callId/status                       (read key)    status, chunk counts, missing chunks
//   GET  /calls/:callId/recording                    (read key)    the finished MP4 (supports Range for seeking)
//   GET  /health                                     (no key)      up or not, nothing private
//
// Chunk upload is safe to repeat: the same chunk sent twice is stored once, so the sender can retry freely.
function createApp({config, store, logger, now = () => new Date()}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use((req, res, next) => {
    res.set({'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'});
    next();
  });

  const saver = createIngest({config, store, logger, now});
  const ingest = requireKey(() => config, 'ingest');
  const read = requireKey(() => config, 'read');

  const validIds = (req, res, next) => {
    if (!isSafeId(req.params.callId)) {
      return res.status(400).json({error: 'bad_call_id'});
    }
    next();
  };

  app.get('/health', (req, res) => res.json({ok: true}));

  app.put(
    '/calls/:callId/tracks/:track/chunks/:seq',
    ingest,
    validIds,
    express.raw({type: () => true, limit: config.maxChunkBytes}),
    async (req, res) => {
      const {callId, track} = req.params;
      const seq = Number(req.params.seq);
      if (!isTrack(track) || !Number.isInteger(seq) || seq < 0 || seq > 999999) {
        return res.status(400).json({error: 'bad_chunk_address'});
      }
      const body = req.body;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        return res.status(400).json({error: 'empty_chunk'});
      }
      const result = await saver.saveChunk({callId, track, seq, bytes: body, claimedSha: String(req.get('x-chunk-sha256') || '')});
      return res.status(result.status).json(result.body);
    },
  );

  app.post('/calls/:callId/finish', ingest, validIds, express.json({limit: '4kb'}), async (req, res) => {
    const expected = req.body && req.body.expectedChunks;
    if (expected != null && !(Number.isInteger(expected) && expected >= 0 && expected <= 1000000)) {
      return res.status(400).json({error: 'bad_expected_chunks'});
    }
    try {
      const recording = await store.requestFinish(req.params.callId, expected == null ? null : expected, now());
      logger.info('call finished, queued for processing', {callId: req.params.callId, expectedChunks: expected ?? null});
      return res.status(202).json({ok: true, status: recording.status});
    } catch (error) {
      logger.error('finish failed', {callId: req.params.callId, error: error.message});
      return res.status(500).json({error: 'finish_failed'});
    }
  });

  app.get('/calls/:callId/status', read, validIds, async (req, res) => {
    try {
      const recording = await store.getRecording(req.params.callId);
      if (!recording) {
        return res.status(404).json({error: 'not_found'});
      }
      const chunks = await store.listChunks(req.params.callId);
      return res.json({
        callId: recording.callId,
        status: recording.status,
        chunks: chunks.length,
        expectedChunks: recording.expectedChunks,
        missingChunks: recording.missingChunks,
        corruptChunks: recording.corruptChunks,
        attempts: recording.attempts,
        sizeBytes: recording.sizeBytes,
        durationSec: recording.durationSec,
        error: recording.error,
        completedAt: recording.completedAt,
      });
    } catch (error) {
      logger.error('status failed', {callId: req.params.callId, error: error.message});
      return res.status(500).json({error: 'status_failed'});
    }
  });

  app.get('/calls/:callId/recording', read, validIds, async (req, res) => {
    try {
      const recording = await store.getRecording(req.params.callId);
      if (!recording || !['completed', 'partial'].includes(recording.status) || !recording.finalPath) {
        return res.status(404).json({error: 'not_ready'});
      }
      // finalPath comes from our own database, never from the request
      return res.sendFile(path.resolve(recording.finalPath), {headers: {'Content-Type': 'video/mp4'}}, error => {
        if (error && !res.headersSent) {
          res.status(404).json({error: 'file_missing'});
        }
      });
    } catch (error) {
      logger.error('download failed', {callId: req.params.callId, error: error.message});
      return res.status(500).json({error: 'download_failed'});
    }
  });

  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    if (error && error.type === 'entity.too.large') {
      return res.status(413).json({error: 'chunk_too_large'});
    }
    logger.error('request failed', {error: error && error.message});
    return res.status(error && error.status ? error.status : 500).json({error: 'request_failed'});
  });

  return app;
}

module.exports = {createApp};
