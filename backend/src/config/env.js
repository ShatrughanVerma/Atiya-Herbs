const {z} = require('zod');

// All settings come from environment variables and are checked once at start-up.
// A wrong or missing setting stops the server immediately with a clear message, instead of failing later.

const bool = fallback =>
  z
    .string()
    .optional()
    .transform(value => (value === undefined || value === '' ? fallback : ['1', 'true', 'yes'].includes(value.toLowerCase())));

const int = (fallback, min, max) =>
  z
    .string()
    .optional()
    .transform(value => (value === undefined || value === '' ? fallback : Number(value)))
    .pipe(z.number().int().min(min).max(max));

const required = name => z.string({error: `${name} is required`}).min(1, `${name} is required`);

const secret = name => z.string({error: `${name} is required`}).min(32, `${name} must be at least 32 characters (use a long random value)`);

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: int(4100, 1, 65535),
    // The public address of this server, written in front of a video's url (for example https://api.atiyaherbs.com).
    // Empty: http://localhost:<PORT>.
    PUBLIC_API_URL: z.string().trim().url().optional().or(z.literal('')).default(''),
    // Number of reverse proxies in front of the server (Render = 1); needed to see the real client IP
    TRUST_PROXY: int(1, 0, 5),
    // Origins allowed to call the API from a browser (e.g. the admin panel). The mobile app needs none.
    CORS_ORIGINS: z.string().optional().default(''),
    // Doctor photo uploads (Cloudinary signed upload). All three or none.
    // Consultation videos: the folder they are kept in, the biggest file, and how long they are kept (days)
    // Where the video files are kept: inside MySQL (default) or in a folder on the server
    VIDEO_STORAGE: z.enum(['database', 'folder']).optional().default('database'),
    VIDEO_STORAGE_DIR: z.string().optional().default('./storage/videos'), // only for VIDEO_STORAGE=folder
    VIDEO_MAX_MB: int(500, 1, 2000), // the database column holds up to about 2 GB
    VIDEO_RETENTION_DAYS: int(365, 30, 3650),
    CLOUDINARY_CLOUD_NAME: z.string().optional().default(''),
    CLOUDINARY_API_KEY: z.string().optional().default(''),
    CLOUDINARY_API_SECRET: z.string().optional().default(''),

    DB_HOST: z.string().default('localhost'),
    DB_PORT: int(3306, 1, 65535),
    DB_NAME: z.string().default('atiyaherbs'),
    DB_USER: required('DB_USER'),
    DB_PASSWORD: required('DB_PASSWORD'),
    // true = encrypted connection with a checked certificate (needed by cloud MySQL such as Aiven or TiDB Cloud)
    DB_SSL: bool(false),

    // Shared secret that call-backend sends when it saves call history and meeting messages. Unset = those routes are off.
    INTERNAL_API_KEY: z.preprocess(
      value => (value === '' ? undefined : value), // an empty line in .env means "off"
      z.string().min(32, 'INTERNAL_API_KEY must be at least 32 characters (use a long random value)').optional(),
    ),

    JWT_ACCESS_SECRET: secret('JWT_ACCESS_SECRET'),
    JWT_ACCESS_TTL_SECONDS: int(900, 60, 3600), // 15 minutes
    REFRESH_TOKEN_TTL_DAYS: int(30, 1, 90),

    OTP_PEPPER: secret('OTP_PEPPER'),
    OTP_TTL_SECONDS: int(300, 60, 900), // 5 minutes
    OTP_MAX_ATTEMPTS: int(5, 1, 10),
    OTP_MAX_REQUESTS_PER_WINDOW: int(3, 1, 20), // per mobile number
    OTP_REQUEST_WINDOW_SECONDS: int(600, 60, 3600),
    // dev: the OTP is printed in the server log (no SMS, no cost). Not allowed in production.
    OTP_SENDER: z.enum(['dev', 'sms']).default('dev'),
    // dev only: also put the OTP in the API response, so you can test without reading the log
    OTP_DEV_ECHO: bool(false),

    RATE_LIMIT_WINDOW_SECONDS: int(60, 1, 3600),
    RATE_LIMIT_MAX: int(120, 1, 100000), // requests per IP per window
  })
  .superRefine((env, ctx) => {
    const problem = (path, message) => ctx.addIssue({code: 'custom', path: [path], message});
    if (env.NODE_ENV === 'production') {
      if (env.OTP_SENDER === 'dev') {
        problem('OTP_SENDER', 'OTP_SENDER=dev prints OTPs in the log and is not allowed in production');
      }
      if (env.OTP_DEV_ECHO) {
        problem('OTP_DEV_ECHO', 'OTP_DEV_ECHO must be false in production');
      }
      if (!env.DB_SSL && !['localhost', '127.0.0.1'].includes(env.DB_HOST)) {
        problem('DB_SSL', 'DB_SSL must be true in production when the database is on another machine');
      }
    }
    if (env.OTP_SENDER === 'sms' && env.OTP_DEV_ECHO) {
      problem('OTP_DEV_ECHO', 'OTP_DEV_ECHO only works with OTP_SENDER=dev');
    }
  });

function loadConfig(env = process.env) {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map(issue => `  - ${issue.path.join('.') || 'config'}: ${issue.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${problems}`);
  }
  const config = parsed.data;
  return {
    ...config,
    corsOrigins: config.CORS_ORIGINS.split(',')
      .map(origin => origin.trim())
      .filter(Boolean),
    publicApiUrl: (config.PUBLIC_API_URL || `http://localhost:${config.PORT}`).replace(/\/+$/, ''),
    isProduction: config.NODE_ENV === 'production',
  };
}

module.exports = {loadConfig};
