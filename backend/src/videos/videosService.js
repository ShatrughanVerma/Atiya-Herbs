const {createHmac, createHash, timingSafeEqual} = require('node:crypto');
const path = require('node:path');
const {Transform} = require('node:stream');
const {randomUUID} = require('node:crypto');
const busboy = require('busboy');
const {HttpError, conflict, forbidden, notFound} = require('../common/errors');
const {formatPatientCode, parsePatientCode} = require('../common/patientCode');
const {formatSessionCode, formatVideoCode, parseVideoCode} = require('../common/videoCode');
const {DAY_MS, istStartOfDay} = require('../consultation/consultationService');

// A play link works for 1 hour: a long video, or one that is paused and played again, asks the server for more of the
// file later, and each of those requests needs the link to still be valid.
const LINK_SECONDS = 60 * 60;
const STUCK_MINUTES = 60; // an upload that has not finished after this long is counted as failed

// The video types a phone's camera makes. The extension is chosen by the server, never taken from the client.
const EXTENSIONS = {'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/3gpp': '3gp', 'video/webm': 'webm', 'video/x-matroska': 'mkv'};
const MIME_BY_EXT = Object.fromEntries(Object.entries(EXTENSIONS).map(([mime, ext]) => [ext, mime]));

// The first bytes of the file must really be a video container: "ftyp" (mp4, mov, 3gp) or the EBML header (webm, mkv)
const looksLikeVideo = head =>
  (head.length >= 12 && head.subarray(4, 8).toString('latin1') === 'ftyp') ||
  (head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3);

const fail = (status, message) => new HttpError(status, message);

// The two times of a video row (consultationDateTime and createdOn) are written as INDIA time (IST, UTC+5:30), so that a
// person reading the table in Workbench sees 15:43 and not 10:13. The service converts them when it writes and reads.
const IST_MS = 330 * 60_000;
const toStored = date => new Date(date.getTime() + IST_MS);
const fromStored = date => new Date(date.getTime() - IST_MS);

// "held" is an uploaded video on legal hold; the panel and the app see it as uploaded (legalHold: true)
const shownStatus = status => (status === 'held' ? 'uploaded' : status);
const isUploaded = v => v.status === 'uploaded' || v.status === 'held';

// One row of the video list, as staff see it. `info` is what the storage says about the file ({size}; null when it
// is gone; undefined when it was not checked). `extra` carries what the table no longer keeps: the doctor's name, the
// patient id, the address of the video.
const toVideo = (v, info, extra) => ({
  id: v.id,
  code: v.videoCode ?? formatVideoCode(v.videoNo),
  sessionId: v.sessionId ?? null,
  patient: {code: extra.patientCode ?? null, name: v.patientName, mobile: v.patientMobile},
  doctor: {id: v.doctorId, name: extra.doctorName ?? null},
  status: v.status === 'uploaded' && info === null ? 'missing' : shownStatus(v.status),
  failedReason: null,
  storage: extra.storage,
  location: v.location ?? null,
  url: extra.url,
  source: {ip: extra.uploadIp ?? null, device: null},
  mimeType: MIME_BY_EXT[(v.fileName ?? '').split('.').pop()] ?? null,
  sizeBytes: info ? info.size : null,
  durationSec: null,
  consentAt: null,
  uploadedAt: isUploaded(v) ? fromStored(v.createdAt).toISOString() : null,
  consultationDateTime: v.consultationDateTime ? fromStored(v.consultationDateTime).toISOString() : null,
  createdAt: fromStored(v.createdAt).toISOString(),
  createdBy: v.createdBy ?? null,
  legalHold: v.status === 'held',
});

// What a doctor sees of their own video: its id (V000012) and the patient (with the patient id), and its state.
const toDoctorVideo = (v, info, patientCode) => ({
  id: v.id,
  code: v.videoCode ?? formatVideoCode(v.videoNo),
  status: shownStatus(v.status),
  failedReason: null,
  patientName: v.patientName,
  patientMobile: v.patientMobile,
  patientCode: patientCode ?? null,
  sizeBytes: info ? info.size : null,
  durationSec: null,
  createdAt: fromStored(v.createdAt).toISOString(),
  uploadedAt: isUploaded(v) ? fromStored(v.createdAt).toISOString() : null,
});

function createVideosService({prisma, config, storage, copyStorage = null, now = () => new Date()}) {
  const maxBytes = config.VIDEO_MAX_MB * 1024 * 1024;
  // where a file is kept, written so that a person reading the table can find it
  const storageLocationOf = key => (config.VIDEO_STORAGE === 'folder' ? path.resolve(config.VIDEO_STORAGE_DIR, key) : `mysql://${config.DB_NAME}/video_chunks/${key}`);
  // with VIDEO_COPY_DIR the table names the folder of the copy (a readable file); the video itself plays from VIDEO_STORAGE
  const locationOf = key => (copyStorage ? path.resolve(config.VIDEO_COPY_DIR, key) : storageLocationOf(key));
  // the folder of a video (the table keeps it next to the full path): where the video is saved
  const destinationOf = key => path.dirname(locationOf(key));
  // The access log (table `log`): who played or downloaded which video, for which patient, and when (India time)
  const writeLog = async (v, userId, action) => {
    try {
      const user = userId ? await prisma.user.findUnique({where: {id: userId}}) : null;
      const name = user ? user.name || user.email || user.mobile : null;
      const codes = await patientCodes([v.patientMobile]);
      const at = toStored(now());
      await prisma.log.create({
        data: {
          whoPlayed: action === 'play' ? name : null,
          whoDownloaded: action === 'download' ? name : null,
          uidName: user ? `${name} (${user.id})` : null,
          videoFile: v.fileName ?? null,
          patientPhone: v.patientMobile,
          patientId: codes.get(v.patientMobile) ?? null,
          dateTime: at,
          createdBy: userId ?? null,
          createdOn: at,
        },
      });
    } catch {
      // the log must never stop a video from playing
    }
  };

  // removes a video file everywhere it is kept
  const dropFile = async key => {
    await storage.remove(key);
    if (copyStorage) {
      await copyStorage.remove(key);
    }
  };
  // the key of the link signatures: derived from the login secret, so there is nothing more to keep safe
  const linkKey = createHash('sha256').update(`video-link:${config.JWT_ACCESS_SECRET}`).digest();

  const sign = (id, action, expires) => createHmac('sha256', linkKey).update(`${id}|${action}|${expires}`).digest('hex');

  const record = (videoId, userId, action, ip) =>
    prisma.videoAudit.create({data: {videoId, userId: userId ?? null, action, ip: ip ? String(ip).slice(0, 64) : null}});

  const load = async id => {
    const video = await prisma.consultVideo.findUnique({where: {id}});
    if (!video) {
      throw notFound('Video not found.');
    }
    return video;
  };

  // The table keeps no patient id and no doctor name: they are looked up from the patient's mobile number and the doctor id
  const patientCodes = async mobiles => {
    const list = [...new Set(mobiles.filter(Boolean))];
    const users = list.length ? await prisma.user.findMany({where: {mobile: {in: list}}}) : [];
    return new Map(users.map(u => [u.mobile, formatPatientCode(u.patientNo)]));
  };
  const doctorNames = async ids => {
    const list = [...new Set(ids.filter(Boolean))];
    const doctors = list.length ? await prisma.doctor.findMany({where: {id: {in: list}}}) : [];
    return new Map(doctors.map(d => [d.id, d.name]));
  };
  const extraOf = (v, codes, names, uploadIp) => ({
    patientCode: codes.get(v.patientMobile) ?? null,
    doctorName: names.get(v.doctorId) ?? null,
    storage: v.fileName ? config.VIDEO_STORAGE : null,
    url: v.fileName ? `${config.publicApiUrl}/api/v1/videos/stream/${v.id}` : null,
    uploadIp,
  });
  // is the file there? (only asked for videos that should have one)
  const infoOf = async v => (isUploaded(v) && v.fileName ? (await storage.stat(v.fileName)) ?? null : undefined);
  // a patient id typed in a search: finds that person's videos (nobody with that id: nothing matches)
  const byPatientCode = async codeNo => {
    const person = await prisma.user.findUnique({where: {patientNo: codeNo}});
    return {patientMobile: person ? person.mobile : '-'};
  };

  // Reads the multipart request into the video folder. Resolves with the number of bytes saved.
  const receiveFile = (req, key, limit) =>
    new Promise((resolve, reject) => {
      let settled = false;
      const done = (error, bytes) => {
        if (!settled) {
          settled = true;
          return error ? reject(error) : resolve(bytes);
        }
        return undefined;
      };
      let parser;
      try {
        parser = busboy({headers: req.headers, limits: {files: 1, fields: 0, fileSize: limit + 1}});
      } catch {
        return done(fail(400, 'Send the video as a file (multipart/form-data).'));
      }
      let gotFile = false;
      let saving = null;

      parser.on('file', (field, file) => {
        if (field !== 'file' || gotFile) {
          file.resume();
          return;
        }
        gotFile = true;
        let head = Buffer.alloc(0);
        let checked = false;
        // the first bytes decide whether this is a video at all, and the size is counted while it is written
        let seen = 0;
        const guard = new Transform({
          transform(chunk, enc, cb) {
            seen += chunk.length;
            if (seen > limit) {
              return cb(fail(413, 'The video is bigger than it was said to be.'));
            }
            if (!checked) {
              head = Buffer.concat([head, chunk]).subarray(0, 16);
              if (head.length >= 12) {
                checked = true;
                if (!looksLikeVideo(head)) {
                  return cb(fail(415, 'This file is not a video.'));
                }
              }
            }
            return cb(null, chunk);
          },
          flush(cb) {
            return !checked && !looksLikeVideo(head) ? cb(fail(415, 'This file is not a video.')) : cb();
          },
        });
        // when the check or the size limit stops the file, the rest of it is read and thrown away, so the parser can finish
        guard.on('error', () => {
          file.unpipe(guard);
          file.resume();
        });
        file.on('limit', () => guard.destroy(fail(413, 'The video is bigger than it was said to be.')));
        file.on('error', error => guard.destroy(error));
        file.pipe(guard);
        saving = storage.save(key, guard);
        saving.catch(() => {}); // handled when the parser closes
      });
      parser.on('error', error => done(error));
      parser.on('close', async () => {
        if (!gotFile) {
          return done(fail(400, 'No video file was sent.'));
        }
        try {
          return done(null, await saving);
        } catch (error) {
          return done(error);
        }
      });
      // the phone lost the network half way: nothing more will come
      req.on('aborted', () => {
        parser.destroy();
        done(fail(400, 'The upload was interrupted.'));
      });
      req.pipe(parser);
      return undefined;
    });

  return {
    maxBytes,

    // ---- the doctor's side
    // Starts an upload. The form of the doctor gives the patient id (P000123) and the doctor id (their own), and the doctor
    // says that the patient agreed to the recording. Nothing about a visit: the video belongs to a patient and a doctor.
    async start(doctor, user, input) {
      if (input.doctorId !== doctor.id) {
        throw forbidden('This doctor ID is not yours. Use the doctor ID of your own login.');
      }
      const patientNo = parsePatientCode(input.patientId);
      const patient = patientNo ? await prisma.user.findUnique({where: {patientNo}}) : null;
      // any account that exists and is not blocked: every person who signs up has a patient id
      if (!patient || patient.status === 'blocked') {
        throw notFound('No patient found with that patient ID.');
      }
      if (input.sizeBytes !== undefined && input.sizeBytes > maxBytes) {
        throw fail(413, `A video can be at most ${config.VIDEO_MAX_MB} MB.`);
      }
      // the file name is decided now (the server picks the extension from the type, never the client)
      const id = randomUUID();
      const key = `${id}.${EXTENSIONS[input.mimeType]}`;
      const video = await prisma.consultVideo.create({
        data: {
          id,
          doctorId: doctor.id,
          patientName: patient.name ?? '',
          patientMobile: patient.mobile,
          fileName: key,
          location: locationOf(key),
          destinationPath: destinationOf(key),
          consultationDateTime: toStored(now()),
          createdAt: toStored(now()),
          createdBy: doctor.id,
        },
      });
      // the video number is given by MySQL when the row is made; it is then written next to it as V000012 / S000012
      const code = formatVideoCode(video.videoNo);
      await prisma.consultVideo.update({where: {id: video.id}, data: {videoCode: code, sessionId: formatSessionCode(video.videoNo)}});
      return {id: video.id, code, status: video.status, maxBytes};
    },

    // The file itself arrives here (multipart). It is checked while it is being written.
    async receive(doctor, user, videoId, req) {
      const video = await prisma.consultVideo.findFirst({where: {id: videoId, doctorId: doctor.id}});
      if (!video) {
        throw notFound('Video not found.');
      }
      if (video.status !== 'uploading') {
        throw conflict('This video was already uploaded or has failed. Start a new upload.');
      }
      const key = video.fileName;
      let bytes;
      try {
        bytes = await receiveFile(req, key, maxBytes);
        if (!bytes) {
          throw fail(400, 'The video file is empty.');
        }
      } catch (error) {
        await dropFile(key);
        await prisma.consultVideo.update({where: {id: video.id}, data: {status: 'failed'}});
        throw error instanceof HttpError ? error : fail(400, 'The upload did not finish. Please try again.');
      }
      // the readable copy: when it cannot be written, the video is still safe in the main storage and the table says so
      let location = video.location;
      let destinationPath = video.destinationPath;
      if (copyStorage) {
        try {
          await copyStorage.save(key, storage.open(key, null));
        } catch {
          await copyStorage.remove(key);
          location = storageLocationOf(key);
          destinationPath = path.dirname(location);
        }
      }
      const saved = await prisma.consultVideo.update({where: {id: video.id}, data: {status: 'uploaded', location, destinationPath}});
      await record(video.id, user.id, 'upload', req.ip);
      return toDoctorVideo(saved, {size: bytes}, (await patientCodes([video.patientMobile])).get(video.patientMobile));
    },

    // The doctor's own latest videos (all their visits), newest first. Smart search (q): a video id (V000012), a patient
    // id (P000123), a mobile number, a patient name or a visit number; `status` narrows it to one state.
    // The doctor deletes one of their own videos (a long press in the app). The file is removed for good; the row stays as a
    // record ("deleted") and the audit log keeps who did it. A video on legal hold, or one that is still being sent, stays.
    async removeMine(doctor, user, id, ip) {
      const v = await prisma.consultVideo.findFirst({where: {id, doctorId: doctor.id, status: {notIn: ['archived', 'deleted']}}});
      if (!v) {
        throw notFound('Video not found.');
      }
      if (v.status === 'held') {
        throw conflict('This video is on a legal hold and cannot be deleted. Please contact the office.');
      }
      if (v.status === 'uploading') {
        throw conflict('This video is still being uploaded. Please wait until it has finished.');
      }
      if (v.fileName) {
        await dropFile(v.fileName);
      }
      await prisma.consultVideo.update({where: {id}, data: {status: 'deleted'}});
      await record(id, user.id, 'delete', ip);
    },

    async listMine(doctor, {q, status} = {}) {
      const and = [{doctorId: doctor.id}, {status: {notIn: ['archived', 'deleted']}}];
      if (status) {
        and.push({status: status === 'uploaded' ? {in: ['uploaded', 'held']} : status});
      }
      const videoNo = parseVideoCode(q);
      const codeNo = parsePatientCode(q);
      if (videoNo) {
        and.push({videoNo});
      } else if (codeNo) {
        and.push(await byPatientCode(codeNo));
      } else if (q) {
        and.push({OR: [{patientName: {contains: q}}, {patientMobile: {contains: q}}]});
      }
      const rows = await prisma.consultVideo.findMany({where: {AND: and}, orderBy: [{createdAt: 'desc'}], take: 50});
      const codes = await patientCodes(rows.map(v => v.patientMobile));
      const items = [];
      for (const v of rows) {
        items.push(toDoctorVideo(v, await infoOf(v), codes.get(v.patientMobile)));
      }
      return items;
    },

    // ---- staff side
    async list({q, doctor, doctorId, patientCode, status, from, to, page, pageSize}) {
      const and = [];
      if (doctorId) {
        and.push({doctorId});
      }
      if (doctor) {
        // the doctor's name is not in the table: find the doctors by name, then their videos
        const named = await prisma.doctor.findMany({where: {name: {contains: doctor}}});
        and.push({doctorId: {in: named.length ? named.map(d => d.id) : ['-']}});
      }
      if (status) {
        and.push({status: status === 'uploaded' ? {in: ['uploaded', 'held']} : status});
      }
      if (from) {
        and.push({createdAt: {gte: toStored(istStartOfDay(from))}});
      }
      if (to) {
        and.push({createdAt: {lt: toStored(new Date(istStartOfDay(to).getTime() + DAY_MS))}});
      }
      // a video id (V000012) finds that video; a patient id (P000123) finds that person's videos
      const videoNo = parseVideoCode(q);
      const codeNo = parsePatientCode(patientCode ?? q);
      if (videoNo) {
        and.push({videoNo});
      } else if (codeNo) {
        and.push(await byPatientCode(codeNo));
      } else if (q) {
        and.push({OR: [{patientName: {contains: q}}, {patientMobile: {contains: q}}]});
      }
      const where = and.length ? {AND: and} : {};
      const [total, rows] = await Promise.all([
        prisma.consultVideo.count({where}),
        prisma.consultVideo.findMany({where, orderBy: [{createdAt: 'desc'}], skip: (page - 1) * pageSize, take: pageSize}),
      ]);
      const [codes, names] = await Promise.all([patientCodes(rows.map(v => v.patientMobile)), doctorNames(rows.map(v => v.doctorId))]);
      const items = [];
      for (const v of rows) {
        items.push(toVideo(v, await infoOf(v), extraOf(v, codes, names, null)));
      }
      return {total, page, pageSize, items};
    },

    async get(id) {
      const v = await load(id);
      const entries = await prisma.videoAudit.findMany({where: {videoId: id}, orderBy: [{id: 'desc'}]});
      const people = new Map();
      for (const userId of new Set(entries.map(e => e.userId).filter(Boolean))) {
        const user = await prisma.user.findUnique({where: {id: userId}});
        people.set(userId, user ? {id: user.id, name: user.name, mobile: user.mobile} : null);
      }
      const [codes, names] = await Promise.all([patientCodes([v.patientMobile]), doctorNames([v.doctorId])]);
      const uploadIp = entries.filter(e => e.action === 'upload').pop()?.ip ?? null;
      return {
        ...toVideo(v, await infoOf(v), extraOf(v, codes, names, uploadIp)),
        audit: entries.map(e => ({action: e.action, by: e.userId ? people.get(e.userId) ?? {id: e.userId, name: null, mobile: null} : null, ip: e.ip, at: e.createdAt.toISOString()})),
      };
    },

    // What needs attention: uploads that failed, never finished, or whose file has gone
    async alerts() {
      const cutoff = new Date(now().getTime() - STUCK_MINUTES * 60_000);
      const rows = await prisma.consultVideo.findMany({where: {status: {notIn: ['archived', 'deleted']}}, orderBy: [{createdAt: 'desc'}]});
      const failed = rows.filter(v => v.status === 'failed');
      const stuck = rows.filter(v => v.status === 'uploading' && v.createdAt < toStored(cutoff));
      const missing = [];
      for (const v of rows.filter(r => isUploaded(r) && r.fileName)) {
        if (!(await storage.stat(v.fileName))) {
          missing.push(v);
        }
      }
      const [codes, names] = await Promise.all([patientCodes(rows.map(v => v.patientMobile)), doctorNames(rows.map(v => v.doctorId))]);
      const brief = (list, info) => list.slice(0, 50).map(v => toVideo(v, info, extraOf(v, codes, names, null)));
      return {failed: failed.length, stuckUploading: stuck.length, missing: missing.length, items: {failed: brief(failed), stuckUploading: brief(stuck), missing: brief(missing, null)}};
    },

    // A legal hold is the status "held" (an uploaded video that the archive policy must not remove); releasing it makes the
    // video "uploaded" again.
    async setLegalHold(admin, id, legalHold, ip) {
      const v = await load(id);
      if (legalHold && v.status !== 'uploaded' && v.status !== 'held') {
        throw conflict('Only an uploaded video can be put on a legal hold.');
      }
      if (v.status === 'uploaded' || v.status === 'held') {
        await prisma.consultVideo.update({where: {id}, data: {status: legalHold ? 'held' : 'uploaded'}});
      }
      await record(id, admin.id, 'hold', ip);
      return this.get(id);
    },

    // Staff delete a video: the file is removed for good, the row stays as a record ("deleted") and the audit log keeps who
    // did it. A video on legal hold must be released first; one that is still being sent must finish (or fail) first.
    async removeVideo(admin, id, ip) {
      const v = await load(id);
      if (v.status === 'deleted' || v.status === 'archived') {
        throw conflict('This video is already removed.');
      }
      if (v.status === 'held') {
        throw conflict('This video is on a legal hold. Release the hold before deleting it.');
      }
      if (v.status === 'uploading') {
        throw conflict('This video is still being uploaded. Please wait until it has finished.');
      }
      if (v.fileName) {
        await dropFile(v.fileName);
      }
      await prisma.consultVideo.update({where: {id}, data: {status: 'deleted'}});
      await record(id, admin.id, 'delete', ip);
      return this.get(id);
    },

    // A link that plays one video for a few minutes. Asking for it is what is written in the audit log.
    // `scope` = {doctorId} when a doctor asks: another doctor's video is simply "not found"
    async issueLink(admin, id, action, ip, scope) {
      const v = await load(id);
      if (scope && v.doctorId !== scope.doctorId) {
        throw notFound('Video not found.');
      }
      if (v.status === 'archived' || v.status === 'deleted') {
        throw fail(410, v.status === 'deleted' ? 'This video was deleted.' : 'This video was removed by the archive policy.');
      }
      if (!isUploaded(v) || !v.fileName || !(await storage.stat(v.fileName))) {
        throw notFound('The video file is not available.');
      }
      const expires = Math.floor(now().getTime() / 1000) + LINK_SECONDS;
      await record(id, admin.id, action, ip);
      await writeLog(v, admin.id, action);
      return {path: `/api/v1/videos/stream/${id}?a=${action}&e=${expires}&t=${sign(id, action, expires)}`, expiresAt: new Date(expires * 1000).toISOString()};
    },

    // Opens a video for a link: the signature and the time are checked, then the file (or the asked part of it) is
    // given. Returns what the route needs to answer.
    async open(id, {a: action, e: expires, t: token}, rangeHeader) {
      const expiresNumber = Number(expires);
      const expected = sign(id, action, expiresNumber);
      const given = Buffer.from(String(token ?? ''));
      const want = Buffer.from(expected);
      if (!['play', 'download'].includes(action) || !Number.isInteger(expiresNumber) || given.length !== want.length || !timingSafeEqual(given, want)) {
        throw fail(403, 'This link is not valid.');
      }
      if (expiresNumber < now().getTime() / 1000) {
        throw fail(403, 'This link has expired. Open the video again.');
      }
      const v = await load(id);
      const info = !isUploaded(v) || !v.fileName ? null : await storage.stat(v.fileName);
      if (!info) {
        throw notFound('The video file is not available.');
      }
      let range = null;
      if (rangeHeader) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
        if (!match || (match[1] === '' && match[2] === '')) {
          throw fail(416, 'The asked part of the video is not valid.');
        }
        const start = match[1] === '' ? Math.max(info.size - Number(match[2]), 0) : Number(match[1]);
        const end = match[1] === '' || match[2] === '' ? info.size - 1 : Math.min(Number(match[2]), info.size - 1);
        if (start > end || start >= info.size) {
          throw fail(416, 'The asked part of the video is not valid.');
        }
        range = {start, end};
      }
      return {
        stream: storage.open(v.fileName, range),
        size: info.size,
        range,
        download: action === 'download',
        mimeType: MIME_BY_EXT[v.fileName.split('.').pop()] ?? 'application/octet-stream',
        fileName: `video-${v.videoCode ?? formatVideoCode(v.videoNo) ?? 'file'}-${v.id.slice(0, 8)}.${v.fileName.split('.').pop()}`,
      };
    },

    // The archive policy and the clean-up of uploads that never finished. Run it every day (npm run videos:archive).
    async applyRetention(retentionDays = config.VIDEO_RETENTION_DAYS) {
      const current = now();
      const result = {failedUploads: 0, archived: 0};
      const stuck = await prisma.consultVideo.findMany({where: {status: 'uploading', createdAt: {lt: toStored(new Date(current.getTime() - STUCK_MINUTES * 60_000))}}});
      for (const v of stuck) {
        if (v.fileName) {
          await dropFile(v.fileName);
        }
        await prisma.consultVideo.update({where: {id: v.id}, data: {status: 'failed'}});
        result.failedUploads += 1;
      }
      // a video on legal hold has the status "held", so it is not in this list
      const old = await prisma.consultVideo.findMany({
        where: {status: 'uploaded', createdAt: {lt: toStored(new Date(current.getTime() - retentionDays * DAY_MS))}},
      });
      for (const v of old) {
        await dropFile(v.fileName);
        await prisma.consultVideo.update({where: {id: v.id}, data: {status: 'archived'}});
        await record(v.id, null, 'delete', null);
        result.archived += 1;
      }
      return result;
    },
  };
}

module.exports = {createVideosService, EXTENSIONS};
