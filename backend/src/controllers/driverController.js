const prisma = require('../db');

const getDrivers = async (req, res) => {
  try {
    console.log('[DRIVER] getDrivers: start');
    const drivers = await prisma.driver.findMany({ orderBy: { name: 'asc' } });
    console.log('[DRIVER] getDrivers: fetched', drivers.length, 'drivers');
    const busIds = [...new Set(drivers.map(d => d.busId).filter(Boolean))];
    const buses = busIds.length
      ? await prisma.bus.findMany({ where: { id: { in: busIds } } })
      : [];
    const busMap = Object.fromEntries(buses.map(b => [b.id, b.busNo]));
    const enriched = drivers.map(d => ({ ...d, busNo: d.busId ? (busMap[d.busId] || null) : null }));
    console.log('[DRIVER] getDrivers: done');
    res.json({ success: true, drivers: enriched });
  } catch (err) {
    console.log('[DRIVER] getDrivers: ERROR', err.message);
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

const createDriver = async (req, res) => {
  console.log('[DRIVER] createDriver: ENTRY', req.body);
  try {
    const { name, phone, licenseNo, licenseExpiry, experience, busId } = req.body;

    if (!name || !phone) {
      console.log('[DRIVER] createDriver: missing name/phone, returning 400');
      return res.status(400).json({ message: 'Name and phone are required' });
    }

    console.log('[DRIVER] createDriver: checking existing phone...');
    const existingPhone = await prisma.driver.findFirst({ where: { phone } });
    console.log('[DRIVER] createDriver: existingPhone check done ->', !!existingPhone);

    if (existingPhone) {
      console.log('[DRIVER] createDriver: duplicate phone, returning 400');
      return res.status(400).json({ message: `Driver with phone ${phone} already exists` });
    }

    if (busId) {
      console.log('[DRIVER] createDriver: checking bus conflict for busId', busId);
      const conflict = await prisma.driver.findFirst({ where: { busId } });
      console.log('[DRIVER] createDriver: bus conflict check done ->', !!conflict);
      if (conflict) {
        console.log('[DRIVER] createDriver: bus already assigned, returning 400');
        return res.status(400).json({ message: 'This bus is already assigned to another active driver.' });
      }
    }

    console.log('[DRIVER] createDriver: creating row now...');
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
    console.log('[DRIVER] createDriver: CREATED SUCCESSFULLY', driver.id);

    res.status(201).json({ success: true, driver });
    console.log('[DRIVER] createDriver: response sent');
  } catch (err) {
    console.log('[DRIVER] createDriver: EXCEPTION CAUGHT ->', err.message, err.stack);
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

const assignBus = async (req, res) => {
  try {
    const { busId } = req.body;
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

    res.json({ success: true, driver });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = { getDrivers, getDriverById, createDriver, updateDriver, deleteDriver, assignBus };