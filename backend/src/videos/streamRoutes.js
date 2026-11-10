const express = require('express');
const {badRequest, unauthorized} = require('../common/errors');
const {idParam} = require('../common/schemas');
const {validateQuery} = require('../common/validate');
const {streamQuerySchema} = require('./schemas');

const checkId = (req, res, next) => (idParam.safeParse(req.params.id).success ? next() : next(badRequest('The id is not valid.')));

// Plays (streams) one video. There is no login header here (a <video> tag cannot send one): the link itself is
// the permission. It was made for one video and one action by an admin, is signed by the server and works for a
// few minutes. Range requests are supported, so the player can jump around.
function createStreamRoutes({videos}) {
  const router = express.Router();

  // The address of a video (the url saved in the database) does not play by itself. Say so in plain words.
  const needsLink = (req, res, next) =>
    req.query.t === undefined && req.query.e === undefined && req.query.a === undefined
      ? next(unauthorized('This address does not play by itself. Open the video from the admin panel (Play) or from the doctor app.'))
      : next();

  router.get('/stream/:id', checkId, needsLink, validateQuery(streamQuerySchema), async (req, res, next) => {
    try {
      const file = await videos.open(req.params.id, req.parsedQuery, req.headers.range);
      res.status(file.range ? 206 : 200);
      res.set({
        'Content-Type': file.mimeType,
        'Accept-Ranges': 'bytes',
        'Content-Length': String(file.range ? file.range.end - file.range.start + 1 : file.size),
        ...(file.range && {'Content-Range': `bytes ${file.range.start}-${file.range.end}/${file.size}`}),
        'Content-Disposition': `inline; filename="${file.fileName}"`,
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
