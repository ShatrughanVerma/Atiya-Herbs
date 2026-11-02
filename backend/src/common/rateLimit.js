const {rateLimit} = require('express-rate-limit');
const {tooManyRequests} = require('./errors');

// Counts requests per client IP and answers 429 once the limit is passed.
// The counters live in memory: fine for one server. With several servers, share them (e.g. a Redis store).
const createLimiter = ({limit, windowSeconds = 60}) =>
  rateLimit({
    windowMs: windowSeconds * 1000,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (req, res, next) => next(tooManyRequests('Too many requests. Please slow down and try again shortly.')),
  });

module.exports = {createLimiter};
