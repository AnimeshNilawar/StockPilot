const express = require('express');
const router = express.Router();
const productController = require('../controllers/product.controller');
const schemas = require('../validators/product.validator');
const { requireAuth, requirePermission } = require('../middleware/auth.middleware');
const { validate } = require('../utils/query');

router.get(
  '/products',
  requireAuth,
  validate({ query: schemas.list }),
  productController.list.bind(productController),
);
router.get(
  '/products/:id',
  requireAuth,
  validate({ params: schemas.idParam }),
  productController.get.bind(productController),
);
router.get(
  '/products/:id/stock',
  requireAuth,
  validate({ params: schemas.idParam }),
  productController.stock.bind(productController),
);

router.post(
  '/products',
  requireAuth,
  requirePermission('product.write'),
  validate({ body: schemas.create }),
  productController.create.bind(productController),
);
router.patch(
  '/products/:id',
  requireAuth,
  requirePermission('product.write'),
  validate({ params: schemas.idParam, body: schemas.update }),
  productController.update.bind(productController),
);
router.delete(
  '/products/:id',
  requireAuth,
  requirePermission('product.write'),
  validate({ params: schemas.idParam }),
  productController.remove.bind(productController),
);

module.exports = router;
