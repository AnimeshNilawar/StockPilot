const express = require('express');
const { requireAuth, requirePermission } = require('../middleware/auth.middleware');
const { validate } = require('../utils/query');
const { requireIdempotencyKey } = require('../services/idempotency.service');
const transferController = require('../controllers/transfer.controller');
const transferValidator = require('../validators/transfer.validator');

const router = express.Router();

router.use(requireAuth);

router
  .route('/')
  .get(validate({ query: transferValidator.list }), transferController.list)
  .post(
    requirePermission('internal_transfer.create'),
    validate({ body: transferValidator.create }),
    transferController.create,
  );

router
  .route('/:id')
  .get(validate({ params: transferValidator.idParam }), transferController.getById)
  .put(
    requirePermission('internal_transfer.create'),
    validate({ params: transferValidator.idParam, body: transferValidator.edit }),
    transferController.update,
  );

router
  .route('/:id/status')
  .patch(
    requirePermission('internal_transfer.create'),
    validate({ params: transferValidator.idParam, body: transferValidator.transition }),
    transferController.changeState,
  );

router
  .route('/:id/cancel')
  .post(
    requirePermission('internal_transfer.create'),
    validate({ params: transferValidator.idParam }),
    transferController.cancel,
  );

router
  .route('/:id/validate')
  .post(
    requirePermission('internal_transfer.validate'),
    validate({ params: transferValidator.idParam }),
    requireIdempotencyKey,
    transferController.validate,
  );

router
  .route('/:id/availability')
  .get(validate({ params: transferValidator.idParam }), transferController.availability);

module.exports = router;
