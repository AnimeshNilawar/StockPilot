const express = require('express');
const { requireAuth, requirePermission } = require('../middleware/auth.middleware');
const { validate } = require('../utils/query');
const partnerController = require('../controllers/partner.controller');
const schemas = require('../validators/partner.validator');

const router = express.Router();

router.use(requireAuth);

/**
 * Partners are master data like products and categories, so they reuse the
 * catalogue's `product.read` / `product.write` permissions rather than growing
 * a parallel set of actions.
 */
router.get(
  '/',
  requirePermission('product.read'),
  validate({ query: schemas.list }),
  partnerController.list,
);

router.get(
  '/options',
  requirePermission('product.read'),
  validate({ query: schemas.options }),
  partnerController.options,
);

router.get(
  '/:id',
  requirePermission('product.read'),
  validate({ params: schemas.idParam }),
  partnerController.getById,
);

router.post(
  '/',
  requirePermission('product.write'),
  validate({ body: schemas.create }),
  partnerController.create,
);

router.patch(
  '/:id',
  requirePermission('product.write'),
  validate({ params: schemas.idParam, body: schemas.update }),
  partnerController.update,
);

router.delete(
  '/:id',
  requirePermission('product.write'),
  validate({ params: schemas.idParam }),
  partnerController.remove,
);

module.exports = router;
