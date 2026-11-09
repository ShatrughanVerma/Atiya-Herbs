const {DAY_MS, istDayOf, istStartOfDay} = require('../consultation/consultationService');

// The numbers on the dashboard. "Today" is the Indian day.
function createDashboardAdmin({prisma, now = () => new Date()}) {
  return {
    // scope = {doctorId}: the numbers of one doctor only
    async summary(scope) {
      const own = scope ? {doctorId: scope.doctorId} : {};
      const current = now();
      const todayStart = istStartOfDay(istDayOf(current));
      const [requestedAppointments, todayAppointments, upcomingAppointments, cancelledLast7Days, doctorsActive] = await Promise.all([
        prisma.appointment.count({where: {status: 'requested', ...own}}),
        prisma.appointment.count({where: {status: 'booked', ...own, startsAt: {gte: todayStart, lt: new Date(todayStart.getTime() + DAY_MS)}}}),
        prisma.appointment.count({where: {status: 'booked', ...own, startsAt: {gte: current}}}),
        prisma.appointment.count({where: {status: 'cancelled', ...own, updatedAt: {gte: new Date(current.getTime() - 7 * DAY_MS)}}}),
        prisma.doctor.count({where: {active: true}}),
      ]);
      const numbers = {requestedAppointments, todayAppointments, upcomingAppointments, cancelledLast7Days};
      if (!scope) {
        return {...numbers, doctorsActive};
      }
      const seen = await prisma.appointment.findMany({where: {doctorId: scope.doctorId, status: {in: ['requested', 'booked', 'completed']}}});
      return {...numbers, patients: new Set(seen.map(a => `${a.patientMobile}|${a.patientName.trim().toLowerCase()}`)).size};
    },
  };
}

module.exports = {createDashboardAdmin};
