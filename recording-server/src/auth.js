const crypto = require('node:crypto');

// Compares in constant time so the key cannot be guessed from response timing
function keyMatches(given, expected) {
  if (!expected || typeof given !== 'string') {
    return false;
  }
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

function bearer(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

// role: 'ingest' (chunk upload, finish) or 'read' (status, download). The read key also opens status.
function requireKey(getKeys, role) {
  return (req, res, next) => {
    const keys = getKeys();
    const token = bearer(req);
    const ok = role === 'ingest' ? keyMatches(token, keys.ingestKey) : keyMatches(token, keys.readKey);
    if (!ok) {
      return res.status(401).json({error: 'unauthorized'});
    }
    next();
  };
}

module.exports = {keyMatches, requireKey};
