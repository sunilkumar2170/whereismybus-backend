const express = require('express');
const router = express.Router();
const { getDrivers, getDriverById } = require('../controllers/driverController');
const { protect } = require('../middleware/authMiddleware');
router.get('/', protect, getDrivers);
router.get('/:id', protect, getDriverById);
module.exports = router;
