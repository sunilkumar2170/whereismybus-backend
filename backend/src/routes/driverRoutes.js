const express = require('express');
const router = express.Router();
const {
  getDrivers, getDriverById, createDriver, updateDriver, deleteDriver, assignBus,
} = require('../controllers/driverController');
const { protect } = require('../middleware/authMiddleware');

router.get('/', protect, getDrivers);
router.get('/:id', protect, getDriverById);
router.post('/', protect, createDriver);
router.put('/:id', protect, updateDriver);
router.delete('/:id', protect, deleteDriver);
router.patch('/:id/assign-bus', protect, assignBus);

module.exports = router;