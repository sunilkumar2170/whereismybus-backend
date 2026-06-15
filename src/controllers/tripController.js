const prisma = require('../db');

// Trip Start
const startTrip = async (req, res) => {
  try {
    const { busId } = req.body;

    // Bus status update karo
    await prisma.bus.update({
      where: { id: busId },
      data: { status: 'ON_TRIP' }
    });

    res.json({ success: true, message: 'Trip started', busId });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Trip End
const endTrip = async (req, res) => {
  try {
    const { busId } = req.body;

    // Bus status update karo
    await prisma.bus.update({
      where: { id: busId },
      data: { status: 'ACTIVE' }
    });

    res.json({ success: true, message: 'Trip ended', busId });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Active trips dekho
const getActiveBuses = async (req, res) => {
  try {
    const buses = await prisma.bus.findMany({
      where: { status: 'ON_TRIP' }
    });
    res.json({ success: true, buses });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = { startTrip, endTrip, getActiveBuses };