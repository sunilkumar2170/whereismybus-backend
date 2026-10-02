const prisma = require('../db');

const getFuelLogs = async (req, res) => {
  try {
    const logs = await prisma.fuelLog.findMany({ orderBy: { date: 'desc' } });
    res.json({ success: true, logs });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

const addFuelLog = async (req, res) => {
  try {
    const { busId, litres, cost, odometer, date } = req.body;
    if (!busId || !litres) return res.status(400).json({ message: 'busId and litres required' });
    const log = await prisma.fuelLog.create({
      data: { busId, litres: parseFloat(litres), cost: parseFloat(cost)||0, odometer: parseFloat(odometer)||0, date: date||new Date().toISOString() },
    });
    res.json({ success: true, log });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

const deleteFuelLog = async (req, res) => {
  try {
    await prisma.fuelLog.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

module.exports = { getFuelLogs, addFuelLog, deleteFuelLog };
