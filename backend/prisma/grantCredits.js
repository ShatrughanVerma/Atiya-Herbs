// npm run db:grant-credits -- 9876543210 250 "Welcome bonus"
// Gives (or, with a minus number, takes back) discount credits for one person. Run by the company only: the app
// itself can never change credits. Every change is written to the credit ledger.
try {
  process.loadEnvFile();
} catch {
  // no .env file: the settings come from real environment variables
}

const {loadConfig} = require('../src/config/env');
const {normalizeMobile} = require('../src/common/mobile');
const {createPrismaClient} = require('../src/prisma/client');

async function main() {
  const [mobileArg, amountArg, ...reasonWords] = process.argv.slice(2);
  const mobile = normalizeMobile(mobileArg ?? '');
  const amount = Number(amountArg);
  if (!mobile || !Number.isInteger(amount) || amount === 0 || Math.abs(amount) > 100_000) {
    throw new Error('Use: npm run db:grant-credits -- <10-digit mobile> <whole number of credits> ["reason"]');
  }
  const reason = (reasonWords.join(' ') || 'Added by the company').slice(0, 60);
  const prisma = createPrismaClient(loadConfig());
  try {
    const user = await prisma.user.findUnique({where: {mobile}});
    if (!user) {
      throw new Error('No account with that mobile number.');
    }
    if (amount < 0 && user.credits + amount < 0) {
      throw new Error(`The person has only ${user.credits} credits.`);
    }
    await prisma.$transaction(async tx => {
      await tx.user.update({where: {id: user.id}, data: {credits: {increment: amount}}});
      await tx.creditEntry.create({data: {userId: user.id, delta: amount, reason}});
    });
    console.log(`Done. Credits are now ${user.credits + amount}.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
