const express = require('express');
const router = express.Router();
const {
  getStopsByBus, getAllStops, createStop, deleteStop, reorderStops,
} = require('../controllers/stopController');
const { protect } = require('../middleware/authMiddleware');

router.get('/', protect, getAllStops);
router.get('/bus/:busId', protect, getStopsByBus);
router.post('/', protect, createStop);
router.patch('/reorder', protect, reorderStops);
router.delete('/:id', protect, deleteStop);

module.exports = router;