const express = require('express');
const {unavailable} = require('../common/errors');

// For the hosting platform's health checks. Public, and it reveals nothing about the system.
function createHealthRoutes({prisma}) {
  const router = express.Router();

  // Is the process up?
  router.get('/', (req, res) => res.json({status: 'ok'}));

  // Can it reach the database?
  router.get('/ready', async (req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1 AS ok`;
    } catch {
      throw unavailable('Not ready');
    }
    res.json({status: 'ok'});
  });

  return router;
}

module.exports = {createHealthRoutes};
