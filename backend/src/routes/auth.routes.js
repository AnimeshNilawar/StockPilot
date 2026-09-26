const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { requireAuth } = require('../middleware/auth.middleware');
const rateLimit = require('express-rate-limit');

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, message: 'Too many login attempts', code: 'RATE_LIMIT' }
});

const resetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { success: false, message: 'Too many reset attempts', code: 'RATE_LIMIT' }
});

router.post('/signup', authController.signup.bind(authController));
router.post('/login', loginLimiter, authController.login.bind(authController));
router.post('/refresh', authController.refresh.bind(authController));
router.post('/logout', authController.logout.bind(authController));
router.get('/me', requireAuth, authController.me.bind(authController));

router.post('/forgot-password', resetLimiter, authController.forgotPassword.bind(authController));
router.post('/verify-otp', resetLimiter, authController.verifyOtp.bind(authController));
router.post('/reset-password', resetLimiter, authController.resetPassword.bind(authController));

module.exports = router;
