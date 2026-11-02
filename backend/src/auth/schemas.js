const {z} = require('zod');
const {normalizeMobile} = require('../common/mobile');

// Accepts +91 98765 43210, 098765-43210 or 9876543210 and turns it into the plain 10 digits
const mobile = z
  .string()
  .transform(normalizeMobile)
  .refine(value => value !== '', 'Enter a valid 10-digit Indian mobile number.');

const requestOtpSchema = z.object({mobile}).strict();

const verifyOtpSchema = z
  .object({
    mobile,
    code: z.string().regex(/^\d{6}$/, 'The code is 6 digits.'),
    // e.g. "Redmi Note 10"
    deviceName: z
      .string()
      .max(100)
      // eslint-disable-next-line no-control-regex -- control characters are rejected on purpose
      .regex(/^[^<>\u0000-\u001f]*$/, 'deviceName has characters that are not allowed.')
      .optional(),
  })
  .strict();

const refreshSchema = z.object({refreshToken: z.string().min(40).max(200)}).strict();

module.exports = {requestOtpSchema, verifyOtpSchema, refreshSchema};
