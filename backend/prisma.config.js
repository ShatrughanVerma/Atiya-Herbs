const {defineConfig} = require('prisma/config');
const {buildMysqlUrl} = require('./src/config/databaseUrl');

// Prisma's command line does not read .env by itself
try {
  process.loadEnvFile();
} catch {
  // no .env file: the settings come from real environment variables (servers, CI)
}

module.exports = defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {path: 'prisma/migrations', seed: 'node prisma/seed.js'},
  // The migration login (MIGRATE_DB_USER) is used here when set; the running API uses the least-privilege DB_USER
  datasource: {url: buildMysqlUrl(process.env, {forMigrations: true})},
});
