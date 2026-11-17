const fs = require('node:fs');
const path = require('node:path');

// One JSON line per event, to the console and to a file per day in LOG_DIR (so Windows services keep a trail).
// Never logs keys or file contents.
function createLogger({dir = null, now = () => new Date(), out = console} = {}) {
  let ready = false;
  const write = (level, message, extra) => {
    const time = now();
    const line = JSON.stringify({time: time.toISOString(), level, message, ...extra});
    (level === 'error' ? out.error : out.log)(line);
    if (!dir) {
      return;
    }
    try {
      if (!ready) {
        fs.mkdirSync(dir, {recursive: true});
        ready = true;
      }
      fs.appendFileSync(path.join(dir, `recording-${time.toISOString().slice(0, 10)}.log`), `${line}\n`);
    } catch {
      // logging must never break recording
    }
  };
  return {
    info: (message, extra) => write('info', message, extra),
    warn: (message, extra) => write('warn', message, extra),
    error: (message, extra) => write('error', message, extra),
  };
}

module.exports = {createLogger};
