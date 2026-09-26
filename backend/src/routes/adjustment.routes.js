const express = require('express');
const { requireAuth, requirePermission } = require('../middleware/auth.middleware');
const { validate } = require('../utils/query');
const { requireIdempotencyKey } = require('../services/idempotency.service');
const adjustmentController = require('../controllers/adjustment.controller');
const adjustmentValidator = require('../validators/adjustment.validator');

const router = express.Router();

router.use(requireAuth);

router
  .route('/')
  .get(validate({ query: adjustmentValidator.list }), adjustmentController.list)
  .post(
    requirePermission('adjustment.create'),
    validate({ body: adjustmentValidator.create }),
    adjustmentController.create,
  );

router
  .route('/:id')
  .get(validate({ params: adjustmentValidator.idParam }), adjustmentController.getById)
  .put(
    requirePermission('adjustment.create'),
    validate({ params: adjustmentValidator.idParam, body: adjustmentValidator.edit }),
    adjustmentController.update,
  );

router
  .route('/:id/status')
  .patch(
    requirePermission('adjustment.create'),
    validate({ params: adjustmentValidator.idParam, body: adjustmentValidator.transition }),
    adjustmentController.changeState,
  );

router
  .route('/:id/cancel')
  .post(
    requirePermission('adjustment.create'),
    validate({ params: adjustmentValidator.idParam }),
    adjustmentController.cancel,
  );

router
  .route('/:id/validate')
  .post(
    requirePermission('adjustment.validate'),
    validate({ params: adjustmentValidator.idParam }),
    requireIdempotencyKey,
    adjustmentController.validate,
  );

module.exports = router;
