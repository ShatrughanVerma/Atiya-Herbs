const {conflict, notFound} = require('../common/errors');

// Finding a person, and changing their discount credits. Credits are changed only here (and by the cancel refunds):
// the mobile app can never change them. Every change has a row in the credit ledger and in the audit log.
function createCreditsAdmin({prisma, audit, consultation}) {
  const mustExist = async id => {
    const user = await prisma.user.findUnique({where: {id}});
    if (!user) {
      throw notFound('User not found.');
    }
    return user;
  };

  return {
    // By exact mobile number or email: there is no "list everybody"
    async find({mobile, email}) {
      const user = await prisma.user.findUnique({where: mobile ? {mobile} : {email}});
      if (!user) {
        throw notFound('No user found.');
      }
      return {id: user.id, name: user.name, mobile: user.mobile, email: user.email, credits: user.credits, status: user.status};
    },

    async get(userId) {
      await mustExist(userId);
      return consultation.credits(userId);
    },

    async change(admin, userId, {amount, reason}) {
      await mustExist(userId);
      await prisma.$transaction(async tx => {
        // a conditional update: the balance can never go below 0, even with two changes at the same moment
        const changed = await tx.user.updateMany({
          where: {id: userId, ...(amount < 0 && {credits: {gte: -amount}})},
          data: {credits: amount > 0 ? {increment: amount} : {decrement: -amount}},
        });
        if (changed.count !== 1) {
          throw conflict('The person does not have that many credits.');
        }
        await tx.creditEntry.create({data: {userId, delta: amount, reason}});
      });
      await audit.record({userId: admin.id, action: 'admin.credits.change', metadata: {targetUserId: userId, amount}});
      return {balance: (await mustExist(userId)).credits};
    },
  };
}

module.exports = {createCreditsAdmin};
