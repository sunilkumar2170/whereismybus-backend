const { sendNotification } = require('../services/notificationService');

// Mark attendance — fixed upsert with real-time Parent notification
const markAttendance = async (req, res) => {
  try {
    const { studentId, busId, date, tripType, boarded } = req.body;
    if (!studentId || !busId || !date)
      return res.status(400).json({ message: 'studentId, busId, date required' });

    const trip = tripType || 'PICKUP';

    // Check if exists
    const existing = await prisma.attendance.findFirst({
      where: { studentId, busId, date, tripType: trip },
    });

    let attendance;
    if (existing) {
      attendance = await prisma.attendance.update({
        where: { id: existing.id },
        data: { boarded: boarded ?? false },
      });
    } else {
      attendance = await prisma.attendance.create({
        data: { studentId, busId, date, tripType: trip, boarded: boarded ?? false },
      });
    }

    // Send push notification to Parent
    try {
      const student = await prisma.student.findUnique({ where: { id: studentId } });
      if (student && student.parentPhone) {
        const parentUser = await prisma.user.findFirst({
          where: { phone: student.parentPhone, fcmToken: { not: null } },
        });
        if (parentUser && parentUser.fcmToken) {
          const statusText = boarded ? '🚌 Boarded Bus' : '❌ Absent / Not Boarded';
          sendNotification(
            parentUser.fcmToken,
            `Student Update: ${student.name}`,
            `${student.name} is marked as ${statusText} for trip (${trip})`,
            { studentId, busId, boarded: String(boarded) }
          ).catch(e => console.log('Attendance notify error:', e.message));
        }
      }
    } catch (e) {
      console.log('Parent lookup error:', e.message);
    }

    res.json({ success: true, attendance });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET attendance by bus + date
const getAttendance = async (req, res) => {
  try {
    const { busId, date } = req.query;
    const attendance = await prisma.attendance.findMany({
      where: {
        busId: busId || undefined,
        date: date || new Date().toISOString().split('T')[0],
      },
    });
    res.json({ success: true, attendance });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = { markAttendance, getAttendance };