// npm run db:seed-consultation                          : saves the clinics and the doctors of the app design
// npm run db:seed-consultation -- --sample-doctors      : also adds two PLACEHOLDER doctors (tests)
try {
  process.loadEnvFile();
} catch {
  // no .env file: the settings come from real environment variables
}

const {loadConfig} = require('../src/config/env');
const {createPrismaClient} = require('../src/prisma/client');
const {seedClinics, seedDoctors, seedPlaceholderDoctors} = require('../src/consultation/seed');

async function main() {
  const config = loadConfig();
  const prisma = createPrismaClient(config);
  try {
    console.log(await seedClinics(prisma));
    console.log(await seedDoctors(prisma));
    if (process.argv.includes('--sample-doctors')) {
      console.log(await seedPlaceholderDoctors(prisma));
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
