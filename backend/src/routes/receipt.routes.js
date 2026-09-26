const express = require('express');
const { requireAuth, requirePermission } = require('../middleware/auth.middleware');
const { validate } = require('../utils/query');
const { requireIdempotencyKey } = require('../services/idempotency.service');
const receiptController = require('../controllers/receipt.controller');
const receiptValidator = require('../validators/receipt.validator');

const router = express.Router();

router.use(requireAuth);

router
  .route('/')
  .get(validate({ query: receiptValidator.list }), receiptController.list)
  .post(
    requirePermission('receipt.create'),
    validate({ body: receiptValidator.create }),
    receiptController.create,
  );

router
  .route('/:id')
  .get(validate({ params: receiptValidator.idParam }), receiptController.getById)
  .put(
    requirePermission('receipt.edit'),
    validate({ params: receiptValidator.idParam, body: receiptValidator.edit }),
    receiptController.update,
  );

router
  .route('/:id/status')
  .patch(
    requirePermission('receipt.edit'),
    validate({ params: receiptValidator.idParam, body: receiptValidator.transition }),
    receiptController.changeState,
  );

router
  .route('/:id/cancel')
  .post(
    requirePermission('receipt.edit'),
    validate({ params: receiptValidator.idParam }),
    receiptController.cancel,
  );

router
  .route('/:id/validate')
  .post(
    requirePermission('receipt.validate'),
    validate({ params: receiptValidator.idParam }),
    requireIdempotencyKey,
    receiptController.validate,
  );

module.exports = router;
