// The video id that people read out and search by: a short running number written as V000012.
const formatVideoCode = videoNo => (Number.isInteger(videoNo) && videoNo > 0 ? `V${String(videoNo).padStart(6, '0')}` : null);

// The session id of the same upload: S000012
const formatSessionCode = videoNo => (Number.isInteger(videoNo) && videoNo > 0 ? `S${String(videoNo).padStart(6, '0')}` : null);

// "V000012", "v12" -> 12; anything else -> null
const parseVideoCode = text => {
  const match = /^v0*(\d{1,9})$/i.exec(String(text ?? '').trim());
  return match ? Number(match[1]) : null;
};

module.exports = {formatSessionCode, formatVideoCode, parseVideoCode};
