const {notFound} = require('../common/errors');
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
      const user = await prisma.user.update({
        where: {id},
        data: {...(changes.name !== undefined && {name: changes.name}), ...(changes.email !== undefined && {email: changes.email})},
      });
      await audit.record({action: 'user.profile.updated', userId: id, ip, metadata: {fields: Object.keys(changes)}});
      return toPublicUser(user);
    },
  };
}

module.exports = {createUsersService};
