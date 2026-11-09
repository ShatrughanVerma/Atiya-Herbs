const {badRequest, conflict, notFound} = require('../common/errors');
const {formatPatientCode, parsePatientCode} = require('../common/patientCode');
const {DAY_MS, istStartOfDay, toAppointment} = require('../consultation/consultationService');

// What staff see of an appointment: everything the patient sees, plus the staff note and the cancel reason
const toAdminAppointment = (a, doctor, clinic, patientNo) => ({
  ...toAppointment(a, doctor, clinic),
  userId: a.userId ?? null,
  patientId: a.userId ?? null,
  patientCode: formatPatientCode(patientNo),
  adminNote: a.adminNote ?? null,
  cancelReason: a.cancelReason ?? null,
  completedAt: a.completedAt ? a.completedAt.toISOString() : null,
  createdAt: a.createdAt.toISOString(),
});

function createAppointmentsAdmin({prisma, audit, consultation, now = () => new Date()}) {
  // `scope` = {doctorId} when a doctor (not staff) is asking: another doctor's appointment simply is not found
  const load = async (id, scope) => {
    const a = await prisma.appointment.findUnique({where: {id}});
    if (!a || (scope && a.doctorId !== scope.doctorId)) {
      throw notFound('Appointment not found.');
    }
    return a;
  };

  // userId -> patientNo for a list of appointments
  const patientNumbers = async userIds => {
    const ids = [...new Set(userIds.filter(Boolean))];
    if (!ids.length) {
      return new Map();
    }
    return new Map((await prisma.user.findMany({where: {id: {in: ids}}})).map(u => [u.id, u.patientNo]));
  };

  // The staff note is for the office: a doctor does not get it
  const withoutNote = (item, scope) => (scope ? {...item, adminNote: null} : item);

  const present = async (a, scope) => {
    const doctor = await prisma.doctor.findFirst({where: {id: a.doctorId}});
    const clinic = a.clinicId ? await prisma.clinic.findFirst({where: {id: a.clinicId}}) : null;
    const patient = a.userId ? await prisma.user.findUnique({where: {id: a.userId}}) : null;
    return withoutNote(toAdminAppointment(a, doctor, clinic, patient?.patientNo), scope);
  };

  // the actor is the logged-in person (an admin, or a doctor): the audit action says which
  const record = (actor, action, appointment) =>
    audit.record({userId: actor.id, action: `${actor.role === 'doctor' ? 'doctor' : 'admin'}.appointment.${action}`, metadata: {appointmentId: appointment.id}});

  return {
    async list({status, doctorId, clinicId, date, q, patientId, patientCode, page, pageSize}, scope) {
      const and = [];
      if (scope) {
        and.push({doctorId: scope.doctorId});
      }
      if (status) {
        and.push({status});
      }
      if (doctorId) {
        and.push({doctorId});
      }
      if (clinicId) {
        and.push({clinicId});
      }
      if (date) {
        const from = istStartOfDay(date);
        // a booked appointment on that day, or a request that wished for that day
        and.push({OR: [{preferredDate: date}, {startsAt: {gte: from, lt: new Date(from.getTime() + DAY_MS)}}]});
      }
      if (patientId) {
        and.push({userId: patientId});
      }
      // a patient code (P000123), typed in the search box or in its own field, finds that person's appointments
      const codeNo = parsePatientCode(patientCode ?? q);
      if (codeNo) {
        const person = await prisma.user.findUnique({where: {patientNo: codeNo}});
        and.push({userId: person ? person.id : '-'});
      } else if (q) {
        and.push({OR: [{patientName: {contains: q}}, {patientMobile: {contains: q}}, {number: {contains: q}}]});
      }
      const where = and.length ? {AND: and} : {};
      const [total, rows] = await Promise.all([
        prisma.appointment.count({where}),
        prisma.appointment.findMany({where, orderBy: [{createdAt: 'desc'}], skip: (page - 1) * pageSize, take: pageSize}),
      ]);
      const doctors = new Map((await prisma.doctor.findMany({})).map(d => [d.id, d]));
      const clinics = new Map((await prisma.clinic.findMany({})).map(c => [c.id, c]));
      const numbers = await patientNumbers(rows.map(a => a.userId));
      return {total, page, pageSize, items: rows.map(a => withoutNote(toAdminAppointment(a, doctors.get(a.doctorId), clinics.get(a.clinicId), numbers.get(a.userId)), scope))};
    },

    async get(id, scope) {
      return present(await load(id, scope), scope);
    },

    // Confirms a request. If the patient already chose a time it stays; otherwise a free slot must be given.
    async confirm(actor, id, startsAt, scope) {
      const a = await load(id, scope);
      if (a.status !== 'requested') {
        throw conflict('Only a request that is waiting for confirmation can be confirmed.');
      }
      let data = {status: 'booked'};
      if (startsAt || !a.startsAt) {
        if (!startsAt) {
          throw badRequest('Choose a time for this appointment.');
        }
        if (a.startsAt && a.startsAt.getTime() === new Date(startsAt).getTime()) {
          data = {status: 'booked'}; // the same time the patient asked for
        } else {
          const {slot} = await consultation.slotFor(a.doctorId, startsAt);
          data = {status: 'booked', startsAt: slot.startsAt, endsAt: slot.endsAt, slotKey: `${a.doctorId}|${slot.startsAt.toISOString()}`};
        }
      }
      try {
        await prisma.appointment.update({where: {id}, data});
      } catch (error) {
        if (error?.code === 'P2002') {
          throw conflict('Someone just booked that slot. Please pick another one.');
        }
        throw error;
      }
      await record(actor, 'confirm', a);
      return this.get(id, scope);
    },

    async complete(actor, id, scope) {
      const a = await load(id, scope);
      if (a.status !== 'booked') {
        throw conflict('Only a booked appointment can be completed.');
      }
      if (a.startsAt.getTime() > now().getTime()) {
        throw conflict('This appointment has not started yet.');
      }
      await prisma.appointment.update({where: {id}, data: {status: 'completed', completedAt: now()}});
      await record(actor, 'complete', a);
      return this.get(id, scope);
    },

    // Cancels a request or a booking. No time limit for staff. Credits the person used are given back.
    async cancel(actor, id, reason, scope) {
      const a = await load(id, scope);
      if (a.status !== 'booked' && a.status !== 'requested') {
        throw conflict('This appointment is already closed.');
      }
      await prisma.$transaction(async tx => {
        await tx.appointment.update({where: {id}, data: {status: 'cancelled', slotKey: null, cancelReason: reason ?? null}});
        if (a.creditsUsed > 0 && a.userId) {
          await tx.user.update({where: {id: a.userId}, data: {credits: {increment: a.creditsUsed}}});
          await tx.creditEntry.create({data: {userId: a.userId, delta: a.creditsUsed, reason: 'Refund: appointment cancelled', appointmentId: id}});
        }
      });
      await record(actor, 'cancel', a);
      return this.get(id, scope);
    },

    // The people a doctor has seen or will see: one row per patient (same mobile and name), newest visit first
    async patients(scope, {q, page = 1, pageSize = 20} = {}) {
      const rows = await prisma.appointment.findMany({where: {doctorId: scope.doctorId, status: {in: ['requested', 'booked', 'completed']}}, orderBy: [{createdAt: 'desc'}]});
      const byPerson = new Map();
      for (const a of rows) {
        const key = `${a.patientMobile}|${a.patientName.trim().toLowerCase()}`;
        const entry = byPerson.get(key) ?? {name: a.patientName, mobile: a.patientMobile, city: a.city ?? null, visits: 0, requests: 0, lastVisit: null, lastConcern: null};
        if (a.status === 'completed') {
          entry.visits += 1;
        }
        if (a.status === 'requested') {
          entry.requests += 1;
        }
        const when = a.startsAt ?? null;
        if (when && (!entry.lastVisit || when > entry.lastVisit)) {
          entry.lastVisit = when;
        }
        entry.lastConcern = entry.lastConcern ?? a.concern ?? null; // the newest appointment comes first
        entry.city = entry.city ?? a.city ?? null;
        byPerson.set(key, entry);
      }
      const needle = (q ?? '').toLowerCase();
      const all = [...byPerson.values()]
        .filter(p => !needle || `${p.name} ${p.mobile}`.toLowerCase().includes(needle))
        .sort((a, b) => (b.lastVisit?.getTime() ?? 0) - (a.lastVisit?.getTime() ?? 0) || a.name.localeCompare(b.name))
        .map(p => ({...p, lastVisit: p.lastVisit ? p.lastVisit.toISOString() : null}));
      return {total: all.length, page, pageSize, items: all.slice((page - 1) * pageSize, page * pageSize)};
    },

    async saveNote(actor, id, adminNote) {
      const a = await load(id);
      await prisma.appointment.update({where: {id}, data: {adminNote}});
      await record(actor, 'note', a);
      return this.get(id);
    },
  };
}

module.exports = {createAppointmentsAdmin};
