const express = require('express');
const { requireAuth, requirePermission } = require('../middleware/auth.middleware');
const { validate } = require('../utils/query');
const { requireIdempotencyKey } = require('../services/idempotency.service');
const deliveryController = require('../controllers/delivery.controller');
const deliveryValidator = require('../validators/delivery.validator');

const router = express.Router();

router.use(requireAuth);

router
  .route('/')
  .get(validate({ query: deliveryValidator.list }), deliveryController.list)
  .post(
    requirePermission('delivery.create'),
    validate({ body: deliveryValidator.create }),
    deliveryController.create,
  );

router
  .route('/:id')
  .get(validate({ params: deliveryValidator.idParam }), deliveryController.getById)
  .put(
    requirePermission('delivery.edit'),
    validate({ params: deliveryValidator.idParam, body: deliveryValidator.edit }),
    deliveryController.update,
  );

router
  .route('/:id/status')
  .patch(
    requirePermission('delivery.edit'),
    validate({ params: deliveryValidator.idParam, body: deliveryValidator.transition }),
    deliveryController.changeState,
  );

/**
 * Picking is a distinct permission from editing, because it is the step that
 * takes a claim on real stock — the first point at which a delivery affects
 * anyone else's ability to ship.
 */
router
  .route('/:id/pick')
  .post(
    requirePermission('delivery.pick'),
    validate({ params: deliveryValidator.idParam }),
    deliveryController.pick,
  );

router
  .route('/:id/cancel')
  .post(
    requirePermission('delivery.edit'),
    validate({ params: deliveryValidator.idParam }),
    deliveryController.cancel,
  );

router
  .route('/:id/validate')
  .post(
    requirePermission('delivery.validate'),
    validate({ params: deliveryValidator.idParam }),
    requireIdempotencyKey,
    deliveryController.validate,
  );

/** Read-only preview of whether the delivery's lines can currently be picked. */
router
  .route('/:id/availability')
  .get(validate({ params: deliveryValidator.idParam }), deliveryController.availability);

module.exports = router;
