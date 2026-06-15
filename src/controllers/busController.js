const prisma = require('../db');

// Bus banao
const createBus = async (req, res) => {
  try {
    const { busNo, driverName } = req.body;

    const existing = await prisma.bus.findUnique({
      where: { busNo }
    });

    if (existing) {
      return res.status(400).json({ message: 'Bus already exists' });
    }

    const bus = await prisma.bus.create({
      data: { busNo, driverName }
    });

    res.status(201).json({ success: true, bus });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Sab buses dekho
const getAllBuses = async (req, res) => {
  try {
    const buses = await prisma.bus.findMany();
    res.json({ success: true, buses });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Ek bus ki live location
const getBusLocation = async (req, res) => {
  try {
    const { busId } = req.params;

    const location = await prisma.liveLocation.findFirst({
      where: { busId },
      orderBy: { timestamp: 'desc' }
    });

    if (!location) {
      return res.status(404).json({ message: 'No location found' });
    }

    res.json({ success: true, location });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = { createBus, getAllBuses, getBusLocation };