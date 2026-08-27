const prisma = require('../db');

// ── GET all drivers (from the Driver table — NOT User) ──
const getDrivers = async (req, res) => {
  try {
    const drivers = await prisma.driver.findMany({ orderBy: { name: 'asc' } });
    // attach busNo for display (Driver.busId has no Prisma relation, so resolve manually)
    const busIds = [...new Set(drivers.map(d => d.busId).filter(Boolean))];
    const buses = busIds.length
      ? await prisma.bus.findMany({ where: { id: { in: busIds } } })
      : [];
    const busMap = Object.fromEntries(buses.map(b => [b.id, b.busNo]));
    const enriched = drivers.map(d => ({ ...d, busNo: d.busId ? (busMap[d.busId] || null) : null }));
    res.json({ success: true, drivers: enriched });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getDriverById = async (req, res) => {
  try {
    const driver = await prisma.driver.findUnique({ where: { id: req.params.id } });
    if (!driver) return res.status(404).json({ message: 'Driver not found' });
    res.json({ success: true, driver });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ── CREATE — this endpoint was MISSING entirely. This is the actual
// root cause of "driver saves in backend but never shows in admin UI":
// there was no POST handler, so the create request had nowhere to go. ──
const createDriver = async (req, res) => {
  try {
    const { name, phone, licenseNo, licenseExpiry, experience, busId } = req.body;
    console.log('[ADMIN] Driver create payload:', req.body);

    if (!name || !phone) {
      return res.status(400).json({ message: 'Name and phone are required' });
    }

    // Prevent duplicate driver on same phone
    const existingPhone = await prisma.driver.findFirst({ where: { phone } });
    if (existingPhone) {
      return res.status(400).json({ message: `Driver with phone ${phone} already exists` });
    }

    // If a bus is being assigned at creation time, enforce one-active-driver-per-bus
    if (busId) {
      const conflict = await prisma.driver.findFirst({ where: { busId } });
      if (conflict) {
        return res.status(400).json({ message: 'This bus is already assigned to another active driver.' });
      }
    }

    const driver = await prisma.driver.create({
      data: {
        name,
        phone,
        licenseNo: licenseNo || null,
        licenseExpiry: licenseExpiry || null,
        experience: parseInt(experience) || 0,
        busId: busId || null,
      },
    });

    console.log('[ADMIN] Driver created:', driver);
    res.status(201).json({ success: true, driver });
  } catch (err) {
    console.log('[ADMIN] Driver create error:', err.message);
    res.status(500).json({ message: err.message });
  }
};

const updateDriver = async (req, res) => {
  try {
    const { name, phone, licenseNo, licenseExpiry, experience } = req.body;
    const driver = await prisma.driver.update({
      where: { id: req.params.id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(phone !== undefined ? { phone } : {}),
        ...(licenseNo !== undefined ? { licenseNo } : {}),
        ...(licenseExpiry !== undefined ? { licenseExpiry } : {}),
        ...(experience !== undefined ? { experience: parseInt(experience) || 0 } : {}),
      },
    });
    res.json({ success: true, driver });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const deleteDriver = async (req, res) => {
  try {
    await prisma.driver.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ── ASSIGN / REASSIGN a bus to a driver — dedicated endpoint so the
// UI can show a specific conflict message instead of a generic error. ──
const assignBus = async (req, res) => {
  try {
    const { busId } = req.body; // busId: null/''/undefined = unassign
    const driverId = req.params.id;

    if (busId) {
      const bus = await prisma.bus.findUnique({ where: { id: busId } });
      if (!bus) return res.status(404).json({ message: 'Bus not found' });

      const conflict = await prisma.driver.findFirst({
        where: { busId, id: { not: driverId } },
      });
      if (conflict) {
        return res.status(400).json({ message: 'This bus is already assigned to another active driver.' });
      }
    }

    const driver = await prisma.driver.update({
      where: { id: driverId },
      data: { busId: busId || null },
    });

    console.log('[ADMIN] Driver', driverId, 'assigned to bus', busId);
    res.json({ success: true, driver });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = { getDrivers, getDriverById, createDriver, updateDriver, deleteDriver, assignBus };