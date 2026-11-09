const {createHash} = require('node:crypto');
const {unavailable} = require('../common/errors');

const FOLDER = 'doctors';

// A signed upload for Cloudinary. The browser sends the image straight to Cloudinary with these values, so the
// secret never leaves this server. Cloudinary signs the parameters in alphabetical order: sha1("folder=..&timestamp=.." + secret).
function createUploads({config, now = () => new Date()}) {
  return {
    signPhotoUpload() {
      if (!config.CLOUDINARY_CLOUD_NAME || !config.CLOUDINARY_API_KEY || !config.CLOUDINARY_API_SECRET) {
        throw unavailable('Photo upload is not set up yet. Add the Cloudinary settings to the server.');
      }
      const timestamp = Math.floor(now().getTime() / 1000);
      const signature = createHash('sha1').update(`folder=${FOLDER}&timestamp=${timestamp}${config.CLOUDINARY_API_SECRET}`).digest('hex');
      return {cloudName: config.CLOUDINARY_CLOUD_NAME, apiKey: config.CLOUDINARY_API_KEY, timestamp, signature, folder: FOLDER};
    },
  };
}

module.exports = {createUploads};
