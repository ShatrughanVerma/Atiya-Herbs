const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const {loadConfig} = require('./config');
const {createLogger} = require('./logger');
const {createMysqlStore} = require('./db/mysqlStore');
const {createApp} = require('./app');
const {createProcessor} = require('./processor');
const {createWorker} = require('./worker');
const {createIngest} = require('./ingest');
const {createPuller} = require('./puller');

async function main() {
  const config = loadConfig();
  const logger = createLogger({dir: config.logDir});

  if (config.ingestKey.length < 32 || config.readKey.length < 32 || config.ingestKey === config.readKey) {
    logger.error('INGEST_KEY and READ_KEY must be different and at least 32 characters');
    process.exit(1);
  }
  fs.mkdirSync(config.chunkDir, {recursive: true});
  fs.mkdirSync(config.recordingDir, {recursive: true});

  const store = createMysqlStore(config.mysql, {logger});
  await store.init();

  const app = createApp({config, store, logger});
  const server =
    config.tlsKey && config.tlsCert
      ? https.createServer({key: fs.readFileSync(config.tlsKey), cert: fs.readFileSync(config.tlsCert)}, app)
      : http.createServer(app);
  server.requestTimeout = 5 * 60 * 1000; // big chunks on slow links
  server.listen(config.port, config.host, () => logger.info('recording server listening', {host: config.host, port: config.port, https: !!config.tlsKey}));

  const worker = createWorker({config, store, processor: createProcessor({config, store, logger}), logger});
  await worker.start();

  const puller = createPuller({config, store, ingest: createIngest({config, store, logger}), logger});
  puller.start();

  const shutdown = async signal => {
    logger.info('shutting down', {signal});
    server.close();
    await puller.stop();
    await worker.stop();
    await store.close();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', error => logger.error('unhandled rejection', {error: String(error && error.message ? error.message : error)}));
}

main().catch(error => {
  console.error('could not start the recording server:', error.message);
  process.exit(1);
});
