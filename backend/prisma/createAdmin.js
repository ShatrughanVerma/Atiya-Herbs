// npm run db:create-admin -- <email> <10-digit mobile> "<Full name>"
// Makes an ADMIN account in an empty database (for example a new cloud database, where nobody has signed up yet).
// The password is typed at a hidden prompt. If the email already has an account, it is only made an admin (the password
// is not touched). Run by the company only.
try {
  process.loadEnvFile();
} catch {
  // no .env file: the settings come from real environment variables
}
const {hashPassword, passwordProblem} = require('../src/auth/passwordService');
const {normalizeMobile} = require('../src/common/mobile');
const {ROLE_IDS} = require('../src/auth/roles');
const {askHidden} = require('./setPassword');

async function main() {
  const [emailArg, mobileArg, ...nameParts] = process.argv.slice(2);
  const email = (emailArg || '').trim().toLowerCase();
  const mobile = normalizeMobile(mobileArg || '');
  const name = nameParts.join(' ').trim() || null;
  if (!email.includes('@') || !mobile) {
    throw new Error('Use: npm run db:create-admin -- <email> <10-digit mobile> "<Full name>"');
  }
  const {loadConfig} = require('../src/config/env');
  const {createPrismaClient} = require('../src/prisma/client');
  const prisma = createPrismaClient(loadConfig());
  try {
    const existing = await prisma.user.findFirst({where: {OR: [{email}, {mobile}]}});
    if (existing) {
      await prisma.user.update({where: {id: existing.id}, data: {roleId: ROLE_IDS.admin}});
      console.log(`Done. ${existing.email || existing.mobile} already had an account: it is an admin now (password unchanged).`);
      return;
    }
    const password = await askHidden('Password for the new admin (hidden): ');
    const again = await askHidden('Type it again: ');
    if (password !== again) {
      throw new Error('The two passwords are not the same. Nothing was changed.');
    }
    const problem = passwordProblem(password, {mobile, email});
    if (problem) {
      throw new Error(problem);
    }
    const user = await prisma.user.create({data: {email, mobile, name, passwordHash: await hashPassword(password), roleId: ROLE_IDS.admin}});
    console.log(`Done. Admin ${user.email} was created. Log in with the email and the password you typed.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
