const path = require('node:path');

// Call ids and tracks become folder/file names, so only plain characters are allowed (no "..", slashes or drive letters)
const SAFE_ID = /^[A-Za-z0-9_-]{1,100}$/;
const TRACKS = new Set(['av', 'audio', 'video']);

const isSafeId = value => typeof value === 'string' && SAFE_ID.test(value);
const isTrack = value => TRACKS.has(value);

const pad = n => String(n).padStart(2, '0');

function chunkPath(chunkDir, callId, track, seq) {
  return path.join(chunkDir, callId, `${track}-${String(seq).padStart(6, '0')}.chunk`);
}

// Final files are grouped by month: D:\recordings\final\2026-11\<callId>.mp4
function finalPath(recordingDir, callId, date) {
  return path.join(recordingDir, `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}`, `${callId}.mp4`);
}

module.exports = {isSafeId, isTrack, chunkPath, finalPath};
