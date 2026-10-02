const express = require('express');
const router = express.Router();
const { startTrip, endTrip, getActiveBuses } = require('../controllers/tripController');
const { protect } = require('../middleware/authMiddleware');

router.post('/start', protect, startTrip);
router.post('/end', protect, endTrip);
router.get('/active', protect, getActiveBuses);

module.exports = router;