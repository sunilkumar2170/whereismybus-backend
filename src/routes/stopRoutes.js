const express = require('express');
const router = express.Router();
const {
  getStops, getAllStops, createStop, deleteStop, reorderStops,
} = require('../controllers/stopController');
const { protect } = require('../middleware/authMiddleware');

// ── NEW routes FIRST (so they don't get swallowed by the ':busId'
// catch-all below — Express matches routes top-to-bottom) ──
router.get('/', protect, getAllStops);
router.post('/', protect, createStop);
router.patch('/reorder', protect, reorderStops);
router.delete('/:id', protect, deleteStop);

// ── LEGACY — unchanged: GET /api/stops/:busId ──
router.get('/:busId', protect, getStops);

module.exports = router;