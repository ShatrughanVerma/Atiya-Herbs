// The video id that people read out and search by: a short running number written as V000012.
const formatVideoCode = videoNo => (Number.isInteger(videoNo) && videoNo > 0 ? `V${String(videoNo).padStart(6, '0')}` : null);

// "V000012", "v12" -> 12; anything else -> null
const parseVideoCode = text => {
  const match = /^v0*(\d{1,9})$/i.exec(String(text ?? '').trim());
  return match ? Number(match[1]) : null;
};

module.exports = {formatVideoCode, parseVideoCode};
