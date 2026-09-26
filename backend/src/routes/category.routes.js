const express = require('express');
const router = express.Router();
const categoryController = require('../controllers/category.controller');
const schemas = require('../validators/category.validator');
const { requireAuth, requirePermission } = require('../middleware/auth.middleware');
const { validate } = require('../utils/query');

// Reads are open to every authenticated role; writes need product.write.
router.get(
  '/categories',
  requireAuth,
  validate({ query: schemas.list }),
  categoryController.list.bind(categoryController),
);
router.get('/categories/tree', requireAuth, categoryController.tree.bind(categoryController));
router.get(
  '/categories/:id',
  requireAuth,
  validate({ params: schemas.idParam }),
  categoryController.get.bind(categoryController),
);

router.post(
  '/categories',
  requireAuth,
  requirePermission('product.write'),
  validate({ body: schemas.create }),
  categoryController.create.bind(categoryController),
);
router.patch(
  '/categories/:id',
  requireAuth,
  requirePermission('product.write'),
  validate({ params: schemas.idParam, body: schemas.update }),
  categoryController.update.bind(categoryController),
);
router.delete(
  '/categories/:id',
  requireAuth,
  requirePermission('product.write'),
  validate({ params: schemas.idParam }),
  categoryController.remove.bind(categoryController),
);

module.exports = router;
