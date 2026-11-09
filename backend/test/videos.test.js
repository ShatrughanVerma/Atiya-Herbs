const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const {loadConfig} = require('../src/config/env');
const {seedClinics, seedPlaceholderDoctors} = require('../src/consultation/seed');
const {createVideoStorage} = require('../src/videos/storage');
const {createVideosService} = require('../src/videos/videosService');
const {BASE_ENV, buildTestApp} = require('./helpers/testApp');

const nextMonday = () => {
  const date = new Date(Date.now() + 3 * 24 * 3_600_000);
  while (new Date(date.getTime() + 5.5 * 3_600_000).getUTCDay() !== 1) {
    date.setTime(date.getTime() + 24 * 3_600_000);
  }
  return new Date(date.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);
};
const at = (day, time) => new Date(`${day}T${time}:00+05:30`).toISOString();

// bytes that start like a real mp4 file
const mp4 = (size = 4000) => Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(12), Buffer.alloc(size, 7)]);

const dirs = [];
afterAll(() => dirs.forEach(dir => fs.rmSync(dir, {recursive: true, force: true})));

// Clinics and doctors, a patient (Asha), an admin, and a doctor linked to sample-doctor-one with a confirmed visit
async function world(env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atiya-videos-'));
  dirs.push(dir);
  const t = buildTestApp({VIDEO_STORAGE_DIR: dir, ...env});
  await seedClinics(t.prisma);
  await seedPlaceholderDoctors(t.prisma);
  const patient = await t.login('9876543210');
  await request(t.app).patch('/api/v1/users/me').set(t.bearer(patient)).send({name: 'Asha Khan'}).expect(200);
  // staff accounts are made directly in the test database: the code request of the login is limited to 5 a minute
  const tokenFor = (user, roleId) => jwt.sign({roleId}, BASE_ENV.JWT_ACCESS_SECRET, {subject: user.id, issuer: 'atiyaherbs-api', audience: 'atiyaherbs-app', expiresIn: 600});
  const adminUser = await t.prisma.user.create({data: {mobile: '9000000001', name: 'Admin', roleId: 1}});
  const admin = {user: adminUser};
  const adminAuth = {Authorization: `Bearer ${tokenFor(adminUser, 1)}`};
  const ask = (method, p) => request(t.app)[method](`/api/v1/admin${p}`).set(adminAuth);

  const makeDoctor = async (mobile, doctorId) => {
    const user = await t.prisma.user.create({data: {mobile, name: 'Doctor', roleId: 12}});
    await t.prisma.doctor.update({where: {id: doctorId}, data: {userId: user.id}});
    const token = tokenFor(user, 12);
    return (method, p) => request(t.app)[method](`/api/v1/doctor${p}`).set('Authorization', `Bearer ${token}`);
  };
  const doc = await makeDoctor('9000000006', 'sample-doctor-one');

  // a confirmed appointment of Asha with the doctor
  const booked = (await request(t.app).post('/api/v1/appointments').set(t.bearer(patient)).send({doctorId: 'sample-doctor-one', type: 'clinic', startsAt: at(nextMonday(), '10:00')}).expect(201)).body;
  await doc('post', `/appointments/${booked.id}/confirm`).send({}).expect(200);

  const config = loadConfig({...BASE_ENV, VIDEO_STORAGE_DIR: dir});
  const upload = async (appointmentId, bytes = mp4(), start = {}) => {
    const created = (await doc('post', `/appointments/${appointmentId}/videos`).send({mimeType: 'video/mp4', consent: true, ...start}).expect(201)).body;
    const done = await doc('post', `/videos/${created.id}/file`).attach('file', bytes, {filename: 'visit.mp4', contentType: 'video/mp4'});
    return {created, done};
  };
  return {t, dir, patient, admin, ask, doc, makeDoctor, booked, upload, config};
}

describe('the doctor uploads a video of a visit', () => {
  test('after the patient agreed, the file is saved in the video folder and the details in the database', async () => {
    const {t, dir, doc, booked} = await world();
    const created = (await doc('post', `/appointments/${booked.id}/videos`).send({mimeType: 'video/mp4', sizeBytes: 4024, durationSec: 95, consent: true}).expect(201)).body;
    expect(created).toMatchObject({status: 'uploading', maxBytes: 500 * 1024 * 1024});
    const done = await doc('post', `/videos/${created.id}/file`).attach('file', mp4(), {filename: 'visit.mp4', contentType: 'video/mp4'}).expect(201);
    expect(done.body).toMatchObject({id: created.id, status: 'uploaded', sizeBytes: 4024, durationSec: 95});

    const row = t.prisma.consultVideo.rows[0];
    expect(row).toMatchObject({appointmentNumber: booked.number, doctorId: 'sample-doctor-one', doctorName: 'Sample Doctor One', patientName: 'Asha Khan', patientMobile: '9876543210', fileName: `${created.id}.mp4`});
    expect(row.consentAt).toBeInstanceOf(Date);
    expect(fs.readFileSync(path.join(dir, `${created.id}.mp4`))).toEqual(mp4());
    expect(t.prisma.videoAudit.rows.map(r => r.action)).toEqual(['upload']);
    // the doctor sees it listed on the appointment, and cannot upload the same video twice
    expect((await doc('get', `/appointments/${booked.id}/videos`).expect(200)).body.map(v => v.status)).toEqual(['uploaded']);
    await doc('post', `/videos/${created.id}/file`).attach('file', mp4(), {filename: 'again.mp4', contentType: 'video/mp4'}).expect(409);
  });

  test('without the consent, for the wrong appointment, or in the wrong state it is refused', async () => {
    const {t, patient, doc, booked, makeDoctor} = await world();
    const start = (id, body) => doc('post', `/appointments/${id}/videos`).send(body);
    await start(booked.id, {mimeType: 'video/mp4'}).expect(400); // consent is required
    await start(booked.id, {mimeType: 'video/mp4', consent: false}).expect(400);
    await start(booked.id, {mimeType: 'image/png', consent: true}).expect(400);
    await start(booked.id, {mimeType: 'video/mp4', consent: true, extra: 1}).expect(400);
    await start(booked.id, {mimeType: 'video/mp4', consent: true, sizeBytes: 600 * 1024 * 1024}).expect(413);
    await start('x'.repeat(36), {mimeType: 'video/mp4', consent: true}).expect(404);

    // a request that is still pending: no video yet
    const pending = (await request(t.app).post('/api/v1/appointments').set(t.bearer(patient)).send({doctorId: 'sample-doctor-one', type: 'video'}).expect(201)).body;
    await start(pending.id, {mimeType: 'video/mp4', consent: true}).expect(409);

    // another doctor cannot touch it
    const other = await makeDoctor('9000000007', 'sample-doctor-two');
    await other('post', `/appointments/${booked.id}/videos`).send({mimeType: 'video/mp4', consent: true}).expect(404);
    await other('get', `/appointments/${booked.id}/videos`).expect(404);
    const mine = (await start(booked.id, {mimeType: 'video/mp4', consent: true}).expect(201)).body;
    await other('post', `/videos/${mine.id}/file`).attach('file', mp4(), {filename: 'x.mp4', contentType: 'video/mp4'}).expect(404);

    // a patient (customer) is not on the doctor side
    await request(t.app).post(`/api/v1/doctor/appointments/${booked.id}/videos`).set(t.bearer(patient)).send({mimeType: 'video/mp4', consent: true}).expect(403);
  });

  test('a file that is not a video, or is bigger than said, fails and leaves nothing on disk', async () => {
    const {t, dir, doc, booked, upload} = await world();
    const text = await upload(booked.id, Buffer.from('this is just some text, not a video at all'));
    expect(text.done.status).toBe(415);
    const big = await upload(booked.id, mp4(5000), {sizeBytes: 1000});
    expect(big.done.status).toBe(413);
    expect(fs.readdirSync(dir)).toEqual([]);
    expect(t.prisma.consultVideo.rows.map(v => [v.status, v.failedReason])).toEqual([
      ['failed', 'This file is not a video.'],
      ['failed', 'The video is bigger than it was said to be.'],
    ]);
    const empty = await upload(booked.id, Buffer.alloc(0));
    expect(empty.done.status).toBeGreaterThanOrEqual(400);
    // failed attempts do not count against the limit of 3 videos
    for (let i = 0; i < 3; i += 1) {
      expect((await upload(booked.id)).done.status).toBe(201);
    }
    await doc('post', `/appointments/${booked.id}/videos`).send({mimeType: 'video/mp4', consent: true}).expect(409);
  });
});

describe('staff find, play and download videos', () => {
  test('search by mobile, name, appointment number, doctor, patient id, dates and status', async () => {
    const {t, ask, booked, upload, patient} = await world();
    const {created} = await upload(booked.id);
    const url = q => ask('get', `/videos${q}`).expect(200);
    const item = (await url('')).body.items[0];
    expect(item).toMatchObject({
      id: created.id,
      appointmentNumber: booked.number,
      patient: {name: 'Asha Khan', mobile: '9876543210'},
      doctor: {id: 'sample-doctor-one', name: 'Sample Doctor One'},
      status: 'uploaded',
      mimeType: 'video/mp4',
      sizeBytes: 4024,
      legalHold: false,
    });
    for (const q of ['?q=9876', '?q=asha', `?q=${booked.number}`, '?doctor=sample', '?doctorId=sample-doctor-one', `?patientId=${patient.user.id}`, `?appointmentId=${booked.id}`, '?status=uploaded']) {
      expect([q, (await url(q)).body.total]).toEqual([q, 1]);
    }
    const today = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
    expect((await url(`?from=${today}&to=${today}`)).body.total).toBe(1);
    expect((await url('?from=2099-01-01')).body.total).toBe(0);
    for (const q of ['?q=nobody', '?doctor=zzz', '?status=failed']) {
      expect([q, (await url(q)).body.total]).toEqual([q, 0]);
    }
    await ask('get', '/videos?status=missing').expect(400);
    await ask('get', '/videos?unknown=1').expect(400);
    await ask('get', '/videos/not-here').expect(404);
    expect(t.prisma.videoAudit.rows).toHaveLength(1);
  });

  test('play: a signed link streams the file, supports ranges, and every request is audited', async () => {
    const {t, ask, upload, booked, admin} = await world();
    const {created} = await upload(booked.id);
    const link = (await ask('post', `/videos/${created.id}/link`).send({action: 'play'}).expect(200)).body;
    expect(link.path).toMatch(new RegExp(`^/api/v1/videos/stream/${created.id}\\?a=play&e=\\d+&t=[0-9a-f]{64}$`));
    expect(new Date(link.expiresAt).getTime()).toBeGreaterThan(Date.now());

    const whole = await request(t.app).get(link.path).buffer(true).parse((res, cb) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    expect(whole.headers['content-type']).toBe('video/mp4');
    expect(whole.headers['content-disposition']).toMatch(/^inline;/);
    expect(whole.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(whole.headers['cache-control']).toBe('private, no-store');
    expect(whole.body).toEqual(mp4());

    const part = await request(t.app).get(link.path).set('Range', 'bytes=0-99').buffer(true).parse((res, cb) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    }).expect(206);
    expect(part.headers['content-range']).toBe('bytes 0-99/4024');
    expect(part.body).toEqual(mp4().subarray(0, 100));
    await request(t.app).get(link.path).set('Range', 'bytes=9999-').expect(416);
    await request(t.app).get(link.path).set('Range', 'bytes=abc').expect(416);

    const detail = (await ask('get', `/videos/${created.id}`).expect(200)).body;
    expect(detail.audit.map(a => a.action)).toEqual(['play', 'upload']); // newest first
    expect(detail.audit[0].by).toMatchObject({id: admin.user.id});
  });

  test('download is a separate action with an attachment name', async () => {
    const {t, ask, upload, booked} = await world();
    const {created} = await upload(booked.id);
    const link = (await ask('post', `/videos/${created.id}/link`).send({action: 'download'}).expect(200)).body;
    const res = await request(t.app).get(link.path).expect(200);
    expect(res.headers['content-disposition']).toBe(`attachment; filename="video-${booked.number}-${created.id.slice(0, 8)}.mp4"`);
    expect(t.prisma.videoAudit.rows.map(r => r.action)).toEqual(['upload', 'download']);
    await ask('post', `/videos/${created.id}/link`).send({action: 'delete'}).expect(400);
  });

  test('a link that was changed, made for another video or action, or has no signature is refused', async () => {
    const {t, ask, upload, booked} = await world();
    const a = (await upload(booked.id)).created;
    const b = (await upload(booked.id)).created;
    const link = (await ask('post', `/videos/${a.id}/link`).send({action: 'play'}).expect(200)).body.path;
    await request(t.app).get(link.replace('a=play', 'a=download')).expect(403); // another action
    await request(t.app).get(link.replace(a.id, b.id)).expect(403); // another video
    await request(t.app).get(link.replace(/&t=[0-9a-f]/, '&t=0')).expect(403); // a changed signature
    await request(t.app).get(link.replace(/&e=\d+/, '&e=9999999999')).expect(403); // a longer time
    await request(t.app).get(`/api/v1/videos/stream/${a.id}`).expect(400); // nothing at all
    await request(t.app).get(`/api/v1/videos/stream/${a.id}?a=play&e=1&t=${'0'.repeat(64)}`).expect(403);
  });

  test('a link stops working after 5 minutes', async () => {
    const {t, config, upload, booked, admin} = await world();
    const {created} = await upload(booked.id);
    let clock = Date.now();
    const videos = createVideosService({prisma: t.prisma, config, storage: createVideoStorage({dir: config.VIDEO_STORAGE_DIR}), now: () => new Date(clock)});
    const {path: linkPath} = await videos.issueLink(admin.user, created.id, 'play', '1.2.3.4');
    const params = Object.fromEntries(new URL(linkPath, 'http://x').searchParams);
    expect((await videos.open(created.id, params)).size).toBe(4024);
    clock += 4 * 60_000;
    expect((await videos.open(created.id, params)).size).toBe(4024);
    clock += 2 * 60_000;
    await expect(videos.open(created.id, params)).rejects.toThrow(/expired/);
  });

  test('only an admin can use the staff routes', async () => {
    const {t, upload, booked, patient} = await world();
    const {created} = await upload(booked.id);
    const routes = [['get', '/videos'], ['get', '/videos/alerts'], ['get', `/videos/${created.id}`], ['post', `/videos/${created.id}/link`], ['patch', `/videos/${created.id}`]];
    for (const [method, p] of routes) {
      expect([p, (await request(t.app)[method](`/api/v1/admin${p}`).send({})).status]).toEqual([p, 401]);
      expect([p, (await request(t.app)[method](`/api/v1/admin${p}`).set(t.bearer(patient)).send({})).status]).toEqual([p, 403]);
    }
    // a doctor is not an admin: the doctor cannot play a video through the staff routes either
    const doctorToken = jwt.sign({roleId: 12}, BASE_ENV.JWT_ACCESS_SECRET, {subject: patient.user.id, issuer: 'atiyaherbs-api', audience: 'atiyaherbs-app', expiresIn: 60});
    await request(t.app).post(`/api/v1/admin/videos/${created.id}/link`).set('Authorization', `Bearer ${doctorToken}`).send({action: 'play'}).expect(403);
  });
});

describe('alerts and the archive policy', () => {
  test('a failed upload, a stuck upload and a missing file are all reported', async () => {
    const {t, dir, ask, doc, booked, upload} = await world();
    await upload(booked.id, Buffer.from('not a video, just text bytes'));
    const stuck = (await doc('post', `/appointments/${booked.id}/videos`).send({mimeType: 'video/mp4', consent: true}).expect(201)).body;
    t.prisma.consultVideo.rows.find(v => v.id === stuck.id).createdAt = new Date(Date.now() - 2 * 3_600_000);
    const fine = (await upload(booked.id)).created;
    const lost = (await upload(booked.id)).created;
    fs.rmSync(path.join(dir, `${lost.id}.mp4`)); // the file disappeared

    const alerts = (await ask('get', '/videos/alerts').expect(200)).body;
    expect(alerts).toMatchObject({failed: 1, stuckUploading: 1, missing: 1});
    expect(alerts.items.missing[0].id).toBe(lost.id);
    expect(alerts.items.failed[0].failedReason).toBe('This file is not a video.');

    const statuses = Object.fromEntries((await ask('get', '/videos?pageSize=50')).body.items.map(v => [v.id, v.status]));
    expect(statuses[lost.id]).toBe('missing');
    expect(statuses[fine.id]).toBe('uploaded');
    await ask('post', `/videos/${lost.id}/link`).send({action: 'play'}).expect(404); // nothing to play
  });

  test('old videos are removed from the folder, a legal hold protects one, unfinished uploads are cleaned', async () => {
    const {t, dir, ask, doc, booked, upload, config} = await world();
    const old = (await upload(booked.id)).created;
    const held = (await upload(booked.id)).created;
    const stuck = (await doc('post', `/appointments/${booked.id}/videos`).send({mimeType: 'video/mp4', consent: true}).expect(201)).body;
    const row = id => t.prisma.consultVideo.rows.find(v => v.id === id);
    row(old.id).uploadedAt = new Date(Date.now() - 400 * 24 * 3_600_000);
    row(held.id).uploadedAt = new Date(Date.now() - 400 * 24 * 3_600_000);
    row(stuck.id).createdAt = new Date(Date.now() - 2 * 3_600_000);
    expect((await ask('patch', `/videos/${held.id}`).send({legalHold: true}).expect(200)).body.legalHold).toBe(true);
    await ask('patch', `/videos/${held.id}`).send({legalHold: 'yes'}).expect(400);

    const videos = createVideosService({prisma: t.prisma, config, storage: createVideoStorage({dir})});
    expect(await videos.applyRetention()).toEqual({failedUploads: 1, archived: 1});
    expect(fs.existsSync(path.join(dir, `${old.id}.mp4`))).toBe(false);
    expect(fs.existsSync(path.join(dir, `${held.id}.mp4`))).toBe(true);
    expect(row(stuck.id)).toMatchObject({status: 'failed', failedReason: 'The upload did not finish.'});
    expect(row(old.id).deletedAt).toBeInstanceOf(Date);

    // an archived video still has its history, but can no longer be played
    const detail = (await ask('get', `/videos/${old.id}`).expect(200)).body;
    expect(detail.status).toBe('archived');
    expect(detail.audit.map(a => a.action)).toEqual(['delete', 'upload']);
    expect(detail.audit[0].by).toBeNull(); // done by the policy, not a person
    expect((await ask('post', `/videos/${old.id}/link`).send({action: 'play'})).status).toBe(410);
    expect((await ask('get', '/videos/alerts')).body.missing).toBe(0); // an archived file is not "missing"
    // running it again changes nothing
    expect(await videos.applyRetention()).toEqual({failedUploads: 0, archived: 0});
  });
});

describe('the patient id that staff can read out', () => {
  test('videos and appointments show the doctor id and the patient id (P000123), and can be searched by it', async () => {
    const {t, ask, upload, booked, patient} = await world();
    const {created} = await upload(booked.id);
    const person = t.prisma.user.rows.find(u => u.id === patient.user.id);
    const code = `P${String(person.patientNo).padStart(6, '0')}`;
    expect(code).toMatch(/^P\d{6}$/);

    const video = (await ask('get', '/videos').expect(200)).body.items[0];
    expect(video.patient).toEqual({id: patient.user.id, code, name: 'Asha Khan', mobile: '9876543210'});
    expect(video.doctor).toEqual({id: 'sample-doctor-one', name: 'Sample Doctor One'});
    expect((await ask('get', `/videos/${created.id}`).expect(200)).body.patient.code).toBe(code);

    for (const query of [`?q=${code}`, `?q=${code.toLowerCase()}`, `?patientCode=${code}`]) {
      expect([query, (await ask('get', `/videos${query}`)).body.total]).toEqual([query, 1]);
    }
    expect((await ask('get', '/videos?q=P999999')).body.total).toBe(0); // no such patient: nothing, not everything
    await ask('get', '/videos?patientCode=12345').expect(400);

    const appointment = (await ask('get', `/appointments/${booked.id}`).expect(200)).body;
    expect(appointment).toMatchObject({patientId: patient.user.id, patientCode: code, doctor: {id: 'sample-doctor-one'}});
    expect((await ask('get', `/appointments?patientCode=${code}`)).body.items.map(a => a.id)).toEqual([booked.id]);
    expect((await ask('get', `/appointments?q=${code}`)).body.total).toBe(1);
    expect((await ask('get', `/appointments?patientId=${patient.user.id}`)).body.total).toBe(1);
    expect((await ask('get', '/appointments?patientCode=P999999')).body.total).toBe(0);
    expect((await ask('get', '/appointments')).body.items[0].patientCode).toBe(code);
  });
});

describe('the limits can be raised in the settings', () => {
  test('VIDEO_MAX_MB and VIDEO_MAX_PER_APPOINTMENT change what is accepted', async () => {
    const {doc, booked} = await world({VIDEO_MAX_MB: '2000', VIDEO_MAX_PER_APPOINTMENT: '5'});
    const created = (await doc('post', `/appointments/${booked.id}/videos`).send({mimeType: 'video/mp4', sizeBytes: 1_900 * 1024 * 1024, consent: true}).expect(201)).body;
    expect(created.maxBytes).toBe(2000 * 1024 * 1024);
    await doc('post', `/appointments/${booked.id}/videos`).send({mimeType: 'video/mp4', sizeBytes: 2_100 * 1024 * 1024, consent: true}).expect(413);
    for (let i = 0; i < 4; i += 1) {
      await doc('post', `/appointments/${booked.id}/videos`).send({mimeType: 'video/mp4', consent: true}).expect(201);
    }
    await doc('post', `/appointments/${booked.id}/videos`).send({mimeType: 'video/mp4', consent: true}).expect(409); // 5 is the limit now
  });

  test('a setting above what the database can hold is refused at start-up', () => {
    const {loadConfig} = require('../src/config/env');
    expect(() => loadConfig({...BASE_ENV, VIDEO_MAX_MB: '5000'})).toThrow(/VIDEO_MAX_MB/);
  });
});
