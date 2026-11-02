// Builds the SQL Server connection URL for Prisma's command line (migrations) from separate settings,
// so there is one place to set the database and no password is ever pasted into a long URL by hand.

// SQL Server connection strings use ';' as a separator, so values containing ; { } must be wrapped in braces
const escapeValue = value => (/[;{}]/.test(value) || value !== value.trim() ? `{${value.replace(/}/g, '}}')}}` : value);

const isTrue = (value, fallback) => (value === undefined || value === '' ? fallback : ['1', 'true', 'yes'].includes(value.toLowerCase()));

// forMigrations: use the separate migration login when one is set (it may create and alter tables;
// the login the API runs with must not be able to)
function buildSqlServerUrl(env, {forMigrations = false} = {}) {
  const host = env.DB_HOST || 'localhost';
  const port = env.DB_PORT || '1433';
  const database = env.DB_NAME || 'atiyaherbs';
  const user = (forMigrations && env.MIGRATE_DB_USER) || env.DB_USER || '';
  const password = (forMigrations && env.MIGRATE_DB_PASSWORD) || env.DB_PASSWORD || '';
  const encrypt = isTrue(env.DB_ENCRYPT, true);
  const trustServerCertificate = isTrue(env.DB_TRUST_SERVER_CERT, false);

  return [
    `sqlserver://${host}:${port}`,
    `database=${escapeValue(database)}`,
    `user=${escapeValue(user)}`,
    `password=${escapeValue(password)}`,
    `encrypt=${encrypt}`,
    `trustServerCertificate=${trustServerCertificate}`,
  ].join(';');
}

module.exports = {buildSqlServerUrl};
