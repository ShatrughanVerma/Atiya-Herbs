const express = require('express');
const {badRequest, forbidden} = require('../common/errors');
const {idParam} = require('../common/schemas');
const {createLimiter} = require('../common/rateLimit');
const {validateBody, validateQuery} = require('../common/validate');
const {startVideoSchema} = require('../videos/schemas');
const {adminAppointmentsQuerySchema, confirmSchema, declineSchema, patientsQuerySchema, scheduleSchema} = require('./schemas');

const checkId = (req, res, next) => (idParam.safeParse(req.params.id).success ? next() : next(badRequest('The id is not valid.')));

// A doctor's own side: the requests that came to them. The doctor is found from the login (doctors.userId), never
// from anything in the request, and every appointment is checked against that doctor: another doctor's appointment
// is simply "not found". A doctor can confirm, decline and complete; they cannot change anything else.
const doctorQuerySchema = adminAppointmentsQuerySchema.omit({doctorId: true, patientId: true, patientCode: true});

function createDoctorRoutes({prisma, requireAuth, requireRole, appointments, dashboard, doctors, videos}) {
  const router = express.Router();
  router.use(requireAuth, requireRole('doctor'));

  router.use(async (req, res, next) => {
    try {
      const doctor = await prisma.doctor.findFirst({where: {userId: req.user.id, active: true}});
      if (!doctor) {
        return next(forbidden('No doctor profile is linked to this login.'));
      }
      req.doctor = doctor;
      return next();
    } catch (error) {
      return next(error);
    }
  });
  const scope = req => ({doctorId: req.doctor.id});

  router.get('/me', async (req, res) => {
    const d = req.doctor;
    const clinic = d.clinicId ? await prisma.clinic.findFirst({where: {id: d.clinicId}}) : null;
    res.json({
      id: d.id,
      name: d.name,
      system: d.system ?? null,
      specialization: d.specialization,
      photoUrl: d.photoUrl ?? null,
      clinicId: d.clinicId ?? null,
      clinicName: clinic ? clinic.name : null,
      fee: d.fee,
    });
  });
  // The doctor's own weekly timetable ("Days & times"). Saving replaces it; booked appointments are not touched.
  router.get('/schedule', async (req, res) => res.json({timings: (await doctors.get(req.doctor.id)).timings}));
  router.put('/schedule', validateBody(scheduleSchema), async (req, res) => {
    res.json({timings: (await doctors.saveSchedule(req.user, req.doctor.id, req.body.timings)).timings});
  });
  router.get('/patients', validateQuery(patientsQuerySchema), async (req, res) => res.json(await appointments.patients(scope(req), req.parsedQuery)));
  router.get('/dashboard', async (req, res) => res.json(await dashboard.summary(scope(req))));

  router.get('/appointments', validateQuery(doctorQuerySchema), async (req, res) => res.json(await appointments.list(req.parsedQuery, scope(req))));
  router.get('/appointments/:id', checkId, async (req, res) => res.json(await appointments.get(req.params.id, scope(req))));
  router.post('/appointments/:id/confirm', checkId, validateBody(confirmSchema), async (req, res) => {
    res.json(await appointments.confirm(req.user, req.params.id, req.body.startsAt, scope(req)));
  });
  // "decline" is a cancel by the doctor: the patient sees Cancelled and the reason
  router.post('/appointments/:id/decline', checkId, validateBody(declineSchema), async (req, res) => {
    res.json(await appointments.cancel(req.user, req.params.id, req.body.reason, scope(req)));
  });
  // Videos of a visit: the doctor says the patient agreed, then sends the file the phone's camera made
  router.get('/appointments/:id/videos', checkId, async (req, res) => res.json(await videos.listForAppointment(req.doctor, req.params.id)));
  router.post('/appointments/:id/videos', checkId, createLimiter({limit: 20}), validateBody(startVideoSchema), async (req, res) => {
    res.status(201).json(await videos.start(req.doctor, req.user, req.params.id, req.body));
  });
  router.post('/videos/:id/file', checkId, createLimiter({limit: 20}), async (req, res) => {
    res.status(201).json(await videos.receive(req.doctor, req.user, req.params.id, req));
  });
  router.post('/appointments/:id/complete', checkId, async (req, res) => res.json(await appointments.complete(req.user, req.params.id, scope(req))));

  return router;
}

module.exports = {createDoctorRoutes};
