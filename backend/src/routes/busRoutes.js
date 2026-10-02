const express = require('express');
const router = express.Router();
const {
  createBus, getAllBuses, updateBus, deactivateBus, getBusLocation, getBusFullInfo,
  getLiveBuses, updateLocationHttp,
} = require('../controllers/busController');
const { protect } = require('../middleware/authMiddleware');

// IMPORTANT: literal paths like '/live' and '/location' MUST come before any ':id' /
// ':busId' pattern route — otherwise Express treats "live" or "location" as an id
// value and the wrong handler fires.
router.get('/live', protect, getLiveBuses);
router.post('/location', updateLocationHttp);

router.get('/', protect, getAllBuses);
router.post('/', protect, createBus);
router.put('/:id', protect, updateBus);
router.delete('/:id', protect, deactivateBus);
router.get('/:busId/location', protect, getBusLocation);
router.get('/:busId/full', protect, getBusFullInfo);

module.exports = router;