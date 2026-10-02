const express = require('express');
const router = express.Router();
const { getSosAlerts, createSosAlert, updateSosStatus } = require('../controllers/sosController');
const { protect } = require('../middleware/authMiddleware');
router.get('/', protect, getSosAlerts);
router.post('/', protect, createSosAlert);
router.patch('/:id', protect, updateSosStatus);
module.exports = router;
