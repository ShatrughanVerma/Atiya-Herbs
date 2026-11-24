const {z} = require('zod');
const {REDEEM_UNIT} = require('./rewardsRules');

const MOODS = ['great', 'good', 'okay', 'low'];

// Water drunk (+) or taken back (-), in ml. The app sends one glass at a time.
const waterSchema = z
  .object({ml: z.number().int().min(-2000).max(2000)})
  .strict()
  .refine(body => body.ml !== 0, {path: ['ml'], message: 'Enter an amount.'});

// null clears the mood
const moodSchema = z.object({mood: z.enum(MOODS).nullable()}).strict();

// A time of day as minutes after midnight (0 to 1439)
const minuteOfDay = z.number().int().min(0).max(1439);

const settingsSchema = z
  .object({
    waterGoalGlasses: z.number().int().min(1).max(30).optional(),
    glassMl: z.number().int().min(100).max(1000).optional(),
    stepGoal: z.number().int().min(1000).max(50_000).optional(),
    waterReminderOn: z.boolean().optional(),
    waterEveryMin: z.number().int().refine(value => [30, 60, 90, 120, 180].includes(value), 'Choose 30, 60, 90, 120 or 180 minutes.').optional(),
    waterFromMin: minuteOfDay.optional(),
    waterUntilMin: minuteOfDay.optional(),
    medMorningMin: minuteOfDay.optional(),
    medAfternoonMin: minuteOfDay.optional(),
    medEveningMin: minuteOfDay.optional(),
    medNightMin: minuteOfDay.optional(),
    checkinOn: z.boolean().optional(),
    checkinAtMin: minuteOfDay.optional(),
  })
  .strict()
  .refine(body => Object.values(body).some(value => value !== undefined), {message: 'Send at least one setting.'});

// The day's steps as the phone counted them so far (the total, not an addition)
const stepsSchema = z.object({steps: z.number().int().min(0).max(100_000)}).strict();

// Steps counted by the phone in a short time. batchId is made by the phone and is what stops a retry from counting twice.
const stepBatchesSchema = z
  .object({
    batches: z
      .array(
        z
          .object({
            batchId: z.string().regex(/^[A-Za-z0-9_-]{8,40}$/, 'The batch id is not valid.'),
            steps: z.number().int().min(1).max(20_000),
            recordedAt: z.string().datetime(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();

// A finished walk: when it started (ISO time), how long it lasted and how many steps
const walkSchema = z
  .object({
    startedAt: z.string().datetime(),
    durationSec: z.number().int().min(10).max(86_400),
    steps: z.number().int().min(0).max(100_000),
  })
  .strict();

// Turning points into wallet money: a whole number of redeem units (500 points = Rs 50)
const redeemSchema = z
  .object({points: z.number().int().min(REDEEM_UNIT).max(100_000)})
  .strict()
  .refine(body => body.points % REDEEM_UNIT === 0, {path: ['points'], message: `Points are added in steps of ${REDEEM_UNIT}.`});

const reportQuerySchema = z.object({range: z.enum(['daily', 'weekly', 'monthly']).default('weekly')}).strict();

const historyQuerySchema = z
  .object({days: z.coerce.number().int().refine(value => [7, 30, 90].includes(value), 'days is 7, 30 or 90.').default(30)})
  .strict();

module.exports = {MOODS, waterSchema, moodSchema, settingsSchema, stepsSchema, walkSchema, stepBatchesSchema, redeemSchema, reportQuerySchema, historyQuerySchema};
