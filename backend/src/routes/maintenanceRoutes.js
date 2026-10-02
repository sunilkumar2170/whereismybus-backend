const express = require('express');
const router = express.Router();
const { getMaintenanceLogs, addMaintenanceLog, deleteMaintenanceLog } = require('../controllers/maintenanceController');
const { protect } = require('../middleware/authMiddleware');
router.get('/', protect, getMaintenanceLogs);
router.post('/', protect, addMaintenanceLog);
router.delete('/:id', protect, deleteMaintenanceLog);
module.exports = router;
