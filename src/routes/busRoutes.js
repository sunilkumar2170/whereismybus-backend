const express = require('express');
const router = express.Router();
const { createBus, getAllBuses, getBusLocation } = require('../controllers/busController');
const { protect } = require('../middleware/authMiddleware');

router.post('/', protect, createBus);
router.get('/', protect, getAllBuses);
router.get('/:busId/location', protect, getBusLocation);

module.exports = router;