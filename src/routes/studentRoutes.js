const express = require('express');
const router = express.Router();
const { getStudents, addStudent, deleteStudent, getStudentsByBus } = require('../controllers/studentController');
const { protect } = require('../middleware/authMiddleware');
router.get('/', protect, getStudents);
router.post('/', protect, addStudent);
router.delete('/:id', protect, deleteStudent);
router.get('/bus/:busId', protect, getStudentsByBus);
module.exports = router;
