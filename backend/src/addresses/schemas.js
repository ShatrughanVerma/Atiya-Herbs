const {z} = require('zod');
const {safeText} = require('../common/schemas');

// The same rules the checkout screen in the app uses.
const fields = {
  name: safeText(2, 100),
  phone: z.string().regex(/^[6-9][0-9]{9}$/, 'Enter a valid 10-digit mobile number.'),
  pincode: z.string().regex(/^[1-9][0-9]{5}$/, 'Enter a valid pincode.'),
  city: safeText(1, 80),
  state: safeText(1, 80),
  line1: safeText(5, 200),
  line2: safeText(1, 200).nullable().optional(),
  isDefault: z.boolean().optional(),
};

const createAddressSchema = z.object(fields).strict();

const updateAddressSchema = z
  .object(Object.fromEntries(Object.entries(fields).map(([key, rule]) => [key, rule.optional()])))
  .strict()
  .refine(a => Object.keys(a).length > 0, {message: 'Send at least one field to change.'});

module.exports = {createAddressSchema, updateAddressSchema};
