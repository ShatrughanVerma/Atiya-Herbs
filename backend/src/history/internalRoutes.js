const {createHash, timingSafeEqual} = require('node:crypto');
const express = require('express');
const {createLimiter} = require('../common/rateLimit');
const {unauthorized} = require('../common/errors');
const {validateBody} = require('../common/validate');
const {ingestCallLogsSchema, ingestMessagesSchema} = require('./schemas');

// Compares two secrets without leaking, through timing, how many characters were right
const sameSecret = (given, expected) => {
  const a = createHash('sha256').update(String(given ?? '')).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
};

const isDuplicate = error => error?.code === 'P2002';

// Routes for the other server (call-backend) only: it saves call history and meeting chat here.
// Mounted only when INTERNAL_API_KEY is set; without it these paths do not exist (404).
function createInternalRoutes({prisma, config}) {
  const router = express.Router();

  router.use(createLimiter({limit: 600}));
  router.use((req, res, next) => (sameSecret(req.headers['x-internal-key'], config.INTERNAL_API_KEY) ? next() : next(unauthorized('Not allowed.'))));

  // Saves each row once: a row with an externalId that is already saved is skipped, so a retry is safe
  const saveAll = async (table, rows) => {
    let saved = 0;
    let duplicates = 0;
    for (const row of rows) {
      try {
        await table.create({data: row});
        saved += 1;
      } catch (error) {
        if (!isDuplicate(error)) {
          throw error;
        }
        duplicates += 1;
      }
    }
    return {saved, duplicates};
  };

  router.post('/call-logs', validateBody(ingestCallLogsSchema), async (req, res) => {
    const rows = req.body.logs.map(log => ({
      ...log,
      startedAt: new Date(log.startedAt),
      endedAt: log.endedAt ? new Date(log.endedAt) : null,
    }));
    res.status(201).json(await saveAll(prisma.callLog, rows));
  });

  router.post('/meeting-messages', validateBody(ingestMessagesSchema), async (req, res) => {
    const rows = req.body.messages.map(message => ({...message, sentAt: new Date(message.sentAt)}));
    res.status(201).json(await saveAll(prisma.meetingMessage, rows));
  });

  return router;
}

module.exports = {createInternalRoutes, sameSecret};
