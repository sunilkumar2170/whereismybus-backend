const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  getRoutes,
  getRouteById,
  getRouteByBus,
  createRoute,
  updateRoute,
  addStopToRoute,
  deleteRouteStop,
  deleteRoute,
} = require('../controllers/routeController');

router.get('/',                 protect, getRoutes);
router.get('/bus/:busId',       protect, getRouteByBus);
router.get('/:id',              protect, getRouteById);
router.post('/',                protect, createRoute);
router.put('/:id',              protect, updateRoute);
router.post('/:id/stops',       protect, addStopToRoute);
router.delete('/stops/:stopId', protect, deleteRouteStop);
router.delete('/:id',           protect, deleteRoute);

module.exports = router;