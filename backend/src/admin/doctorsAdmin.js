const {badRequest, conflict, notFound} = require('../common/errors');
const {hashPassword, passwordProblem} = require('../auth/passwordService');
const {ROLE_IDS} = require('../auth/roles');
const {toDoctor} = require('../consultation/consultationService');

const toAdminDoctor = (doctor, clinic, schedules) => ({
  ...toDoctor(doctor, clinic),
  clinicId: doctor.clinicId ?? null,
  bio: doctor.bio ?? null,
  userId: doctor.userId ?? null,
  active: doctor.active,
  timings: schedules.map(s => ({weekday: s.weekday, startTime: s.startTime, endTime: s.endTime, slotMinutes: s.slotMinutes})),
});

function createDoctorsAdmin({prisma, audit, now = () => new Date()}) {
  const load = async id => {
    const doctor = await prisma.doctor.findUnique({where: {id}});
    if (!doctor) {
      throw notFound('Doctor not found.');
    }
    return doctor;
  };

  const present = async doctor => {
    const clinic = doctor.clinicId ? await prisma.clinic.findFirst({where: {id: doctor.clinicId}}) : null;
    const schedules = await prisma.doctorSchedule.findMany({where: {doctorId: doctor.id}, orderBy: [{weekday: 'asc'}, {startTime: 'asc'}]});
    return toAdminDoctor(doctor, clinic, schedules);
  };

  const checkLinks = async ({clinicId, userId}, doctorId) => {
    if (clinicId && !(await prisma.clinic.findUnique({where: {id: clinicId}}))) {
      throw badRequest('That clinic does not exist.');
    }
    if (userId) {
      const user = await prisma.user.findUnique({where: {id: userId}});
      if (!user) {
        throw badRequest('That user does not exist.');
      }
      if (user.roleId !== ROLE_IDS.doctor) {
        throw badRequest('That user does not have the Doctor role.');
      }
      const taken = await prisma.doctor.findFirst({where: {userId}});
      if (taken && taken.id !== doctorId) {
        throw conflict('That user is already linked to another doctor.');
      }
    }
  };

  // Back to an ordinary customer. The person's sessions are ended, so the old Doctor token stops working at once.
  const demote = async (tx, userId) => {
    const user = await tx.user.findUnique({where: {id: userId}});
    if (user && user.roleId === ROLE_IDS.doctor) {
      await tx.user.update({where: {id: userId}, data: {roleId: ROLE_IDS.customer}});
      await tx.refreshToken.updateMany({where: {userId, revokedAt: null}, data: {revokedAt: new Date()}});
    }
  };

  const record = (admin, action, doctorId) => audit.record({userId: admin.id, action, metadata: {doctorId}});

  return {
    async list({q, active, clinicId, page, pageSize}) {
      const rows = await prisma.doctor.findMany({
        where: {...(active && {active: active === 'true'}), ...(clinicId && {clinicId})},
        orderBy: [{name: 'asc'}],
      });
      const needle = (q ?? '').toLowerCase();
      const found = rows.filter(d => !needle || `${d.id} ${d.name} ${d.specialization} ${d.system ?? ''}`.toLowerCase().includes(needle));
      const clinics = new Map((await prisma.clinic.findMany({})).map(c => [c.id, c]));
      const schedules = await prisma.doctorSchedule.findMany({});
      const items = found.slice((page - 1) * pageSize, page * pageSize).map(d =>
        toAdminDoctor(d, clinics.get(d.clinicId), schedules.filter(s => s.doctorId === d.id)),
      );
      return {total: found.length, page, pageSize, items};
    },

    async get(id) {
      return present(await load(id));
    },

    async create(admin, input) {
      await checkLinks(input);
      if (await prisma.doctor.findUnique({where: {id: input.id}})) {
        throw conflict('A doctor with this id already exists.');
      }
      let doctor;
      try {
        doctor = await prisma.doctor.create({data: {...input, concerns: input.concerns ?? []}});
      } catch (error) {
        if (error?.code === 'P2002') {
          throw conflict('That doctor or login is already in use.');
        }
        throw error;
      }
      await record(admin, 'admin.doctor.create', doctor.id);
      return present(doctor);
    },

    async update(admin, id, changes) {
      const doctor = await load(id);
      await checkLinks(changes, id);
      if (changes.active === false && doctor.active) {
        const open = await prisma.appointment.count({where: {doctorId: id, status: 'requested'}});
        const upcoming = await prisma.appointment.count({where: {doctorId: id, status: 'booked', startsAt: {gte: now()}}});
        if (open + upcoming > 0) {
          throw conflict('This doctor still has open appointments. Cancel or complete them first.');
        }
      }
      let updated;
      try {
        updated = await prisma.doctor.update({where: {id}, data: changes});
      } catch (error) {
        if (error?.code === 'P2002') {
          throw conflict('That login is already linked to another doctor.');
        }
        throw error;
      }
      await record(admin, 'admin.doctor.update', id);
      return present(updated);
    },

    // Gives a doctor a login: the person (found by mobile number) gets the Doctor role and is linked to this doctor.
    // Only an ordinary customer account can become a doctor login, so staff roles are never changed by accident.
    async linkLogin(admin, id, mobile) {
      const doctor = await load(id);
      const user = await prisma.user.findUnique({where: {mobile}});
      if (!user) {
        throw notFound('No account with that mobile number. The doctor must sign up in the app first.');
      }
      if (user.roleId !== ROLE_IDS.customer && user.roleId !== ROLE_IDS.doctor) {
        throw conflict('Only a customer account can become a doctor login.');
      }
      const taken = await prisma.doctor.findFirst({where: {userId: user.id}});
      if (taken && taken.id !== id) {
        throw conflict('That person is already the login of another doctor.');
      }
      await prisma.$transaction(async tx => {
        if (doctor.userId && doctor.userId !== user.id) {
          await demote(tx, doctor.userId);
        }
        await tx.user.update({where: {id: user.id}, data: {roleId: ROLE_IDS.doctor}});
        await tx.doctor.update({where: {id}, data: {userId: user.id}});
      });
      await audit.record({userId: admin.id, action: 'admin.doctor.login.link', metadata: {doctorId: id, targetUserId: user.id}});
      return present(await load(id));
    },

    // Makes the account of a doctor: a new user with the Doctor role and a temporary password, linked at once.
    // The doctor logs in with the mobile (or email) and the password they were told, and changes the password in the app.
    async createLogin(admin, id, {mobile, email, password}) {
      const doctor = await load(id);
      if (doctor.userId) {
        throw conflict('This doctor already has a login.');
      }
      const problem = passwordProblem(password, {mobile, email});
      if (problem) {
        throw badRequest('Some details are not valid.', [{field: 'password', message: problem}]);
      }
      const taken = await prisma.user.findFirst({where: {OR: [{mobile}, ...(email ? [{email}] : [])]}});
      if (taken) {
        throw conflict(
          taken.mobile === mobile
            ? 'That mobile number already has an account. Use "Link" to give that account the doctor role.'
            : 'That email already has an account. Use "Link" with the mobile number of that account.',
        );
      }
      const passwordHash = await hashPassword(password);
      try {
        await prisma.$transaction(async tx => {
          const user = await tx.user.create({data: {mobile, email: email ?? null, name: doctor.name, passwordHash, roleId: ROLE_IDS.doctor}});
          await tx.doctor.update({where: {id}, data: {userId: user.id}});
        });
      } catch (error) {
        if (error?.code === 'P2002') {
          throw conflict('That mobile number or email was just registered.');
        }
        throw error;
      }
      // the password is never written to the audit log
      await audit.record({userId: admin.id, action: 'admin.doctor.login.create', metadata: {doctorId: id}});
      return present(await load(id));
    },

    async unlinkLogin(admin, id) {
      const doctor = await load(id);
      if (doctor.userId) {
        await prisma.$transaction(async tx => {
          await demote(tx, doctor.userId);
          await tx.doctor.update({where: {id}, data: {userId: null}});
        });
        await audit.record({userId: admin.id, action: 'admin.doctor.login.unlink', metadata: {doctorId: id, targetUserId: doctor.userId}});
      }
      return present(await load(id));
    },

    // Replaces the whole weekly timetable. Appointments that are already booked are not touched.
    async saveSchedule(admin, id, timings) {
      const doctor = await load(id);
      await prisma.$transaction(async tx => {
        await tx.doctorSchedule.deleteMany({where: {doctorId: id}});
        if (timings.length) {
          await tx.doctorSchedule.createMany({data: timings.map(t => ({...t, doctorId: id}))});
        }
      });
      await record(admin, admin.role === 'doctor' ? 'doctor.schedule' : 'admin.doctor.schedule', id);
      return present(doctor);
    },
  };
}

module.exports = {createDoctorsAdmin};
