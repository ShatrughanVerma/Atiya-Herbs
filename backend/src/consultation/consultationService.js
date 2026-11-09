const {randomBytes} = require('node:crypto');
const {badRequest, conflict, notFound} = require('../common/errors');

const IST_OFFSET = '+05:30'; // all clinic timetables are in Indian time
const IST_MS = 5.5 * 3_600_000;
const DAY_MS = 24 * 3_600_000;
const LEAD_MINUTES = 30; // a slot cannot be booked less than this far ahead
const MAX_DAYS_AHEAD = 30;
const NEXT_SLOT_DAYS = 8; // how far ahead the cards look for the first free time
const MAX_UPCOMING = 5; // upcoming bookings one person can hold
const CANCEL_BEFORE_MINUTES = 60; // a booking can be cancelled up to this long before it starts

const toClinic = (clinic, distanceKm) => ({
  id: clinic.id,
  name: clinic.name,
  area: clinic.area,
  city: clinic.city,
  state: clinic.state,
  pincode: clinic.pincode,
  address: clinic.address,
  phone: clinic.phone,
  timings: clinic.timings,
  lat: clinic.lat,
  lng: clinic.lng,
  ...(distanceKm !== undefined && {distanceKm}),
});

const toDoctor = (doctor, clinic, nextAvailable) => ({
  id: doctor.id,
  name: doctor.name,
  photoUrl: doctor.photoUrl,
  system: doctor.system ?? null,
  specialization: doctor.specialization,
  concerns: doctor.concerns ?? [],
  qualifications: doctor.qualifications,
  experienceYears: doctor.experienceYears,
  languages: doctor.languages,
  fee: doctor.fee,
  rating: doctor.rating,
  reviewCount: doctor.reviewCount,
  modes: doctor.modes,
  clinic: clinic ? {id: clinic.id, name: clinic.name, city: clinic.city} : null,
  ...(nextAvailable !== undefined && {nextAvailable}),
});

const toAppointment = (a, doctor, clinic) => ({
  id: a.id,
  number: a.number,
  type: a.type,
  status: a.status,
  startsAt: a.startsAt ? a.startsAt.toISOString() : null,
  endsAt: a.endsAt ? a.endsAt.toISOString() : null,
  preferredDate: a.preferredDate ?? null,
  cancelReason: a.cancelReason ?? null,
  forSelf: a.forSelf,
  patientName: a.patientName,
  patientMobile: a.patientMobile,
  city: a.city ?? null,
  concern: a.concern ?? null,
  duration: a.duration ?? null,
  reason: a.reason,
  fee: a.fee,
  creditsUsed: a.creditsUsed ?? 0,
  toPay: a.fee - (a.creditsUsed ?? 0),
  paymentStatus: a.paymentStatus,
  doctor: doctor ? {id: doctor.id, name: doctor.name, photoUrl: doctor.photoUrl, specialization: doctor.specialization} : null,
  clinic: clinic ? {id: clinic.id, name: clinic.name, city: clinic.city, address: clinic.address, phone: clinic.phone} : null,
});

const haversineKm = (lat1, lng1, lat2, lng2) => {
  const rad = degrees => (degrees * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
};

const toMinutes = hhmm => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
const pad = n => String(n).padStart(2, '0');

// A calendar day like "2026-11-10" is real only if it exists (no 31 February)
const isRealDate = day => {
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
};

const istStartOfDay = day => new Date(`${day}T00:00:00${IST_OFFSET}`);
const istDayOf = date => new Date(date.getTime() + IST_MS).toISOString().slice(0, 10);
const newNumber = () => `AP${new Date().toISOString().slice(2, 10).replace(/-/g, '')}${randomBytes(3).toString('hex').toUpperCase()}`;

// Doctors, clinics, free slots and appointments. Prices and times are always worked out here: the app only says
// which doctor, which kind of consultation and which of the offered slots.
function createConsultationService({prisma, audit, now = () => new Date()}) {
  // Every possible slot of one day, from the doctor's weekly timetable
  const buildSlots = (schedules, day) => {
    const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
    const slots = [];
    for (const schedule of schedules.filter(s => s.weekday === weekday).sort((a, b) => a.startTime.localeCompare(b.startTime))) {
      const end = toMinutes(schedule.endTime);
      for (let minute = toMinutes(schedule.startTime); minute + schedule.slotMinutes <= end; minute += schedule.slotMinutes) {
        const startsAt = new Date(`${day}T${pad(Math.floor(minute / 60))}:${pad(minute % 60)}:00${IST_OFFSET}`);
        slots.push({startsAt, endsAt: new Date(startsAt.getTime() + schedule.slotMinutes * 60_000)});
      }
    }
    return slots;
  };

  const checkDay = day => {
    if (!isRealDate(day)) {
      throw badRequest('That date is not valid.');
    }
    const today = istStartOfDay(istDayOf(now()));
    const start = istStartOfDay(day);
    if (start < today || start > new Date(today.getTime() + MAX_DAYS_AHEAD * DAY_MS)) {
      throw badRequest(`Choose a date within the next ${MAX_DAYS_AHEAD} days.`);
    }
  };

  const activeDoctor = async id => {
    const doctor = await prisma.doctor.findFirst({where: {id, active: true}});
    if (!doctor) {
      throw notFound('Doctor not found.');
    }
    return doctor;
  };

  const freeSlots = async (doctor, day) => {
    const from = istStartOfDay(day);
    const booked = await prisma.appointment.findMany({
      where: {doctorId: doctor.id, status: {in: ['booked', 'requested']}, startsAt: {gte: from, lt: new Date(from.getTime() + DAY_MS)}},
    });
    const taken = new Set(booked.map(a => a.startsAt.getTime()));
    const earliest = now().getTime() + LEAD_MINUTES * 60_000;
    const schedules = await prisma.doctorSchedule.findMany({where: {doctorId: doctor.id}});
    return buildSlots(schedules, day).filter(slot => slot.startsAt.getTime() >= earliest && !taken.has(slot.startsAt.getTime()));
  };

  // The first free time in the next few days (null when there is none): "Today 4:30 PM" on the doctor cards
  const nextAvailable = async doctor => {
    const schedules = await prisma.doctorSchedule.findMany({where: {doctorId: doctor.id}});
    if (!schedules.length) {
      return null;
    }
    const booked = await prisma.appointment.findMany({where: {doctorId: doctor.id, status: {in: ['booked', 'requested']}, startsAt: {gte: now()}}});
    const taken = new Set(booked.map(a => a.startsAt.getTime()));
    const earliest = now().getTime() + LEAD_MINUTES * 60_000;
    for (let ahead = 0; ahead < NEXT_SLOT_DAYS; ahead += 1) {
      const slot = buildSlots(schedules, istDayOf(new Date(now().getTime() + ahead * DAY_MS))).find(
        s => s.startsAt.getTime() >= earliest && !taken.has(s.startsAt.getTime()),
      );
      if (slot) {
        return slot.startsAt.toISOString();
      }
    }
    return null;
  };

  const service = {
    async listClinics({city, q, lat, lng}) {
      const rows = await prisma.clinic.findMany({where: {active: true}, orderBy: {name: 'asc'}});
      const needle = (q ?? '').toLowerCase();
      const found = rows.filter(
        c =>
          (!city || c.city.toLowerCase() === city.toLowerCase()) &&
          (!needle || `${c.name} ${c.area} ${c.city} ${c.state} ${c.pincode ?? ''}`.toLowerCase().includes(needle)),
      );
      if (lat === undefined) {
        return found.map(c => toClinic(c));
      }
      return found
        .map(c => toClinic(c, Math.round(haversineKm(lat, lng, c.lat, c.lng) * 10) / 10))
        .sort((a, b) => a.distanceKm - b.distanceKm);
    },

    async getClinic(id) {
      const clinic = await prisma.clinic.findFirst({where: {id, active: true}});
      if (!clinic) {
        throw notFound('Clinic not found.');
      }
      const doctors = await prisma.doctor.findMany({where: {clinicId: id, active: true}, orderBy: {name: 'asc'}});
      return {...toClinic(clinic), doctors: doctors.map(d => toDoctor(d, clinic))};
    },

    async listDoctors({q, specialization, concern, clinicId, mode, maxFee, minRating, page, pageSize}) {
      const where = {
        active: true,
        ...(clinicId && {clinicId}),
        ...(maxFee !== undefined && {fee: {lte: maxFee}}),
        ...(minRating !== undefined && {rating: {gte: minRating}}),
      };
      const rows = await prisma.doctor.findMany({where, orderBy: [{rating: 'desc'}, {name: 'asc'}]});
      const needle = (q ?? '').toLowerCase();
      const found = rows.filter(
        d =>
          (!specialization || d.specialization.toLowerCase() === specialization.toLowerCase()) &&
          (!mode || d.modes.includes(mode)) &&
          (!concern || (d.concerns ?? []).some(c => c.toLowerCase() === concern.toLowerCase())) &&
          (!needle || `${d.name} ${d.specialization} ${d.system ?? ''} ${(d.concerns ?? []).join(' ')}`.toLowerCase().includes(needle)),
      );
      const clinics = new Map((await prisma.clinic.findMany({})).map(c => [c.id, c]));
      const pageRows = found.slice((page - 1) * pageSize, page * pageSize);
      const nexts = await Promise.all(pageRows.map(nextAvailable));
      return {
        total: found.length,
        page,
        pageSize,
        items: pageRows.map((d, i) => toDoctor(d, clinics.get(d.clinicId), nexts[i])),
      };
    },

    // The concerns doctors treat, most common first: the filter chips of the doctor list
    async listConcerns() {
      const rows = await prisma.doctor.findMany({where: {active: true}});
      const counts = new Map();
      rows.forEach(d => (d.concerns ?? []).forEach(c => counts.set(c, (counts.get(c) ?? 0) + 1)));
      return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name);
    },

    async getDoctor(id) {
      const doctor = await activeDoctor(id);
      const clinic = doctor.clinicId ? await prisma.clinic.findFirst({where: {id: doctor.clinicId}}) : null;
      const schedules = await prisma.doctorSchedule.findMany({where: {doctorId: id}, orderBy: [{weekday: 'asc'}, {startTime: 'asc'}]});
      return {
        ...toDoctor(doctor, clinic, await nextAvailable(doctor)),
        bio: doctor.bio,
        clinic: clinic ? toClinic(clinic) : null,
        weeklyTimings: schedules.map(s => ({weekday: s.weekday, startTime: s.startTime, endTime: s.endTime})),
        timings: schedules.map(s => ({weekday: s.weekday, startTime: s.startTime, endTime: s.endTime, slotMinutes: s.slotMinutes})),
      };
    },

    // Staff use this to fix a time: the doctor, and the slot only if it is one of the free ones of that day
    async slotFor(doctorId, isoStart) {
      const doctor = await activeDoctor(doctorId);
      const startsAt = new Date(isoStart);
      const day = istDayOf(startsAt);
      checkDay(day);
      const slot = (await freeSlots(doctor, day)).find(s => s.startsAt.getTime() === startsAt.getTime());
      if (!slot) {
        throw conflict('That time is not available. Please pick another slot.');
      }
      return {doctor, slot};
    },

    async getSlots(doctorId, day) {
      checkDay(day);
      const doctor = await activeDoctor(doctorId);
      const slots = await freeSlots(doctor, day);
      return {doctorId, date: day, slots: slots.map(s => ({startsAt: s.startsAt.toISOString(), endsAt: s.endsAt.toISOString()}))};
    },

    async book(user, input) {
      const doctor = await activeDoctor(input.doctorId);
      if (!doctor.modes.includes(input.type)) {
        throw badRequest('This doctor does not offer that kind of consultation.');
      }
      if (input.type === 'clinic' && !doctor.clinicId) {
        throw badRequest('This doctor has no clinic for an in-clinic visit.');
      }
      // With a time: it must be exactly one of the free slots (nothing the client invents is accepted).
      // Without: the clinic will suggest a time, near the preferred day when there is one.
      let slot = null;
      let preferredDate = input.preferredDate ?? null;
      if (input.startsAt) {
        const startsAt = new Date(input.startsAt);
        const day = istDayOf(startsAt);
        checkDay(day);
        slot = (await freeSlots(doctor, day)).find(s => s.startsAt.getTime() === startsAt.getTime());
        if (!slot) {
          throw conflict('That time is not available. Please pick another slot.');
        }
        preferredDate = day;
      } else if (preferredDate) {
        checkDay(preferredDate);
      }
      const account = await prisma.user.findUnique({where: {id: user.id}});
      if (!account) {
        throw notFound('Account not found.');
      }
      const patientName = input.patientName ?? (input.forSelf ? account.name : null);
      if (!patientName) {
        throw badRequest('Please add the patient name.');
      }
      if (!input.forSelf && !input.patientMobile) {
        throw badRequest('Please add the mobile number of the person the appointment is for.');
      }
      const open = await prisma.appointment.count({where: {userId: user.id, status: 'requested'}});
      const upcoming = await prisma.appointment.count({where: {userId: user.id, status: 'booked', startsAt: {gte: now()}}});
      if (open + upcoming >= MAX_UPCOMING) {
        throw conflict(`You can have up to ${MAX_UPCOMING} open appointments. Please cancel one first.`);
      }
      const creditsUsed = input.useCredits ? Math.min(account.credits, doctor.fee) : 0;
      let appointment;
      try {
        appointment = await prisma.$transaction(async tx => {
          if (creditsUsed > 0) {
            // A conditional decrement: two bookings at once cannot spend the same credits twice
            const spent = await tx.user.updateMany({where: {id: user.id, credits: {gte: creditsUsed}}, data: {credits: {decrement: creditsUsed}}});
            if (spent.count !== 1) {
              throw conflict('Your credits changed. Please try again.');
            }
          }
          const created = await tx.appointment.create({
            data: {
              number: newNumber(),
              userId: user.id,
              doctorId: doctor.id,
              clinicId: input.type === 'clinic' ? doctor.clinicId : null,
              type: input.type,
              status: 'requested', // the doctor confirms (or declines) it; a chosen time stays held meanwhile
              startsAt: slot?.startsAt ?? null,
              endsAt: slot?.endsAt ?? null,
              slotKey: slot ? `${doctor.id}|${slot.startsAt.toISOString()}` : null,
              preferredDate,
              forSelf: input.forSelf,
              patientName,
              patientMobile: input.patientMobile ?? account.mobile,
              city: input.city ?? null,
              concern: input.concern ?? null,
              duration: input.duration ?? null,
              reason: input.reason ?? null,
              fee: doctor.fee,
              creditsUsed,
            },
          });
          if (creditsUsed > 0) {
            await tx.creditEntry.create({data: {userId: user.id, delta: -creditsUsed, reason: 'Consultation', appointmentId: created.id}});
          }
          return created;
        });
      } catch (error) {
        if (error?.code === 'P2002') {
          throw conflict('Someone just booked that slot. Please pick another one.');
        }
        throw error;
      }
      await audit?.record({userId: user.id, action: 'appointment.book', metadata: {appointmentId: appointment.id}});
      return service.get(user.id, appointment.id);
    },

    async credits(userId) {
      const account = await prisma.user.findUnique({where: {id: userId}});
      const entries = await prisma.creditEntry.findMany({where: {userId}, orderBy: {id: 'desc'}, take: 20});
      return {balance: account?.credits ?? 0, history: entries.map(e => ({delta: e.delta, reason: e.reason, at: e.createdAt.toISOString()}))};
    },

    async get(userId, id) {
      const a = await prisma.appointment.findFirst({where: {id, userId}});
      if (!a) {
        throw notFound('Appointment not found.');
      }
      const doctor = await prisma.doctor.findFirst({where: {id: a.doctorId}});
      const clinic = a.clinicId ? await prisma.clinic.findFirst({where: {id: a.clinicId}}) : null;
      return toAppointment(a, doctor, clinic);
    },

    async list(userId, {status, page, pageSize}) {
      const where = {userId, ...(status && {status})};
      const [total, rows] = await Promise.all([
        prisma.appointment.count({where}),
        prisma.appointment.findMany({where, orderBy: [{createdAt: 'desc'}], skip: (page - 1) * pageSize, take: pageSize}),
      ]);
      const doctors = new Map((await prisma.doctor.findMany({})).map(d => [d.id, d]));
      return {total, page, pageSize, items: rows.map(a => toAppointment(a, doctors.get(a.doctorId)))};
    },

    async cancel(userId, id) {
      const a = await prisma.appointment.findFirst({where: {id, userId}});
      if (!a) {
        throw notFound('Appointment not found.');
      }
      if (a.status !== 'booked' && a.status !== 'requested') {
        throw conflict('This appointment is already closed.');
      }
      if (a.startsAt && a.startsAt.getTime() - now().getTime() < CANCEL_BEFORE_MINUTES * 60_000) {
        throw conflict(`An appointment can be cancelled up to ${CANCEL_BEFORE_MINUTES} minutes before it starts.`);
      }
      await prisma.$transaction(async tx => {
        // slotKey is cleared, so the slot becomes free for someone else
        await tx.appointment.update({where: {id}, data: {status: 'cancelled', slotKey: null}});
        if (a.creditsUsed > 0) {
          await tx.user.update({where: {id: userId}, data: {credits: {increment: a.creditsUsed}}});
          await tx.creditEntry.create({data: {userId, delta: a.creditsUsed, reason: 'Refund: appointment cancelled', appointmentId: id}});
        }
      });
      await audit?.record({userId, action: 'appointment.cancel', metadata: {appointmentId: id}});
      return service.get(userId, id);
    },
  };
  return service;
}

module.exports = {createConsultationService, toAppointment, toDoctor, istDayOf, istStartOfDay, DAY_MS};
