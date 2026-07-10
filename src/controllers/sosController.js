const prisma = require('../db');

const getSosAlerts = async (req, res) => {
  try {
    const alerts = await prisma.sosAlert.findMany({ orderBy: { createdAt: 'desc' } });
    res.json({ success: true, alerts });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

const createSosAlert = async (req, res) => {
  try {
    const { busId, driverName, message } = req.body;
    const alert = await prisma.sosAlert.create({
      data: { busId, driverName: driverName||'', message: message||'SOS Emergency!', status: 'OPEN' },
    });
    res.json({ success: true, alert });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

const updateSosStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const alert = await prisma.sosAlert.update({
      where: { id: req.params.id },
      data: { status },
    });
    res.json({ success: true, alert });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

module.exports = { getSosAlerts, createSosAlert, updateSosStatus };
