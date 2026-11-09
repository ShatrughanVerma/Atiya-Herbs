// npm run db:seed : loads the app's sample catalog into the database. Safe to run more than once.
try {
  process.loadEnvFile();
} catch {
  // no .env file: the settings come from real environment variables
}

const path = require('node:path');
const {loadConfig} = require('../src/config/env');
const {createPrismaClient} = require('../src/prisma/client');
const {buildSeedData, loadCatalogFile, seedCatalog} = require('../src/catalog/seed');

async function main() {
  const config = loadConfig();
  const prisma = createPrismaClient(config);
  try {
    const catalog = await loadCatalogFile(path.join(__dirname, '..', '..', 'src', 'data', 'catalog.js'));
    const counts = await seedCatalog(prisma, buildSeedData(catalog));
    console.log('Catalog saved:', counts);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
