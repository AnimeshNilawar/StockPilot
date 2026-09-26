const express = require('express');
const router = express.Router();
const userController = require('../controllers/user.controller');
const schemas = require('../validators/user.validator');
const { requireAuth, requirePermission } = require('../middleware/auth.middleware');
const { validate } = require('../utils/query');

// All user management routes require authentication and 'user.manage' permission
router.use(requireAuth);
router.use(requirePermission('user.manage'));

router.get('/roles', userController.listRoles.bind(userController));

router.get(
  '/',
  validate({ query: schemas.list }),
  userController.list.bind(userController),
);

router.get(
  '/:id',
  validate({ params: schemas.idParam }),
  userController.get.bind(userController),
);

router.post(
  '/',
  validate({ body: schemas.create }),
  userController.create.bind(userController),
);

router.patch(
  '/:id',
  validate({ params: schemas.idParam, body: schemas.update }),
  userController.update.bind(userController),
);

router.patch(
  '/:id/role',
  validate({ params: schemas.idParam, body: schemas.updateRole }),
  userController.updateRole.bind(userController),
);

router.patch(
  '/:id/warehouse-access',
  validate({ params: schemas.idParam, body: schemas.updateWarehouseAccess }),
  userController.assignWarehouseAccess.bind(userController),
);

router.put(
  '/:id/warehouses',
  validate({ params: schemas.idParam, body: schemas.updateWarehouseAccess }),
  userController.assignWarehouseAccess.bind(userController),
);

router.patch(
  '/:id/status',
  validate({ params: schemas.idParam, body: schemas.updateStatus }),
  userController.updateStatus.bind(userController),
);

module.exports = router;
