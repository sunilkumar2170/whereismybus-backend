const prisma = require('../db');
const { sendMulticast } = require('../services/notificationService');

const getSosAlerts = async (req, res) => {
  try {
    const alerts = await prisma.emergency.findMany({ orderBy: { createdAt: 'desc' } });
    res.json({ success: true, alerts });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

const createSosAlert = async (req, res) => {
  try {
    const { busId, driverName, message, notes } = req.body;
    if (!busId) return res.status(400).json({ message: 'busId required' });

    const alert = await prisma.emergency.create({
      data: { busId, driverName: driverName || 'Driver', notes: notes || message || 'SOS Emergency!', status: 'open' },
    });

    // FCM Notification to Parents of this bus
    try {
      const parentRows = await prisma.$queryRaw`
        SELECT DISTINCT u."fcmToken"
        FROM "Student" s
        JOIN "User" u ON u.phone = s."parentPhone"
        WHERE s."busId" = ${busId} AND u."fcmToken" IS NOT NULL
      `;
      const tokens = parentRows.map(r => r.fcmToken).filter(Boolean);
      if (tokens.length > 0) {
        sendMulticast(
          tokens,
          '🚨 SOS EMERGENCY ALERT!',
          `Emergency alert triggered on Bus ${busId}! Driver: ${driverName || 'Driver'}`,
          { busId, type: 'SOS' }
        ).catch(e => console.log('SOS push error:', e.message));
      }
    } catch (e) {
      console.log('SOS notify error:', e.message);
    }

    res.json({ success: true, alert });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

const updateSosStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const alert = await prisma.emergency.update({
      where: { id: req.params.id },
      data: { status },
    });
    res.json({ success: true, alert });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

module.exports = { getSosAlerts, createSosAlert, updateSosStatus };
