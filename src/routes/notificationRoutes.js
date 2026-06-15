const express = require('express');
const router = express.Router();
const { sendNotification, sendMulticast } = require('../services/notificationService');
const prisma = require('../db');

// Token save karo
router.post('/save-token', async (req, res) => {
  try {
    const { phone, fcmToken } = req.body;
    await prisma.user.update({
      where: { phone },
      data: { fcmToken }
    });
    res.json({ success: true, message: 'Token saved!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Notification bhejo
router.post('/send', async (req, res) => {
  try {
    const { token, title, body } = req.body;
    await sendNotification(token, title, body);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;