const {z} = require('zod');
const {pagination, safeText, slug} = require('../common/schemas');
const {CONSULT_TYPES} = require('../consultation/schemas');

// Staff can write longer text with new lines (a bio), but never < > or other control characters
// eslint-disable-next-line no-control-regex -- control characters are rejected on purpose
const LONG_TEXT = /^[^<>\u0000-\u0008\u000b\u000c\u000e-\u001f]*$/;
const longText = max => z.string().trim().max(max).regex(LONG_TEXT, 'This has characters that are not allowed.');

// "" from a form means "nothing": it is stored as null
const emptyToNull = value => (value === '' ? null : value);
const optionalText = max => safeText(1, max).or(z.literal('')).transform(emptyToNull);

const httpsUrl = z
  .string()
  .trim()
  .max(500)
  .url()
  .refine(value => value.startsWith('https://'), 'Use an https:// address.');

// ---- appointments
const adminAppointmentsQuerySchema = z
  .object({
    status: z.enum(['requested', 'booked', 'cancelled', 'completed']).optional(),
    doctorId: slug.optional(),
    clinicId: slug.optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the date as YYYY-MM-DD.').optional(),
    q: safeText(1, 80).optional(),
    patientId: z.string().length(36).optional(),
    patientCode: z.string().regex(/^[Pp]\d{1,9}$/, 'Use the patient id like P000123.').optional(),
    ...pagination,
  })
  .strict();

// without startsAt the time the patient chose is kept
const patientsQuerySchema = z.object({q: safeText(1, 80).optional(), ...pagination}).strict();

const confirmSchema = z.object({startsAt: z.string().datetime({offset: true}).optional()}).strict();
const cancelSchema = z.object({reason: safeText(1, 200).optional()}).strict();
const declineSchema = z.object({reason: safeText(1, 200).optional()}).strict();
const noteSchema = z.object({adminNote: longText(500).transform(emptyToNull)}).strict();

// ---- doctors
const doctorFields = {
  name: safeText(2, 120),
  clinicId: slug.nullable(),
  system: safeText(1, 30),
  specialization: safeText(1, 100),
  qualifications: optionalText(200),
  experienceYears: z.number().int().min(0).max(80),
  languages: optionalText(120),
  bio: longText(2000).transform(emptyToNull),
  fee: z.number().int().min(0).max(100_000),
  modes: z.array(z.enum(CONSULT_TYPES)).min(1).max(4).refine(list => new Set(list).size === list.length, 'Each type only once.'),
  concerns: z.array(safeText(1, 40)).max(12),
  photoUrl: httpsUrl.nullable(),
  userId: z.string().length(36).nullable(), // the login of the doctor
};

const createDoctorSchema = z
  .object({
    id: slug,
    ...Object.fromEntries(
      Object.entries(doctorFields).map(([key, rule]) => [key, ['qualifications', 'languages', 'bio', 'photoUrl', 'userId', 'clinicId', 'concerns'].includes(key) ? rule.optional() : rule]),
    ),
  })
  .strict();

const updateDoctorSchema = z
  .object({...Object.fromEntries(Object.entries(doctorFields).map(([key, rule]) => [key, rule.optional()])), active: z.boolean().optional()})
  .strict()
  .refine(body => Object.keys(body).length > 0, {message: 'Send at least one field to change.'});

const adminDoctorsQuerySchema = z
  .object({
    q: safeText(1, 80).optional(),
    active: z.enum(['true', 'false']).optional(),
    clinicId: slug.optional(),
    ...pagination,
  })
  .strict();

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const timingSchema = z
  .object({
    weekday: z.number().int().min(0).max(6),
    startTime: z.string().regex(HHMM, 'Use HH:MM.'),
    endTime: z.string().regex(HHMM, 'Use HH:MM.'),
    slotMinutes: z.number().int().min(5).max(120),
  })
  .strict()
  .refine(t => t.startTime < t.endTime, {message: 'The start must be before the end.'});

const scheduleSchema = z
  .object({
    timings: z
      .array(timingSchema)
      .max(70)
      .superRefine((list, ctx) => {
        for (let weekday = 0; weekday < 7; weekday += 1) {
          const day = list.filter(t => t.weekday === weekday).sort((a, b) => a.startTime.localeCompare(b.startTime));
          for (let i = 1; i < day.length; i += 1) {
            if (day[i].startTime < day[i - 1].endTime) {
              ctx.addIssue({code: 'custom', message: 'Time ranges on the same day must not overlap.'});
              return;
            }
          }
        }
      }),
  })
  .strict();

// ---- clinics
const clinicFields = {
  name: safeText(2, 150),
  area: safeText(1, 100),
  city: safeText(1, 80),
  state: safeText(1, 80),
  pincode: z.string().regex(/^[1-9][0-9]{5}$/, 'Enter a valid pincode.').or(z.literal('')).transform(emptyToNull),
  address: optionalText(300),
  phone: z.string().regex(/^[0-9+ -]{6,20}$/, 'Enter a valid phone number.').or(z.literal('')).transform(emptyToNull),
  timings: optionalText(120),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
};

const createClinicSchema = z
  .object({
    id: slug,
    ...Object.fromEntries(Object.entries(clinicFields).map(([key, rule]) => [key, ['pincode', 'address', 'phone', 'timings'].includes(key) ? rule.optional() : rule])),
  })
  .strict();

const updateClinicSchema = z
  .object({...Object.fromEntries(Object.entries(clinicFields).map(([key, rule]) => [key, rule.optional()])), active: z.boolean().optional()})
  .strict()
  .refine(body => Object.keys(body).length > 0, {message: 'Send at least one field to change.'});

// ---- the login of a doctor: the person is found by mobile number
const doctorLoginSchema = z.object({mobile: z.string().regex(/^[6-9][0-9]{9}$/, 'Enter a valid 10-digit mobile number.')}).strict();

// Staff make the account of a doctor: mobile, optional email, and a temporary password the doctor changes at once
const createDoctorLoginSchema = z
  .object({
    mobile: z.string().regex(/^[6-9][0-9]{9}$/, 'Enter a valid 10-digit mobile number.'),
    email: z.string().trim().toLowerCase().email().max(254).optional(),
    password: z.string().max(200),
  })
  .strict();

// ---- users and credits
const findUserQuerySchema = z
  .object({mobile: z.string().regex(/^[6-9][0-9]{9}$/, 'Enter a valid 10-digit mobile number.').optional(), email: z.string().trim().toLowerCase().email().max(254).optional()})
  .strict()
  .refine(query => (query.mobile === undefined) !== (query.email === undefined), {message: 'Send either mobile or email.'});

const changeCreditsSchema = z
  .object({
    amount: z
      .number()
      .int()
      .refine(n => n !== 0 && Math.abs(n) <= 100_000, 'Use a whole number other than 0, up to 100000.'),
    reason: safeText(1, 60),
  })
  .strict();

module.exports = {
  adminAppointmentsQuerySchema,
  confirmSchema,
  cancelSchema,
  noteSchema,
  patientsQuerySchema,
  declineSchema,
  doctorLoginSchema,
  createDoctorLoginSchema,
  createDoctorSchema,
  updateDoctorSchema,
  adminDoctorsQuerySchema,
  scheduleSchema,
  createClinicSchema,
  updateClinicSchema,
  findUserQuerySchema,
  changeCreditsSchema,
};
