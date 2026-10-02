const express = require('express');
const router = express.Router();
const { markAttendance, getAttendance } = require('../controllers/attendanceController');
const { protect } = require('../middleware/authMiddleware');
router.get('/', protect, getAttendance);
router.post('/', protect, markAttendance);
module.exports = router;
