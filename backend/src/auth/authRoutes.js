const express = require('express');
const {validateBody} = require('../common/validate');
const {createLimiter} = require('../common/rateLimit');
const {refreshSchema, requestOtpSchema, verifyOtpSchema} = require('./schemas');

const contextOf = req => ({ip: req.ip ?? null, userAgent: req.headers['user-agent'] ?? null});

// Login by mobile OTP. The limits below apply on top of the global limit, per client IP.
function createAuthRoutes({auth}) {
  const router = express.Router();

  // Always answers the same way, whether or not the number already has an account
  router.post('/otp/request', createLimiter({limit: 5}), validateBody(requestOtpSchema), async (req, res) => {
    res.status(200).json(await auth.requestOtp(req.body.mobile, contextOf(req)));
  });

  router.post('/otp/verify', createLimiter({limit: 10}), validateBody(verifyOtpSchema), async (req, res) => {
    const {mobile, code, deviceName} = req.body;
    res.status(200).json(await auth.verifyOtp(mobile, code, deviceName, contextOf(req)));
  });

  router.post('/refresh', createLimiter({limit: 30}), validateBody(refreshSchema), async (req, res) => {
    res.status(200).json(await auth.refresh(req.body.refreshToken, contextOf(req)));
  });

  router.post('/logout', createLimiter({limit: 30}), validateBody(refreshSchema), async (req, res) => {
    await auth.logout(req.body.refreshToken, contextOf(req));
    res.status(204).end();
  });

  return router;
}

module.exports = {createAuthRoutes};
