const jwt = require('jsonwebtoken');
const prisma = require('../db');

const JWT_SECRET = 'whereismybus_secret_2026'; // sabke liye same secret

// ── Parent ya Driver ke login/register response mein busId attach karo ──
const attachBusInfo = async (user) => {
  try {
    // ── PARENT ── uska student dhoondo, wahi bus + route mil jaayega
    if (user.role === 'PARENT') {
      const rows = await prisma.$queryRaw`
        SELECT s.id as "studentId", s.name as "studentName", s."busId",
               s."routeId", s.class, s."stopId", b."busNo"
        FROM "Student" s
        LEFT JOIN "Bus" b ON b.id = s."busId"
        WHERE s."parentPhone" = ${user.phone}
        LIMIT 1
      `;
      const student = rows[0];
      if (student) {
        return {
          ...user,
          studentId:   student.studentId,
          studentName: student.studentName,
          busId:       student.busId,
          busNo:       student.busNo,
          routeId:     student.routeId,
          stopId:      student.stopId,
          class:       student.class,
        };
      }
      return { ...user, busId: null, studentId: null };
    }

    // ── DRIVER / CONDUCTOR ── admin ne Driver table mein jo bus assign kiya hai
    if (user.role === 'DRIVER' || user.role === 'CONDUCTOR') {
      const rows = await prisma.$queryRaw`
        SELECT d."busId", b."busNo"
        FROM "Driver" d
        LEFT JOIN "Bus" b ON b.id = d."busId"
        WHERE d.phone = ${user.phone}
        LIMIT 1
      `;
      const driver = rows[0];
      if (driver && driver.busId) {
        return { ...user, busId: driver.busId, busNo: driver.busNo };
      }
      return { ...user, busId: null, busNo: null };
    }

    // ── ADMIN ── kuch attach nahi karna
    return user;

  } catch (err) {
    console.log('attachBusInfo error:', err.message);
    return { ...user, busId: null };
  }
};

const register = async (req, res) => {
  try {
    const { phone, name, role } = req.body;
    const existing = await prisma.user.findUnique({ where: { phone } });
    if (existing) {
      return res.status(400).json({ message: 'User already exists' });
    }
    const user = await prisma.user.create({
      data: { phone, name, role: role || 'PARENT' }
    });
    const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });

    const fullUser = await attachBusInfo(user);
    res.status(201).json({ success: true, token, user: fullUser });
  } catch (err) {
    console.log('Register Error:', err.message);
    res.status(500).json({ message: err.message });
  }
};

const login = async (req, res) => {
  try {
    const { phone } = req.body;
    const user = await prisma.user.findUnique({ where: { phone } });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });

    const fullUser = await attachBusInfo(user);
    res.json({ success: true, token, user: fullUser });
  } catch (err) {
    console.log('Login Error:', err.message);
    res.status(500).json({ message: err.message });
  }
};

const adminLogin = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: 'Email aur password dono chahiye' });
    }

    const rows = await prisma.$queryRaw`
      SELECT * FROM "Admin" WHERE email = ${email} LIMIT 1
    `;
    const admin = rows[0];
    if (!admin) return res.status(401).json({ message: 'Admin not found' });
    if (admin.password !== password) return res.status(401).json({ message: 'Wrong password' });

    const token = jwt.sign({ id: admin.id, role: 'ADMIN' }, JWT_SECRET, { expiresIn: '30d' });
    res.json({
      success: true,
      token,
      user: { id: admin.id, email: admin.email, name: admin.name, role: 'ADMIN' }
    });
  } catch (err) {
    console.log('Admin Login Error:', err.message);
    res.status(500).json({ message: err.message });
  }
};

// ⚠️ IMPORTANT: teeno ko yahan ek saath export karo — alag se "exports.x = " mat likhna
module.exports = { register, login, adminLogin };