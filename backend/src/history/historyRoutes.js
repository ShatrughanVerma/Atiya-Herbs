const express = require('express');
const {badRequest} = require('../common/errors');
const {validateQuery} = require('../common/validate');
const {historyQuerySchema, MEETING_ID} = require('./schemas');

function createHistoryRoutes({history, requireAuth}) {
  const router = express.Router();
  router.use(requireAuth);

  router.get('/calls', validateQuery(historyQuerySchema), async (req, res) => {
    res.json(await history.calls(req.user.id, req.parsedQuery));
  });
  router.get('/meetings', validateQuery(historyQuerySchema), async (req, res) => {
    res.json(await history.meetings(req.user.id, req.parsedQuery));
  });
  router.get('/meetings/:meetingId/messages', validateQuery(historyQuerySchema), async (req, res) => {
    if (!MEETING_ID.safeParse(req.params.meetingId).success) {
      throw badRequest('The meeting id is not valid.');
    }
    res.json(await history.meetingMessages(req.user.id, req.params.meetingId, req.parsedQuery));
  });

  return router;
}

module.exports = {createHistoryRoutes};
