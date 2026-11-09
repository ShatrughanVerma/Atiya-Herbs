// npm run videos:archive
// The archive policy for consultation videos. Run it once a day (a scheduled job on the server):
//  - an upload that never finished (more than an hour old) is marked failed and its half file is removed;
//  - a video older than VIDEO_RETENTION_DAYS is removed from the video folder, unless a legal hold is set on it.
//    The row stays in the database (status "archived"), so its history can still be read.
try {
  process.loadEnvFile();
} catch {
  // no .env file: the settings come from real environment variables
}

const {loadConfig} = require('../src/config/env');
const {createPrismaClient} = require('../src/prisma/client');
const {createVideoStorage} = require('../src/videos/storage');
const {createVideosService} = require('../src/videos/videosService');

async function main() {
  const config = loadConfig();
  const prisma = createPrismaClient(config);
  try {
    const videos = createVideosService({prisma, config, storage: createVideoStorage({dir: config.VIDEO_STORAGE_DIR})});
    console.log(await videos.applyRetention());
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
