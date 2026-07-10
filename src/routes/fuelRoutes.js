const express = require('express');
const router = express.Router();
const { getFuelLogs, addFuelLog, deleteFuelLog } = require('../controllers/fuelController');
const { protect } = require('../middleware/authMiddleware');
router.get('/', protect, getFuelLogs);
router.post('/', protect, addFuelLog);
router.delete('/:id', protect, deleteFuelLog);
module.exports = router;
