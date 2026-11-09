// Builds the MySQL connection URL for Prisma's command line (migrations) from separate settings,
// so there is one place to set the database and no password is ever pasted into a long URL by hand.

const isTrue = (value, fallback) => (value === undefined || value === '' ? fallback : ['1', 'true', 'yes'].includes(value.toLowerCase()));

// forMigrations: use the separate migration login when one is set (it may create and alter tables;
// the login the API runs with must not be able to)
function buildMysqlUrl(env, {forMigrations = false} = {}) {
  const host = env.DB_HOST || 'localhost';
  const port = env.DB_PORT || '3306';
  const database = env.DB_NAME || 'atiyaherbs';
  const user = (forMigrations && env.MIGRATE_DB_USER) || env.DB_USER || '';
  const password = (forMigrations && env.MIGRATE_DB_PASSWORD) || env.DB_PASSWORD || '';
  const ssl = isTrue(env.DB_SSL, false);

  // encodeURIComponent: a password with @ : / ? # or % must not break the URL
  const url = new URL(`mysql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${encodeURIComponent(database)}`);
  if (ssl) {
    url.searchParams.set('sslaccept', 'strict');
  }
  return url.toString();
}

module.exports = {buildMysqlUrl, isTrue};
