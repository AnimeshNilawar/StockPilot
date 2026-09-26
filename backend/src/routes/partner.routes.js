const express = require('express');
const { requireAuth } = require('../middleware/auth.middleware');
const partnerController = require('../controllers/partner.controller');

const router = express.Router();

router.use(requireAuth);
router.get('/', partnerController.list);

module.exports = router;
