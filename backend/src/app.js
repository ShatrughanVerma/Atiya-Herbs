const {randomUUID} = require('node:crypto');
const cors = require('cors');
const express = require('express');
const helmet = require('helmet');
const {createCartRoutes} = require('./cart/cartRoutes');
const {createCartService} = require('./cart/cartService');
const {createAddressesRoutes} = require('./addresses/addressesRoutes');
const {createAddressesService} = require('./addresses/addressesService');
const {createAuditService} = require('./audit/auditService');
const {createAuthMiddleware} = require('./auth/authMiddleware');
const {createAuthRoutes} = require('./auth/authRoutes');
const {createAuthService} = require('./auth/authService');
const {createCatalogRoutes} = require('./catalog/catalogRoutes');
const {createCatalogService} = require('./catalog/catalogService');
const {createTokenService} = require('./auth/tokenService');
const {HttpError, notFound} = require('./common/errors');
const {createLimiter} = require('./common/rateLimit');
const {createHealthRoutes} = require('./health/healthRoutes');
const {createHistoryRoutes} = require('./history/historyRoutes');
const {createHistoryService} = require('./history/historyService');
const {createInternalRoutes} = require('./history/internalRoutes');
const {createOrdersRoutes} = require('./orders/ordersRoutes');
const {createOrdersService} = require('./orders/ordersService');
const {createConsultationRoutes} = require('./consultation/consultationRoutes');
const {createAdminRoutes} = require('./admin/adminRoutes');
const {createDoctorRoutes} = require('./admin/doctorRoutes');
const {createStreamRoutes} = require('./videos/streamRoutes');
const {createVideoStorage} = require('./videos/storage');
const {createVideosService} = require('./videos/videosService');
const {createAppointmentsAdmin} = require('./admin/appointmentsAdmin');
const {createClinicsAdmin} = require('./admin/clinicsAdmin');
const {createCreditsAdmin} = require('./admin/creditsAdmin');
const {createDashboardAdmin} = require('./admin/dashboardAdmin');
const {createDoctorsAdmin} = require('./admin/doctorsAdmin');
const {createUploads} = require('./admin/uploads');
const {createConsultationService} = require('./consultation/consultationService');
const {createOtpService} = require('./otp/otpService');
const {createUsersRoutes} = require('./users/usersRoutes');
const {createUsersService} = require('./users/usersService');

// Builds the whole API. Everything it needs (config, database, OTP sender) is passed in, so tests can
// run it against a fake database without any network or MySQL server.
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
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
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
  const {requireAuth, requireRole} = createAuthMiddleware({tokens});
  const catalog = createCatalogService({prisma, audit});
  const addresses = createAddressesService({prisma});
  const cart = createCartService({prisma});
  const orders = createOrdersService({prisma, audit});
  const history = createHistoryService({prisma});
  const consultation = createConsultationService({prisma, audit});
  const videos = createVideosService({prisma, config, storage: createVideoStorage({dir: config.VIDEO_STORAGE_DIR})});
  const adminParts = {
    videos,
    appointments: createAppointmentsAdmin({prisma, audit, consultation}),
    doctors: createDoctorsAdmin({prisma, audit}),
    clinics: createClinicsAdmin({prisma, audit}),
    credits: createCreditsAdmin({prisma, audit, consultation}),
    dashboard: createDashboardAdmin({prisma}),
    uploads: createUploads({config}),
  };

  app.use('/api/v1/auth', createAuthRoutes({auth}));
  app.use('/api/v1/users', createUsersRoutes({users, auth, requireAuth}));
  app.use('/api/v1/addresses', createAddressesRoutes({addresses, requireAuth}));
  app.use('/api/v1/cart', createCartRoutes({cart, requireAuth}));
  app.use('/api/v1/history', createHistoryRoutes({history, requireAuth}));
  // The shop and orders have their own paths (/products, /orders, /admin/...), so they are mounted at the root
  app.use('/api/v1', createCatalogRoutes({catalog, requireAuth, requireRole}));
  app.use('/api/v1', createOrdersRoutes({orders, requireAuth, requireRole}));
  // /clinics, /doctors and /appointments
  app.use('/api/v1', createConsultationRoutes({consultation, requireAuth}));
  // Staff only: every route behind one Admin-role guard
  app.use('/api/v1/admin', createAdminRoutes({requireAuth, requireRole, ...adminParts}));
  // The doctor's own side (their requests): the Doctor role, and only their own appointments
  app.use('/api/v1/doctor', createDoctorRoutes({prisma, requireAuth, requireRole, appointments: adminParts.appointments, dashboard: adminParts.dashboard, doctors: adminParts.doctors, videos}));
  // Plays or downloads a video for a short-lived signed link that staff were given (no login header is needed)
  app.use('/api/v1/videos', createStreamRoutes({videos}));
  // Only call-backend uses these, and only when a shared secret is configured; otherwise the paths do not exist
  if (config.INTERNAL_API_KEY) {
    app.use('/api/v1/internal', createInternalRoutes({prisma, config}));
  }

  app.use((req, res, next) => next(notFound('Not found.')));

  // The last stop for every error. People only ever see safe messages; the details stay in the server log.
  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    if (error instanceof HttpError) {
      if (error.headers) {
        res.set(error.headers);
      }
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
