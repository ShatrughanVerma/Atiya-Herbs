const {spawn: nodeSpawn} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {PassThrough} = require('node:stream');
const {pipeline} = require('node:stream/promises');

// Shrinks a recording while it is being moved, using ffmpeg, so the smaller file is what gets stored.
// Audio streams through ffmpeg (nothing is written to disk), so it uses little memory even for a long call.
// A video MP4 keeps its index at the end of the file, which ffmpeg cannot read from a pipe, so a video is
// first saved to a temporary file (deleted afterwards) and read from there. ffmpeg is installed in the
// Docker image (see Dockerfile).
//
//  - audio: mono Opus at a low "voice" bitrate (default 24 kbit/s, about 11 MB an hour). Plenty for speech.
//  - video: at most 640 px wide, H.264 at a modest quality, AAC audio at 48 kbit/s.

const audioArgs = bitrate => [
  '-hide_banner',
  '-loglevel',
  'error',
  '-i',
  'pipe:0',
  '-vn',
  '-map_metadata',
  '-1',
  '-ac',
  '1',
  '-c:a',
  'libopus',
  '-b:a',
  bitrate,
  '-application',
  'voip',
  '-f',
  'ogg',
  'pipe:1',
];

const videoArgs = (input = 'pipe:0') => [
  '-hide_banner',
  '-loglevel',
  'error',
  '-i',
  input,
  '-map_metadata',
  '-1',
  '-vf',
  "scale='min(640,iw)':-2",
  '-c:v',
  'libx264',
  '-preset',
  'veryfast',
  '-crf',
  '30',
  '-c:a',
  'aac',
  '-b:a',
  '48k',
  // an MP4 normally needs a seekable file; this form can be written to a pipe
  '-movflags',
  '+frag_keyframe+empty_moov+default_base_moof',
  '-f',
  'mp4',
  'pipe:1',
];

// `spawn`, `command` and `buildArgs` can be replaced in tests; in real use only the environment matters.
function createCompressor({env = process.env, spawn = nodeSpawn, command, buildArgs, buildVideoArgs = videoArgs} = {}) {
  // 'false' turns compression off; 'cloudinary' leaves it to Cloudinary (see cloudinaryArchive.js), so ffmpeg is not used
  const enabled = env.RECORDING_COMPRESS !== 'false' && env.RECORDING_COMPRESS !== 'cloudinary';
  const binary = command || env.FFMPEG_PATH || 'ffmpeg';
  const audioBitrate = env.RECORDING_AUDIO_BITRATE || '24k';
  const argsFor = buildArgs || (mode => (mode === 'video' ? videoArgs() : audioArgs(audioBitrate)));

  // input: a readable stream (the recording). Returns {output, finished}:
  //   output    the smaller recording, as a stream to pipe into the upload
  //   finished  resolves when ffmpeg ended cleanly; rejects if it could not start or exited with an error
  function compress(input, mode) {
    if (mode === 'video' && !buildArgs) {
      return compressVideoFile(input);
    }
    const child = spawn(binary, argsFor(mode), {stdio: ['pipe', 'pipe', 'pipe']});

    let errors = '';
    child.stderr.on('data', chunk => {
      errors = (errors + chunk).slice(-2000);
    });

    const finished = new Promise((resolve, reject) => {
      child.on('error', error => reject(new Error(`could not run ${binary}: ${error.message}`)));
      child.on('close', code => (code === 0 ? resolve() : reject(new Error(`${binary} exited with code ${code}: ${errors.trim()}`))));
    });
    finished.catch(() => {}); // the caller handles the failure; this only stops a stray "unhandled" warning

    // ffmpeg closing early makes writing to it fail; that is reported through `finished`, not as a crash
    child.stdin.on('error', () => {});
    input.on('error', () => child.kill());
    input.pipe(child.stdin);

    return {output: child.stdout, finished};
  }

  // Video: save to a temp file, then let ffmpeg read that file (seekable) and write the small MP4 to a pipe.
  function compressVideoFile(input) {
    const tempFile = path.join(os.tmpdir(), `recording-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.mp4`);
    const cleanup = () => fs.promises.rm(tempFile, {force: true}).catch(() => {});
    const output = new PassThrough();
    let child;

    const finished = (async () => {
      try {
        await pipeline(input, fs.createWriteStream(tempFile));
        await new Promise((resolve, reject) => {
          let errors = '';
          child = spawn(binary, buildVideoArgs(tempFile), {stdio: ['ignore', 'pipe', 'pipe']});
          child.stderr.on('data', chunk => {
            errors = (errors + chunk).slice(-2000);
          });
          child.on('error', error => reject(new Error(`could not run ${binary}: ${error.message}`)));
          child.on('close', code => (code === 0 ? resolve() : reject(new Error(`${binary} exited with code ${code}: ${errors.trim()}`))));
          child.stdout.pipe(output);
        });
      } catch (error) {
        output.destroy(error);
        throw error;
      } finally {
        await cleanup();
      }
    })();
    finished.catch(() => {}); // the caller handles the failure; this only stops a stray "unhandled" warning

    return {output, finished};
  }

  return {enabled, compress};
}

module.exports = {createCompressor, audioArgs, videoArgs};
