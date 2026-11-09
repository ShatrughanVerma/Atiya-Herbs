// npm run db:set-password -- y8099372@gmail.com
// Sets a new password for one account (found by email or 10-digit mobile). Run by the company only, on the server's
// own machine, for example when an admin has forgotten the password. The new password is typed at a prompt (hidden),
// so it is not left in the terminal history. The old password stops working, the account is unlocked and every
// login of that account is ended.
try {
  process.loadEnvFile();
} catch {
  // no .env file: the settings come from real environment variables
}

const {hashPassword, passwordProblem} = require('../src/auth/passwordService');
const {normalizeMobile} = require('../src/common/mobile');

// The work itself, kept apart from the terminal so it can be tested
async function applyPassword(prisma, identifier, password) {
  const lookup = identifier.includes('@') ? {email: identifier.trim().toLowerCase()} : {mobile: normalizeMobile(identifier)};
  if (!lookup.email && !lookup.mobile) {
    throw new Error('Use an email or a 10-digit mobile number.');
  }
  const user = await prisma.user.findUnique({where: lookup});
  if (!user) {
    throw new Error('No account found.');
  }
  const problem = passwordProblem(password, {mobile: user.mobile, email: user.email});
  if (problem) {
    throw new Error(problem);
  }
  const passwordHash = await hashPassword(password);
  await prisma.$transaction(async tx => {
    await tx.user.update({where: {id: user.id}, data: {passwordHash, failedLoginCount: 0, lockedUntil: null}});
    await tx.refreshToken.updateMany({where: {userId: user.id, revokedAt: null}, data: {revokedAt: new Date()}});
    await tx.auditLog.create({data: {action: 'admin.password.reset', userId: user.id, metadata: null}});
  });
  return user;
}

// Reads a line without showing it (falls back to a plain line when the input is piped)
function askHidden(question) {
  return new Promise(resolve => {
    process.stdout.write(question);
    if (!process.stdin.isTTY) {
      let text = '';
      process.stdin.on('data', chunk => (text += chunk));
      process.stdin.on('end', () => resolve(text.split(/\r?\n/)[0]));
      return;
    }
    let text = '';
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    const onData = key => {
      if (key === '\r' || key === '\n' || key === '\u0004') {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(text);
      } else if (key === '\u0003') {
        process.exit(1); // Ctrl+C
      } else if (key === '\u007f' || key === '\b') {
        text = text.slice(0, -1);
      } else {
        text += key;
      }
    };
    process.stdin.on('data', onData);
  });
}

async function main() {
  const identifier = process.argv[2];
  if (!identifier) {
    throw new Error('Use: npm run db:set-password -- <email or 10-digit mobile>');
  }
  const {loadConfig} = require('../src/config/env');
  const {createPrismaClient} = require('../src/prisma/client');
  const password = await askHidden('New password (hidden): ');
  const again = await askHidden('Type it again: ');
  if (password !== again) {
    throw new Error('The two passwords are not the same. Nothing was changed.');
  }
  const prisma = createPrismaClient(loadConfig());
  try {
    const user = await applyPassword(prisma, identifier, password);
    console.log(`Done. ${user.email || user.mobile} can now log in with the new password.`);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {applyPassword};
