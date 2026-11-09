const {z} = require('zod');

// Pieces shared by the request schemas of every module.

// Free text that may be shown on other screens: no < > and no control characters
// eslint-disable-next-line no-control-regex -- control characters are rejected on purpose
const SAFE_TEXT = /^[^<>\u0000-\u001f]+$/;
const safeText = (min, max) => z.string().trim().min(min).max(max).regex(SAFE_TEXT, 'This has characters that are not allowed.');

// A readable id such as "t-care" or "herbal-medicine"
const slug = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lower-case letters, numbers and single dashes.');

// ?page=2&pageSize=20 (numbers arrive as text in a query string)
const pagination = {
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
};

const idParam = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);

module.exports = {safeText, slug, pagination, idParam, SAFE_TEXT};
