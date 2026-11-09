const {conflict, notFound} = require('../common/errors');

const MAX_ADDRESSES = 10;

const toAddress = a => ({
  id: a.id,
  name: a.name,
  phone: a.phone,
  pincode: a.pincode,
  city: a.city,
  state: a.state,
  line1: a.line1,
  line2: a.line2,
  isDefault: a.isDefault,
});

// A person's saved delivery addresses. Every query carries the userId from the login token,
// so an address id belonging to someone else simply is not found.
function createAddressesService({prisma}) {
  const mine = async (userId, id) => {
    const address = await prisma.address.findFirst({where: {id, userId}});
    if (!address) {
      throw notFound('Address not found.');
    }
    return address;
  };

  return {
    async list(userId) {
      const rows = await prisma.address.findMany({where: {userId}, orderBy: [{isDefault: 'desc'}, {createdAt: 'desc'}]});
      return rows.map(toAddress);
    },

    async get(userId, id) {
      return toAddress(await mine(userId, id));
    },

    async create(userId, input) {
      return prisma.$transaction(async tx => {
        const count = await tx.address.count({where: {userId}});
        if (count >= MAX_ADDRESSES) {
          throw conflict(`You can save up to ${MAX_ADDRESSES} addresses. Please remove one first.`);
        }
        const makeDefault = input.isDefault === true || count === 0; // the first address is the default
        if (makeDefault) {
          await tx.address.updateMany({where: {userId, isDefault: true}, data: {isDefault: false}});
        }
        return toAddress(await tx.address.create({data: {...input, userId, isDefault: makeDefault}}));
      });
    },

    async update(userId, id, changes) {
      await mine(userId, id);
      return prisma.$transaction(async tx => {
        if (changes.isDefault === true) {
          await tx.address.updateMany({where: {userId, isDefault: true}, data: {isDefault: false}});
        }
        // "isDefault: false" on the only default would leave none, so it is ignored: use another address as default instead
        const {isDefault, ...rest} = changes;
        return toAddress(await tx.address.update({where: {id}, data: {...rest, ...(isDefault === true && {isDefault: true})}}));
      });
    },

    async setDefault(userId, id) {
      await mine(userId, id);
      return prisma.$transaction(async tx => {
        await tx.address.updateMany({where: {userId, isDefault: true}, data: {isDefault: false}});
        return toAddress(await tx.address.update({where: {id}, data: {isDefault: true}}));
      });
    },

    async remove(userId, id) {
      const address = await mine(userId, id);
      await prisma.$transaction(async tx => {
        await tx.address.delete({where: {id}});
        if (address.isDefault) {
          const next = await tx.address.findFirst({where: {userId}, orderBy: {createdAt: 'desc'}});
          if (next) {
            await tx.address.update({where: {id: next.id}, data: {isDefault: true}});
          }
        }
      });
    },
  };
}

module.exports = {createAddressesService, MAX_ADDRESSES};
