const express = require('express');
const router = express.Router();
const locationController = require('../controllers/location.controller');
const schemas = require('../validators/warehouse.validator');
const { requireAuth, requirePermission } = require('../middleware/auth.middleware');
const {
  requireWarehouseAccess,
  requireBodyWarehouseAccess,
} = require('../middleware/access.middleware');
const { validate } = require('../utils/query');

// Nested under a warehouse: access is checked against the :warehouseId param,
// so a user cannot read or mutate another warehouse's tree by editing the URL.
router.get(
  '/warehouses/:warehouseId/locations',
  requireAuth,
  validate({ params: schemas.locationByWarehouseParam, query: schemas.locationList }),
  requireWarehouseAccess((req) => req.valid.params.warehouseId),
  locationController.listByWarehouse.bind(locationController),
);

router.get(
  '/locations',
  requireAuth,
  validate({ query: schemas.locationList }),
  locationController.list.bind(locationController),
);
router.get('/locations/options', requireAuth, locationController.options.bind(locationController));
router.get(
  '/locations/:id',
  requireAuth,
  validate({ params: schemas.idParam }),
  locationController.get.bind(locationController),
);

router.post(
  '/locations',
  requireAuth,
  requirePermission('location.write'),
  validate({ body: schemas.locationCreate }),
  requireBodyWarehouseAccess(),
  locationController.create.bind(locationController),
);
router.patch(
  '/locations/:id',
  requireAuth,
  requirePermission('location.write'),
  validate({ params: schemas.idParam, body: schemas.locationUpdate }),
  locationController.update.bind(locationController),
);
router.delete(
  '/locations/:id',
  requireAuth,
  requirePermission('location.write'),
  validate({ params: schemas.idParam }),
  locationController.remove.bind(locationController),
);

module.exports = router;
