const express = require('express');
const router = express.Router();
const warehouseController = require('../controllers/warehouse.controller');
const schemas = require('../validators/warehouse.validator');
const { requireAuth, requirePermission } = require('../middleware/auth.middleware');
const { validate } = require('../utils/query');

router.get(
  '/warehouses',
  requireAuth,
  validate({ query: schemas.list }),
  warehouseController.list.bind(warehouseController),
);
router.get(
  '/warehouses/options',
  requireAuth,
  warehouseController.options.bind(warehouseController),
);
router.get(
  '/warehouses/:id',
  requireAuth,
  validate({ params: schemas.idParam }),
  warehouseController.get.bind(warehouseController),
);

router.post(
  '/warehouses',
  requireAuth,
  requirePermission('warehouse.write'),
  validate({ body: schemas.create }),
  warehouseController.create.bind(warehouseController),
);
router.patch(
  '/warehouses/:id',
  requireAuth,
  requirePermission('warehouse.write'),
  validate({ params: schemas.idParam, body: schemas.update }),
  warehouseController.update.bind(warehouseController),
);
router.delete(
  '/warehouses/:id',
  requireAuth,
  requirePermission('warehouse.write'),
  validate({ params: schemas.idParam }),
  warehouseController.remove.bind(warehouseController),
);

module.exports = router;
