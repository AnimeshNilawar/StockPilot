const express = require('express');
const router = express.Router();

const authRoutes = require('./auth.routes');
const userRoutes = require('./user.routes');

router.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    data: {
      status: 'ok',
    },
  });
});

router.use('/auth', authRoutes);
router.use('/users', userRoutes);

module.exports = router;
