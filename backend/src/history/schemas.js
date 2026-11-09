const {z} = require('zod');
const {pagination} = require('../common/schemas');

const MOBILE = z.string().regex(/^[6-9]\d{9}$/, 'Use a 10-digit mobile number.');
const MEETING_ID = z.string().regex(/^[a-z0-9-]{3,32}$/, 'The meeting id is not valid.');
const EXTERNAL_ID = z.string().min(1).max(64).regex(/^[A-Za-z0-9:_.-]+$/);

const historyQuerySchema = z.object({...pagination}).strict();

// ---- what call-backend sends (a batch per request) ----

const callLogSchema = z
  .object({
    externalId: EXTERNAL_ID.optional(),
    kind: z.enum(['voice', 'video', 'conference', 'meeting']),
    callerMobile: MOBILE, // for a meeting or conference: the person this row is about
    calleeMobile: MOBILE.nullable().optional(),
    meetingId: MEETING_ID.nullable().optional(),
    title: z.string().trim().min(1).max(120).nullable().optional(),
    outcome: z.enum(['completed', 'missed', 'declined', 'no-answer', 'cancelled', 'failed']),
    startedAt: z.iso.datetime(),
    endedAt: z.iso.datetime().nullable().optional(),
    durationSec: z.number().int().min(0).max(86_400 * 2).optional(),
  })
  .strict();

const messageSchema = z
  .object({
    externalId: EXTERNAL_ID.optional(),
    meetingId: MEETING_ID,
    fromMobile: MOBILE,
    fromName: z.string().trim().min(1).max(100),
    toMobile: MOBILE.nullable().optional(), // null or left out = sent to everyone
    text: z.string().min(1).max(1000),
    sentAt: z.iso.datetime(),
  })
  .strict();

const ingestCallLogsSchema = z.object({logs: z.array(callLogSchema).min(1).max(100)}).strict();
const ingestMessagesSchema = z.object({messages: z.array(messageSchema).min(1).max(50)}).strict();

module.exports = {historyQuerySchema, ingestCallLogsSchema, ingestMessagesSchema, MEETING_ID};
