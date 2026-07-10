const prisma = require('../db');

const getMaintenanceLogs = async (req, res) => {
  try {
    const logs = await prisma.maintenanceLog.findMany({ orderBy: { date: 'desc' } });
    res.json({ success: true, logs });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

const addMaintenanceLog = async (req, res) => {
  try {
    const { busId, type, cost, date, nextDue, notes } = req.body;
    if (!busId || !type) return res.status(400).json({ message: 'busId and type required' });
    const log = await prisma.maintenanceLog.create({
      data: { busId, type, cost: parseFloat(cost)||0, date: date||new Date().toISOString(), nextDue: nextDue||null, notes: notes||'' },
    });
    res.json({ success: true, log });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

const deleteMaintenanceLog = async (req, res) => {
  try {
    await prisma.maintenanceLog.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

module.exports = { getMaintenanceLogs, addMaintenanceLog, deleteMaintenanceLog };
