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

// bytes that start like a real mp4 file
const mp4 = (size = 4000) => Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(12), Buffer.alloc(size, 7)]);

// Asha (the patient of every test) is the first user made, so her patient id is always P000001
const PATIENT = 'P000001';
const DOCTOR = 'sample-doctor-one';

const dirs = [];
afterAll(() => dirs.forEach(dir => fs.rmSync(dir, {recursive: true, force: true})));

// Clinics and doctors, a patient (Asha), an admin, and a doctor linked to sample-doctor-one
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

  const config = loadConfig({...BASE_ENV, VIDEO_STORAGE_DIR: dir});
  // the doctor's form: patient id + doctor id + the file
  const start = (body = {}) => doc('post', '/videos').send({patientId: PATIENT, doctorId: DOCTOR, mimeType: 'video/mp4', consent: true, ...body});
  const upload = async (bytes = mp4(), body = {}) => {
    const created = (await start(body).expect(201)).body;
    const done = await doc('post', `/videos/${created.id}/file`).set('User-Agent', 'AtiyaHerbs-test-phone/1.0 (Android 12; CPH2095)').attach('file', bytes, {filename: 'visit.mp4', contentType: 'video/mp4'});
    return {created, done};
  };
  return {t, dir, patient, admin, ask, doc, makeDoctor, start, upload, config};
}

describe('the doctor uploads a video with the form (patient id + doctor id)', () => {
  test('the file is saved and the details, with the patient taken from the patient id, go to the database', async () => {
    const {t, dir, doc, start} = await world();
    const created = (await start().expect(201)).body;
    expect(created).toMatchObject({status: 'uploading', maxBytes: 500 * 1024 * 1024});
    expect(created.code).toMatch(/^V\d{6}$/);
    const done = await doc('post', `/videos/${created.id}/file`).set('User-Agent', 'AtiyaHerbs-test-phone/1.0 (Android 12; CPH2095)').attach('file', mp4(), {filename: 'visit.mp4', contentType: 'video/mp4'}).expect(201);
    expect(done.body).toMatchObject({id: created.id, code: created.code, status: 'uploaded', sizeBytes: 4024, patientName: 'Asha Khan', patientMobile: '9876543210', patientCode: PATIENT});

    const row = t.prisma.consultVideo.rows[0];
    // no visit: the video belongs to a patient and a doctor
    expect(row).toMatchObject({videoCode: created.code, sessionId: created.code.replace('V', 'S'), createdBy: DOCTOR, doctorId: DOCTOR, patientName: 'Asha Khan', patientMobile: '9876543210', fileName: `${created.id}.mp4`, status: 'uploaded'});
    expect(row.consultationDateTime).toBeInstanceOf(Date);
    // the table keeps only the columns that were asked for
    expect(Object.keys(row).filter(k => !k.startsWith('_')).sort()).toEqual(['consultationDateTime', 'createdAt', 'createdBy', 'destinationPath', 'doctorId', 'fileName', 'id', 'location', 'patientMobile', 'patientName', 'sessionId', 'status', 'videoCode', 'videoNo']);
    expect(fs.readFileSync(path.join(dir, `${created.id}.mp4`))).toEqual(mp4());
    // the table says where the file is
    expect(row.location).toBe(path.resolve(dir, `${created.id}.mp4`));
    expect(t.prisma.videoAudit.rows.map(r => r.action)).toEqual(['upload']);
    expect((await doc('get', '/videos').expect(200)).body.map(v => v.status)).toEqual(['uploaded']);
    // the same upload cannot be sent twice
    await doc('post', `/videos/${created.id}/file`).attach('file', mp4(), {filename: 'again.mp4', contentType: 'video/mp4'}).expect(409);
  });

  test('both ids are required and checked: the patient must exist, the doctor id must be the doctor\'s own', async () => {
    const {t, doc, start, makeDoctor} = await world();
    await doc('post', '/videos').send({doctorId: DOCTOR, mimeType: 'video/mp4', consent: true}).expect(400); // no patient id
    await doc('post', '/videos').send({patientId: PATIENT, mimeType: 'video/mp4', consent: true}).expect(400); // no doctor id
    await start({patientId: '9876543210'}).expect(400); // a mobile number is not a patient id
    await start({patientId: 'P12'}).expect(404); // a well-formed id nobody has
    await start({patientId: 'P999999'}).expect(404);
    await start({doctorId: 'sample-doctor-two'}).expect(403); // another doctor's id
    await start({doctorId: 'nobody-at-all'}).expect(403);
    t.prisma.user.rows.find(u => u.mobile === '9876543210').status = 'blocked';
    await start().expect(404); // a blocked account is refused
    t.prisma.user.rows.find(u => u.mobile === '9876543210').status = 'active';
    await start({patientId: PATIENT.toLowerCase()}).expect(201); // p000001 works too
    expect(t.prisma.consultVideo.rows).toHaveLength(1); // the refused ones left nothing behind
    // another doctor logs in with their own id
    const other = await makeDoctor('9000000007', 'sample-doctor-two');
    await other('post', '/videos').send({patientId: PATIENT, doctorId: 'sample-doctor-two', mimeType: 'video/mp4', consent: true}).expect(201);
    await other('post', '/videos').send({patientId: PATIENT, doctorId: DOCTOR, mimeType: 'video/mp4', consent: true}).expect(403);
  });

  test('without the patient agreeing, with a wrong type or size, or from another login it is refused', async () => {
    const {t, patient, start, makeDoctor, doc} = await world();
    await doc('post', '/videos').send({patientId: PATIENT, doctorId: DOCTOR, mimeType: 'video/mp4'}).expect(400); // consent is required
    await start({consent: false}).expect(400);
    await start({mimeType: 'image/png'}).expect(400);
    await start({extra: 1}).expect(400); // nothing else can be sent (no appointment, no role, ...)
    await start({appointmentId: 'x'.repeat(36)}).expect(400); // there is no visit field any more
    await start({sizeBytes: 600 * 1024 * 1024}).expect(413);
    // a patient (customer) is not on the doctor side
    await request(t.app).post('/api/v1/doctor/videos').set(t.bearer(patient)).send({patientId: PATIENT, doctorId: DOCTOR, mimeType: 'video/mp4', consent: true}).expect(403);
    // another doctor cannot send a file into this doctor's upload
    const mine = (await start().expect(201)).body;
    const other = await makeDoctor('9000000007', 'sample-doctor-two');
    await other('post', `/videos/${mine.id}/file`).attach('file', mp4(), {filename: 'x.mp4', contentType: 'video/mp4'}).expect(404);
  });

  test('a file that is not a video fails and leaves nothing on disk', async () => {
    const {t, dir, upload} = await world();
    const text = await upload(Buffer.from('this is just some text, not a video at all'));
    expect(text.done.status).toBe(415);
    expect(fs.readdirSync(dir)).toEqual([]);
    expect(t.prisma.consultVideo.rows.map(v => v.status)).toEqual(['failed']);
    const empty = await upload(Buffer.alloc(0));
    expect(empty.done.status).toBeGreaterThanOrEqual(400);
    // there is no limit on how many videos a patient can have
    for (let i = 0; i < 5; i += 1) {
      expect((await upload()).done.status).toBe(201);
    }
  });
});

describe('staff find and play videos', () => {
  test('search by mobile, name, doctor, patient id, dates and status', async () => {
    const {t, ask, upload} = await world();
    const {created} = await upload();
    const url = q => ask('get', `/videos${q}`).expect(200);
    const item = (await url('')).body.items[0];
    expect(item).toMatchObject({
      id: created.id,
      code: expect.stringMatching(/^V\d{6}$/),
      patient: {code: PATIENT, name: 'Asha Khan', mobile: '9876543210'},
      doctor: {id: 'sample-doctor-one', name: 'Sample Doctor One'},
      status: 'uploaded',
      sessionId: created.code.replace('V', 'S'),
      mimeType: 'video/mp4',
      sizeBytes: 4024,
      legalHold: false,
    });
    for (const q of ['?q=9876', '?q=asha', `?q=${PATIENT}`, '?doctor=sample', '?doctorId=sample-doctor-one', `?patientCode=${PATIENT}`, '?status=uploaded']) {
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
    const {t, ask, upload, admin} = await world();
    const {created} = await upload();
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

  test('a video can be played but not downloaded: only the play action exists', async () => {
    const {t, ask, upload} = await world();
    const {created} = await upload();
    await ask('post', `/videos/${created.id}/link`).send({action: 'download'}).expect(400);
    await ask('post', `/videos/${created.id}/link`).send({action: 'delete'}).expect(400);
    const link = (await ask('post', `/videos/${created.id}/link`).send({action: 'play'}).expect(200)).body;
    const res = await request(t.app).get(link.path).expect(200);
    expect(res.headers['content-disposition']).toMatch(/^inline;/); // never "attachment"
    await request(t.app).get(link.path.replace('a=play', 'a=download')).expect(400); // a download link is not accepted
    expect(t.prisma.videoAudit.rows.map(r => r.action)).toEqual(['upload', 'play']);
  });

  test('a link that was changed, made for another video or action, or has no signature is refused', async () => {
    const {t, ask, upload} = await world();
    const a = (await upload()).created;
    const b = (await upload()).created;
    const link = (await ask('post', `/videos/${a.id}/link`).send({action: 'play'}).expect(200)).body.path;
    await request(t.app).get(link.replace(a.id, b.id)).expect(403); // another video
    await request(t.app).get(link.replace(/&t=([0-9a-f])/, (m, c) => `&t=${c === '0' ? '1' : '0'}`)).expect(403); // a changed signature (always really changed)
    await request(t.app).get(link.replace(/&e=\d+/, '&e=9999999999')).expect(403); // a longer time
    const bare = await request(t.app).get(`/api/v1/videos/stream/${a.id}`).expect(401); // the saved address alone: nothing at all
    expect(bare.body.message).toMatch(/does not play by itself/);
    await request(t.app).get(`/api/v1/videos/stream/${a.id}?a=play&e=1&t=${'0'.repeat(64)}`).expect(403);
  });

  test('a link keeps working while a video is watched (an hour) and then stops', async () => {
    const {t, config, upload, admin} = await world();
    const {created} = await upload();
    let clock = Date.now();
    const videos = createVideosService({prisma: t.prisma, config, storage: createVideoStorage({kind: 'folder', dir: config.VIDEO_STORAGE_DIR}), now: () => new Date(clock)});
    const {path: linkPath, expiresAt} = await videos.issueLink(admin.user, created.id, 'play', '1.2.3.4');
    expect(new Date(expiresAt).getTime() - clock).toBeGreaterThan(59 * 60_000);
    const params = Object.fromEntries(new URL(linkPath, 'http://x').searchParams);
    expect((await videos.open(created.id, params)).size).toBe(4024);
    clock += 10 * 60_000; // paused for ten minutes, then played again from the middle
    expect((await videos.open(created.id, params, 'bytes=2000-')).range).toEqual({start: 2000, end: 4023});
    clock += 55 * 60_000;
    await expect(videos.open(created.id, params)).rejects.toThrow(/expired/);
  });

  test('only an admin can use the staff routes', async () => {
    const {t, upload, patient} = await world();
    const {created} = await upload();
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
    const {t, dir, ask, start, upload} = await world();
    await upload(Buffer.from('not a video, just text bytes'));
    const stuck = (await start().expect(201)).body;
    t.prisma.consultVideo.rows.find(v => v.id === stuck.id).createdAt = new Date(Date.now() - 2 * 3_600_000);
    const fine = (await upload()).created;
    const lost = (await upload()).created;
    fs.rmSync(path.join(dir, `${lost.id}.mp4`)); // the file disappeared

    const alerts = (await ask('get', '/videos/alerts').expect(200)).body;
    expect(alerts).toMatchObject({failed: 1, stuckUploading: 1, missing: 1});
    expect(alerts.items.missing[0].id).toBe(lost.id);

    const statuses = Object.fromEntries((await ask('get', '/videos?pageSize=50')).body.items.map(v => [v.id, v.status]));
    expect(statuses[lost.id]).toBe('missing');
    expect(statuses[fine.id]).toBe('uploaded');
    await ask('post', `/videos/${lost.id}/link`).send({action: 'play'}).expect(404); // nothing to play
  });

  test('old videos are removed from the folder, a legal hold protects one, unfinished uploads are cleaned', async () => {
    const {t, dir, ask, start, upload, config} = await world();
    const old = (await upload()).created;
    const held = (await upload()).created;
    const stuck = (await start().expect(201)).body;
    const row = id => t.prisma.consultVideo.rows.find(v => v.id === id);
    row(old.id).createdAt = new Date(Date.now() - 400 * 24 * 3_600_000);
    row(held.id).createdAt = new Date(Date.now() - 400 * 24 * 3_600_000);
    row(stuck.id).createdAt = new Date(Date.now() - 2 * 3_600_000);
    expect((await ask('patch', `/videos/${held.id}`).send({legalHold: true}).expect(200)).body.legalHold).toBe(true);
    await ask('patch', `/videos/${held.id}`).send({legalHold: 'yes'}).expect(400);

    const videos = createVideosService({prisma: t.prisma, config, storage: createVideoStorage({kind: 'folder', dir})});
    expect(await videos.applyRetention()).toEqual({failedUploads: 1, archived: 1});
    expect(fs.existsSync(path.join(dir, `${old.id}.mp4`))).toBe(false);
    expect(fs.existsSync(path.join(dir, `${held.id}.mp4`))).toBe(true);
    expect(row(held.id).status).toBe('held'); // a legal hold is the status "held"
    expect(row(stuck.id).status).toBe('failed');
    expect(row(old.id).status).toBe('archived');

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
  test('videos show the doctor id and the patient id (P000123), and can be searched by it', async () => {
    const {t, ask, upload, patient} = await world();
    const {created} = await upload();
    const person = t.prisma.user.rows.find(u => u.id === patient.user.id);
    const code = `P${String(person.patientNo).padStart(6, '0')}`;
    expect(code).toMatch(/^P\d{6}$/);

    const video = (await ask('get', '/videos').expect(200)).body.items[0];
    expect(video.patient).toEqual({code, name: 'Asha Khan', mobile: '9876543210'});
    expect(video.doctor).toEqual({id: 'sample-doctor-one', name: 'Sample Doctor One'});
    expect((await ask('get', `/videos/${created.id}`).expect(200)).body.patient.code).toBe(code);

    for (const query of [`?q=${code}`, `?q=${code.toLowerCase()}`, `?patientCode=${code}`]) {
      expect([query, (await ask('get', `/videos${query}`)).body.total]).toEqual([query, 1]);
    }
    expect((await ask('get', '/videos?q=P999999')).body.total).toBe(0); // no such patient: nothing, not everything
    await ask('get', '/videos?patientCode=12345').expect(400);

  });
});

describe('the limit can be raised in the settings', () => {
  test('VIDEO_MAX_MB changes the biggest video that is accepted', async () => {
    const {start} = await world({VIDEO_MAX_MB: '2000'});
    const created = (await start({sizeBytes: 1_900 * 1024 * 1024}).expect(201)).body;
    expect(created.maxBytes).toBe(2000 * 1024 * 1024);
    await start({sizeBytes: 2_100 * 1024 * 1024}).expect(413);
  });

  test('a setting above what the database can hold is refused at start-up', () => {
    const {loadConfig} = require('../src/config/env');
    expect(() => loadConfig({...BASE_ENV, VIDEO_MAX_MB: '5000'})).toThrow(/VIDEO_MAX_MB/);
  });
});

describe('videos kept inside MySQL (VIDEO_STORAGE=database)', () => {
  const {Readable} = require('node:stream');
  const {createDatabaseStorage, CHUNK} = require('../src/videos/storage');
  const {createFakePrisma} = require('./helpers/fakePrisma');
  const read = async stream => {
    const parts = [];
    for await (const part of stream) {
      parts.push(part);
    }
    return Buffer.concat(parts);
  };
  const KEY = '0192a7c4-aaaa-bbbb-cccc-1234567890ab.mp4';

  test('the storage cuts a file into 1 MiB pieces, reads it whole or from the middle, and removes it', async () => {
    const prisma = createFakePrisma();
    const storage = createDatabaseStorage({prisma});
    const data = Buffer.alloc(2 * CHUNK + 500_000);
    for (let i = 0; i < data.length; i += 1) {
      data[i] = i % 251;
    }
    // the file arrives in odd sized pieces, like a network
    const pieces = [];
    for (let at = 0; at < data.length; at += 300_007) {
      pieces.push(data.subarray(at, at + 300_007));
    }
    expect(await storage.save(KEY, Readable.from(pieces))).toBe(data.length);
    expect(prisma.videoChunk.rows.map(r => [r.seq, r.size])).toEqual([[0, CHUNK], [1, CHUNK], [2, 500_000]]);
    expect(await storage.stat(KEY)).toEqual({size: data.length});
    expect((await read(storage.open(KEY))).equals(data)).toBe(true); // (a byte-by-byte toEqual of 2 MB is very slow)
    // a part that starts and ends inside different pieces, one inside a single piece, and the last bytes
    expect(await read(storage.open(KEY, {start: CHUNK - 10, end: CHUNK + 9}))).toEqual(data.subarray(CHUNK - 10, CHUNK + 10));
    expect(await read(storage.open(KEY, {start: 5, end: 99}))).toEqual(data.subarray(5, 100));
    expect(await read(storage.open(KEY, {start: data.length - 3, end: data.length - 1}))).toEqual(data.subarray(data.length - 3));
    expect(await storage.stat('0192a7c4-aaaa-bbbb-cccc-000000000000.mp4')).toBeNull();
    await storage.remove(KEY);
    expect(prisma.videoChunk.rows).toHaveLength(0);
    expect(await storage.stat(KEY)).toBeNull();
    expect(() => storage.open('../../etc/passwd')).toThrow(/valid video file name/);
    await expect(storage.save('bad key.mp4', Readable.from([Buffer.from('x')]))).rejects.toThrow(/valid video file name/);
  });

  test('a stream that fails half way leaves no piece behind', async () => {
    const prisma = createFakePrisma();
    const storage = createDatabaseStorage({prisma});
    async function* broken() {
      yield Buffer.alloc(CHUNK + 10, 1);
      throw new Error('the network went away');
    }
    await expect(storage.save(KEY, Readable.from(broken()))).rejects.toThrow(/network/);
    expect(prisma.videoChunk.rows).toHaveLength(0);
  });

  test('an upload is saved in the database, plays with ranges, and no file is written to the disk', async () => {
    const {t, dir, doc, ask, start} = await world({VIDEO_STORAGE: 'database'});
    const bytes = mp4(2 * CHUNK + 1000);
    const created = (await start().expect(201)).body;
    const done = await doc('post', `/videos/${created.id}/file`).set('User-Agent', 'AtiyaHerbs-test-phone/1.0 (Android 12; CPH2095)').attach('file', bytes, {filename: 'a.mp4', contentType: 'video/mp4'}).expect(201);
    expect(done.body).toMatchObject({status: 'uploaded', sizeBytes: bytes.length});
    expect(fs.readdirSync(dir)).toEqual([]); // nothing in the folder
    expect(t.prisma.consultVideo.rows[0]).toMatchObject({location: `mysql://${t.config.DB_NAME}/video_chunks/${created.id}.mp4`});
    // staff see them too, and the address alone does not play anything: it needs the signed link
    const item = (await ask('get', '/videos').expect(200)).body.items[0];
    expect(item).toMatchObject({storage: 'database', location: `mysql://${t.config.DB_NAME}/video_chunks/${created.id}.mp4`, url: `http://localhost:4100/api/v1/videos/stream/${created.id}`, source: {ip: null, device: null}});
    expect((await ask('get', `/videos/${created.id}`).expect(200)).body.source.ip).toEqual(expect.any(String)); // the upload address is read from the audit log
    await request(t.app).get(new URL(item.url).pathname).expect(401);
    expect(t.prisma.videoChunk.rows.map(r => r.seq)).toEqual([0, 1, 2]);
    expect(t.prisma.videoChunk.rows.reduce((sum, r) => sum + r.size, 0)).toBe(bytes.length);

    const link = (await ask('post', `/videos/${created.id}/link`).send({action: 'play'}).expect(200)).body;
    const binary = (req) => req.buffer(true).parse((res, cb) => {
      const parts = [];
      res.on('data', c => parts.push(c));
      res.on('end', () => cb(null, Buffer.concat(parts)));
    });
    const whole = await binary(request(t.app).get(link.path)).expect(200);
    expect(whole.body.equals(bytes)).toBe(true);
    const part = await binary(request(t.app).get(link.path).set('Range', `bytes=${CHUNK - 5}-${CHUNK + 4}`)).expect(206);
    expect(part.headers['content-range']).toBe(`bytes ${CHUNK - 5}-${CHUNK + 4}/${bytes.length}`);
    expect(part.body).toEqual(bytes.subarray(CHUNK - 5, CHUNK + 5));
  });

  test('a bad file leaves no piece, a missing video is reported, and the archive policy removes the pieces', async () => {
    const {t, ask, doc, start, config} = await world({VIDEO_STORAGE: 'database'});
    const upload = async bytes => {
      const created = (await start().expect(201)).body;
      const res = await doc('post', `/videos/${created.id}/file`).attach('file', bytes, {filename: 'a.mp4', contentType: 'video/mp4'});
      return {created, res};
    };
    const text = await upload(Buffer.from('not a video, only some text for the check'));
    expect(text.res.status).toBe(415);
    expect(t.prisma.videoChunk.rows).toHaveLength(0);

    const lost = (await upload(mp4())).created;
    const old = (await upload(mp4())).created;
    await t.prisma.videoChunk.deleteMany({where: {fileKey: `${lost.id}.mp4`}}); // the pieces vanish
    expect((await ask('get', '/videos/alerts').expect(200)).body.missing).toBe(1);
    await ask('post', `/videos/${lost.id}/link`).send({action: 'play'}).expect(404);

    t.prisma.consultVideo.rows.find(v => v.id === old.id).createdAt = new Date(Date.now() - 400 * 24 * 3_600_000);
    const videos = createVideosService({prisma: t.prisma, config: {...config, VIDEO_STORAGE: 'database'}, storage: createDatabaseStorage({prisma: t.prisma})});
    expect((await videos.applyRetention()).archived).toBe(1);
    expect(t.prisma.videoChunk.rows.filter(r => r.fileKey.startsWith(old.id))).toHaveLength(0);
    expect((await ask('get', `/videos/${old.id}`)).body.status).toBe('archived');
  });

  test('the setting accepts only database or folder', () => {
    const {loadConfig} = require('../src/config/env');
    expect(loadConfig({...BASE_ENV}).VIDEO_STORAGE).toBe('folder'); // the test settings
    expect(() => loadConfig({...BASE_ENV, VIDEO_STORAGE: 'cloud'})).toThrow(/VIDEO_STORAGE/);
    const {VIDEO_STORAGE, ...rest} = BASE_ENV; // eslint-disable-line no-unused-vars
    expect(loadConfig(rest).VIDEO_STORAGE).toBe('database'); // the default
  });
});

describe('the doctor sees their uploaded videos with ids, and can watch them', () => {
  test('each video has a short id (V000001), and the list shows the patient name, mobile and patient id', async () => {
    const {t, doc, ask, upload, patient} = await world();
    const {created} = await upload();
    const second = (await upload()).created;
    const code = n => `V${String(n).padStart(6, '0')}`;
    const rows = t.prisma.consultVideo.rows;
    const mine = (await doc('get', '/videos').expect(200)).body;
    expect(mine.map(v => v.id)).toEqual([second.id, created.id]); // newest first
    const first = mine.find(v => v.id === created.id);
    expect(first).toMatchObject({
      code: code(rows.find(r => r.id === created.id).videoNo),
      status: 'uploaded',
      patientName: 'Asha Khan',
      patientMobile: '9876543210',
      sizeBytes: 4024,
    });
    expect(first.patientCode).toBe(`P${String(t.prisma.user.rows.find(u => u.id === patient.user.id).patientNo).padStart(6, '0')}`);
    expect(first.code).not.toBe(mine.find(v => v.id === second.id).code);
    // and staff find it by the same id
    const staff = (await ask('get', `/videos?q=${first.code}`).expect(200)).body;
    expect(staff.items.map(v => v.id)).toEqual([created.id]); // found by the video id
    expect(staff.items[0].code).toBe(first.code);
    expect((await ask('get', `/videos?q=${first.code.toLowerCase()}`)).body.total).toBe(1);
    expect((await ask('get', '/videos?q=V999999')).body.total).toBe(0);
  });

  test('the doctor gets a short-lived link to play their own video, and it is audited', async () => {
    const {t, doc, makeDoctor, upload} = await world();
    const {created} = await upload();
    const link = (await doc('post', `/videos/${created.id}/link`).send({action: 'play'}).expect(200)).body;
    expect(link.path).toMatch(new RegExp('^/api/v1/videos/stream/' + created.id + '[?]a=play&e=[0-9]+&t=[0-9a-f]{64}$'));
    const res = await request(t.app).get(link.path).set('Range', 'bytes=0-99').expect(206);
    expect(res.headers['content-range']).toBe('bytes 0-99/4024');
    const actions = t.prisma.videoAudit.rows.map(r => r.action);
    expect(actions).toEqual(['upload', 'play']);
    // only play: a doctor cannot download, and another doctor cannot even ask
    await doc('post', `/videos/${created.id}/link`).send({action: 'download'}).expect(400);
    const other = await makeDoctor('9000000007', 'sample-doctor-two');
    await other('post', `/videos/${created.id}/link`).send({action: 'play'}).expect(404);
    await doc('post', '/videos/not-here/link').send({action: 'play'}).expect(404);
    expect(t.prisma.videoAudit.rows).toHaveLength(2); // the refused asks left no "play"
  });
});

describe('smart search in the doctor\'s own videos', () => {
  test('finds by video id, patient id, mobile and name, and by status; never shows another doctor\'s videos', async () => {
    const {t, doc, upload, patient, makeDoctor} = await world();
    const a = (await upload()).created;
    const b = (await upload()).created;
    await upload(Buffer.from('not a video, just plain text bytes here')); // one that failed
    const rows = t.prisma.consultVideo.rows;
    const codeOf = id => `V${String(rows.find(r => r.id === id).videoNo).padStart(6, '0')}`;
    const pcode = `P${String(t.prisma.user.rows.find(u => u.id === patient.user.id).patientNo).padStart(6, '0')}`;
    const find = async query => (await doc('get', `/videos${query}`).expect(200)).body.map(v => v.id);

    expect(await find('')).toHaveLength(3);
    expect(await find(`?q=${codeOf(a.id)}`)).toEqual([a.id]); // by video id
    expect(await find(`?q=${codeOf(b.id).toLowerCase()}`)).toEqual([b.id]);
    expect(await find(`?q=${pcode}`)).toHaveLength(3); // by patient id: all of this patient
    expect(await find('?q=9876')).toHaveLength(3); // by mobile
    expect(await find('?q=asha')).toHaveLength(3); // by name
    expect(await find('?q=nobody')).toEqual([]);
    expect(await find('?q=V999999')).toEqual([]);
    expect(await find('?q=P999999')).toEqual([]); // a patient code that nobody has finds nothing, not everything
    expect(await find('?status=uploaded')).toHaveLength(2);
    expect(await find('?status=failed')).toHaveLength(1);
    expect(await find(`?q=${pcode}&status=failed`)).toHaveLength(1);
    await doc('get', '/videos?status=missing').expect(400);
    await doc('get', '/videos?unknown=1').expect(400);

    // another doctor searching for the same ids finds nothing of this doctor
    const other = await makeDoctor('9000000007', 'sample-doctor-two');
    expect((await other('get', `/videos?q=${codeOf(a.id)}`).expect(200)).body).toEqual([]);
    expect((await other('get', `/videos?q=${pcode}`).expect(200)).body).toEqual([]);
  });
});

describe('the address of a video and where it came from', () => {
  test('the url starts with the public address of the server (PUBLIC_API_URL) and the upload address is known', async () => {
    const {t, ask, upload} = await world({PUBLIC_API_URL: 'https://api.atiyaherbs.example/'});
    const {created} = await upload();
    const item = (await ask('get', '/videos').expect(200)).body.items[0];
    expect(item.url).toBe(`https://api.atiyaherbs.example/api/v1/videos/stream/${created.id}`); // no double slash
    expect((await ask('get', `/videos/${created.id}`).expect(200)).body.source).toEqual({ip: expect.any(String), device: null}); // the address comes from the upload entry of the audit log
    // the address alone plays nothing: it needs the signed link
    await request(t.app).get(new URL(item.url).pathname).expect(401);
  });
});

describe('the doctor deletes one of their own videos', () => {
  test('the file is removed for good, the row stays as "deleted", the doctor no longer sees it, and the audit says who', async () => {
    const {t, dir, doc, ask, upload, makeDoctor} = await world();
    const keep = (await upload()).created;
    const gone = (await upload()).created;
    expect(fs.readdirSync(dir).sort()).toEqual([`${keep.id}.mp4`, `${gone.id}.mp4`].sort());

    await doc('delete', `/videos/${gone.id}`).expect(204);
    expect(fs.readdirSync(dir)).toEqual([`${keep.id}.mp4`]); // the file is really gone
    const row = t.prisma.consultVideo.rows.find(v => v.id === gone.id);
    expect(row.status).toBe('deleted');
    expect((await doc('get', '/videos').expect(200)).body.map(v => v.id)).toEqual([keep.id]); // gone from the doctor's list
    expect((await doc('get', `/videos?q=${gone.code}`).expect(200)).body).toEqual([]);

    // staff still see the record, as "deleted" (not "archived": the policy did not do it), with who did it
    const detail = (await ask('get', `/videos/${gone.id}`).expect(200)).body;
    expect(detail.status).toBe('deleted');
    expect(detail.audit.map(a => a.action)).toEqual(['delete', 'upload']);
    expect(detail.audit[0].by).toMatchObject({name: 'Doctor'});
    // it can no longer be played, by anybody
    await ask('post', `/videos/${gone.id}/link`).send({action: 'play'}).expect(410);
    await doc('post', `/videos/${gone.id}/link`).send({action: 'play'}).expect(410);
    // and cannot be deleted twice
    await doc('delete', `/videos/${gone.id}`).expect(404);

    // another doctor cannot delete it, and a patient is not on the doctor side
    const other = await makeDoctor('9000000007', 'sample-doctor-two');
    await other('delete', `/videos/${keep.id}`).expect(404);
    await doc('delete', '/videos/not-here').expect(404);
    expect(fs.existsSync(path.join(dir, `${keep.id}.mp4`))).toBe(true);
  });

  test('a video on legal hold, or one that is still uploading, is not deleted', async () => {
    const {t, dir, doc, ask, start, upload} = await world();
    const held = (await upload()).created;
    await ask('patch', `/videos/${held.id}`).send({legalHold: true}).expect(200);
    await doc('delete', `/videos/${held.id}`).expect(409);
    expect(fs.existsSync(path.join(dir, `${held.id}.mp4`))).toBe(true);
    const pending = (await start().expect(201)).body; // still "uploading"
    await doc('delete', `/videos/${pending.id}`).expect(409);
    expect(t.prisma.consultVideo.rows.filter(v => v.status === 'deleted')).toHaveLength(0);
  });

  test('without a login, or as a patient, nothing can be deleted; a failed upload can be cleared', async () => {
    const {t, patient, doc, upload} = await world();
    const bad = await upload(Buffer.from('not a video, plain text bytes for the check'));
    expect(bad.done.status).toBe(415);
    await request(t.app).delete(`/api/v1/doctor/videos/${bad.created.id}`).expect(401);
    await request(t.app).delete(`/api/v1/doctor/videos/${bad.created.id}`).set(t.bearer(patient)).expect(403);
    await doc('delete', `/videos/${bad.created.id}`).expect(204); // a failed video can be removed from the list
    expect((await doc('get', '/videos').expect(200)).body).toEqual([]);
  });
});

describe('a readable copy in VIDEO_COPY_DIR', () => {
  test('the video is kept in the database and also written to the folder; the table names the folder; deleting removes both', async () => {
    const copyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atiya-copy-'));
    dirs.push(copyDir);
    const {t, dir, doc, ask, upload} = await world({VIDEO_STORAGE: 'database', VIDEO_COPY_DIR: copyDir});
    const {created} = await upload();
    const key = `${created.id}.mp4`;
    expect(fs.readdirSync(dir)).toEqual([]); // not in the storage folder: the video is in the database
    expect(t.prisma.videoChunk.rows.length).toBeGreaterThan(0);
    expect(fs.readFileSync(path.join(copyDir, key)).equals(mp4())).toBe(true); // the copy
    expect(t.prisma.consultVideo.rows[0].location).toBe(path.resolve(copyDir, key)); // the table names the copy
    expect(t.prisma.consultVideo.rows[0].destinationPath).toBe(path.resolve(copyDir)); // and the folder it is in
    expect((await ask('get', '/videos').expect(200)).body.items[0].location).toBe(path.resolve(copyDir, key));
    // it still plays from the database
    const link = (await ask('post', `/videos/${created.id}/link`).send({action: 'play'}).expect(200)).body;
    await request(t.app).get(link.path).expect(200);
    await doc('delete', `/videos/${created.id}`).expect(204);
    expect(fs.existsSync(path.join(copyDir, key))).toBe(false);
    expect(t.prisma.videoChunk.rows).toHaveLength(0);
  });
});

describe('the times of a video are written as India time', () => {
  test('the table holds IST (UTC + 5:30); the API still answers the real moment', async () => {
    const {t, ask, upload} = await world();
    const before = Date.now();
    await upload();
    const row = t.prisma.consultVideo.rows[0];
    const IST = 330 * 60_000;
    expect(Math.abs(row.consultationDateTime.getTime() - (before + IST))).toBeLessThan(60_000);
    expect(Math.abs(row.createdAt.getTime() - (before + IST))).toBeLessThan(60_000);
    const item = (await ask('get', '/videos').expect(200)).body.items[0];
    expect(Math.abs(new Date(item.createdAt).getTime() - before)).toBeLessThan(60_000); // the real moment
    expect(Math.abs(new Date(item.consultationDateTime).getTime() - before)).toBeLessThan(60_000);
  });
});

describe('the access log (table log)', () => {
  test('every play is written with who played, the video file, the patient and the time', async () => {
    const {t, ask, doc, upload} = await world();
    const {created} = await upload();
    await ask('post', `/videos/${created.id}/link`).send({action: 'play'}).expect(200);
    await doc('post', `/videos/${created.id}/link`).send({action: 'play'}).expect(200);
    const rows = t.prisma.log.rows;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({whoPlayed: 'Admin', whoDownloaded: null, videoFile: `${created.id}.mp4`, patientPhone: '9876543210', patientId: PATIENT});
    expect(rows[0].uidName).toMatch(/^Admin \(.+\)$/);
    expect(rows[0].serialNo).toBe(1);
    expect(rows[1].serialNo).toBe(2);
    expect(rows[1].whoPlayed).toEqual(expect.any(String)); // the doctor's own name or number
    expect(Math.abs(rows[0].dateTime.getTime() - (Date.now() + 330 * 60_000))).toBeLessThan(60_000); // India time
    expect(rows[0].createdBy).toBe(rows[0].uidName.match(/\((.+)\)/)[1]);
  });
});
