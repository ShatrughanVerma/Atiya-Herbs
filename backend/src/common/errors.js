// An error whose message is safe to show to the person who called the API.
// Anything else that goes wrong is reported only as "Internal server error".
class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.details = details;
    this.headers = undefined; // extra response headers, e.g. Retry-After
  }
}

const badRequest = (message, details) => new HttpError(400, message, details);
const unauthorized = message => new HttpError(401, message);
const forbidden = message => new HttpError(403, message);
const notFound = message => new HttpError(404, message);
const conflict = message => new HttpError(409, message);
const tooManyRequests = (message, retryAfterSeconds) => {
  const error = new HttpError(429, message);
  if (retryAfterSeconds) {
    error.headers = {'Retry-After': String(Math.ceil(retryAfterSeconds))};
  }
  return error;
};
const unavailable = message => new HttpError(503, message);

module.exports = {HttpError, badRequest, unauthorized, forbidden, notFound, conflict, tooManyRequests, unavailable};
