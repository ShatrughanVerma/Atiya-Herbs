const {conflict, notFound} = require('../common/errors');

const toAdminClinic = c => ({
  id: c.id,
  name: c.name,
  area: c.area,
  city: c.city,
  state: c.state,
  pincode: c.pincode ?? null,
  address: c.address ?? null,
  phone: c.phone ?? null,
  timings: c.timings ?? null,
  lat: c.lat,
  lng: c.lng,
  active: c.active,
});

function createClinicsAdmin({prisma, audit, now = () => new Date()}) {
  const record = (admin, action, clinicId) => audit.record({userId: admin.id, action, metadata: {clinicId}});

  return {
    async list() {
      const rows = await prisma.clinic.findMany({orderBy: [{name: 'asc'}]});
      return rows.map(toAdminClinic);
    },

    async create(admin, input) {
      if (await prisma.clinic.findUnique({where: {id: input.id}})) {
        throw conflict('A clinic with this id already exists.');
      }
      const clinic = await prisma.clinic.create({data: input});
      await record(admin, 'admin.clinic.create', clinic.id);
      return toAdminClinic(clinic);
    },

    async update(admin, id, changes) {
      const clinic = await prisma.clinic.findUnique({where: {id}});
      if (!clinic) {
        throw notFound('Clinic not found.');
      }
      if (changes.active === false && clinic.active) {
        // a clinic with doctors who still have open appointments cannot be switched off
        const doctors = await prisma.doctor.findMany({where: {clinicId: id}});
        for (const doctor of doctors) {
          const open = await prisma.appointment.count({where: {doctorId: doctor.id, status: 'requested'}});
          const upcoming = await prisma.appointment.count({where: {doctorId: doctor.id, status: 'booked', startsAt: {gte: now()}}});
          if (open + upcoming > 0) {
            throw conflict(`${doctor.name} still has open appointments at this clinic. Cancel or complete them first.`);
          }
        }
      }
      const updated = await prisma.clinic.update({where: {id}, data: changes});
      await record(admin, 'admin.clinic.update', id);
      return toAdminClinic(updated);
    },
  };
}

module.exports = {createClinicsAdmin};
