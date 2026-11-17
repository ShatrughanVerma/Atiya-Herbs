const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {EventEmitter} = require('node:events');
const {loadConfig} = require('../src/config');
const {createMemoryStore} = require('../src/db/memoryStore');
const {createApp} = require('../src/app');
const {createProcessor} = require('../src/processor');
const {createWorker} = require('../src/worker');

const INGEST = 'i'.repeat(40);
const READ = 'r'.repeat(40);

function silentLogger() {
  const events = [];
  const add = level => (message, extra) => events.push({level, message, ...extra});
  return {events, info: add('info'), warn: add('warn'), error: add('error')};
}

// Stands in for ffmpeg: writes the output file (the last argument) and reports a 12 second duration
function fakeFfmpeg({fail = false} = {}) {
  const calls = [];
  const spawn = (binary, args) => {
    calls.push({binary, args});
    const child = new EventEmitter();
    child.stderr = new EventEmitter();
    setImmediate(() => {
      if (fail) {
        child.stderr.emit('data', 'boom');
        child.emit('close', 1);
        return;
      }
      fs.writeFileSync(args[args.length - 1], 'fake mp4');
      child.stderr.emit('data', 'frame=1 time=00:00:12.30 bitrate=1kbits/s');
      child.emit('close', 0);
    });
    return child;
  };
  return {spawn, calls};
}

function setup({ffmpegFails = false, env = {}} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-'));
  const config = loadConfig({
    INGEST_KEY: INGEST,
    READ_KEY: READ,
    CHUNK_DIR: path.join(root, 'chunks'),
    RECORDING_DIR: path.join(root, 'final'),
    LOG_DIR: path.join(root, 'logs'),
    MAX_ATTEMPTS: '3',
    RETRY_BASE_SECONDS: '1',
    ...env,
  });
  const store = createMemoryStore();
  const logger = silentLogger();
  const ffmpeg = fakeFfmpeg({fail: ffmpegFails});
  let clock = new Date('2026-11-17T10:00:00Z');
  const now = () => new Date(clock);
  const app = createApp({config, store, logger, now});
  const processor = createProcessor({config, store, logger, spawn: ffmpeg.spawn, now});
  const worker = createWorker({config, store, processor, logger, now});
  return {
    root,
    config,
    store,
    logger,
    ffmpeg,
    app,
    worker,
    advance: ms => {
      clock = new Date(clock.getTime() + ms);
    },
    cleanup: () => fs.rmSync(root, {recursive: true, force: true}),
  };
}

const sha = buffer => crypto.createHash('sha256').update(buffer).digest('hex');

module.exports = {setup, sha, INGEST, READ};
