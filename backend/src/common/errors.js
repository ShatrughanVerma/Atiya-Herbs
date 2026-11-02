// An error whose message is safe to show to the person who called the API.
// Anything else that goes wrong is reported only as "Internal server error".
class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.details = details;
  }
}

const badRequest = (message, details) => new HttpError(400, message, details);
const unauthorized = message => new HttpError(401, message);
const forbidden = message => new HttpError(403, message);
const notFound = message => new HttpError(404, message);
const tooManyRequests = message => new HttpError(429, message);
const unavailable = message => new HttpError(503, message);

module.exports = {HttpError, badRequest, unauthorized, forbidden, notFound, tooManyRequests, unavailable};
