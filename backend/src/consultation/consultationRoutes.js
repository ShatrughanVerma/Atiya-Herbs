const express = require('express');
const {badRequest} = require('../common/errors');
const {idParam} = require('../common/schemas');
const {validateBody, validateQuery} = require('../common/validate');
const {bookSchema, clinicsQuerySchema, doctorsQuerySchema, listAppointmentsQuerySchema, slotsQuerySchema} = require('./schemas');

const checkId = (req, res, next) => (idParam.safeParse(req.params.id).success ? next() : next(badRequest('The id is not valid.')));

// Clinics, doctors and free slots are public (people can look before they log in). Booking needs a login, and a
// person only ever sees and changes their own appointments.
function createConsultationRoutes({consultation, requireAuth}) {
  const router = express.Router();

  router.get('/clinics', validateQuery(clinicsQuerySchema), async (req, res) => res.json(await consultation.listClinics(req.parsedQuery)));
  router.get('/clinics/:id', checkId, async (req, res) => res.json(await consultation.getClinic(req.params.id)));
  router.get('/doctors/concerns', async (req, res) => res.json(await consultation.listConcerns()));
  router.get('/doctors', validateQuery(doctorsQuerySchema), async (req, res) => res.json(await consultation.listDoctors(req.parsedQuery)));
  router.get('/doctors/:id', checkId, async (req, res) => res.json(await consultation.getDoctor(req.params.id)));
  router.get('/doctors/:id/slots', checkId, validateQuery(slotsQuerySchema), async (req, res) => {
    res.json(await consultation.getSlots(req.params.id, req.parsedQuery.date));
  });

  router.post('/appointments', requireAuth, validateBody(bookSchema), async (req, res) => {
    res.status(201).json(await consultation.book(req.user, req.body));
  });
  router.get('/credits', requireAuth, async (req, res) => res.json(await consultation.credits(req.user.id)));
  router.get('/appointments', requireAuth, validateQuery(listAppointmentsQuerySchema), async (req, res) => {
    res.json(await consultation.list(req.user.id, req.parsedQuery));
  });
  router.get('/appointments/:id', requireAuth, checkId, async (req, res) => res.json(await consultation.get(req.user.id, req.params.id)));
  router.post('/appointments/:id/cancel', requireAuth, checkId, async (req, res) => res.json(await consultation.cancel(req.user.id, req.params.id)));

  return router;
}

module.exports = {createConsultationRoutes};
