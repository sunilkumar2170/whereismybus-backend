const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { getRoutes, createRoute, deleteRoute, getRouteByBus } = require('../controllers/routeController');

router.get('/',           protect, getRoutes);
router.post('/',          protect, createRoute);
router.delete('/:id',     protect, deleteRoute);
router.get('/bus/:busId', protect, getRouteByBus);

module.exports = router;