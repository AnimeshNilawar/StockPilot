const express = require('express');
const router = express.Router();
const stockController = require('../controllers/stock.controller');
const schemas = require('../validators/stock.validator');
const { requireAuth, requirePermission } = require('../middleware/auth.middleware');
const { requireIdempotencyKey } = require('../services/idempotency.service');
const { validate } = require('../utils/query');

// Literal paths come before the `:id` pattern so `/stock/summary` is never
// swallowed as an identifier.
router.get(
  '/stock',
  requireAuth,
  validate({ query: schemas.quantList }),
  stockController.listQuants.bind(stockController),
);
router.get(
  '/stock/summary',
  requireAuth,
  validate({ query: schemas.stockSummary }),
  stockController.summary.bind(stockController),
);
router.get(
  '/stock/low-stock',
  requireAuth,
  validate({ query: schemas.lowStockList }),
  stockController.lowStock.bind(stockController),
);
router.get(
  '/stock/reconcile',
  requireAuth,
  requirePermission('stock.read'),
  validate({ query: schemas.reconcile }),
  stockController.reconcile.bind(stockController),
);

router.get(
  '/moves',
  requireAuth,
  validate({ query: schemas.moveList }),
  stockController.listMoves.bind(stockController),
);
router.get(
  '/moves/:id',
  requireAuth,
  validate({ params: schemas.idParam }),
  stockController.getMove.bind(stockController),
);

router.post(
  '/moves',
  requireAuth,
  requirePermission('stock.move'),
  requireIdempotencyKey,
  validate({ body: schemas.directMove }),
  stockController.createDirectMove.bind(stockController),
);

module.exports = router;
