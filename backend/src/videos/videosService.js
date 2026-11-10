const {createHmac, createHash, timingSafeEqual} = require('node:crypto');
const path = require('node:path');
const {Transform} = require('node:stream');
const busboy = require('busboy');
const {HttpError, conflict, forbidden, notFound} = require('../common/errors');
const {formatPatientCode, parsePatientCode} = require('../common/patientCode');
const {formatVideoCode, parseVideoCode} = require('../common/videoCode');
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

// One row of the video list, as staff see it. `exists` says whether the file is on disk (null: not checked).
const toVideo = (v, exists, patientNo) => ({
  id: v.id,
  code: v.videoCode ?? formatVideoCode(v.videoNo),
  patient: {id: v.userId ?? null, code: v.patientCode ?? formatPatientCode(patientNo), name: v.patientName, mobile: v.patientMobile},
  doctor: {id: v.doctorId, name: v.doctorName},
  status: v.deletedAt ? 'archived' : v.status === 'uploaded' && exists === false ? 'missing' : v.status,
  failedReason: v.failedReason ?? null,
  storage: v.storageKind ?? null,
  location: v.location ?? null,
  url: v.url ?? null,
  source: {ip: v.uploadIp ?? null, device: v.uploadDevice ?? null},
  mimeType: v.mimeType,
  sizeBytes: v.sizeBytes ?? null,
  durationSec: v.durationSec ?? null,
  consentAt: v.consentAt ? v.consentAt.toISOString() : null,
  uploadedAt: v.uploadedAt ? v.uploadedAt.toISOString() : null,
  createdAt: v.createdAt.toISOString(),
  legalHold: v.legalHold,
});

// What a doctor sees of their own video: its id (V000012) and the patient (with the patient id), and its
// state. `patientNo` is the patient's short number (P000123), looked up by the service.
const toDoctorVideo = (v, patientNo) => ({
  id: v.id,
  code: v.videoCode ?? formatVideoCode(v.videoNo),
  status: v.deletedAt ? 'archived' : v.status,
  failedReason: v.failedReason ?? null,
  patientName: v.patientName,
  patientMobile: v.patientMobile,
  patientCode: formatPatientCode(patientNo),
  sizeBytes: v.sizeBytes ?? null,
  durationSec: v.durationSec ?? null,
  createdAt: v.createdAt.toISOString(),
  uploadedAt: v.uploadedAt ? v.uploadedAt.toISOString() : null,
});

function createVideosService({prisma, config, storage, now = () => new Date()}) {
  const maxBytes = config.VIDEO_MAX_MB * 1024 * 1024;
  // where a file is kept, written so that a person reading the table can find it
  const locationOf = key => (config.VIDEO_STORAGE === 'folder' ? path.resolve(config.VIDEO_STORAGE_DIR, key) : `mysql://${config.DB_NAME}/video_chunks/${key}`);
  // the key of the link signatures: derived from the login secret, so there is nothing more to keep safe
  const linkKey = createHash('sha256').update(`video-link:${config.JWT_ACCESS_SECRET}`).digest();

  const sign = (id, action, expires) => createHmac('sha256', linkKey).update(`${id}|${action}|${expires}`).digest('hex');

  // userId -> the patient's short number, for a list of videos
  const patientNumbers = async userIds => {
    const ids = [...new Set(userIds.filter(Boolean))];
    if (!ids.length) {
      return new Map();
    }
    return new Map((await prisma.user.findMany({where: {id: {in: ids}}})).map(u => [u.id, u.patientNo]));
  };

  const record = (videoId, userId, action, ip) =>
    prisma.videoAudit.create({data: {videoId, userId: userId ?? null, action, ip: ip ? String(ip).slice(0, 64) : null}});

  const load = async id => {
    const video = await prisma.consultVideo.findUnique({where: {id}});
    if (!video) {
      throw notFound('Video not found.');
    }
    return video;
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
      const video = await prisma.consultVideo.create({
        data: {
          doctorId: doctor.id,
          doctorName: doctor.name,
          userId: patient.id,
          patientCode: formatPatientCode(patient.patientNo),
          patientName: patient.name ?? '',
          patientMobile: patient.mobile,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes ?? null,
          durationSec: input.durationSec ?? null,
          consentAt: now(),
          consentByUserId: user.id,
        },
      });
      // the video number is given by MySQL when the row is made; it is then written next to it as V000012
      const code = formatVideoCode(video.videoNo);
      await prisma.consultVideo.update({where: {id: video.id}, data: {videoCode: code}});
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
      const key = `${video.id}.${EXTENSIONS[video.mimeType]}`;
      let bytes;
      try {
        bytes = await receiveFile(req, key, video.sizeBytes ?? maxBytes);
        if (!bytes) {
          throw fail(400, 'The video file is empty.');
        }
      } catch (error) {
        await storage.remove(key);
        const reason = error instanceof HttpError ? error.message : 'The upload did not finish.';
        await prisma.consultVideo.update({where: {id: video.id}, data: {status: 'failed', failedReason: reason.slice(0, 200)}});
        throw error instanceof HttpError ? error : fail(400, 'The upload did not finish. Please try again.');
      }
      const saved = await prisma.consultVideo.update({where: {id: video.id}, data: {status: 'uploaded', fileName: key, storageKind: config.VIDEO_STORAGE, location: locationOf(key), url: `${config.publicApiUrl}/api/v1/videos/stream/${video.id}`, uploadIp: req.ip ? String(req.ip).slice(0, 64) : null, uploadDevice: req.headers['user-agent'] ? String(req.headers['user-agent']).slice(0, 250) : null, sizeBytes: bytes, uploadedAt: now()}});
      await record(video.id, user.id, 'upload', req.ip);
      return toDoctorVideo(saved, (await patientNumbers([saved.userId])).get(saved.userId));
    },

    // The doctor's own latest videos (all their visits), newest first. Smart search (q): a video id (V000012), a patient
    // id (P000123), a mobile number, a patient name or a visit number; `status` narrows it to one state.
    async listMine(doctor, {q, status} = {}) {
      const and = [{doctorId: doctor.id}, {deletedAt: null}];
      if (status) {
        and.push({status});
      }
      const videoNo = parseVideoCode(q);
      const codeNo = parsePatientCode(q);
      if (videoNo) {
        and.push({videoNo});
      } else if (codeNo) {
        const person = await prisma.user.findUnique({where: {patientNo: codeNo}});
        and.push({userId: person ? person.id : '-'});
      } else if (q) {
        and.push({OR: [{patientName: {contains: q}}, {patientMobile: {contains: q}}]});
      }
      const rows = await prisma.consultVideo.findMany({where: {AND: and}, orderBy: [{createdAt: 'desc'}], take: 50});
      const numbers = await patientNumbers(rows.map(v => v.userId));
      return rows.map(v => toDoctorVideo(v, numbers.get(v.userId)));
    },

    // ---- staff side
    async list({q, doctor, doctorId, patientId, patientCode, status, from, to, page, pageSize}) {
      const and = [];
      if (doctorId) {
        and.push({doctorId});
      }
      if (doctor) {
        and.push({doctorName: {contains: doctor}});
      }
      if (patientId) {
        and.push({userId: patientId});
      }
      if (status) {
        and.push({status});
      }
      if (from) {
        and.push({createdAt: {gte: istStartOfDay(from)}});
      }
      if (to) {
        and.push({createdAt: {lt: new Date(istStartOfDay(to).getTime() + DAY_MS)}});
      }
      // a video id (V000012) finds that video; a patient id (P000123) finds that person's videos
      const videoNo = parseVideoCode(q);
      const codeNo = parsePatientCode(patientCode ?? q);
      if (videoNo) {
        and.push({videoNo});
      } else if (codeNo) {
        const person = await prisma.user.findUnique({where: {patientNo: codeNo}});
        and.push({userId: person ? person.id : '-'});
      } else if (q) {
        and.push({OR: [{patientName: {contains: q}}, {patientMobile: {contains: q}}]});
      }
      const where = and.length ? {AND: and} : {};
      const [total, rows] = await Promise.all([
        prisma.consultVideo.count({where}),
        prisma.consultVideo.findMany({where, orderBy: [{createdAt: 'desc'}], skip: (page - 1) * pageSize, take: pageSize}),
      ]);
      const ids = [...new Set(rows.map(v => v.userId).filter(Boolean))];
      const numbers = new Map(ids.length ? (await prisma.user.findMany({where: {id: {in: ids}}})).map(u => [u.id, u.patientNo]) : []);
      const items = [];
      for (const v of rows) {
        const present = v.status === 'uploaded' && !v.deletedAt && v.fileName ? !!(await storage.stat(v.fileName)) : null;
        items.push(toVideo(v, present, numbers.get(v.userId)));
      }
      return {total, page, pageSize, items};
    },

    async get(id) {
      const v = await load(id);
      const present = v.status === 'uploaded' && !v.deletedAt && v.fileName ? !!(await storage.stat(v.fileName)) : null;
      const entries = await prisma.videoAudit.findMany({where: {videoId: id}, orderBy: [{id: 'desc'}]});
      const people = new Map();
      for (const userId of new Set(entries.map(e => e.userId).filter(Boolean))) {
        const user = await prisma.user.findUnique({where: {id: userId}});
        people.set(userId, user ? {id: user.id, name: user.name, mobile: user.mobile} : null);
      }
      const owner = v.userId ? await prisma.user.findUnique({where: {id: v.userId}}) : null;
      return {
        ...toVideo(v, present, owner?.patientNo),
        audit: entries.map(e => ({action: e.action, by: e.userId ? people.get(e.userId) ?? {id: e.userId, name: null, mobile: null} : null, ip: e.ip, at: e.createdAt.toISOString()})),
      };
    },

    // What needs attention: uploads that failed, never finished, or whose file has gone
    async alerts() {
      const cutoff = new Date(now().getTime() - STUCK_MINUTES * 60_000);
      const rows = await prisma.consultVideo.findMany({where: {deletedAt: null}, orderBy: [{createdAt: 'desc'}]});
      const failed = rows.filter(v => v.status === 'failed');
      const stuck = rows.filter(v => v.status === 'uploading' && v.createdAt < cutoff);
      const missing = [];
      for (const v of rows.filter(r => r.status === 'uploaded' && r.fileName)) {
        if (!(await storage.stat(v.fileName))) {
          missing.push(v);
        }
      }
      const brief = list => list.slice(0, 50).map(v => toVideo(v, v.status === 'uploaded' ? false : null));
      return {failed: failed.length, stuckUploading: stuck.length, missing: missing.length, items: {failed: brief(failed), stuckUploading: brief(stuck), missing: brief(missing)}};
    },

    async setLegalHold(admin, id, legalHold, ip) {
      await load(id);
      await prisma.consultVideo.update({where: {id}, data: {legalHold}});
      await record(id, admin.id, 'hold', ip);
      return this.get(id);
    },

    // A link that plays one video for a few minutes. Asking for it is what is written in the audit log.
    // `scope` = {doctorId} when a doctor asks: another doctor's video is simply "not found"
    async issueLink(admin, id, action, ip, scope) {
      const v = await load(id);
      if (scope && v.doctorId !== scope.doctorId) {
        throw notFound('Video not found.');
      }
      if (v.deletedAt) {
        throw fail(410, 'This video was removed by the archive policy.');
      }
      if (v.status !== 'uploaded' || !v.fileName || !(await storage.stat(v.fileName))) {
        throw notFound('The video file is not available.');
      }
      const expires = Math.floor(now().getTime() / 1000) + LINK_SECONDS;
      await record(id, admin.id, action, ip);
      return {path: `/api/v1/videos/stream/${id}?a=${action}&e=${expires}&t=${sign(id, action, expires)}`, expiresAt: new Date(expires * 1000).toISOString()};
    },

    // Opens a video for a link: the signature and the time are checked, then the file (or the asked part of it) is
    // given. Returns what the route needs to answer.
    async open(id, {a: action, e: expires, t: token}, rangeHeader) {
      const expiresNumber = Number(expires);
      const expected = sign(id, action, expiresNumber);
      const given = Buffer.from(String(token ?? ''));
      const want = Buffer.from(expected);
      if (action !== 'play' || !Number.isInteger(expiresNumber) || given.length !== want.length || !timingSafeEqual(given, want)) {
        throw fail(403, 'This link is not valid.');
      }
      if (expiresNumber < now().getTime() / 1000) {
        throw fail(403, 'This link has expired. Open the video again.');
      }
      const v = await load(id);
      const info = v.deletedAt || !v.fileName ? null : await storage.stat(v.fileName);
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
        mimeType: MIME_BY_EXT[v.fileName.split('.').pop()] ?? 'application/octet-stream',
        fileName: `video-${v.videoCode ?? formatVideoCode(v.videoNo) ?? 'file'}-${v.id.slice(0, 8)}.${v.fileName.split('.').pop()}`,
      };
    },

    // The archive policy and the clean-up of uploads that never finished. Run it every day (npm run videos:archive).
    async applyRetention(retentionDays = config.VIDEO_RETENTION_DAYS) {
      const current = now();
      const result = {failedUploads: 0, archived: 0};
      const stuck = await prisma.consultVideo.findMany({where: {status: 'uploading', createdAt: {lt: new Date(current.getTime() - STUCK_MINUTES * 60_000)}}});
      for (const v of stuck) {
        if (v.fileName) {
          await storage.remove(v.fileName);
        } else {
          await storage.remove(`${v.id}.${EXTENSIONS[v.mimeType]}`);
        }
        await prisma.consultVideo.update({where: {id: v.id}, data: {status: 'failed', failedReason: 'The upload did not finish.'}});
        result.failedUploads += 1;
      }
      const old = await prisma.consultVideo.findMany({
        where: {status: 'uploaded', deletedAt: null, legalHold: false, uploadedAt: {lt: new Date(current.getTime() - retentionDays * DAY_MS)}},
      });
      for (const v of old) {
        await storage.remove(v.fileName);
        await prisma.consultVideo.update({where: {id: v.id}, data: {deletedAt: current}});
        await record(v.id, null, 'delete', null);
        result.archived += 1;
      }
      return result;
    },
  };
}

module.exports = {createVideosService, EXTENSIONS};
