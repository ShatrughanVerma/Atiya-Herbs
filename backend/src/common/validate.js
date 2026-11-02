const {badRequest} = require('./errors');

// Checks the request body against a zod schema before the route runs. Schemas are .strict(), so any field the
// route does not expect is rejected rather than silently passed on (this stops users sending "role": "admin").
// The error lists the field and the rule, never the value that was sent.
const validateBody = schema => (req, res, next) => {
  const result = schema.safeParse(req.body ?? {});
  if (!result.success) {
    const details = result.error.issues.map(issue => ({field: issue.path.join('.') || 'body', message: issue.message}));
    return next(badRequest('Some details are not valid.', details));
  }
  req.body = result.data;
  return next();
};

module.exports = {validateBody};
