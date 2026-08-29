const express = require('express');
const router = express.Router();
const {
  createBus, getAllBuses, updateBus, deactivateBus, getBusLocation, getBusFullInfo,
  getLiveBuses,
} = require('../controllers/busController');
const { protect } = require('../middleware/authMiddleware');

// IMPORTANT: literal paths like '/live' MUST come before any ':id' /
// ':busId' pattern route — otherwise Express treats "live" as an id
// value and the wrong handler fires.
router.get('/live', protect, getLiveBuses);

router.get('/', protect, getAllBuses);
router.post('/', protect, createBus);
router.put('/:id', protect, updateBus);
router.delete('/:id', protect, deactivateBus);
router.get('/:busId/location', protect, getBusLocation);
router.get('/:busId/full', protect, getBusFullInfo);

module.exports = router;