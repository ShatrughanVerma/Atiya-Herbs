const {PrismaClient} = require('@prisma/client');
const {PrismaMariaDb} = require('@prisma/adapter-mariadb');

// The one database connection of the app. All queries go through Prisma, which sends values as parameters,
// so user input can never change the SQL (there are no string-built queries anywhere in this project).
function createPrismaClient(config) {
  return new PrismaClient({
    adapter: new PrismaMariaDb({
      host: config.DB_HOST,
      port: config.DB_PORT,
      database: config.DB_NAME,
      user: config.DB_USER,
      password: config.DB_PASSWORD,
      connectionLimit: 10,
      connectTimeout: 10_000,
      // Cloud MySQL (Aiven, TiDB Cloud, ...) needs an encrypted connection: the certificate is checked
      ssl: config.DB_SSL ? {rejectUnauthorized: true} : undefined,
      charset: 'utf8mb4',
      // MySQL 8 checks the password with an RSA key. Over an encrypted connection (cloud) that is safe; on a local
      // MySQL without SSL the driver must be allowed to ask the server for it (production refuses DB_SSL=false
      // for any other machine, see config/env.js)
      allowPublicKeyRetrieval: !config.DB_SSL,
    }),
  });
}

module.exports = {createPrismaClient};
