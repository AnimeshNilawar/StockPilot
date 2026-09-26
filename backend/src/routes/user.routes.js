const express = require('express');
const router = express.Router();
const userController = require('../controllers/user.controller');
const { requireAuth, requirePermission } = require('../middleware/auth.middleware');

// All user management routes require authentication and 'user.manage' permission
router.use(requireAuth);
router.use(requirePermission('user.manage'));

router.get('/', userController.list.bind(userController));
router.post('/', userController.create.bind(userController));
router.patch('/:id', userController.update.bind(userController));
router.patch('/:id/role', userController.updateRole.bind(userController));
router.put('/:id/warehouses', userController.assignWarehouses.bind(userController));

module.exports = router;
