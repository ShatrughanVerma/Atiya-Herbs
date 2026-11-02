const {PrismaClient} = require('@prisma/client');
const {PrismaMssql} = require('@prisma/adapter-mssql');

// The one database connection of the app. All queries go through Prisma, which sends values as parameters,
// so user input can never change the SQL (there are no string-built queries anywhere in this project).
function createPrismaClient(config) {
  return new PrismaClient({
    adapter: new PrismaMssql({
      server: config.DB_HOST,
      port: config.DB_PORT,
      database: config.DB_NAME,
      user: config.DB_USER,
      password: config.DB_PASSWORD,
      options: {encrypt: config.DB_ENCRYPT, trustServerCertificate: config.DB_TRUST_SERVER_CERT},
      pool: {max: 10, min: 0, idleTimeoutMillis: 30_000},
    }),
  });
}

module.exports = {createPrismaClient};
