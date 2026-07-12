const jwt = require('jsonwebtoken');
const prisma = require('../db');

const JWT_SECRET = 'whereismybus_secret_2026'; // sabke liye same secret

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
    res.status(201).json({ success: true, token, user });
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
    res.json({ success: true, token, user });
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