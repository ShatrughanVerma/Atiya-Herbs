const {z} = require('zod');

// Only these two fields can be changed by the user. Anything else in the request (role, mobile, status, ...)
// is rejected because the schema is strict, so a user can never promote themselves.
const updateProfileSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2)
      .max(100)
      // no < > or control characters: the name is shown in other screens (and later in the admin panel)
      // eslint-disable-next-line no-control-regex -- control characters are rejected on purpose
      .regex(/^[^<>\u0000-\u001f]+$/, 'name has characters that are not allowed.')
      .optional(),
    email: z
      .string()
      .trim()
      .max(254)
      .pipe(z.email())
      .transform(value => value.toLowerCase()) // one account per email, whatever the capital letters
      .optional(),
  })
  .strict();

module.exports = {updateProfileSchema};
