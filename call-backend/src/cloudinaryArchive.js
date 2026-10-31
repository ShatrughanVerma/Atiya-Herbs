const {DeleteObjectCommand, GetObjectCommand, S3Client} = require('@aws-sdk/client-s3');
const {v2: cloudinaryV2} = require('cloudinary');

// Moves a finished recording from the R2 staging bucket to Cloudinary.
//
// LiveKit can only upload recordings to S3-style buckets (R2, S3, Google Cloud, Azure), not to
// Cloudinary. So LiveKit writes the file to R2 first; this copies it to Cloudinary and then deletes
// the R2 copy. If anything fails, the file is left in R2 so the recording is never lost.
//
// Audio is stored under Cloudinary's "video" resource type (that is how Cloudinary holds audio).
// By default files use delivery type "authenticated": they cannot be opened without a signed link.

function createCloudinaryArchiver({
  env = process.env,
  s3 = null,
  cloudinary = cloudinaryV2,
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

  if (available) {
    cloudinary.config({cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret, secure: true});
  }

  const stagingClient = () => {
    if (s3) {
      return s3;
    }
    return new S3Client({
      region: 'auto',
      endpoint: env.R2_ENDPOINT,
      credentials: {accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY},
      forcePathStyle: true,
    });
  };

  // Copies `objectKey` from the staging bucket to Cloudinary. Returns
  // {ok: true, publicId, bytes, resourceType, deliveryType} or {ok: false, error}.
  async function archive({bucket, objectKey, callId, sizeBytes}) {
    if (!available) {
      return {ok: false, error: 'not-configured'};
    }
    if (sizeBytes && sizeBytes > maxBytes) {
      return {ok: false, error: 'too-large'};
    }
    const client = stagingClient();
    try {
      const object = await client.send(new GetObjectCommand({Bucket: bucket, Key: objectKey}));
      const publicId = `${callId}-${Date.now()}`;
      const uploaded = await new Promise((resolve, reject) => {
        const upload = cloudinary.uploader.upload_stream(
          {
            resource_type: 'video',
            type: deliveryType,
            folder,
            public_id: publicId,
            overwrite: false,
            use_filename: false,
          },
          (error, result) => (error ? reject(error) : resolve(result)),
        );
        object.Body.on('error', reject);
        object.Body.pipe(upload);
      });

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
        resourceType: uploaded.resource_type || 'video',
        deliveryType: uploaded.type || deliveryType,
      };
    } catch (e) {
      log(`could not copy the recording to Cloudinary: ${e.message || JSON.stringify(e)}`);
      return {ok: false, error: 'upload-failed'};
    }
  }

  return {available, folder, deliveryType, archive};
}

module.exports = {createCloudinaryArchiver};
