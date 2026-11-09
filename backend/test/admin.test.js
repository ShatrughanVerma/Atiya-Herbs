const {createHash} = require('node:crypto');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const {ROLE_IDS} = require('../src/auth/roles');
const {BASE_ENV, buildTestApp} = require('./helpers/testApp');
const {seedClinics, seedPlaceholderDoctors} = require('../src/consultation/seed');

const API = '/api/v1/admin';

const nextMonday = () => {
  const date = new Date(Date.now() + 3 * 24 * 3_600_000);
  while (new Date(date.getTime() + 5.5 * 3_600_000).getUTCDay() !== 1) {
    date.setTime(date.getTime() + 24 * 3_600_000);
  }
  return new Date(date.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);
};
const at = (day, time) => new Date(`${day}T${time}:00+05:30`).toISOString();

// An app with clinics, doctors, one customer and one admin
async function build(envOverrides) {
  const t = buildTestApp(envOverrides);
  await seedClinics(t.prisma);
  await seedPlaceholderDoctors(t.prisma);
  const customer = await t.login('9876543210');
  await request(t.app).patch('/api/v1/users/me').set(t.bearer(customer)).send({name: 'Asha Khan'}).expect(200);
  const admin = await t.loginAs('admin', '9000000001');
  const as = {admin: t.bearer(admin), customer: t.bearer(customer)};
  const ask = (method, path, who = 'admin') => request(t.app)[method](`${API}${path}`).set(as[who]);
  // a request without a time, made by the customer
  const makeRequest = async (extra = {}) =>
    (await request(t.app).post('/api/v1/appointments').set(as.customer).send({doctorId: 'sample-doctor-one', type: 'video', ...extra}).expect(201)).body;
  return {t, as, ask, makeRequest, admin};
}

describe('who may use the admin API', () => {
  const ROUTES = [
    ['get', '/dashboard'],
    ['get', '/appointments'],
    ['get', '/appointments/abc'],
    ['post', '/appointments/abc/confirm'],
    ['post', '/appointments/abc/complete'],
    ['post', '/appointments/abc/cancel'],
    ['patch', '/appointments/abc'],
    ['get', '/doctors'],
    ['post', '/doctors'],
    ['post', '/doctors/photo-upload'],
    ['post', '/doctors/abc/login/create'],
    ['put', '/doctors/abc/login'],
    ['delete', '/doctors/abc/login'],
    ['get', '/doctors/abc'],
    ['patch', '/doctors/abc'],
    ['put', '/doctors/abc/schedule'],
    ['get', '/clinics'],
    ['post', '/clinics'],
    ['patch', '/clinics/abc'],
    ['get', '/users?mobile=9876543210'],
    ['get', '/users/abc/credits'],
    ['post', '/users/abc/credits'],
  ];

  test('without a login every route answers 401, and a customer gets 403 on every one', async () => {
    const {t, as} = await build();
    for (const [method, path] of ROUTES) {
      const anonymous = await request(t.app)[method](`${API}${path}`).send({});
      expect([method, path, anonymous.status]).toEqual([method, path, 401]);
      const customer = await request(t.app)[method](`${API}${path}`).set(as.customer).send({});
      expect([method, path, customer.status]).toEqual([method, path, 403]);
    }
  });

  test('a doctor, a moderator and a distributor are not admins either', async () => {
    const {t, admin} = await build();
    for (const role of ['doctor', 'moderator', 'distributor', 'customer']) {
      // a valid token of the same person, but with another role
      const token = jwt.sign({roleId: ROLE_IDS[role]}, BASE_ENV.JWT_ACCESS_SECRET, {subject: admin.user.id, issuer: 'atiyaherbs-api', audience: 'atiyaherbs-app', expiresIn: 60});
      await request(t.app).get(`${API}/dashboard`).set('Authorization', `Bearer ${token}`).expect(403);
    }
  });
});

describe('admin appointments', () => {
  test('list, filters and details', async () => {
    const {t, ask, makeRequest, as} = await build();
    const day = nextMonday();
    const wish = await makeRequest({preferredDate: day, concern: 'Joint pain'});
    await request(t.app).post('/api/v1/appointments').set(as.customer).send({doctorId: 'sample-doctor-two', type: 'video', startsAt: at(day, '10:00')}).expect(201);

    const all = (await ask('get', '/appointments').expect(200)).body;
    expect(all.total).toBe(2);
    expect(all.items[0].adminNote).toBeNull();
    expect((await ask('get', '/appointments?status=requested')).body.total).toBe(2); // both wait for a doctor
    expect((await ask('get', '/appointments?status=booked')).body.total).toBe(0);
    expect((await ask('get', '/appointments?doctorId=sample-doctor-two')).body.total).toBe(1);
    expect((await ask('get', `/appointments?date=${day}`)).body.total).toBe(2); // the wish and the booking
    expect((await ask('get', '/appointments?q=asha')).body.total).toBe(0 + 2); // by patient name
    expect((await ask('get', `/appointments?q=${wish.number}`)).body.total).toBe(1);
    expect((await ask('get', '/appointments?q=9876')).body.total).toBe(2); // by mobile
    await ask('get', '/appointments?status=nonsense').expect(400);
    const one = (await ask('get', `/appointments/${wish.id}`).expect(200)).body;
    expect(one).toMatchObject({status: 'requested', concern: 'Joint pain', doctor: {id: 'sample-doctor-one'}, toPay: 300});
    await ask('get', '/appointments/not-here').expect(404);
  });

  test('a request gets its time from staff, and the slot is then taken', async () => {
    const {t, ask, makeRequest, as} = await build();
    const day = nextMonday();
    const wish = await makeRequest({preferredDate: day});
    await ask('post', `/appointments/${wish.id}/confirm`).send({startsAt: at(day, '10:05')}).expect(409); // not a slot
    await ask('post', `/appointments/${wish.id}/confirm`).send({startsAt: at(day, '10:20'), extra: 1}).expect(400);
    const done = await ask('post', `/appointments/${wish.id}/confirm`).send({startsAt: at(day, '10:20')}).expect(200);
    expect(done.body).toMatchObject({status: 'booked', startsAt: at(day, '10:20')});
    const slots = (await request(t.app).get(`/api/v1/doctors/sample-doctor-one/slots?date=${day}`)).body.slots.map(s => s.startsAt);
    expect(slots).not.toContain(at(day, '10:20'));
    // already booked: confirming again is refused, and so is taking another person's slot
    await ask('post', `/appointments/${wish.id}/confirm`).send({startsAt: at(day, '10:40')}).expect(409);
    const second = await makeRequest();
    await ask('post', `/appointments/${second.id}/confirm`).send({startsAt: at(day, '10:20')}).expect(409);
    // the patient sees the new time
    expect((await request(t.app).get(`/api/v1/appointments/${wish.id}`).set(as.customer)).body).toMatchObject({status: 'booked', startsAt: at(day, '10:20')});
  });

  test('complete needs a booked appointment that has started', async () => {
    const {t, ask, makeRequest} = await build();
    const day = nextMonday();
    const wish = await makeRequest();
    await ask('post', `/appointments/${wish.id}/complete`).expect(409); // still a request
    await ask('post', `/appointments/${wish.id}/confirm`).send({startsAt: at(day, '10:00')}).expect(200);
    await ask('post', `/appointments/${wish.id}/complete`).expect(409); // in the future
    t.prisma.appointment.rows[0].startsAt = new Date(Date.now() - 3_600_000); // pretend the time has passed
    const done = await ask('post', `/appointments/${wish.id}/complete`).expect(200);
    expect(done.body.status).toBe('completed');
    expect(done.body.completedAt).toEqual(expect.any(String));
    await ask('post', `/appointments/${wish.id}/cancel`).expect(409); // closed
  });

  test('cancel keeps the reason, frees the slot and gives the credits back', async () => {
    const {t, ask, as} = await build();
    const day = nextMonday();
    t.prisma.user.rows.find(u => u.mobile === '9876543210').credits = 100;
    const booked = (
      await request(t.app).post('/api/v1/appointments').set(as.customer).send({doctorId: 'sample-doctor-one', type: 'video', startsAt: at(day, '11:00'), useCredits: true}).expect(201)
    ).body;
    expect(booked.creditsUsed).toBe(100);
    const cancelled = await ask('post', `/appointments/${booked.id}/cancel`).send({reason: 'Doctor on leave'}).expect(200);
    expect(cancelled.body).toMatchObject({status: 'cancelled', cancelReason: 'Doctor on leave'});
    expect((await request(t.app).get('/api/v1/credits').set(as.customer)).body.balance).toBe(100);
    const slots = (await request(t.app).get(`/api/v1/doctors/sample-doctor-one/slots?date=${day}`)).body.slots.map(s => s.startsAt);
    expect(slots).toContain(at(day, '11:00'));
    await ask('post', `/appointments/${booked.id}/cancel`).send({}).expect(409);
  });

  test('a staff note is saved, can be cleared, and is not shown to the patient', async () => {
    const {t, ask, makeRequest, as} = await build();
    const wish = await makeRequest();
    expect((await ask('patch', `/appointments/${wish.id}`).send({adminNote: 'Called, will come at 5'}).expect(200)).body.adminNote).toBe('Called, will come at 5');
    expect(JSON.stringify((await request(t.app).get(`/api/v1/appointments/${wish.id}`).set(as.customer)).body)).not.toContain('will come at 5');
    expect((await ask('patch', `/appointments/${wish.id}`).send({adminNote: ''})).body.adminNote).toBeNull();
    await ask('patch', `/appointments/${wish.id}`).send({status: 'completed'}).expect(400); // only the note can be changed
  });

  test('every staff action is written to the audit log with the admin as the actor', async () => {
    const {t, ask, makeRequest, admin} = await build();
    const wish = await makeRequest();
    await ask('post', `/appointments/${wish.id}/confirm`).send({startsAt: at(nextMonday(), '12:00')}).expect(200);
    await ask('post', `/appointments/${wish.id}/cancel`).send({}).expect(200);
    const logs = t.prisma.auditLog.rows.filter(row => row.action.startsWith('admin.appointment'));
    expect(logs.map(row => row.action)).toEqual(['admin.appointment.confirm', 'admin.appointment.cancel']);
    expect(logs.every(row => row.userId === admin.user.id)).toBe(true);
  });
});

describe('admin doctors', () => {
  const NEW_DOCTOR = {
    id: 'dr-new-person',
    name: 'Dr. New Person',
    clinicId: 'lucknow',
    system: 'Unani',
    specialization: 'Skin',
    qualifications: '',
    experienceYears: 5,
    languages: 'Hindi',
    bio: 'Line one.\nLine two.',
    fee: 250,
    modes: ['clinic', 'video'],
    concerns: ['Skin & Hair'],
  };

  test('create, list (including inactive), edit and switch off', async () => {
    const {t, ask} = await build();
    const created = await ask('post', '/doctors').send(NEW_DOCTOR).expect(201);
    expect(created.body).toMatchObject({id: 'dr-new-person', fee: 250, active: true, qualifications: null, bio: 'Line one.\nLine two.', clinicId: 'lucknow'});
    await ask('post', '/doctors').send(NEW_DOCTOR).expect(409);
    await ask('post', '/doctors').send({...NEW_DOCTOR, id: 'Bad Id'}).expect(400);
    await ask('post', '/doctors').send({...NEW_DOCTOR, id: 'dr-x', modes: []}).expect(400);
    await ask('post', '/doctors').send({...NEW_DOCTOR, id: 'dr-x', fee: -1}).expect(400);
    await ask('post', '/doctors').send({...NEW_DOCTOR, id: 'dr-x', photoUrl: 'http://insecure.example/x.jpg'}).expect(400);
    await ask('post', '/doctors').send({...NEW_DOCTOR, id: 'dr-x', clinicId: 'no-such-clinic'}).expect(400);

    expect((await ask('patch', '/doctors/dr-new-person').send({fee: 400, concerns: ['Gut Health'], photoUrl: 'https://res.cloudinary.com/x/a.jpg'}).expect(200)).body).toMatchObject({fee: 400, concerns: ['Gut Health']});
    await ask('patch', '/doctors/dr-new-person').send({}).expect(400);
    await ask('patch', '/doctors/dr-new-person').send({id: 'other'}).expect(400); // the id never changes
    await ask('patch', '/doctors/nobody').send({fee: 1}).expect(404);

    await ask('patch', '/doctors/dr-new-person').send({active: false}).expect(200);
    expect((await request(t.app).get('/api/v1/doctors/dr-new-person')).status).toBe(404); // hidden from the app
    const list = (await ask('get', '/doctors?pageSize=50').expect(200)).body;
    expect(list.items.map(d => d.id)).toContain('dr-new-person');
    expect((await ask('get', '/doctors?active=false')).body.items.map(d => d.id)).toEqual(['dr-new-person']);
    expect((await ask('get', '/doctors?q=skin')).body.items.map(d => d.id)).toContain('dr-new-person');
  });

  test('a doctor with open appointments cannot be switched off', async () => {
    const {ask, makeRequest} = await build();
    const wish = await makeRequest();
    await ask('patch', '/doctors/sample-doctor-one').send({active: false}).expect(409);
    await ask('post', `/appointments/${wish.id}/cancel`).send({}).expect(200);
    await ask('patch', '/doctors/sample-doctor-one').send({active: false}).expect(200);
  });

  test('the login of a doctor must be a real user with the Doctor role, used once', async () => {
    const {t, ask} = await build();
    const doctorUser = await t.loginAs('doctor', '9000000005');
    await ask('patch', '/doctors/sample-doctor-one').send({userId: 'x'.repeat(36)}).expect(400); // no such user
    await ask('patch', '/doctors/sample-doctor-one').send({userId: t.prisma.user.rows.find(u => u.mobile === '9876543210').id}).expect(400); // a customer
    await ask('patch', '/doctors/sample-doctor-one').send({userId: doctorUser.user.id}).expect(200);
    await ask('patch', '/doctors/sample-doctor-two').send({userId: doctorUser.user.id}).expect(409);
  });

  test('the timetable is replaced as a whole and new slots follow it', async () => {
    const {t, ask} = await build();
    const day = nextMonday(); // a Monday
    const timings = [
      {weekday: 1, startTime: '09:00', endTime: '10:00', slotMinutes: 30},
      {weekday: 1, startTime: '15:00', endTime: '16:00', slotMinutes: 30},
    ];
    const saved = await ask('put', '/doctors/sample-doctor-one/schedule').send({timings}).expect(200);
    expect(saved.body.timings).toHaveLength(2);
    const slots = (await request(t.app).get(`/api/v1/doctors/sample-doctor-one/slots?date=${day}`)).body.slots.map(s => s.startsAt);
    expect(slots).toEqual([at(day, '09:00'), at(day, '09:30'), at(day, '15:00'), at(day, '15:30')]);
    expect((await request(t.app).get('/api/v1/doctors/sample-doctor-one')).body.timings).toHaveLength(2);

    const bad = [
      [{weekday: 1, startTime: '10:00', endTime: '09:00', slotMinutes: 20}],
      [{weekday: 1, startTime: '10:00', endTime: '12:00', slotMinutes: 20}, {weekday: 1, startTime: '11:00', endTime: '13:00', slotMinutes: 20}],
      [{weekday: 9, startTime: '10:00', endTime: '12:00', slotMinutes: 20}],
      [{weekday: 1, startTime: '10:00', endTime: '12:00', slotMinutes: 1}],
      [{weekday: 1, startTime: '10am', endTime: '12:00', slotMinutes: 20}],
    ];
    for (const list of bad) {
      await ask('put', '/doctors/sample-doctor-one/schedule').send({timings: list}).expect(400);
    }
    expect((await ask('put', '/doctors/sample-doctor-one/schedule').send({timings: []}).expect(200)).body.timings).toEqual([]);
    await ask('put', '/doctors/nobody/schedule').send({timings: []}).expect(404);
  });
});

describe('admin clinics', () => {
  const NEW_CLINIC = {id: 'patna', name: 'AIHM Patna Clinic', area: 'Bihar', city: 'Patna', state: 'Bihar', pincode: '800001', address: 'Boring Road', phone: '+91 612 123456', timings: 'Mon-Sat 10-6', lat: 25.6, lng: 85.1};

  test('create, list, edit and switch off', async () => {
    const {t, ask} = await build();
    expect((await ask('post', '/clinics').send(NEW_CLINIC).expect(201)).body).toMatchObject({id: 'patna', active: true});
    await ask('post', '/clinics').send(NEW_CLINIC).expect(409);
    await ask('post', '/clinics').send({...NEW_CLINIC, id: 'x-clinic', lat: 200}).expect(400);
    await ask('post', '/clinics').send({...NEW_CLINIC, id: 'x-clinic', pincode: '12'}).expect(400);
    await ask('post', '/clinics').send({...NEW_CLINIC, id: 'x-clinic', phone: '<script>'}).expect(400);
    expect((await ask('patch', '/clinics/patna').send({phone: '', address: 'New Road'}).expect(200)).body).toMatchObject({phone: null, address: 'New Road'});
    await ask('patch', '/clinics/patna').send({}).expect(400);
    await ask('patch', '/clinics/nowhere').send({city: 'X'}).expect(404);
    await ask('patch', '/clinics/patna').send({active: false}).expect(200);
    expect((await request(t.app).get('/api/v1/clinics/patna')).status).toBe(404); // hidden from the app
    const list = (await ask('get', '/clinics').expect(200)).body;
    expect(list.find(c => c.id === 'patna').active).toBe(false);
    expect(list.length).toBe(10);
  });

  test('a clinic whose doctor has open appointments cannot be switched off', async () => {
    const {ask, makeRequest} = await build();
    await makeRequest(); // sample-doctor-one works at lucknow
    await ask('patch', '/clinics/lucknow').send({active: false}).expect(409);
  });
});

describe('admin credits', () => {
  test('find a person, give and take back credits, never below zero', async () => {
    const {t, ask, as} = await build();
    const found = (await ask('get', '/users?mobile=9876543210').expect(200)).body;
    expect(found).toMatchObject({name: 'Asha Khan', mobile: '9876543210', credits: 0});
    await ask('get', '/users?mobile=9111111111').expect(404);
    await ask('get', '/users').expect(400);
    await ask('get', '/users?mobile=9876543210&email=a@b.com').expect(400);
    await ask('get', '/users?mobile=123').expect(400);

    expect((await ask('post', `/users/${found.id}/credits`).send({amount: 250, reason: 'Welcome bonus'}).expect(200)).body).toEqual({balance: 250});
    expect((await ask('post', `/users/${found.id}/credits`).send({amount: -100, reason: 'Correction'}).expect(200)).body).toEqual({balance: 150});
    await ask('post', `/users/${found.id}/credits`).send({amount: -151, reason: 'Too much'}).expect(409);
    await ask('post', `/users/${found.id}/credits`).send({amount: 0, reason: 'Nothing'}).expect(400);
    await ask('post', `/users/${found.id}/credits`).send({amount: 1.5, reason: 'Half'}).expect(400);
    await ask('post', `/users/${found.id}/credits`).send({amount: 5}).expect(400);
    await ask('post', '/users/nobody/credits').send({amount: 5, reason: 'x'}).expect(404);

    const history = (await ask('get', `/users/${found.id}/credits`).expect(200)).body;
    expect(history.balance).toBe(150);
    expect(history.history.map(h => h.delta)).toEqual([-100, 250]);
    expect((await request(t.app).get('/api/v1/credits').set(as.customer)).body.balance).toBe(150); // what the app shows
    expect(t.prisma.auditLog.rows.filter(r => r.action === 'admin.credits.change')).toHaveLength(2);
  });
});

describe('admin dashboard', () => {
  test('counts what needs attention', async () => {
    const {t, ask, makeRequest, as} = await build();
    const day = nextMonday();
    const a = await makeRequest();
    await makeRequest();
    await request(t.app).post('/api/v1/appointments').set(as.customer).send({doctorId: 'sample-doctor-two', type: 'video', startsAt: at(day, '10:00')}).expect(201);
    await ask('post', `/appointments/${a.id}/cancel`).send({}).expect(200);
    expect((await ask('get', '/dashboard').expect(200)).body).toEqual({
      requestedAppointments: 2, // the one without a time, and the one with a time: both wait for a doctor
      todayAppointments: 0,
      upcomingAppointments: 0,
      cancelledLast7Days: 1,
      doctorsActive: 2,
    });
  });
});

describe('doctor photo upload', () => {
  test('is refused until Cloudinary is set up', async () => {
    const {ask} = await build();
    await ask('post', '/doctors/photo-upload').send({}).expect(503);
  });

  test('gives a signature made with the secret, and never the secret itself', async () => {
    const {ask} = await build({CLOUDINARY_CLOUD_NAME: 'demo', CLOUDINARY_API_KEY: '12345', CLOUDINARY_API_SECRET: 'shh-secret'});
    const res = (await ask('post', '/doctors/photo-upload').send({}).expect(200)).body;
    expect(res).toMatchObject({cloudName: 'demo', apiKey: '12345', folder: 'doctors'});
    expect(res.signature).toBe(createHash('sha1').update(`folder=doctors&timestamp=${res.timestamp}shh-secret`).digest('hex'));
    expect(JSON.stringify(res)).not.toContain('shh-secret');
  });
});

describe('the doctor side', () => {
  // a doctor who is linked to sample-doctor-one by an admin, and a request for that doctor
  async function withDoctor() {
    const ctx = await build();
    const {t, ask, as} = ctx;
    const customerId = t.prisma.user.rows.find(u => u.mobile === '9876543210').id;
    const doctorSession = await t.loginAs('customer', '9000000006'); // an ordinary account for now
    await ask('put', '/doctors/sample-doctor-one/login').send({mobile: '9000000006'}).expect(200);
    const doctorToken = require('jsonwebtoken').sign({roleId: 12}, BASE_ENV.JWT_ACCESS_SECRET, {
      subject: doctorSession.user.id,
      issuer: 'atiyaherbs-api',
      audience: 'atiyaherbs-app',
      expiresIn: 60,
    });
    const doc = (method, path) => request(t.app)[method](`/api/v1/doctor${path}`).set('Authorization', `Bearer ${doctorToken}`);
    return {...ctx, doc, customerId, as, doctorUserId: doctorSession.user.id};
  }

  test('linking a login gives the Doctor role, unlinking takes it back and ends the sessions', async () => {
    const {t, ask, doctorUserId} = await withDoctor();
    const row = () => t.prisma.user.rows.find(u => u.id === doctorUserId);
    expect(row().roleId).toBe(12);
    expect((await ask('get', '/doctors/sample-doctor-one')).body.userId).toBe(doctorUserId);
    await ask('put', '/doctors/sample-doctor-two/login').send({mobile: '9000000006'}).expect(409); // already another doctor's login
    await ask('put', '/doctors/sample-doctor-two/login').send({mobile: '9000000001'}).expect(409); // an admin account is never changed
    await ask('put', '/doctors/sample-doctor-two/login').send({mobile: '9111111111'}).expect(404);
    await ask('put', '/doctors/sample-doctor-two/login').send({mobile: '123'}).expect(400);
    await ask('delete', '/doctors/sample-doctor-one/login').expect(200);
    expect(row().roleId).toBe(14);
    expect((await ask('get', '/doctors/sample-doctor-one')).body.userId).toBeNull();
    expect(t.prisma.refreshToken.rows.filter(r => r.userId === doctorUserId).every(r => r.revokedAt)).toBe(true);
    expect(t.prisma.auditLog.rows.map(r => r.action)).toEqual(expect.arrayContaining(['admin.doctor.login.link', 'admin.doctor.login.unlink']));
  });

  test('a doctor sees only their own requests, and a login without a doctor profile is refused', async () => {
    const {t, doc, makeRequest, as} = await withDoctor();
    const mine = await makeRequest({preferredDate: nextMonday()});
    await request(t.app).post('/api/v1/appointments').set(as.customer).send({doctorId: 'sample-doctor-two', type: 'video'}).expect(201); // another doctor
    const list = (await doc('get', '/appointments').expect(200)).body;
    expect(list.items.map(a => a.id)).toEqual([mine.id]);
    expect((await doc('get', '/appointments?doctorId=sample-doctor-two')).status).toBe(400); // cannot ask for another doctor
    expect((await doc('get', '/dashboard').expect(200)).body).toEqual({requestedAppointments: 1, todayAppointments: 0, upcomingAppointments: 0, cancelledLast7Days: 0, patients: 1});
    expect((await doc('get', '/me').expect(200)).body.id).toBe('sample-doctor-one');
    // another doctor's appointment is "not found"
    const otherId = t.prisma.appointment.rows.find(a => a.doctorId === 'sample-doctor-two').id;
    await doc('get', `/appointments/${otherId}`).expect(404);
    await doc('post', `/appointments/${otherId}/confirm`).send({}).expect(404);
    await doc('post', `/appointments/${otherId}/decline`).send({}).expect(404);
    // a Doctor-role token with no doctor linked is refused
    const lonely = require('jsonwebtoken').sign({roleId: 12}, BASE_ENV.JWT_ACCESS_SECRET, {subject: t.prisma.user.rows[0].id, issuer: 'atiyaherbs-api', audience: 'atiyaherbs-app', expiresIn: 60});
    await request(t.app).get('/api/v1/doctor/appointments').set('Authorization', `Bearer ${lonely}`).expect(403);
    // a customer and an admin are not on the doctor side
    await request(t.app).get('/api/v1/doctor/appointments').set(as.customer).expect(403);
    await request(t.app).get('/api/v1/doctor/appointments').set(as.admin).expect(403);
  });

  test('pending -> confirmed when the doctor confirms, and the patient sees it', async () => {
    const {t, doc, as, makeRequest} = await withDoctor();
    const day = nextMonday();
    const pending = await makeRequest({startsAt: at(day, '10:00')}); // the patient chose a time
    expect(pending).toMatchObject({status: 'requested', startsAt: at(day, '10:00')});
    // the chosen time is held: nobody else can take it while the doctor decides
    const slots = (await request(t.app).get(`/api/v1/doctors/sample-doctor-one/slots?date=${day}`)).body.slots.map(s => s.startsAt);
    expect(slots).not.toContain(at(day, '10:00'));
    expect((await request(t.app).get(`/api/v1/appointments/${pending.id}`).set(as.customer)).body.status).toBe('requested');

    const done = await doc('post', `/appointments/${pending.id}/confirm`).send({}).expect(200); // keeps the patient's time
    expect(done.body).toMatchObject({status: 'booked', startsAt: at(day, '10:00')});
    expect((await request(t.app).get(`/api/v1/appointments/${pending.id}`).set(as.customer)).body).toMatchObject({status: 'booked', startsAt: at(day, '10:00')});
    await doc('post', `/appointments/${pending.id}/confirm`).send({}).expect(409); // already confirmed
    expect(t.prisma.auditLog.rows.map(r => r.action)).toContain('doctor.appointment.confirm');
  });

  test('a request without a time needs the doctor to give one', async () => {
    const {t, doc, makeRequest} = await withDoctor();
    const day = nextMonday();
    const wish = await makeRequest({preferredDate: day});
    await doc('post', `/appointments/${wish.id}/confirm`).send({}).expect(400); // no time anywhere
    await doc('post', `/appointments/${wish.id}/confirm`).send({startsAt: at(day, '10:05')}).expect(409); // not a free slot
    const done = await doc('post', `/appointments/${wish.id}/confirm`).send({startsAt: at(day, '10:20')}).expect(200);
    expect(done.body).toMatchObject({status: 'booked', startsAt: at(day, '10:20')});
    expect(t.prisma.appointment.rows[0].slotKey).toBe(`sample-doctor-one|${at(day, '10:20')}`);
  });

  test('declining cancels it for the patient with the reason, frees the time and refunds credits', async () => {
    const {t, doc, as, makeRequest} = await withDoctor();
    const day = nextMonday();
    t.prisma.user.rows.find(u => u.mobile === '9876543210').credits = 100;
    const pending = await makeRequest({startsAt: at(day, '11:00'), useCredits: true});
    const declined = await doc('post', `/appointments/${pending.id}/decline`).send({reason: 'Not available that day'}).expect(200);
    expect(declined.body).toMatchObject({status: 'cancelled', cancelReason: 'Not available that day'});
    const seen = (await request(t.app).get(`/api/v1/appointments/${pending.id}`).set(as.customer)).body;
    expect(seen).toMatchObject({status: 'cancelled', cancelReason: 'Not available that day'});
    expect((await request(t.app).get('/api/v1/credits').set(as.customer)).body.balance).toBe(100);
    const slots = (await request(t.app).get(`/api/v1/doctors/sample-doctor-one/slots?date=${day}`)).body.slots.map(s => s.startsAt);
    expect(slots).toContain(at(day, '11:00'));
    await doc('post', `/appointments/${pending.id}/decline`).send({}).expect(409); // already closed
    expect(t.prisma.auditLog.rows.map(r => r.action)).toContain('doctor.appointment.cancel');
  });

  test('a doctor completes a confirmed visit after it has started, and cannot change doctors or notes', async () => {
    const {t, doc, makeRequest} = await withDoctor();
    const day = nextMonday();
    const pending = await makeRequest({startsAt: at(day, '10:00')});
    await doc('post', `/appointments/${pending.id}/complete`).expect(409); // still pending
    await doc('post', `/appointments/${pending.id}/confirm`).send({}).expect(200);
    await doc('post', `/appointments/${pending.id}/complete`).expect(409); // in the future
    t.prisma.appointment.rows[0].startsAt = new Date(Date.now() - 3_600_000);
    expect((await doc('post', `/appointments/${pending.id}/complete`).expect(200)).body.status).toBe('completed');
    await doc('patch', `/appointments/${pending.id}`).send({adminNote: 'x'}).expect(404); // no such doctor route
    await doc('put', '/doctors/sample-doctor-two/login').send({mobile: '9000000001'}).expect(404);
  });
});

describe('the doctor app: profile, patients and own timetable', () => {
  async function doctorWorld() {
    const ctx = await build();
    const {t, ask} = ctx;
    const session = await t.loginAs('customer', '9000000006');
    await ask('put', '/doctors/sample-doctor-one/login').send({mobile: '9000000006'}).expect(200);
    const token = jwt.sign({roleId: 12}, BASE_ENV.JWT_ACCESS_SECRET, {subject: session.user.id, issuer: 'atiyaherbs-api', audience: 'atiyaherbs-app', expiresIn: 60});
    const doc = (method, path) => request(t.app)[method](`/api/v1/doctor${path}`).set('Authorization', `Bearer ${token}`);
    return {...ctx, doc};
  }

  test('/me gives the doctor their profile with the clinic name', async () => {
    const {doc} = await doctorWorld();
    expect((await doc('get', '/me').expect(200)).body).toMatchObject({id: 'sample-doctor-one', name: 'Sample Doctor One', system: 'Unani', clinicName: 'AIHM Lucknow Clinic', fee: 300});
  });

  test('patients: one row per person, cancelled requests do not count, search works, others are not shown', async () => {
    const {t, as, doc, ask} = await doctorWorld();
    const post = body => request(t.app).post('/api/v1/appointments').set(as.customer).send({doctorId: 'sample-doctor-one', type: 'video', ...body});
    const day = nextMonday();
    const first = (await post({startsAt: at(day, '10:00')}).expect(201)).body;
    await post({startsAt: at(day, '10:20')}).expect(201); // the same person again
    const family = (await post({forSelf: false, patientName: 'Zaid Khan', patientMobile: '9123456780', concern: 'Acidity'}).expect(201)).body;
    await request(t.app).post('/api/v1/appointments').set(as.customer).send({doctorId: 'sample-doctor-two', type: 'video'}).expect(201); // another doctor's patient
    await ask('post', `/appointments/${family.id}/cancel`).send({}).expect(200); // a cancelled request is not a patient
    await doc('post', `/appointments/${first.id}/confirm`).send({}).expect(200);

    const list = (await doc('get', '/patients').expect(200)).body;
    expect(list.items.map(p => p.name)).toEqual(['Asha Khan']);
    expect(list.items[0]).toMatchObject({mobile: '9876543210', visits: 0, requests: 1, lastVisit: at(day, '10:20')});
    expect((await doc('get', '/patients?q=9876').expect(200)).body.total).toBe(1);
    expect((await doc('get', '/patients?q=zaid').expect(200)).body.total).toBe(0);
    await doc('get', '/patients?doctorId=x').expect(400);
  });

  test('a doctor does not get the staff note', async () => {
    const {ask, doc, makeRequest} = await doctorWorld();
    const wish = await makeRequest();
    await ask('patch', `/appointments/${wish.id}`).send({adminNote: 'internal remark'}).expect(200);
    expect((await ask('get', `/appointments/${wish.id}`)).body.adminNote).toBe('internal remark');
    expect((await doc('get', `/appointments/${wish.id}`).expect(200)).body.adminNote).toBeNull();
    expect((await doc('get', '/appointments').expect(200)).body.items[0].adminNote).toBeNull();
  });

  test('a doctor reads and replaces their own timetable only', async () => {
    const {t, ask, doc} = await doctorWorld();
    expect((await doc('get', '/schedule').expect(200)).body.timings).toHaveLength(12);
    const timings = [{weekday: 2, startTime: '14:00', endTime: '16:00', slotMinutes: 30}];
    expect((await doc('put', '/schedule').send({timings}).expect(200)).body.timings).toEqual(timings);
    expect((await doc('get', '/schedule')).body.timings).toEqual(timings);
    await doc('put', '/schedule').send({timings: [{weekday: 2, startTime: '16:00', endTime: '14:00', slotMinutes: 30}]}).expect(400);
    await doc('put', '/schedule').send({timings, doctorId: 'sample-doctor-two'}).expect(400); // cannot name another doctor
    // the other doctor's timetable is untouched
    expect((await ask('get', '/doctors/sample-doctor-two')).body.timings).toHaveLength(12);
    expect(t.prisma.auditLog.rows.map(r => r.action)).toContain('doctor.schedule');
  });
});

describe('staff make the account of a doctor', () => {
  const LOGIN = {mobile: '9811111111', email: 'Dr.Zafar@Example.com', password: 'Temp-Pass-2026'};

  test('the doctor can log in at once with the temporary password and lands on the doctor side', async () => {
    const {t, ask} = await build();
    const made = await ask('post', '/doctors/sample-doctor-one/login/create').send(LOGIN).expect(201);
    expect(made.body).toMatchObject({id: 'sample-doctor-one'});
    expect(made.body.userId).toEqual(expect.any(String));
    expect(JSON.stringify(made.body)).not.toContain('Temp-Pass'); // the password is never sent back

    const user = t.prisma.user.rows.find(u => u.mobile === '9811111111');
    expect(user).toMatchObject({roleId: 12, name: 'Sample Doctor One', email: 'dr.zafar@example.com'});
    expect(user.passwordHash).toMatch(/^scrypt\$/);
    expect(JSON.stringify(t.prisma.auditLog.rows)).not.toContain('Temp-Pass');
    expect(t.prisma.auditLog.rows.map(r => r.action)).toContain('admin.doctor.login.create');

    // login with the mobile, and with the email
    for (const identifier of ['9811111111', 'dr.zafar@example.com']) {
      const session = (await request(t.app).post('/api/v1/auth/login').send({identifier, password: LOGIN.password}).expect(200)).body;
      expect(session.user).toMatchObject({role: 'doctor', roleId: 12});
      const me = await request(t.app).get('/api/v1/doctor/me').set(t.bearer(session)).expect(200);
      expect(me.body.id).toBe('sample-doctor-one');
    }
    // the doctor can change the temporary password in the app, like anybody
    const session = (await request(t.app).post('/api/v1/auth/login').send({identifier: '9811111111', password: LOGIN.password})).body;
    await request(t.app).post('/api/v1/users/me/password').set(t.bearer(session)).send({currentPassword: LOGIN.password, newPassword: 'My-Own-Pass-1'}).expect(200);
  });

  test('refuses a weak password, a second login, a used mobile or email, and bad input', async () => {
    const {ask} = await build();
    const path = '/doctors/sample-doctor-one/login/create';
    await ask('post', path).send({...LOGIN, password: 'short1'}).expect(400);
    await ask('post', path).send({...LOGIN, password: '9811111111'}).expect(400); // the mobile number is not a password
    await ask('post', path).send({...LOGIN, mobile: '12345'}).expect(400);
    await ask('post', path).send({...LOGIN, email: 'not-an-email'}).expect(400);
    await ask('post', path).send({...LOGIN, role: 'admin'}).expect(400); // nothing else can be sent
    await ask('post', '/doctors/nobody/login/create').send(LOGIN).expect(404);
    await ask('post', path).send({mobile: '9876543210', password: LOGIN.password}).expect(409); // the customer account of Asha
    await ask('post', path).send({...LOGIN, email: 'asha@example.com'}).expect(201); // fresh mobile and email: fine
    await ask('post', path).send({mobile: '9822222222', password: LOGIN.password}).expect(409); // the doctor already has a login
  });

  test('an email that already has an account is refused, and the mobile of a customer says to use Link', async () => {
    const {t, ask} = await build();
    const asha = t.prisma.user.rows.find(u => u.mobile === '9876543210');
    asha.email = 'taken@example.com';
    const byEmail = await ask('post', '/doctors/sample-doctor-two/login/create').send({mobile: '9833333333', email: 'taken@example.com', password: LOGIN.password}).expect(409);
    expect(byEmail.body.message).toMatch(/email/i);
    const byMobile = await ask('post', '/doctors/sample-doctor-two/login/create').send({mobile: '9876543210', password: LOGIN.password}).expect(409);
    expect(byMobile.body.message).toMatch(/Link/);
    expect(t.prisma.user.rows.filter(u => u.roleId === 12)).toHaveLength(0);
  });

  test('removing the login later ends its sessions, like a linked one', async () => {
    const {t, ask} = await build();
    await ask('post', '/doctors/sample-doctor-one/login/create').send(LOGIN).expect(201);
    const session = (await request(t.app).post('/api/v1/auth/login').send({identifier: '9811111111', password: LOGIN.password}).expect(200)).body;
    await ask('delete', '/doctors/sample-doctor-one/login').expect(200);
    expect(t.prisma.user.rows.find(u => u.mobile === '9811111111').roleId).toBe(14);
    await request(t.app).post('/api/v1/auth/refresh').send({refreshToken: session.refreshToken}).expect(401);
  });
});

