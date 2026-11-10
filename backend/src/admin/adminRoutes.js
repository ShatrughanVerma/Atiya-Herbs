const express = require('express');
const {badRequest} = require('../common/errors');
const {createLimiter} = require('../common/rateLimit');
const {idParam} = require('../common/schemas');
const {validateBody, validateQuery} = require('../common/validate');
const {adminVideosQuerySchema, holdSchema, linkSchema} = require('../videos/schemas');
const {
  adminAppointmentsQuerySchema,
  adminDoctorsQuerySchema,
  cancelSchema,
  changeCreditsSchema,
  confirmSchema,
  createClinicSchema,
  createDoctorLoginSchema,
  createDoctorSchema,
  doctorLoginSchema,
  findUserQuerySchema,
  noteSchema,
  scheduleSchema,
  updateClinicSchema,
  updateDoctorSchema,
} = require('./schemas');

const checkId = (req, res, next) => (idParam.safeParse(req.params.id).success ? next() : next(badRequest('The id is not valid.')));

// Everything under /api/v1/admin. One guard at the top: a person who is not logged in gets 401, a logged-in
// person without the Admin role gets 403, whatever route they try. The staff member's id always comes from the token.
function createAdminRoutes({requireAuth, requireRole, videos, appointments, doctors, clinics, credits, dashboard, uploads}) {
  const router = express.Router();
  router.use(requireAuth, requireRole('admin'));

  router.get('/dashboard', async (req, res) => res.json(await dashboard.summary()));

  router.get('/appointments', validateQuery(adminAppointmentsQuerySchema), async (req, res) => res.json(await appointments.list(req.parsedQuery)));
  router.get('/appointments/:id', checkId, async (req, res) => res.json(await appointments.get(req.params.id)));
  router.post('/appointments/:id/confirm', checkId, validateBody(confirmSchema), async (req, res) => {
    res.json(await appointments.confirm(req.user, req.params.id, req.body.startsAt));
  });
  router.post('/appointments/:id/complete', checkId, async (req, res) => res.json(await appointments.complete(req.user, req.params.id)));
  router.post('/appointments/:id/cancel', checkId, validateBody(cancelSchema), async (req, res) => {
    res.json(await appointments.cancel(req.user, req.params.id, req.body.reason));
  });
  router.patch('/appointments/:id', checkId, validateBody(noteSchema), async (req, res) => {
    res.json(await appointments.saveNote(req.user, req.params.id, req.body.adminNote));
  });

  router.get('/doctors', validateQuery(adminDoctorsQuerySchema), async (req, res) => res.json(await doctors.list(req.parsedQuery)));
  router.post('/doctors/photo-upload', createLimiter({limit: 30}), (req, res) => res.json(uploads.signPhotoUpload()));
  router.post('/doctors', validateBody(createDoctorSchema), async (req, res) => res.status(201).json(await doctors.create(req.user, req.body)));
  router.get('/doctors/:id', checkId, async (req, res) => res.json(await doctors.get(req.params.id)));
  router.patch('/doctors/:id', checkId, validateBody(updateDoctorSchema), async (req, res) => {
    res.json(await doctors.update(req.user, req.params.id, req.body));
  });
  router.post('/doctors/:id/login/create', checkId, createLimiter({limit: 20}), validateBody(createDoctorLoginSchema), async (req, res) => {
    res.status(201).json(await doctors.createLogin(req.user, req.params.id, req.body));
  });
  router.put('/doctors/:id/login', checkId, validateBody(doctorLoginSchema), async (req, res) => {
    res.json(await doctors.linkLogin(req.user, req.params.id, req.body.mobile));
  });
  router.delete('/doctors/:id/login', checkId, async (req, res) => res.json(await doctors.unlinkLogin(req.user, req.params.id)));
  router.put('/doctors/:id/schedule', checkId, validateBody(scheduleSchema), async (req, res) => {
    res.json(await doctors.saveSchedule(req.user, req.params.id, req.body.timings));
  });

  // Consultation videos: search, alerts, history, and short-lived play links
  router.get('/videos', validateQuery(adminVideosQuerySchema), async (req, res) => res.json(await videos.list(req.parsedQuery)));
  router.get('/videos/alerts', async (req, res) => res.json(await videos.alerts()));
  router.get('/videos/:id', checkId, async (req, res) => res.json(await videos.get(req.params.id)));
  router.post('/videos/:id/link', checkId, createLimiter({limit: 60}), validateBody(linkSchema), async (req, res) => {
    res.json(await videos.issueLink(req.user, req.params.id, req.body.action, req.ip));
  });
  router.patch('/videos/:id', checkId, validateBody(holdSchema), async (req, res) => {
    res.json(await videos.setLegalHold(req.user, req.params.id, req.body.legalHold, req.ip));
  });

  router.get('/clinics', async (req, res) => res.json(await clinics.list()));
  router.post('/clinics', validateBody(createClinicSchema), async (req, res) => res.status(201).json(await clinics.create(req.user, req.body)));
  router.patch('/clinics/:id', checkId, validateBody(updateClinicSchema), async (req, res) => {
    res.json(await clinics.update(req.user, req.params.id, req.body));
  });

  router.get('/users', validateQuery(findUserQuerySchema), async (req, res) => res.json(await credits.find(req.parsedQuery)));
  router.get('/users/:id/credits', checkId, async (req, res) => res.json(await credits.get(req.params.id)));
  router.post('/users/:id/credits', checkId, createLimiter({limit: 60}), validateBody(changeCreditsSchema), async (req, res) => {
    res.json(await credits.change(req.user, req.params.id, req.body));
  });

  return router;
}

module.exports = {createAdminRoutes};
