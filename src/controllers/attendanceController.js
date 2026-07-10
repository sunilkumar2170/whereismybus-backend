const prisma = require('../db');

// Mark attendance
const markAttendance = async (req, res) => {
  try {
    const { studentId, busId, date, tripType, boarded } = req.body;
    if (!studentId || !busId || !date)
      return res.status(400).json({ message: 'studentId, busId, date required' });
    const attendance = await prisma.attendance.upsert({
      where: { studentId_busId_date_tripType: { studentId, busId, date, tripType: tripType||'PICKUP' } },
      update: { boarded },
      create: { studentId, busId, date, tripType: tripType||'PICKUP', boarded: boarded||false },
    });
    res.json({ success: true, attendance });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

// GET attendance by bus + date
const getAttendance = async (req, res) => {
  try {
    const { busId, date } = req.query;
    const attendance = await prisma.attendance.findMany({
      where: { busId, date: date || new Date().toISOString().split('T')[0] },
      include: { student: true },
    });
    res.json({ success: true, attendance });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

module.exports = { markAttendance, getAttendance };
