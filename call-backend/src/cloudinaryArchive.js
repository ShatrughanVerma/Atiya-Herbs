const {spawn: nodeSpawn} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {pipeline} = require('node:stream/promises');
const {DeleteObjectCommand, DeleteObjectsCommand, GetObjectCommand, ListObjectsV2Command, S3Client} = require('@aws-sdk/client-s3');
const {v2: cloudinaryV2} = require('cloudinary');
const {createCompressor} = require('./compress');

// Joins the .ts pieces of a chunked recording into one MP4 without re-encoding (fast, almost no CPU)
function ffmpegRemux(inputFile, outputFile, {env = process.env, spawn = nodeSpawn} = {}) {
  return new Promise((resolve, reject) => {
    const binary = env.FFMPEG_PATH || 'ffmpeg';
    const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', inputFile, '-c', 'copy', '-bsf:a', 'aac_adtstoasc', '-movflags', '+faststart', outputFile];
    const child = spawn(binary, args, {stdio: ['ignore', 'ignore', 'pipe']});
    let errors = '';
    child.stderr.on('data', chunk => {
      errors = (errors + chunk).slice(-2000);
    });
    child.on('error', error => reject(new Error(`could not run ${binary}: ${error.message}`)));
    child.on('close', code => (code === 0 ? resolve() : reject(new Error(`${binary} exited with code ${code}: ${errors.trim()}`))));
  });
}

// Moves a finished recording from the R2 staging bucket to Cloudinary, making it smaller on the way.
//
// LiveKit can only upload recordings to S3-style buckets (R2, S3, Google Cloud, Azure), not to
// Cloudinary. So LiveKit writes the file to R2 first; this streams it through ffmpeg (compression) into
// Cloudinary and then deletes the R2 copy. If anything fails, the file is left in R2 so the recording is
// never lost, and if compression alone fails the original is stored instead.
//
// Audio is stored under Cloudinary's "video" resource type (that is how Cloudinary holds audio).
// By default files use delivery type "authenticated": they cannot be opened without a signed link.

function createCloudinaryArchiver({
  env = process.env,
  s3 = null,
  cloudinary = cloudinaryV2,
  compressor = createCompressor({env}),
  remux = (input, output) => ffmpegRemux(input, output, {env}),
  log = () => {},
} = {}) {
  // Cloudinary's dashboard gives one variable, CLOUDINARY_URL=cloudinary://<key>:<secret>@<cloud name>;
  // the three separate variables also work and win if both are set
  // (a value like <your_api_key> is the unfilled placeholder from the dashboard, not a real login)
  const fromUrl = /^cloudinary:\/\/([^:@/<>\s]+):([^@/<>\s]+)@([^/?#\s]+)/.exec(env.CLOUDINARY_URL || '') || [];
  const cloudName = env.CLOUDINARY_CLOUD_NAME || fromUrl[3] || '';
  const apiKey = env.CLOUDINARY_API_KEY || fromUrl[1] || '';
  const apiSecret = env.CLOUDINARY_API_SECRET || fromUrl[2] || '';
  const available = !!(cloudName && apiKey && apiSecret);
  const folder = env.CLOUDINARY_FOLDER || 'atiyaherbs/call-recordings';
  const deliveryType = env.CLOUDINARY_DELIVERY_TYPE === 'upload' ? 'upload' : 'authenticated';
  // Cloudinary's free plan allows videos up to 100 MB per file
  const maxBytes = (Number(env.CLOUDINARY_MAX_MB) || 100) * 1024 * 1024;
  const keepStagingCopy = env.RECORDING_KEEP_R2_COPY === 'true';
  // RECORDING_COMPRESS=cloudinary: the original is uploaded as it is and Cloudinary shrinks a video while saving it
  // (an "incoming transformation": only the small version is kept). Audio is already tiny, so it is left alone.
  const cloudinaryCompress = env.RECORDING_COMPRESS === 'cloudinary';
  const incomingTransformation = mode =>
    cloudinaryCompress && mode === 'video'
      ? [{width: 640, crop: 'limit', quality: 'auto:low', video_codec: 'h264'}]
      : undefined;

  if (available) {
    cloudinary.config({cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret, secure: true});
  }

  const stagingClient = () => {
    if (s3) {
      return s3;
    }
    return new S3Client({
      region: (env.R2_REGION || '').trim() || 'auto',
      endpoint: (env.R2_ENDPOINT || '').trim(),
      credentials: {
        accessKeyId: (env.R2_ACCESS_KEY_ID || '').trim(),
        secretAccessKey: (env.R2_SECRET_ACCESS_KEY || '').trim(),
      },
      forcePathStyle: true,
    });
  };

  const uploadFrom = (stream, publicId, transformation) =>
    new Promise((resolve, reject) => {
      const options = {resource_type: 'video', type: deliveryType, folder, public_id: publicId, overwrite: false, use_filename: false};
      if (transformation) {
        options.transformation = transformation;
      }
      const upload = cloudinary.uploader.upload_stream(
        options,
        (error, result) => (error ? reject(error) : resolve(result)),
      );
      stream.on('error', reject);
      stream.pipe(upload);
    });

  // One try at copying the file. With compress=true the bytes go through ffmpeg first. The upload only counts
  // if ffmpeg also ended cleanly: a half-compressed file is deleted from Cloudinary again.
  async function copyOnce(client, {bucket, objectKey, callId, mode, compress, transformation}) {
    const object = await client.send(new GetObjectCommand({Bucket: bucket, Key: objectKey}));
    const publicId = `${callId}-${Date.now()}`;
    let source = object.Body;
    let finished = Promise.resolve();
    if (compress) {
      ({output: source, finished} = compressor.compress(object.Body, mode));
    }
    const [upload, encoder] = await Promise.allSettled([uploadFrom(source, publicId, transformation), finished]);
    if (encoder.status === 'rejected') {
      if (upload.status === 'fulfilled') {
        await cloudinary.uploader
          .destroy(upload.value.public_id, {resource_type: 'video', type: deliveryType})
          .catch(e => log(`could not remove the incomplete upload ${upload.value.public_id}: ${e.message}`));
      }
      throw encoder.reason;
    }
    if (upload.status === 'rejected') {
      throw upload.reason;
    }
    return upload.value;
  }

  // A chunked recording is a folder of short .ts pieces in the staging bucket (objectKey is its playlist). The pieces are
  // joined into one MP4 (no re-encoding; they were already recorded small), uploaded to Cloudinary as one file, and the
  // folder is then cleared. If the join fails, the joined .ts stream is uploaded instead so nothing is lost.
  const isChunked = objectKey => objectKey.endsWith('.m3u8');

  async function listPieces(client, bucket, prefix) {
    const keys = [];
    let token;
    do {
      const page = await client.send(new ListObjectsV2Command({Bucket: bucket, Prefix: prefix, ContinuationToken: token}));
      keys.push(...(page.Contents || []).map(item => item.Key));
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return keys;
  }

  async function archiveChunked(client, {bucket, objectKey, callId}) {
    const prefix = objectKey.slice(0, objectKey.lastIndexOf('/') + 1);
    const allKeys = await listPieces(client, bucket, prefix);
    const pieces = allKeys.filter(key => key.endsWith('.ts')).sort(); // zero-padded numbers, so name order is time order
    if (!pieces.length) {
      return {ok: false, error: 'no-segments'};
    }

    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'recording-'));
    try {
      const joined = path.join(dir, 'joined.ts');
      for (const key of pieces) {
        const piece = await client.send(new GetObjectCommand({Bucket: bucket, Key: key}));
        await pipeline(piece.Body, fs.createWriteStream(joined, {flags: 'a'})); // .ts pieces can simply be appended
      }
      let file = joined;
      try {
        const mp4 = path.join(dir, 'recording.mp4');
        await remux(joined, mp4);
        file = mp4;
      } catch (e) {
        log(`could not join the recording pieces into an MP4 (${e.message}); storing the joined .ts stream instead`);
      }
      const size = (await fs.promises.stat(file)).size;
      if (size > maxBytes) {
        return {ok: false, error: 'too-large'};
      }

      const uploaded = await uploadFrom(fs.createReadStream(file), `${callId}-${Date.now()}`);
      if (!keepStagingCopy) {
        for (let i = 0; i < allKeys.length; i += 1000) {
          await client
            .send(new DeleteObjectsCommand({Bucket: bucket, Delete: {Objects: allKeys.slice(i, i + 1000).map(Key => ({Key})), Quiet: true}}))
            .catch(e => log(`could not delete the staging pieces under ${prefix}: ${e.message}`));
        }
      }
      return {
        ok: true,
        publicId: uploaded.public_id,
        bytes: uploaded.bytes,
        compressed: false, // recorded small from the start, so there is nothing more to shrink here
        resourceType: uploaded.resource_type || 'video',
        deliveryType: uploaded.type || deliveryType,
        pieces: pieces.length,
      };
    } finally {
      await fs.promises.rm(dir, {recursive: true, force: true}).catch(() => {});
    }
  }

  // Copies `objectKey` from the staging bucket to Cloudinary (compressed when possible). Returns
  // {ok: true, publicId, bytes, compressed, resourceType, deliveryType} or {ok: false, error}.
  async function archive({bucket, objectKey, callId, sizeBytes, mode = 'audio'}) {
    if (!available) {
      return {ok: false, error: 'not-configured'};
    }
    if (isChunked(objectKey)) {
      try {
        return await archiveChunked(stagingClient(), {bucket, objectKey, callId});
      } catch (e) {
        log(`could not copy the recording to Cloudinary: ${e.message || JSON.stringify(e)}`);
        return {ok: false, error: 'upload-failed'};
      }
    }
    const originalTooLarge = !!sizeBytes && sizeBytes > maxBytes;
    // A big original can still fit once compressed, so only refuse it when compression is off
    if (originalTooLarge && !compressor.enabled) {
      return {ok: false, error: 'too-large'};
    }

    const client = stagingClient();
    const args = {bucket, objectKey, callId, mode};
    let uploaded = null;
    let compressed = false;
    try {
      const transformation = incomingTransformation(mode);
      if (transformation) {
        try {
          uploaded = await copyOnce(client, {...args, compress: false, transformation});
          compressed = true;
        } catch (e) {
          log(`Cloudinary could not compress the recording (${e.message}); storing the original recording instead`);
        }
      } else if (compressor.enabled) {
        try {
          uploaded = await copyOnce(client, {...args, compress: true});
          compressed = true;
        } catch (e) {
          log(`compression did not work (${e.message}); storing the original recording instead`);
        }
      }
      if (!uploaded) {
        if (originalTooLarge) {
          return {ok: false, error: 'too-large'};
        }
        uploaded = await copyOnce(client, {...args, compress: false});
      }

      // Safely stored in Cloudinary: remove the staging copy (unless asked to keep it)
      if (!keepStagingCopy) {
        await client
          .send(new DeleteObjectCommand({Bucket: bucket, Key: objectKey}))
          .catch(e => log(`could not delete the R2 staging copy ${objectKey}: ${e.message}`));
      }
      return {
        ok: true,
        publicId: uploaded.public_id,
        bytes: uploaded.bytes,
        compressed,
        resourceType: uploaded.resource_type || 'video',
        deliveryType: uploaded.type || deliveryType,
      };
    } catch (e) {
      log(`could not copy the recording to Cloudinary: ${e.message || JSON.stringify(e)}`);
      return {ok: false, error: 'upload-failed'};
    }
  }

  return {available, folder, deliveryType, compression: compressor.enabled || cloudinaryCompress, archive};
}

module.exports = {createCloudinaryArchiver};
