// "Leave the recording where LiveKit wrote it." Used when RECORDING_ARCHIVE=staging.
//
// Normally, once a call's recording is finished, this server moves it on (to Cloudinary, or to the Recording Server) and
// clears the staging bucket. With this archiver it does neither: the chunks stay in the staging bucket (Backblaze B2 or
// any S3-style bucket) and the separate Recording Server, which has its own disk, pulls them from there
// (see recording-server/src/puller.js) and clears the bucket itself. This is the setup for a call backend hosted on
// Render, which can't reach a recording server running on a PC at home or in the office.
function createStagingArchiver({env = process.env} = {}) {
  const available = (env.RECORDING_ARCHIVE || '').trim() === 'staging';
  return {
    available,
    destination: 'staging',
    compression: false,
    // Nothing to copy; reporting success only records that the file is in staging, ready to be pulled
    async archive({sizeBytes} = {}) {
      return {ok: true, destination: 'staging', bytes: sizeBytes ?? null, compressed: false, chunks: 0};
    },
  };
}

module.exports = {createStagingArchiver};
