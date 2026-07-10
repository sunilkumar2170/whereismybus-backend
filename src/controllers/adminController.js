const prisma = require('../db');

// ── STUDENTS ──
const getStudents = async (req, res) => {
  try {
    const students = await prisma.$queryRaw`SELECT * FROM "Student" ORDER BY "createdAt" DESC`;
    res.json({ success: true, students });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

const addStudent = async (req, res) => {
  try {
    const { name, admissionNo, busId, parentPhone, class: cls, stopId } = req.body;
    if (!name || !busId || !parentPhone) return res.status(400).json({ message: 'Name, busId, parentPhone required' });
    const r = await prisma.$queryRaw`
      INSERT INTO "Student" ("name","admissionNo","busId","parentPhone","class","stopId")
      VALUES (${name},${admissionNo||''},${busId},${parentPhone},${cls||''},${stopId||null})
      RETURNING *`;
    res.json({ success: true, student: r[0] });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

const deleteStudent = async (req, res) => {
  try {
    await prisma.$executeRaw`DELETE FROM "Student" WHERE id = ${req.params.id}`;
    res.json({ success: true });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

// ── DRIVERS ──
const getDrivers = async (req, res) => {
  try {
    const drivers = await prisma.$queryRaw`SELECT * FROM "Driver" ORDER BY "createdAt" DESC`;
    res.json({ success: true, drivers });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

const addDriver = async (req, res) => {
  try {
    const { name, phone, licenseNo, licenseExpiry, busId, experience } = req.body;
    if (!name || !phone) return res.status(400).json({ message: 'Name and phone required' });
    const r = await prisma.$queryRaw`
      INSERT INTO "Driver" ("name","phone","licenseNo","licenseExpiry","busId","experience")
      VALUES (${name},${phone},${licenseNo||''},${licenseExpiry||null},${busId||null},${experience||0})
      RETURNING *`;
    res.json({ success: true, driver: r[0] });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

const deleteDriver = async (req, res) => {
  try {
    await prisma.$executeRaw`DELETE FROM "Driver" WHERE id = ${req.params.id}`;
    res.json({ success: true });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

// ── ATTENDANCE ──
const getAttendance = async (req, res) => {
  try {
    const attendance = await prisma.$queryRaw`SELECT * FROM "Attendance" ORDER BY "createdAt" DESC LIMIT 100`;
    res.json({ success: true, attendance });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

const markAttendance = async (req, res) => {
  try {
    const { busId, studentId, date, tripType, boarded } = req.body;
    if (!busId || !studentId) return res.status(400).json({ message: 'busId and studentId required' });
    const r = await prisma.$queryRaw`
      INSERT INTO "Attendance" ("busId","studentId","date","tripType","boarded")
      VALUES (${busId},${studentId},${date},${tripType||'pickup'},${boarded||false})
      RETURNING *`;
    res.json({ success: true, attendance: r[0] });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

// ── EMERGENCY ──
const getEmergencies = async (req, res) => {
  try {
    const emergencies = await prisma.$queryRaw`SELECT * FROM "Emergency" ORDER BY "createdAt" DESC`;
    res.json({ success: true, emergencies });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

const addEmergency = async (req, res) => {
  try {
    const { busId, driverName, type, notes } = req.body;
    if (!busId) return res.status(400).json({ message: 'busId required' });
    const r = await prisma.$queryRaw`
      INSERT INTO "Emergency" ("busId","driverName","type","notes","status")
      VALUES (${busId},${driverName||''},${type||'SOS'},${notes||''},'open')
      RETURNING *`;
    res.json({ success: true, emergency: r[0] });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

const deleteEmergency = async (req, res) => {
  try {
    await prisma.$executeRaw`DELETE FROM "Emergency" WHERE id = ${req.params.id}`;
    res.json({ success: true });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

module.exports = {
  getStudents, addStudent, deleteStudent,
  getDrivers, addDriver, deleteDriver,
  getAttendance, markAttendance,
  getEmergencies, addEmergency, deleteEmergency,
};
