const express = require('express');
const router = express.Router();

const authRoutes = require('./auth.routes');
const userRoutes = require('./user.routes');
const categoryRoutes = require('./category.routes');
const uomRoutes = require('./uom.routes');
const productRoutes = require('./product.routes');
const warehouseRoutes = require('./warehouse.routes');
const locationRoutes = require('./location.routes');
const stockRoutes = require('./stock.routes');
const receiptRoutes = require('./receipt.routes');
const deliveryRoutes = require('./delivery.routes');
const partnerRoutes = require('./partner.routes');
const transferRoutes = require('./transfer.routes');
const adjustmentRoutes = require('./adjustment.routes');
const { prisma } = require('../lib/prisma');

router.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    data: {
      status: 'ok',
    },
  });
});

/** Readiness probe: verifies the database round-trips, not just the process. */
router.get('/health/ready', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({ success: true, data: { status: 'ok', database: 'up' } });
  } catch {
    res.status(503).json({
      success: false,
      message: 'Database unavailable',
      code: 'SERVICE_UNAVAILABLE',
    });
  }
});

router.use('/auth', authRoutes);
router.use('/users', userRoutes);

// Feature routers declare `requireAuth` on each route rather than as blanket
// middleware, so an unknown path still returns 404 instead of 401.
router.use(categoryRoutes);
router.use(uomRoutes);
router.use(productRoutes);
router.use(warehouseRoutes);
router.use(locationRoutes);
router.use(stockRoutes);
router.use('/receipts', receiptRoutes);
router.use('/deliveries', deliveryRoutes);
router.use('/partners', partnerRoutes);
router.use('/internal-transfers', transferRoutes);
router.use('/transfers', transferRoutes);
router.use('/adjustments', adjustmentRoutes);

module.exports = router;

