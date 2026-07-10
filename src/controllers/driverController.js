const prisma = require('../db');

// GET all drivers
const getDrivers = async (req, res) => {
  try {
    const drivers = await prisma.user.findMany({
      where: { role: { in: ['DRIVER', 'CONDUCTOR'] } },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, phone: true, role: true, createdAt: true },
    });
    res.json({ success: true, drivers });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET driver by id
const getDriverById = async (req, res) => {
  try {
    const driver = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: { id: true, name: true, phone: true, role: true, createdAt: true },
    });
    if (!driver) return res.status(404).json({ message: 'Driver not found' });
    res.json({ success: true, driver });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = { getDrivers, getDriverById };
