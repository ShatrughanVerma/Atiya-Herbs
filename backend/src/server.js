// Starts the API. Run with: npm start (or npm run dev while developing).
try {
  process.loadEnvFile();
} catch {
  // no .env file: the settings come from real environment variables (servers, CI)
}

const {createApp} = require('./app');
const {loadConfig} = require('./config/env');
const {createOtpSender} = require('./otp/otpSender');
const {createPrismaClient} = require('./prisma/client');

async function main() {
  const config = loadConfig(); // stops here with a clear message if any setting is wrong
  const prisma = createPrismaClient(config);
  await prisma.$connect(); // fail now, not on the first request, if the database cannot be reached

  const app = createApp({config, prisma, sender: createOtpSender(config, console), logger: console});
  const server = app.listen(config.PORT, '0.0.0.0', () => {
    console.log(`Atiya Herbs API listening on port ${config.PORT} (${config.NODE_ENV}, OTP sender: ${config.OTP_SENDER})`);
  });

  // A long video can take a while to upload on a slow network: allow up to 30 minutes for one request
  server.requestTimeout = 30 * 60 * 1000;

  // Finish the requests in progress, then close the database, when the host stops or restarts the server
  let stopping = false;
  const shutdown = signal => {
    if (stopping) {
      return;
    }
    stopping = true;
    console.log(`${signal} received, shutting down`);
    setTimeout(() => process.exit(1), 10_000).unref();
    server.close(async () => {
      await prisma.$disconnect();
      process.exit(0);
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', reason => console.error('Unhandled promise rejection:', reason));
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
