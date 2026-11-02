const {DeleteObjectCommand, GetObjectCommand, S3Client} = require('@aws-sdk/client-s3');
const {v2: cloudinaryV2} = require('cloudinary');
const {createCompressor} = require('./compress');

// Moves a finished recording from the R2 staging bucket to Cloudinary, making it smaller on the way.
//
// LiveKit can only upload recordings to S3-style buckets (R2, S3, Google Cloud, Azure), not to
// Cloudinary. So LiveKit writes the file to R2 first; this streams it through ffmpeg (compression) into
// Cloudinary and then deletes the R2 copy. If anything fails, the file is left in R2 so the recording is
// never lost, and if compression alone fails the original is stored instead.
//
// Audio is stored under Cloudinary's "video" resource type (that is how Cloudinary holds audio).
// By default files use delivery type "authenticated": they cannot be opened without a signed link.

function createCloudinaryArchiver({env = process.env, s3 = null, cloudinary = cloudinaryV2, compressor = createCompressor({env}), log = () => {}} = {}) {
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

  if (available) {
    cloudinary.config({cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret, secure: true});
  }

  const stagingClient = () => {
    if (s3) {
      return s3;
    }
    return new S3Client({
      region: env.R2_REGION || 'auto',
      endpoint: env.R2_ENDPOINT,
      credentials: {accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY},
      forcePathStyle: true,
    });
  };

  const uploadFrom = (stream, publicId) =>
    new Promise((resolve, reject) => {
      const upload = cloudinary.uploader.upload_stream(
        {resource_type: 'video', type: deliveryType, folder, public_id: publicId, overwrite: false, use_filename: false},
        (error, result) => (error ? reject(error) : resolve(result)),
      );
      stream.on('error', reject);
      stream.pipe(upload);
    });

  // One try at copying the file. With compress=true the bytes go through ffmpeg first. The upload only counts
  // if ffmpeg also ended cleanly: a half-compressed file is deleted from Cloudinary again.
  async function copyOnce(client, {bucket, objectKey, callId, mode, compress}) {
    const object = await client.send(new GetObjectCommand({Bucket: bucket, Key: objectKey}));
    const publicId = `${callId}-${Date.now()}`;
    let source = object.Body;
    let finished = Promise.resolve();
    if (compress) {
      ({output: source, finished} = compressor.compress(object.Body, mode));
    }
    const [upload, encoder] = await Promise.allSettled([uploadFrom(source, publicId), finished]);
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

  // Copies `objectKey` from the staging bucket to Cloudinary (compressed when possible). Returns
  // {ok: true, publicId, bytes, compressed, resourceType, deliveryType} or {ok: false, error}.
  async function archive({bucket, objectKey, callId, sizeBytes, mode = 'audio'}) {
    if (!available) {
      return {ok: false, error: 'not-configured'};
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
      if (compressor.enabled) {
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

  return {available, folder, deliveryType, compression: compressor.enabled, archive};
}

module.exports = {createCloudinaryArchiver};
