// npm run db:deploy-fresh
// Puts the WHOLE database structure into a new, EMPTY database in one go, then tells Prisma that every migration is done.
// Use it for a cloud database where `migrate deploy` stops half way (TiDB Cloud cannot add an AUTO_INCREMENT column to an
// existing table, which a few old migrations do). Creating each table with its AUTO_INCREMENT column at once works.
// Later `npm run db:migrate:deploy` works as usual for new migrations.
//
// It refuses to run when the database already has users (so it can never wipe real data). It drops every table first, so
// a half-finished migrate deploy is cleaned up.
try {
  process.loadEnvFile();
} catch {
  // no .env file: the settings come from real environment variables
}
const {execFileSync} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const mariadb = require('mariadb');

const root = path.resolve(__dirname, '..');
const prismaBin = path.join(root, 'node_modules', 'prisma', 'build', 'index.js');
const prisma = args => execFileSync(process.execPath, [prismaBin, ...args], {cwd: root, encoding: 'utf8', maxBuffer: 50 * 1024 * 1024, env: process.env});

async function main() {
  const env = process.env;
  const connection = await mariadb.createConnection({
    host: env.DB_HOST,
    port: Number(env.DB_PORT || 3306),
    database: env.DB_NAME,
    user: env.MIGRATE_DB_USER || env.DB_USER,
    password: env.MIGRATE_DB_PASSWORD || env.DB_PASSWORD,
    ssl: env.DB_SSL === 'true' ? {rejectUnauthorized: true} : undefined,
    multipleStatements: false,
    allowPublicKeyRetrieval: env.DB_SSL !== 'true',
  });
  try {
    const tables = (await connection.query('SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()')).map(r => r.name);
    if (tables.includes('users')) {
      const [{n}] = await connection.query('SELECT COUNT(*) AS n FROM `users`');
      if (Number(n) > 0) {
        throw new Error(`This database already has ${n} user(s). It is not empty, so nothing was changed.`);
      }
    }
    console.log(`Database ${env.DB_NAME} at ${env.DB_HOST}: ${tables.length} old table(s) will be removed.`);
    await connection.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const name of tables) {
      await connection.query(`DROP TABLE IF EXISTS \`${name}\``);
    }
    await connection.query('SET FOREIGN_KEY_CHECKS = 1');

    const sql = prisma(['migrate', 'diff', '--from-empty', '--to-schema', 'prisma/schema.prisma', '--script']);
    const statements = sql
      .split('\n')
      .filter(line => !line.trim().startsWith('--'))
      .join('\n')
      .split(/;\s*\n/)
      .map(s => s.trim())
      .filter(Boolean);
    for (const statement of statements) {
      await connection.query(statement);
    }
    console.log(`${statements.length} statements done: the structure is in place.`);
  } finally {
    await connection.end();
  }

  const names = fs.readdirSync(path.join(root, 'prisma', 'migrations'), {withFileTypes: true}).filter(d => d.isDirectory()).map(d => d.name).sort();
  for (const name of names) {
    prisma(['migrate', 'resolve', '--applied', name]);
    console.log(`  marked as applied: ${name}`);
  }
  console.log(`Done. ${names.length} migrations are marked as applied.`);
}

main().catch(error => {
  console.error('Failed:', error.message);
  process.exit(1);
});
