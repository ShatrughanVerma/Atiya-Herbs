const {ROLE_IDS} = require('../auth/roles');
const {conflict, notFound} = require('../common/errors');
const {pageArgs, pageOf} = require('../common/paging');
const {formatPatientCode, parsePatientCode} = require('../common/patientCode');

// The people who use the app. Only Customer accounts are listed and can be blocked here; staff and doctor accounts
// are managed elsewhere. Never returns password hashes, tokens, addresses or health information.
const RECENT = 20;

const toCustomer = u => ({
  id: u.id,
  patientCode: formatPatientCode(u.patientNo),
  name: u.name,
  mobile: u.mobile,
  email: u.email,
  credits: u.credits,
  status: u.status,
  createdAt: u.createdAt,
  lastLoginAt: u.lastLoginAt,
});

function createCustomersAdmin({prisma, audit}) {
  const mustExist = async id => {
    const user = await prisma.user.findFirst({where: {id, roleId: ROLE_IDS.customer}});
    if (!user) {
      throw notFound('Customer not found.');
    }
    return user;
  };

  const service = {
    async list(query) {
      const where = {roleId: ROLE_IDS.customer, ...(query.status && {status: query.status})};
      if (query.q) {
        const patientNo = parsePatientCode(query.q);
        if (patientNo) {
          where.patientNo = patientNo;
        } else {
          where.OR = ['name', 'mobile', 'email'].map(field => ({[field]: {contains: query.q}}));
        }
      }
      const [rows, total] = await Promise.all([
        prisma.user.findMany({where, orderBy: {createdAt: 'desc'}, ...pageArgs(query)}),
        prisma.user.count({where}),
      ]);
      return pageOf(rows.map(toCustomer), total, query);
    },

    // One person with their latest orders and appointments
    async get(id) {
      const user = await mustExist(id);
      const where = {userId: id};
      const latest = {where, orderBy: {createdAt: 'desc'}, take: RECENT};
      const [orders, orderCount, appointments, appointmentCount] = await Promise.all([
        prisma.order.findMany(latest),
        prisma.order.count({where}),
        prisma.appointment.findMany(latest),
        prisma.appointment.count({where}),
      ]);
      return {
        ...toCustomer(user),
        orderCount,
        orders: orders.map(o => ({id: o.id, orderNumber: o.orderNumber, status: o.status, total: o.total, createdAt: o.createdAt})),
        appointmentCount,
        appointments: appointments.map(a => ({id: a.id, number: a.number, status: a.status, startsAt: a.startsAt, createdAt: a.createdAt})),
      };
    },

    // Blocking ends every session: no new login or token refresh. A token already handed out dies within 15 minutes.
    async setStatus(admin, id, status) {
      const user = await mustExist(id);
      if (user.status === status) {
        throw conflict(`This account is already ${status}.`);
      }
      await prisma.user.update({where: {id}, data: {status}});
      if (status === 'blocked') {
        await prisma.refreshToken.updateMany({where: {userId: id, revokedAt: null}, data: {revokedAt: new Date()}});
      }
      await audit.record({userId: admin.id, action: `admin.customer.${status === 'blocked' ? 'block' : 'unblock'}`, metadata: {targetUserId: id}});
      return service.get(id);
    },
  };
  return service;
}

module.exports = {createCustomersAdmin};
