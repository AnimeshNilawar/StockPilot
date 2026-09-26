const express = require('express');
const router = express.Router();
const uomController = require('../controllers/uom.controller');
const schemas = require('../validators/uom.validator');
const { requireAuth, requirePermission } = require('../middleware/auth.middleware');
const { validate } = require('../utils/query');

router.get(
  '/uoms',
  requireAuth,
  validate({ query: schemas.list }),
  uomController.list.bind(uomController),
);
router.get('/uoms/options', requireAuth, uomController.options.bind(uomController));
router.get(
  '/uoms/:id',
  requireAuth,
  validate({ params: schemas.idParam }),
  uomController.get.bind(uomController),
);

router.post(
  '/uoms',
  requireAuth,
  requirePermission('product.write'),
  validate({ body: schemas.create }),
  uomController.create.bind(uomController),
);
router.patch(
  '/uoms/:id',
  requireAuth,
  requirePermission('product.write'),
  validate({ params: schemas.idParam, body: schemas.update }),
  uomController.update.bind(uomController),
);
router.delete(
  '/uoms/:id',
  requireAuth,
  requirePermission('product.write'),
  validate({ params: schemas.idParam }),
  uomController.remove.bind(uomController),
);

module.exports = router;
