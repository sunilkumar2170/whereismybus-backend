const express = require('express');
const router  = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  getStudents, addStudent, deleteStudent,
  getDrivers, addDriver, deleteDriver,
  getAttendance, markAttendance,
  getEmergencies, addEmergency, deleteEmergency,
} = require('../controllers/adminController');

// Students
router.get('/students',        protect, getStudents);
router.post('/students',       protect, addStudent);
router.delete('/students/:id', protect, deleteStudent);

// Drivers
router.get('/drivers',         protect, getDrivers);
router.post('/drivers',        protect, addDriver);
router.delete('/drivers/:id',  protect, deleteDriver);

// Attendance
router.get('/attendance',  protect, getAttendance);
router.post('/attendance', protect, markAttendance);

// Emergency
router.get('/emergencies',         protect, getEmergencies);
router.post('/emergencies',        protect, addEmergency);
router.delete('/emergencies/:id',  protect, deleteEmergency);

module.exports = router;
