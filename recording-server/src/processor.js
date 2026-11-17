const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {spawn: nodeSpawn} = require('node:child_process');
const {finalPath: buildFinalPath} = require('./paths');

// Turns the chunks of one finished call into one MP4.
//
//  1. Check every chunk on disk (exists, same size, same SHA-256 as when it arrived). Damaged ones are marked corrupt.
//  2. Work out which chunks are missing: with expectedChunks, every number from 0 to expected-1 per track; without
//     it, any gap below the highest number seen.
//  3. If chunks are missing and we still have tries left, wait and look again (late chunks may still be on the way).
//     On the last try the call is joined from what exists and marked "partial".
//  4. FFmpeg joins each track's chunks in order and writes <callId>.mp4 (H.264 + AAC, faststart) to a ".part" file
//     that is renamed only when ffmpeg succeeded and the file is not empty.
//  5. Chunks are deleted only after a complete recording is checked (partial ones are kept for investigation).

const sha256File = file =>
  new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(file)
      .on('data', data => hash.update(data))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });

// concat list lines: file 'path'. Forward slashes work on Windows too and avoid backslash escaping.
const listLine = file => `file '${file.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`;

function runFfmpeg(binary, args, spawn = nodeSpawn) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {stdio: ['ignore', 'ignore', 'pipe']});
    let output = '';
    child.stderr.on('data', data => {
      output = (output + data).slice(-4000);
    });
    child.on('error', error => reject(new Error(`could not run ${binary}: ${error.message}`)));
    child.on('close', code => (code === 0 ? resolve(output) : reject(new Error(`${binary} exited with code ${code}: ${output.trim().slice(-500)}`))));
  });
}

function parseDuration(output) {
  const all = [...String(output).matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)];
  const last = all[all.length - 1];
  return last ? Math.round(Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3])) : null;
}

function createProcessor({config, store, logger, spawn = nodeSpawn, now = () => new Date()}) {
  // Which chunk numbers should exist, per track that has at least one chunk
  function findMissing(chunks, expected) {
    const byTrack = new Map();
    for (const chunk of chunks) {
      if (!byTrack.has(chunk.track)) {
        byTrack.set(chunk.track, new Set());
      }
      if (chunk.good) {
        byTrack.get(chunk.track).add(chunk.seq);
      }
    }
    const missing = [];
    for (const [track, seen] of byTrack) {
      const highest = Math.max(-1, ...chunks.filter(c => c.track === track).map(c => c.seq));
      const last = expected != null ? expected - 1 : highest;
      for (let seq = 0; seq <= last; seq += 1) {
        if (!seen.has(seq)) {
          missing.push(`${track}:${seq}`);
        }
      }
    }
    return missing;
  }

  async function verifyChunks(callId, chunks) {
    let corrupt = 0;
    for (const chunk of chunks) {
      let problem = null;
      try {
        const stat = await fs.promises.stat(chunk.filePath);
        if (stat.size !== chunk.sizeBytes) {
          problem = 'size differs';
        } else if ((await sha256File(chunk.filePath)) !== chunk.sha256) {
          problem = 'checksum differs';
        }
      } catch {
        problem = 'file missing';
      }
      chunk.good = !problem;
      if (problem) {
        corrupt += 1;
        logger.warn('chunk is damaged', {callId, track: chunk.track, seq: chunk.seq, problem});
        await store.updateChunk(callId, chunk.track, chunk.seq, {status: 'corrupt', transferError: problem});
      }
    }
    return corrupt;
  }

  async function join(callId, goodChunks, outFile) {
    const tmpDir = path.join(config.chunkDir, callId);
    const tracks = [...new Set(goodChunks.map(c => c.track))];
    const lists = [];
    for (const track of tracks) {
      const list = path.join(tmpDir, `${track}.concat.txt`);
      const lines = goodChunks.filter(c => c.track === track).sort((a, b) => a.seq - b.seq).map(c => listLine(c.filePath));
      await fs.promises.writeFile(list, `${lines.join('\n')}\n`);
      lists.push({track, list});
    }
    const args = ['-hide_banner', '-loglevel', 'error', '-stats', '-y'];
    for (const {list} of lists) {
      args.push('-f', 'concat', '-safe', '0', '-i', list);
    }
    // audio and video sent as two separate tracks become two inputs; "av" is one input holding both
    if (lists.length > 1) {
      lists.forEach(({track}, index) => {
        if (track === 'video') {
          args.push('-map', `${index}:v:0`);
        }
        if (track === 'audio') {
          args.push('-map', `${index}:a:0`);
        }
      });
    }
    // Smaller picture (only ever shrinks, width stays even for H.264) and fewer frames per second
    const videoFilter = `scale='min(${config.videoMaxWidth},iw)':-2,fps='min(${config.videoMaxFps},source_fps)'`;
    args.push('-vf', videoFilter, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(config.videoCrf), '-pix_fmt', 'yuv420p');
    args.push('-c:a', 'aac', '-b:a', `${config.audioKbps}k`, '-movflags', '+faststart', '-f', 'mp4', outFile);
    try {
      return await runFfmpeg(config.ffmpeg, args, spawn);
    } finally {
      await Promise.all(lists.map(({list}) => fs.promises.rm(list, {force: true})));
    }
  }

  // Returns {outcome: 'completed' | 'partial' | 'retry', ...}. Throws when ffmpeg or the disk fails (the worker retries).
  async function process(recording) {
    const {callId} = recording;
    const chunks = (await store.listChunks(callId)).filter(c => c.status !== 'deleted');
    if (chunks.length === 0) {
      throw new Error('no chunks were received for this call');
    }
    const corrupt = await verifyChunks(callId, chunks);
    const missing = findMissing(chunks, recording.expectedChunks);
    const good = chunks.filter(c => c.good);
    const lastTry = recording.attempts >= config.maxAttempts;

    if (missing.length > 0 && !lastTry) {
      await store.updateRecording(callId, {missingChunks: missing.join(',').slice(0, 500), corruptChunks: corrupt});
      return {outcome: 'retry', missing};
    }
    if (good.length === 0) {
      throw new Error('every chunk is damaged or missing');
    }

    const target = buildFinalPath(config.recordingDir, callId, recording.createdAt instanceof Date ? recording.createdAt : now());
    const part = `${target}.part`;
    await fs.promises.mkdir(path.dirname(target), {recursive: true});
    await fs.promises.rm(part, {force: true});
    let output;
    try {
      output = await join(callId, good, part);
      const stat = await fs.promises.stat(part);
      if (!stat.isFile() || stat.size === 0) {
        throw new Error('ffmpeg wrote an empty file');
      }
      await fs.promises.rename(part, target);
    } catch (error) {
      await fs.promises.rm(part, {force: true});
      throw error;
    }
    const stat = await fs.promises.stat(target);
    const originalBytes = good.reduce((sum, c) => sum + c.sizeBytes, 0);
    logger.info('recording compressed and stored', {
      callId,
      originalBytes,
      storedBytes: stat.size,
      savedPercent: originalBytes > 0 ? Math.round((1 - stat.size / originalBytes) * 100) : null,
      path: target,
    });
    const complete = missing.length === 0 && corrupt === 0;
    await store.updateRecording(callId, {
      status: complete ? 'completed' : 'partial',
      finalPath: target,
      sizeBytes: stat.size,
      durationSec: parseDuration(output),
      missingChunks: missing.length ? missing.join(',').slice(0, 500) : null,
      corruptChunks: corrupt,
      error: null,
      completedAt: now(),
    });

    if (complete && config.deleteChunksAfter) {
      for (const chunk of chunks) {
        await store.updateChunk(callId, chunk.track, chunk.seq, {status: 'deleted'});
      }
      await fs.promises.rm(path.join(config.chunkDir, callId), {recursive: true, force: true});
    }
    return {outcome: complete ? 'completed' : 'partial', missing, corrupt, finalPath: target};
  }

  return {process, findMissing};
}

module.exports = {createProcessor, runFfmpeg, parseDuration, sha256File};
