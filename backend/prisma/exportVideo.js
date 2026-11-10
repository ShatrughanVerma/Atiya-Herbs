// npm run videos:export -- V000008 [folder]
// Writes one saved video to a normal file (default: the folder "AtiyaHerbsVideos" on the Desktop), so that it can be opened
// in any player. The video itself stays where it is (in the database); this only makes a copy. Run by the company only.
try {
  process.loadEnvFile();
} catch {
  // no .env file: the settings come from real environment variables
}
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {pipeline} = require('node:stream/promises');
const {parseVideoCode} = require('../src/common/videoCode');

async function main() {
  const videoNo = parseVideoCode(process.argv[2]);
  if (!videoNo) {
    throw new Error('Use: npm run videos:export -- V000008 [folder]');
  }
  const {loadConfig} = require('../src/config/env');
  const {createPrismaClient} = require('../src/prisma/client');
  const {createVideoStorage} = require('../src/videos/storage');
  const config = loadConfig();
  const prisma = createPrismaClient(config);
  try {
    const video = await prisma.consultVideo.findUnique({where: {videoNo}});
    if (!video || !video.fileName) {
      throw new Error('No such video.');
    }
    if (!['uploaded', 'held'].includes(video.status)) {
      throw new Error(`This video is ${video.status}: there is no file to export.`);
    }
    const storage = createVideoStorage({kind: config.VIDEO_STORAGE, dir: config.VIDEO_STORAGE_DIR, prisma});
    if (!(await storage.stat(video.fileName))) {
      throw new Error('The video file is missing from the storage.');
    }
    const folder = process.argv[3] ? path.resolve(process.argv[3]) : path.join(os.homedir(), 'Desktop', 'AtiyaHerbsVideos');
    fs.mkdirSync(folder, {recursive: true});
    const target = path.join(folder, `${video.videoCode}-${video.patientName.replace(/[^\w]+/g, '_')}.${video.fileName.split('.').pop()}`);
    await pipeline(storage.open(video.fileName, null), fs.createWriteStream(target));
    console.log(`Done. Saved to ${target}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
