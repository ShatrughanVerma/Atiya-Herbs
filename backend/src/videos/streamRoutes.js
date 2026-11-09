const express = require('express');
const {badRequest} = require('../common/errors');
const {idParam} = require('../common/schemas');
const {validateQuery} = require('../common/validate');
const {streamQuerySchema} = require('./schemas');

const checkId = (req, res, next) => (idParam.safeParse(req.params.id).success ? next() : next(badRequest('The id is not valid.')));

// Plays or downloads one video. There is no login header here (a <video> tag cannot send one): the link itself is
// the permission. It was made for one video and one action by an admin, is signed by the server and works for a
// few minutes. Range requests are supported, so the player can jump around.
function createStreamRoutes({videos}) {
  const router = express.Router();

  router.get('/stream/:id', checkId, validateQuery(streamQuerySchema), async (req, res, next) => {
    try {
      const file = await videos.open(req.params.id, req.parsedQuery, req.headers.range);
      res.status(file.range ? 206 : 200);
      res.set({
        'Content-Type': file.mimeType,
        'Accept-Ranges': 'bytes',
        'Content-Length': String(file.range ? file.range.end - file.range.start + 1 : file.size),
        ...(file.range && {'Content-Range': `bytes ${file.range.start}-${file.range.end}/${file.size}`}),
        'Content-Disposition': `${file.download ? 'attachment' : 'inline'}; filename="${file.fileName}"`,
        'Cache-Control': 'private, no-store',
        // the admin panel is another website: its video player may load this
        'Cross-Origin-Resource-Policy': 'cross-origin',
      });
      res.on('close', () => file.stream.destroy());
      file.stream.on('error', error => (res.headersSent ? res.destroy(error) : next(error)));
      file.stream.pipe(res);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = {createStreamRoutes};
