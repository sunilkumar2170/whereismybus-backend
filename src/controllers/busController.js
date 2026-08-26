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

// ── NEW — Parent screen ke liye ek hi call mein sab kuch: busNo,
// driver{name,phone} (Driver table se, busId match), stops[] (Admin ne
// jo add kiye, order se sorted), latest live location, aur trip status
// (Bus.status: ACTIVE/INACTIVE/ON_TRIP). Schema mein alag Route/Trip
// model nahi hai, isliye ye sab yahin se milta hai. ──
const getBusFullInfo = async (req, res) => {
  try {
    const { busId } = req.params;
    if (!busId) return res.status(400).json({ message: 'busId required' });

    const bus = await prisma.bus.findUnique({ where: { id: busId } });
    if (!bus) return res.status(404).json({ message: 'Bus not found' });

    const driver = await prisma.driver.findFirst({ where: { busId } });

    const stops = await prisma.stop.findMany({
      where: { busId },
      orderBy: { order: 'asc' },
    });

    const liveLocation = await prisma.liveLocation.findFirst({
      where: { busId },
      orderBy: { timestamp: 'desc' },
    });

    res.json({
      busId: bus.id,
      busNo: bus.busNo,
      status: bus.status,              // 'ACTIVE' | 'INACTIVE' | 'ON_TRIP'
      tripActive: bus.status === 'ON_TRIP',
      driver: driver
        ? { name: driver.name, phone: driver.phone }
        : null,                        // null => "Driver not assigned"
      stops: stops.map(s => ({
        id: s.id, name: s.name, lat: s.lat, lng: s.lng, order: s.order,
      })),
      liveLocation: liveLocation
        ? {
            lat: liveLocation.lat,
            lng: liveLocation.lng,
            speed: liveLocation.speed,
            timestamp: liveLocation.timestamp,
          }
        : null,                        // null => "Location unavailable"
    });
  } catch (err) {
    console.log('getBusFullInfo error:', err.message);
    res.status(500).json({ message: err.message });
  }
};

module.exports = { createBus, getAllBuses, getBusLocation, getBusFullInfo };