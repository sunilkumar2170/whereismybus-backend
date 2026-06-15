const express = require('express');
const router = express.Router();
const { getStops } = require('../controllers/stopController');
const { protect } = require('../middleware/authMiddleware');

router.get('/:busId', protect, getStops);

module.exports = router;