const {conflict, notFound} = require('../common/errors');
const {maskMobile} = require('../common/mobile');
const {toPublicUser} = require('../auth/authService');

function createUsersService({prisma, audit}) {
  const getById = async id => {
    const user = await prisma.user.findUnique({where: {id}});
    // A blocked or deleted account stops working here even if its 15-minute token is still valid
    if (!user || user.status !== 'active') {
      throw notFound('Account not found.');
    }
    return toPublicUser(user);
  };

  return {
    getById,

    async updateProfile(id, changes, ip) {
      await getById(id);
      let user;
      try {
        user = await prisma.user.update({
          where: {id},
          data: {...(changes.name !== undefined && {name: changes.name}), ...(changes.email !== undefined && {email: changes.email})},
        });
      } catch (error) {
        if (error.code === 'P2002') {
          throw conflict('This email is already used by another account.');
        }
        throw error;
      }
      await audit.record({action: 'user.profile.updated', userId: id, ip, metadata: {fields: Object.keys(changes)}});
      return toPublicUser(user);
    },

    // "Delete my account" (an app-store rule). Personal data is removed or made anonymous in one transaction:
    //  - logins and saved addresses are deleted
    //  - orders stay (the shop needs them for its books) but lose their link to the person and their address
    //  - the person's chat messages are deleted, and their number is blanked in call history rows
    //  - the security trail keeps its rows but loses the link to the account
    async deleteAccount(id, ip) {
      await getById(id);
      if ((await prisma.order.count({where: {userId: id, status: {in: ['placed', 'confirmed', 'shipped']}}})) > 0) {
        throw conflict('You have an order on its way. Please wait until it is delivered or cancel it, then delete your account.');
      }
      const user = await prisma.user.findUnique({where: {id}});
      await prisma.$transaction(async tx => {
        await tx.refreshToken.deleteMany({where: {userId: id}});
        await tx.cartItem.deleteMany({where: {userId: id}});
        await tx.address.deleteMany({where: {userId: id}});
        await tx.order.updateMany({where: {userId: id}, data: {userId: null, shippingAddress: {removed: true}}});
        await tx.meetingMessage.deleteMany({where: {OR: [{fromMobile: user.mobile}, {toMobile: user.mobile}]}});
        await tx.callLog.updateMany({where: {callerMobile: user.mobile}, data: {callerMobile: 'deleted'}});
        await tx.callLog.updateMany({where: {calleeMobile: user.mobile}, data: {calleeMobile: 'deleted'}});
        await tx.auditLog.updateMany({where: {userId: id}, data: {userId: null}});
        await tx.user.delete({where: {id}});
      });
      // written after the account is gone, with no link to it and only a masked number
      await audit.record({action: 'user.deleted', ip, metadata: {mobile: maskMobile(user.mobile)}});
    },
  };
}

module.exports = {createUsersService};
