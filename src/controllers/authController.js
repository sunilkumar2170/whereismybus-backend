const jwt = require('jsonwebtoken');
const prisma = require('../db');

const JWT_SECRET = 'whereismybus_secret_2026'; // sabke liye same secret

// ── Normalize a phone number for comparison: strip everything except
// digits, then keep the last 10 digits. Handles "+91 96800 02257",
// "919680002257", "9680002257" etc. all matching the same person. ──
const normalizePhone = (p) => {
  if (!p) return '';
  const digits = String(p).replace(/\D/g, '');
  return digits.slice(-10);
};

// ── Parent ya Driver ke login/register response mein busId attach karo ──
// IMPORTANT: this must be called with `user.role` already set to the
// role the person is CURRENTLY logging in as. If role is stale (e.g. a
// user row created earlier under a different role), busId will be
// attached for the WRONG role — that was the root cause of the
// "existing driver shows No Bus Assigned" bug.
const attachBusInfo = async (user) => {
  try {
    console.log('[attachBusInfo] role:', user.role, 'phone:', user.phone);

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

    // ── DRIVER / CONDUCTOR ── admin ne Driver table mein jo bus assign
    // kiya hai. Match on a NORMALIZED phone so formatting differences
    // between the Admin panel (e.g. "+91 96800 02257") and the app's
    // OTP login (e.g. "9680002257") don't cause a false "no match".
    if (user.role === 'DRIVER' || user.role === 'CONDUCTOR') {
      const normalized = normalizePhone(user.phone);

      const rows = await prisma.$queryRaw`
        SELECT d.id as "driverId", d.name as "driverName", d.phone as "driverPhone",
               d."busId", b."busNo"
        FROM "Driver" d
        LEFT JOIN "Bus" b ON b.id = d."busId"
        WHERE regexp_replace(d.phone, '\\D', '', 'g') LIKE '%' || ${normalized}
        LIMIT 1
      `;
      const driver = rows[0];

      console.log('[LOGIN] existing driver:', driver);
      console.log('[LOGIN] driver id:', driver?.driverId);
      console.log('[LOGIN] driver busId:', driver?.busId);

      if (driver && driver.busId) {
        return {
          ...user,
          driverId: driver.driverId,
          name:     driver.driverName || user.name, // prefer admin-entered driver name
          busId:    driver.busId,
          busNo:    driver.busNo,
        };
      }
      // driver row exists but no bus assigned yet, or no driver row at all
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
    console.log('[REGISTER] selected role:', role);
    console.log('[REGISTER] name:', name);
    console.log('[REGISTER] phone:', phone);

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
    // `role` = the role the person tapped on the Login screen THIS time.
    // We keep User.role in sync with it before attaching bus info, so
    // an existing driver logging in as Driver always gets their busId,
    // even if their User row was created/last-used under a different role.
    const { phone, role, name } = req.body;
    console.log('[LOGIN] selected role:', role);
    console.log('[LOGIN] name:', name);
    console.log('[LOGIN] phone:', phone);

    let user = await prisma.user.findUnique({ where: { phone } });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (role && user.role !== role) {
      console.log(`[LOGIN] syncing role for ${phone}: ${user.role} -> ${role}`);
      user = await prisma.user.update({
        where: { id: user.id },
        data: { role },
      });
    }

    const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });

    const fullUser = await attachBusInfo(user);
    console.log('[LOGIN] final user payload:', fullUser);
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