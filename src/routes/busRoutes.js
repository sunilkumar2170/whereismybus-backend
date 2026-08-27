const express = require('express');
const router = express.Router();
const {
  createBus, getAllBuses, updateBus, deactivateBus, getBusLocation, getBusFullInfo,
} = require('../controllers/busController');
const { protect } = require('../middleware/authMiddleware');

router.get('/', protect, getAllBuses);
router.post('/', protect, createBus);
router.put('/:id', protect, updateBus);
router.delete('/:id', protect, deactivateBus);
router.get('/:busId/location', protect, getBusLocation);
router.get('/:busId/full', protect, getBusFullInfo);

module.exports = router;