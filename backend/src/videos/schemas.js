const {z} = require('zod');
const {pagination, safeText, slug} = require('../common/schemas');
const {EXTENSIONS} = require('./videosService');

// The doctor's form: the patient id (P000123), the doctor id (the doctor's own), the file that is coming, and that the
// patient agreed to the recording
const startVideoSchema = z
  .object({
    patientId: z.string().trim().regex(/^[Pp]\d{1,9}$/, 'Enter the patient ID like P000123.'),
    doctorId: slug,
    mimeType: z.enum(Object.keys(EXTENSIONS)),
    sizeBytes: z.number().int().min(1).optional(),
    durationSec: z.number().int().min(0).max(86_400).optional(),
    consent: z.literal(true, {error: 'Confirm that the patient agreed to the recording.'}),
  })
  .strict();

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the date as YYYY-MM-DD.');

// Search by video id, patient id, mobile or patient name (q), patient id, doctor, or dates
const adminVideosQuerySchema = z
  .object({
    q: safeText(1, 80).optional(),
    doctor: safeText(1, 80).optional(),
    doctorId: slug.optional(),
    patientId: z.string().length(36).optional(),
    patientCode: z.string().regex(/^[Pp]\d{1,9}$/, 'Use the patient id like P000123.').optional(),
    status: z.enum(['uploading', 'uploaded', 'failed']).optional(),
    from: ymd.optional(),
    to: ymd.optional(),
    ...pagination,
  })
  .strict();

// Videos can only be played (streamed), never downloaded
const doctorVideosQuerySchema = z
  .object({q: safeText(1, 80).optional(), status: z.enum(['uploading', 'uploaded', 'failed']).optional()})
  .strict();

const linkSchema = z.object({action: z.literal('play')}).strict();
// a doctor can only play their own video
const doctorLinkSchema = z.object({action: z.literal('play')}).strict();
const holdSchema = z.object({legalHold: z.boolean()}).strict();

// ?a=play&e=1767000000&t=<signature>
const streamQuerySchema = z
  .object({a: z.literal('play'), e: z.string().regex(/^\d{1,12}$/), t: z.string().regex(/^[0-9a-f]{64}$/)})
  .strict();

module.exports = {startVideoSchema, doctorVideosQuerySchema, adminVideosQuerySchema, linkSchema, doctorLinkSchema, holdSchema, streamQuerySchema};
