const request = require('supertest');
const {buildTestApp} = require('./helpers/testApp');
const {seedClinics, seedPlaceholderDoctors} = require('../src/consultation/seed');

// A day a few days ahead that is a Monday (weekday 1), so the Mon-Sat timetable of the seed applies
const nextMonday = () => {
  const date = new Date(Date.now() + 3 * 24 * 3_600_000);
  while (new Date(date.getTime() + 5.5 * 3_600_000).getUTCDay() !== 1) {
    date.setTime(date.getTime() + 24 * 3_600_000);
  }
  return new Date(date.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);
};

async function buildClinicApp() {
  const t = buildTestApp();
  await seedClinics(t.prisma);
  await seedPlaceholderDoctors(t.prisma);
  return t;
}

describe('clinics and doctors', () => {
  test('are public, and clinics can be sorted by distance', async () => {
    const t = await buildClinicApp();
    const all = (await request(t.app).get('/api/v1/clinics').expect(200)).body;
    expect(all.length).toBe(9);
    const near = (await request(t.app).get('/api/v1/clinics?lat=28.61&lng=77.2').expect(200)).body; // Delhi
    expect(near[0].id).toBe('karol-bagh');
    expect(near[0].distanceKm).toBeLessThan(10);
    await request(t.app).get('/api/v1/clinics?lat=28.6').expect(400); // lat without lng
    expect((await request(t.app).get('/api/v1/clinics?city=jaipur')).body.map(c => c.id)).toEqual(['jaipur']);
    await request(t.app).get('/api/v1/clinics/nope-clinic').expect(404);
  });

  test('doctor list filters, and the profile shows timings and the clinic', async () => {
    const t = await buildClinicApp();
    const list = (await request(t.app).get('/api/v1/doctors').expect(200)).body;
    expect(list.total).toBe(2);
    expect(list.items[0].name).toBe('Sample Doctor One'); // best rating first
    expect((await request(t.app).get('/api/v1/doctors?mode=audio')).body.items.map(d => d.id)).toEqual(['sample-doctor-one']);
    expect((await request(t.app).get('/api/v1/doctors?maxFee=350')).body.total).toBe(1);
    expect((await request(t.app).get('/api/v1/doctors?q=joint')).body.items.map(d => d.id)).toEqual(['sample-doctor-two']);
    await request(t.app).get('/api/v1/doctors?unknown=1').expect(400);
    const profile = (await request(t.app).get('/api/v1/doctors/sample-doctor-one').expect(200)).body;
    expect(profile.clinic.id).toBe('lucknow');
    expect(profile.weeklyTimings.length).toBe(12);
    await request(t.app).get('/api/v1/doctors/not-a-doctor').expect(404);
  });

  test('concerns work as filter chips, search matches them, and each card shows the first free time', async () => {
    const t = await buildClinicApp();
    const chips = (await request(t.app).get('/api/v1/doctors/concerns').expect(200)).body;
    expect(chips).toEqual(expect.arrayContaining(['Gut Health', 'Joint & Mobility', 'General Wellness']));
    expect(chips[0]).toBe('General Wellness'); // treated by both doctors: most common first
    expect((await request(t.app).get('/api/v1/doctors?concern=gut%20health')).body.items.map(d => d.id)).toEqual(['sample-doctor-one']);
    expect((await request(t.app).get('/api/v1/doctors?q=unani')).body.items.map(d => d.id)).toEqual(['sample-doctor-one']);
    const first = (await request(t.app).get('/api/v1/doctors')).body.items[0];
    expect(first.system).toBe('Unani');
    expect(first.concerns).toContain('Gut Health');
    const next = new Date(first.nextAvailable).getTime();
    expect(next).toBeGreaterThan(Date.now());
    expect(next).toBeLessThan(Date.now() + 8 * 24 * 3_600_000);
  });

  test('the first free time skips a booked slot', async () => {
    const t = await buildClinicApp();
    const me = await t.login();
    await request(t.app).patch('/api/v1/users/me').set(t.bearer(me)).send({name: 'Asha Khan'}).expect(200);
    const before = (await request(t.app).get('/api/v1/doctors/sample-doctor-one')).body.nextAvailable;
    await request(t.app).post('/api/v1/appointments').set(t.bearer(me)).send({doctorId: 'sample-doctor-one', type: 'video', startsAt: before}).expect(201);
    const after = (await request(t.app).get('/api/v1/doctors/sample-doctor-one')).body.nextAvailable;
    expect(new Date(after).getTime()).toBeGreaterThan(new Date(before).getTime());
  });
});

describe('slots', () => {
  test('are made from the timetable, in Indian time, and a booked one disappears', async () => {
    const t = await buildClinicApp();
    const day = nextMonday();
    const slots = (await request(t.app).get(`/api/v1/doctors/sample-doctor-one/slots?date=${day}`).expect(200)).body.slots;
    expect(slots).toHaveLength(18); // 2 sessions x 3 hours x 3 per hour
    expect(slots[0].startsAt).toBe(new Date(`${day}T10:00:00+05:30`).toISOString());
    const sunday = new Date(day);
    sunday.setUTCDate(sunday.getUTCDate() + 6);
    expect((await request(t.app).get(`/api/v1/doctors/sample-doctor-one/slots?date=${sunday.toISOString().slice(0, 10)}`)).body.slots).toEqual([]);
  });

  test('refuse past, far-future and impossible dates', async () => {
    const t = await buildClinicApp();
    for (const date of ['2020-01-01', '2099-01-01', '2026-02-31', 'tomorrow']) {
      await request(t.app).get(`/api/v1/doctors/sample-doctor-one/slots?date=${date}`).expect(400);
    }
  });
});

describe('appointments', () => {
  const book = (t, session, startsAt, extra = {}) =>
    request(t.app).post('/api/v1/appointments').set(t.bearer(session)).send({doctorId: 'sample-doctor-one', type: 'video', startsAt, ...extra});

  test('need a login', async () => {
    const t = await buildClinicApp();
    await request(t.app).post('/api/v1/appointments').send({}).expect(401);
    await request(t.app).get('/api/v1/appointments').expect(401);
  });

  test('are requests the doctor must confirm, show up in the list, and hold the chosen slot', async () => {
    const t = await buildClinicApp();
    const me = await t.login('9876543210');
    await request(t.app).patch('/api/v1/users/me').set(t.bearer(me)).send({name: 'Asha Khan'}).expect(200);
    const day = nextMonday();
    const startsAt = new Date(`${day}T10:20:00+05:30`).toISOString();

    const res = await book(t, me, startsAt, {reason: 'Joint pain'}).expect(201);
    expect(res.body).toMatchObject({type: 'video', status: 'requested', fee: 300, patientName: 'Asha Khan', paymentStatus: 'pay_later', clinic: null});
    expect(res.body.number).toMatch(/^AP\d{6}[0-9A-F]{6}$/);

    const slots = (await request(t.app).get(`/api/v1/doctors/sample-doctor-one/slots?date=${day}`)).body.slots;
    expect(slots.map(s => s.startsAt)).not.toContain(startsAt);

    const other = await t.login('9123456780');
    await request(t.app).patch('/api/v1/users/me').set(t.bearer(other)).send({name: 'Zaid'}).expect(200);
    await book(t, other, startsAt).expect(409); // already taken

    const list = (await request(t.app).get('/api/v1/appointments').set(t.bearer(me)).expect(200)).body;
    expect(list.total).toBe(1);
    expect((await request(t.app).get('/api/v1/appointments').set(t.bearer(other))).body.total).toBe(0);
    await request(t.app).get(`/api/v1/appointments/${res.body.id}`).set(t.bearer(other)).expect(404); // not theirs
  });

  test('the price and the time come from the server, not from the request', async () => {
    const t = await buildClinicApp();
    const me = await t.login();
    const day = nextMonday();
    await book(t, me, new Date(`${day}T10:05:00+05:30`).toISOString(), {patientName: 'Asha Khan'}).expect(409); // not a slot
    await book(t, me, new Date(`${day}T22:00:00+05:30`).toISOString(), {patientName: 'Asha Khan'}).expect(409);
    await book(t, me, new Date(`${day}T10:00:00+05:30`).toISOString(), {patientName: 'Asha Khan', fee: 1}).expect(400); // unknown field
    await book(t, me, new Date(`${day}T10:00:00+05:30`).toISOString(), {patientName: 'Asha Khan', type: 'telepathy'}).expect(400);
    const ok = await book(t, me, new Date(`${day}T10:00:00+05:30`).toISOString(), {patientName: 'Asha Khan'}).expect(201);
    expect(ok.body.fee).toBe(300);
  });

  test('a kind of consultation the doctor does not offer, and a missing patient name, are refused', async () => {
    const t = await buildClinicApp();
    const me = await t.login();
    const startsAt = new Date(`${nextMonday()}T10:00:00+05:30`).toISOString();
    await request(t.app)
      .post('/api/v1/appointments')
      .set(t.bearer(me))
      .send({doctorId: 'sample-doctor-two', type: 'audio', startsAt, patientName: 'Asha Khan'})
      .expect(400);
    await book(t, me, startsAt).expect(400); // the account has no name yet
  });

  test('an in-clinic visit records the clinic', async () => {
    const t = await buildClinicApp();
    const me = await t.login();
    const res = await book(t, me, new Date(`${nextMonday()}T11:00:00+05:30`).toISOString(), {type: 'clinic', patientName: 'Asha Khan'}).expect(201);
    expect(res.body.clinic).toMatchObject({id: 'lucknow'});
  });

  test('cancelling frees the slot, and it cannot be cancelled twice', async () => {
    const t = await buildClinicApp();
    const me = await t.login();
    const startsAt = new Date(`${nextMonday()}T10:40:00+05:30`).toISOString();
    const booked = (await book(t, me, startsAt, {patientName: 'Asha Khan'}).expect(201)).body;
    const cancelled = await request(t.app).post(`/api/v1/appointments/${booked.id}/cancel`).set(t.bearer(me)).expect(200);
    expect(cancelled.body.status).toBe('cancelled');
    await request(t.app).post(`/api/v1/appointments/${booked.id}/cancel`).set(t.bearer(me)).expect(409);
    await book(t, me, startsAt, {patientName: 'Asha Khan'}).expect(201); // the slot is free again
  });

  test('one person can hold only a few upcoming appointments', async () => {
    const t = await buildClinicApp();
    const me = await t.login();
    const day = nextMonday();
    for (const time of ['10:00', '10:20', '10:40', '11:00', '11:20']) {
      await book(t, me, new Date(`${day}T${time}:00+05:30`).toISOString(), {patientName: 'Asha Khan'}).expect(201);
    }
    await book(t, me, new Date(`${day}T11:40:00+05:30`).toISOString(), {patientName: 'Asha Khan'}).expect(409);
  });

  test('a request without a time waits for the clinic, and can carry the health details', async () => {
    const t = await buildClinicApp();
    const me = await t.login();
    await request(t.app).patch('/api/v1/users/me').set(t.bearer(me)).send({name: 'Asha Khan'}).expect(200);
    const day = nextMonday();
    const res = await request(t.app)
      .post('/api/v1/appointments')
      .set(t.bearer(me))
      .send({doctorId: 'sample-doctor-one', type: 'clinic', preferredDate: day, concern: 'Joint & back pain', duration: '1-3 months', city: 'Lucknow', reason: 'Morning if possible'})
      .expect(201);
    expect(res.body).toMatchObject({status: 'requested', startsAt: null, preferredDate: day, concern: 'Joint & back pain', duration: '1-3 months', city: 'Lucknow', forSelf: true, toPay: 300});
    // a request does not take a slot away
    expect((await request(t.app).get(`/api/v1/doctors/sample-doctor-one/slots?date=${day}`)).body.slots).toHaveLength(18);
    // "any day" works too, and an unknown duration or a far date does not
    await request(t.app).post('/api/v1/appointments').set(t.bearer(me)).send({doctorId: 'sample-doctor-one', type: 'video'}).expect(201);
    await request(t.app).post('/api/v1/appointments').set(t.bearer(me)).send({doctorId: 'sample-doctor-one', type: 'video', duration: 'forever'}).expect(400);
    await request(t.app).post('/api/v1/appointments').set(t.bearer(me)).send({doctorId: 'sample-doctor-one', type: 'video', preferredDate: '2099-01-01'}).expect(400);
    const cancelled = await request(t.app).post(`/api/v1/appointments/${res.body.id}/cancel`).set(t.bearer(me)).expect(200);
    expect(cancelled.body.status).toBe('cancelled');
  });

  test('booking for a family member needs their name and mobile number', async () => {
    const t = await buildClinicApp();
    const me = await t.login('9876543210');
    await request(t.app).patch('/api/v1/users/me').set(t.bearer(me)).send({name: 'Asha Khan'}).expect(200);
    const base = {doctorId: 'sample-doctor-one', type: 'video', forSelf: false};
    await request(t.app).post('/api/v1/appointments').set(t.bearer(me)).send(base).expect(400);
    await request(t.app).post('/api/v1/appointments').set(t.bearer(me)).send({...base, patientName: 'Zaid Khan'}).expect(400);
    const ok = await request(t.app).post('/api/v1/appointments').set(t.bearer(me)).send({...base, patientName: 'Zaid Khan', patientMobile: '9123456780'}).expect(201);
    expect(ok.body).toMatchObject({forSelf: false, patientName: 'Zaid Khan', patientMobile: '9123456780'});
  });

  test('credits take rupees off the fee, are refunded on cancel, and cannot be spent twice', async () => {
    const t = await buildClinicApp();
    const me = await t.login();
    await request(t.app).patch('/api/v1/users/me').set(t.bearer(me)).send({name: 'Asha Khan'}).expect(200);
    expect((await request(t.app).get('/api/v1/credits').set(t.bearer(me)).expect(200)).body.balance).toBe(0);
    t.prisma.user.rows[0].credits = 250; // credits are given by the company, never by the app
    const body = {doctorId: 'sample-doctor-one', type: 'video'};
    const first = await request(t.app).post('/api/v1/appointments').set(t.bearer(me)).send({...body, useCredits: true}).expect(201);
    expect(first.body).toMatchObject({fee: 300, creditsUsed: 250, toPay: 50});
    const after = (await request(t.app).get('/api/v1/credits').set(t.bearer(me))).body;
    expect(after.balance).toBe(0);
    expect(after.history[0]).toMatchObject({delta: -250});
    // nothing left: the next one is full price, and asking for credits uses none
    const second = await request(t.app).post('/api/v1/appointments').set(t.bearer(me)).send({...body, useCredits: true}).expect(201);
    expect(second.body).toMatchObject({creditsUsed: 0, toPay: 300});
    await request(t.app).post(`/api/v1/appointments/${first.body.id}/cancel`).set(t.bearer(me)).expect(200);
    expect((await request(t.app).get('/api/v1/credits').set(t.bearer(me))).body.balance).toBe(250);
    await request(t.app).get('/api/v1/credits').expect(401);
    // credits can never be sent by the app
    await request(t.app).patch('/api/v1/users/me').set(t.bearer(me)).send({credits: 9999}).expect(400);
  });
});

