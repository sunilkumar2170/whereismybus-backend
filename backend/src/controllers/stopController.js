const prisma = require('../db');

// ── LEGACY — kept exactly as it was (GET /api/stops/:busId), so any
// existing caller (old DriverScreen fallback, etc.) keeps working
// unchanged. Returns stops for ONE bus, ordered. ──
const getStops = async (req, res) => {
  try {
    const { busId } = req.params;
    const stops = await prisma.stop.findMany({
      where: { busId },
      orderBy: { order: 'asc' },
    });
    res.json({ success: true, stops });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ── NEW — all stops across all buses, for the Admin dashboard's
// "Stops" tab and bus-card previews (avoids one request per bus). ──
const getAllStops = async (req, res) => {
  try {
    const stops = await prisma.stop.findMany({ orderBy: [{ busId: 'asc' }, { order: 'asc' }] });
    res.json({ success: true, stops });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ── NEW — Admin "Add Stop". Stops belong directly to a Bus (Stop.busId)
// — there is no Route model in the schema, so a stop's "route" IS just
// that bus's ordered stop list. Order is auto-assigned (end of list). ──
const createStop = async (req, res) => {
  try {
    const { busId, name, lat, lng } = req.body;
    if (!busId || !name || lat === undefined || lng === undefined) {
      return res.status(400).json({ message: 'busId, name, lat, lng are required' });
    }
    const bus = await prisma.bus.findUnique({ where: { id: busId } });
    if (!bus) return res.status(404).json({ message: 'Bus not found' });

    const count = await prisma.stop.count({ where: { busId } });
    const stop = await prisma.stop.create({
      data: { busId, name, lat: parseFloat(lat), lng: parseFloat(lng), order: count + 1 },
    });
    res.status(201).json({ success: true, stop });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ── NEW — delete a stop, then close the order gap for the remaining
// stops on that bus so order stays a clean 1..N sequence. ──
const deleteStop = async (req, res) => {
  try {
    const stop = await prisma.stop.findUnique({ where: { id: req.params.id } });
    if (!stop) return res.status(404).json({ message: 'Stop not found' });
    await prisma.stop.delete({ where: { id: req.params.id } });

    const remaining = await prisma.stop.findMany({
      where: { busId: stop.busId }, orderBy: { order: 'asc' },
    });
    await Promise.all(remaining.map((s, i) =>
      s.order !== i + 1 ? prisma.stop.update({ where: { id: s.id }, data: { order: i + 1 } }) : null
    ));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ── NEW — reorder: frontend sends the FULL ordered list of stop ids
// for a bus, we assign 1..N. Simpler and race-free vs swap-two-at-a-time. ──
const reorderStops = async (req, res) => {
  try {
    const { busId, stopIds } = req.body;
    if (!busId || !Array.isArray(stopIds)) {
      return res.status(400).json({ message: 'busId and stopIds[] are required' });
    }
    await Promise.all(stopIds.map((id, i) =>
      prisma.stop.update({ where: { id }, data: { order: i + 1 } })
    ));
    const stops = await prisma.stop.findMany({ where: { busId }, orderBy: { order: 'asc' } });
    res.json({ success: true, stops });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = { getStops, getAllStops, createStop, deleteStop, reorderStops };