const fs = require('node:fs');
const path = require('node:path');
const {pipeline} = require('node:stream/promises');

// Where the video files are kept: one private folder on this server. Nothing here is served directly: videos
// are only read through the checked routes of the API. The rest of the app only uses these four functions, so the
// folder can later be replaced by cloud storage (S3) by writing another version of this one file.
function createVideoStorage({dir}) {
  const root = path.resolve(dir);

  // Keys are made by the server from a UUID and a fixed extension; anything else is refused, so a key can never
  // point outside the folder
  const fileOf = key => {
    if (!/^[A-Za-z0-9-]{8,64}\.[a-z0-9]{2,5}$/.test(key)) {
      throw new Error('Not a valid video file name.');
    }
    return path.join(root, key);
  };

  return {
    // Writes a stream to disk. Resolves with the number of bytes written; a stream that fails leaves nothing behind.
    async save(key, readable) {
      await fs.promises.mkdir(root, {recursive: true});
      const target = fileOf(key);
      let bytes = 0;
      readable.on('data', chunk => {
        bytes += chunk.length;
      });
      try {
        await pipeline(readable, fs.createWriteStream(target, {flags: 'wx'}));
      } catch (error) {
        await fs.promises.rm(target, {force: true});
        throw error;
      }
      return bytes;
    },

    // {size} when the file is there, otherwise null
    async stat(key) {
      try {
        const info = await fs.promises.stat(fileOf(key));
        return info.isFile() ? {size: info.size} : null;
      } catch {
        return null;
      }
    },

    // A read stream, for the whole file or for the bytes start..end (both included)
    open(key, range) {
      return fs.createReadStream(fileOf(key), range ? {start: range.start, end: range.end} : undefined);
    },

    async remove(key) {
      await fs.promises.rm(fileOf(key), {force: true});
    },
  };
}

module.exports = {createVideoStorage};
