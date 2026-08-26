const express = require('express');
const router = express.Router();
const { createBus, getAllBuses, getBusLocation, getBusFullInfo } = require('../controllers/busController');
const { protect } = require('../middleware/authMiddleware');

router.post('/', protect, createBus);
router.get('/', protect, getAllBuses);
router.get('/:busId/location', protect, getBusLocation);
router.get('/:busId/full', protect, getBusFullInfo);

module.exports = router;