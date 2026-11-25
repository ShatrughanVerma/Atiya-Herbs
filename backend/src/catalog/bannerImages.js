const {randomUUID} = require('node:crypto');
const express = require('express');
const {badRequest, notFound} = require('../common/errors');

// Banner pictures uploaded from the admin panel, kept in the database (table banner_images). A banner stores
// "uploads/<name>"; the app and the panel read it from GET /api/v1/banner-images/<name>.
const MAX_BYTES = 2 * 1024 * 1024;
const NAME = /^[0-9a-f-]{36}\.(jpg|png|webp)$/;

// The type is read from the first bytes of the file, never from what the sender says it is
const kindOf = data => {
  if (data.length > 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return 'jpg';
  }
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'png';
  }
  if (data.toString('latin1', 0, 4) === 'RIFF' && data.toString('latin1', 8, 12) === 'WEBP') {
    return 'webp';
  }
  return null;
};

function createBannerImages({prisma}) {
  const save = async data => {
    const kind = Buffer.isBuffer(data) ? kindOf(data) : null;
    if (!kind) {
      throw badRequest('Choose a JPG, PNG or WEBP photo.');
    }
    const name = `${randomUUID()}.${kind}`; // our own name, never one from the sender
    await prisma.bannerImage.create({data: {name, data}});
    return {image: `uploads/${name}`};
  };

  // Public, like the banners themselves
  const routes = express.Router();
  routes.get('/:name', async (req, res) => {
    const {name} = req.params;
    const row = NAME.test(name) ? await prisma.bannerImage.findUnique({where: {name}}) : null;
    if (!row) {
      throw notFound('Picture not found.');
    }
    // the admin panel is on another address, and a name is never reused, so it may be cached
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
    res.type(name.slice(name.lastIndexOf('.') + 1)).send(Buffer.from(row.data));
  });

  return {save, routes, upload: express.raw({type: ['image/jpeg', 'image/png', 'image/webp'], limit: MAX_BYTES})};
}

module.exports = {createBannerImages, MAX_BYTES};
