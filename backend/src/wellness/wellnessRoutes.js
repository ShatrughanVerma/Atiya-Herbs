const express = require('express');
const {validateBody, validateQuery} = require('../common/validate');
const {historyQuerySchema, moodSchema, redeemSchema, reportQuerySchema, settingsSchema, stepBatchesSchema, stepsSchema, walkSchema, waterSchema} = require('./schemas');

// Health wellness of the logged-in person (there is no way to name another user here).
function createWellnessRoutes({wellness, requireAuth}) {
  const router = express.Router();
  router.use(requireAuth);

  // Everything the Home screen needs: today's water, mood, goals, streak and the last 7 days
  router.get('/today', async (req, res) => res.json(await wellness.today(req.user.id)));
  router.post('/water', validateBody(waterSchema), async (req, res) => res.json(await wellness.addWater(req.user.id, req.body.ml)));
  router.put('/mood', validateBody(moodSchema), async (req, res) => res.json(await wellness.setMood(req.user.id, req.body.mood)));
  router.put('/steps', validateBody(stepsSchema), async (req, res) => res.json(await wellness.setSteps(req.user.id, req.body.steps)));
  router.post('/steps/batches', validateBody(stepBatchesSchema), async (req, res) => res.json(await wellness.addStepBatches(req.user.id, req.body.batches)));
  router.get('/steps/recent', async (req, res) => res.json(await wellness.recentSteps(req.user.id)));
  router.post('/walks', validateBody(walkSchema), async (req, res) => res.status(201).json(await wellness.addWalk(req.user.id, req.body)));
  router.get('/walks', validateQuery(historyQuerySchema), async (req, res) => res.json(await wellness.listWalks(req.user.id, req.parsedQuery.days)));
  router.get('/rewards', async (req, res) => res.json(await wellness.rewards.full(req.user.id)));
  router.post('/rewards/redeem', validateBody(redeemSchema), async (req, res) => res.json(await wellness.rewards.redeem(req.user.id, req.body.points)));
  router.get('/reports', validateQuery(reportQuerySchema), async (req, res) => res.json(await wellness.reports.report(req.user.id, req.parsedQuery.range)));
  router.get('/history', validateQuery(historyQuerySchema), async (req, res) => res.json(await wellness.history(req.user.id, req.parsedQuery.days)));
  router.get('/settings', async (req, res) => res.json(await wellness.getSettings(req.user.id)));
  router.put('/settings', validateBody(settingsSchema), async (req, res) => res.json(await wellness.updateSettings(req.user.id, req.body)));

  return router;
}

module.exports = {createWellnessRoutes};
