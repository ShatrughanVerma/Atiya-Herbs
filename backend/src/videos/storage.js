const fs = require('node:fs');
const path = require('node:path');
const {Readable} = require('node:stream');
const {pipeline} = require('node:stream/promises');

// Where the video files are kept. Nothing here is served directly: videos are only read through the checked routes of
// the API. The rest of the app uses only these four functions (save, stat, open, remove), so the place can be changed
// by choosing another kind in the settings (VIDEO_STORAGE) without touching anything else.
//   "database": inside MySQL, in small pieces (the table video_chunks). Nothing outside the database to back up.
//   "folder":   one private folder on this server.

// Keys are made by the server from a UUID and a fixed extension; anything else is refused
const validKey = key => /^[A-Za-z0-9-]{8,64}\.[a-z0-9]{2,5}$/.test(key);

// ---------------------------------------------------------------- inside MySQL
// A video is cut into pieces of exactly 1 MiB (the last one is smaller), each its own row. A whole video is never
// held in memory or sent to MySQL in one go, so the size is only limited by VIDEO_MAX_MB, not by MySQL's
// max_allowed_packet. Playing from the middle reads only the pieces that are needed.
const CHUNK = 1024 * 1024;

function createDatabaseStorage({prisma}) {
  const check = key => {
    if (!validKey(key)) {
      throw new Error('Not a valid video file name.');
    }
  };

  const insert = (key, seq, part) => prisma.videoChunk.create({data: {fileKey: key, seq, size: part.length, data: Buffer.from(part)}});

  return {
    async save(key, readable) {
      check(key);
      let seq = 0;
      let total = 0;
      let pending = [];
      let pendingLength = 0;
      try {
        for await (const piece of readable) {
          pending.push(piece);
          pendingLength += piece.length;
          while (pendingLength >= CHUNK) {
            const joined = Buffer.concat(pending);
            await insert(key, seq, joined.subarray(0, CHUNK));
            seq += 1;
            total += CHUNK;
            const rest = joined.subarray(CHUNK);
            pending = rest.length ? [rest] : [];
            pendingLength = rest.length;
          }
        }
        if (pendingLength > 0) {
          await insert(key, seq, Buffer.concat(pending));
          total += pendingLength;
        }
      } catch (error) {
        await prisma.videoChunk.deleteMany({where: {fileKey: key}}); // a failed upload leaves nothing behind
        throw error;
      }
      return total;
    },

    // {size} when the video is there, otherwise null
    async stat(key) {
      check(key);
      const sum = await prisma.videoChunk.aggregate({where: {fileKey: key}, _sum: {size: true}});
      const size = sum._sum.size ?? 0;
      return size > 0 ? {size} : null;
    },

    // A read stream, for the whole video or for the bytes start..end (both included)
    open(key, range) {
      check(key);
      async function* read() {
        if (!range) {
          for (let seq = 0; ; seq += 1) {
            const row = await prisma.videoChunk.findFirst({where: {fileKey: key, seq}});
            if (!row) {
              return;
            }
            yield Buffer.from(row.data);
          }
        }
        const first = Math.floor(range.start / CHUNK);
        const last = Math.floor(range.end / CHUNK);
        for (let seq = first; seq <= last; seq += 1) {
          const row = await prisma.videoChunk.findFirst({where: {fileKey: key, seq}});
          if (!row) {
            throw new Error('A part of the video is missing.');
          }
          const data = Buffer.from(row.data);
          yield data.subarray(seq === first ? range.start - seq * CHUNK : 0, seq === last ? range.end - seq * CHUNK + 1 : data.length);
        }
      }
      return Readable.from(read());
    },

    async remove(key) {
      check(key);
      await prisma.videoChunk.deleteMany({where: {fileKey: key}});
    },
  };
}

// ---------------------------------------------------------------- a folder on the server
function createFolderStorage({dir}) {
  const root = path.resolve(dir);
  const fileOf = key => {
    if (!validKey(key)) {
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

    async stat(key) {
      try {
        const info = await fs.promises.stat(fileOf(key));
        return info.isFile() ? {size: info.size} : null;
      } catch {
        return null;
      }
    },

    open(key, range) {
      return fs.createReadStream(fileOf(key), range ? {start: range.start, end: range.end} : undefined);
    },

    async remove(key) {
      await fs.promises.rm(fileOf(key), {force: true});
    },
  };
}

function createVideoStorage({kind = 'database', dir = './storage/videos', prisma}) {
  return kind === 'folder' ? createFolderStorage({dir}) : createDatabaseStorage({prisma});
}

module.exports = {createVideoStorage, createDatabaseStorage, createFolderStorage, CHUNK};
