const {z} = require('zod');
const {pagination, safeText, slug} = require('../common/schemas');
const {EXTENSIONS} = require('./videosService');

// The doctor says what is coming: the type of the file, its size, and that the patient agreed to the recording
const startVideoSchema = z
  .object({
    mimeType: z.enum(Object.keys(EXTENSIONS)),
    sizeBytes: z.number().int().min(1).optional(),
    durationSec: z.number().int().min(0).max(86_400).optional(),
    consent: z.literal(true, {error: 'Confirm that the patient agreed to the recording.'}),
  })
  .strict();

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the date as YYYY-MM-DD.');

// Search by mobile / patient name / appointment number (q), patient id, appointment (call) id, doctor, or dates
const adminVideosQuerySchema = z
  .object({
    q: safeText(1, 80).optional(),
    doctor: safeText(1, 80).optional(),
    doctorId: slug.optional(),
    patientId: z.string().length(36).optional(),
    patientCode: z.string().regex(/^[Pp]\d{1,9}$/, 'Use the patient id like P000123.').optional(),
    appointmentId: z.string().length(36).optional(),
    status: z.enum(['uploading', 'uploaded', 'failed']).optional(),
    from: ymd.optional(),
    to: ymd.optional(),
    ...pagination,
  })
  .strict();

const linkSchema = z.object({action: z.enum(['play', 'download'])}).strict();
const holdSchema = z.object({legalHold: z.boolean()}).strict();

// ?a=play&e=1767000000&t=<signature>
const streamQuerySchema = z
  .object({a: z.enum(['play', 'download']), e: z.string().regex(/^\d{1,12}$/), t: z.string().regex(/^[0-9a-f]{64}$/)})
  .strict();

module.exports = {startVideoSchema, adminVideosQuerySchema, linkSchema, holdSchema, streamQuerySchema};
