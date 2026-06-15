const jwt = require('jsonwebtoken');
const prisma = require('../db');

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
    const token = jwt.sign(
      { id: user.id, role: user.role },
      'whereismybus_secret_2026',
      { expiresIn: '7d' }
    );
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
    const token = jwt.sign(
      { id: user.id, role: user.role },
      'whereismybus_secret_2026',
      { expiresIn: '7d' }
    );
    res.json({ success: true, token, user });
  } catch (err) {
    console.log('Login Error:', err.message);
    res.status(500).json({ message: err.message });
  }
};

module.exports = { register, login };