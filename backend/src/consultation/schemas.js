const {z} = require('zod');
const {pagination, safeText, slug} = require('../common/schemas');

const CONSULT_TYPES = ['text', 'audio', 'video', 'clinic'];

const clinicsQuerySchema = z
  .object({
    city: safeText(1, 80).optional(),
    q: safeText(1, 80).optional(),
    // "near me": both or neither
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
  })
  .strict()
  .refine(query => (query.lat === undefined) === (query.lng === undefined), {message: 'Send lat and lng together.'});

const doctorsQuerySchema = z
  .object({
    q: safeText(1, 80).optional(),
    specialization: safeText(1, 100).optional(),
    concern: safeText(1, 60).optional(),
    clinicId: slug.optional(),
    mode: z.enum(CONSULT_TYPES).optional(),
    maxFee: z.coerce.number().int().min(0).max(100_000).optional(),
    minRating: z.coerce.number().min(0).max(5).optional(),
    ...pagination,
  })
  .strict();

const slotsQuerySchema = z.object({date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the date as YYYY-MM-DD.')}).strict();

const DURATIONS = ['Less than 1 month', '1-3 months', '3-6 months', '6-12 months', 'More than 1 year'];

// A request to see a doctor. With startsAt (one of the offered slots) the time is booked at once; without it the
// request waits for the clinic to suggest a time (optionally near preferredDate).
const bookSchema = z
  .object({
    doctorId: slug,
    type: z.enum(CONSULT_TYPES),
    startsAt: z.string().datetime({offset: true}).optional(),
    preferredDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the date as YYYY-MM-DD.').optional(),
    forSelf: z.boolean().default(true),
    patientName: safeText(2, 100).optional(), // for the account holder it defaults to the account name
    patientMobile: z.string().regex(/^[6-9][0-9]{9}$/, 'Enter a valid 10-digit mobile number.').optional(),
    city: safeText(1, 80).optional(),
    concern: safeText(1, 200).optional(),
    duration: z.enum(DURATIONS).optional(),
    reason: safeText(1, 500).optional(), // "Anything else?"
    useCredits: z.boolean().default(false),
  })
  .strict();

const listAppointmentsQuerySchema = z.object({status: z.enum(['requested', 'booked', 'cancelled', 'completed']).optional(), ...pagination}).strict();

module.exports = {CONSULT_TYPES, DURATIONS, clinicsQuerySchema, doctorsQuerySchema, slotsQuerySchema, bookSchema, listAppointmentsQuerySchema};
