const {randomUUID} = require('node:crypto');
const cors = require('cors');
const express = require('express');
const helmet = require('helmet');
const {createAuditService} = require('./audit/auditService');
const {createAuthMiddleware} = require('./auth/authMiddleware');
const {createAuthRoutes} = require('./auth/authRoutes');
const {createAuthService} = require('./auth/authService');
const {createTokenService} = require('./auth/tokenService');
const {HttpError, notFound} = require('./common/errors');
const {createLimiter} = require('./common/rateLimit');
const {createHealthRoutes} = require('./health/healthRoutes');
const {createOtpService} = require('./otp/otpService');
const {createUsersRoutes} = require('./users/usersRoutes');
const {createUsersService} = require('./users/usersService');

// Builds the whole API. Everything it needs (config, database, OTP sender) is passed in, so tests can
// run it against a fake database without any network or SQL Server.
function createApp({config, prisma, sender, logger = console}) {
  const app = express();
  app.disable('x-powered-by');
  // How many proxies sit in front of the server, so req.ip is the real client and not the proxy
  app.set('trust proxy', config.TRUST_PROXY);

  // Request id + one line per request (method, path, status, time). No query string, headers or body are logged.
  app.use((req, res, next) => {
    const id = randomUUID();
    res.setHeader('X-Request-Id', id);
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = (Number(process.hrtime.bigint() - started) / 1e6).toFixed(0);
      logger.info(`${id} ${req.method} ${req.path} ${res.statusCode} ${ms}ms`);
    });
    next();
  });

  // Security headers (no sniffing, no framing, HSTS, ...)
  app.use(helmet());
  // Browsers are blocked from calling the API unless their website is listed. The mobile app needs no CORS.
  if (config.corsOrigins.length > 0) {
    app.use(
      cors({
        origin: config.corsOrigins,
        methods: ['GET', 'POST', 'PATCH', 'DELETE'],
        allowedHeaders: ['Authorization', 'Content-Type'],
        maxAge: 600,
      }),
    );
  }

  // Health checks come first: they are cheap, public and must never be rate limited
  app.use('/api/v1/health', createHealthRoutes({prisma}));

  // Responses can hold tokens, so nothing may be cached by browsers or proxies
  app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(createLimiter({limit: config.RATE_LIMIT_MAX, windowSeconds: config.RATE_LIMIT_WINDOW_SECONDS}));
  app.use(express.json({limit: '100kb'}));

  const audit = createAuditService({prisma, logger});
  const tokens = createTokenService(config);
  const otp = createOtpService({prisma, config, sender});
  const auth = createAuthService({prisma, otp, tokens, audit, config});
  const users = createUsersService({prisma, audit});
  const {requireAuth} = createAuthMiddleware({tokens});

  app.use('/api/v1/auth', createAuthRoutes({auth}));
  app.use('/api/v1/users', createUsersRoutes({users, requireAuth}));

  app.use((req, res, next) => next(notFound('Not found.')));

  // The last stop for every error. People only ever see safe messages; the details stay in the server log.
  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    if (error instanceof HttpError) {
      return res
        .status(error.status)
        .json({statusCode: error.status, message: error.message, ...(error.details && {details: error.details})});
    }
    if (error.type === 'entity.too.large') {
      return res.status(413).json({statusCode: 413, message: 'The request is too large.'});
    }
    if (error.type === 'entity.parse.failed') {
      return res.status(400).json({statusCode: 400, message: 'The request is not valid JSON.'});
    }
    if (error.type === 'charset.unsupported' || error.type === 'encoding.unsupported') {
      return res.status(415).json({statusCode: 415, message: 'Unsupported content encoding.'});
    }
    logger.error(`${req.method} ${req.path} failed: ${error.stack || error}`);
    return res.status(500).json({statusCode: 500, message: 'Internal server error'});
  });

  return app;
}

module.exports = {createApp};
