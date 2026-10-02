const express = require('express');
const router = express.Router();
const { register, login, adminLogin, updateFcmToken } = require('../controllers/authController');

router.post('/register', register);
router.post('/login', login);
router.post('/admin-login', adminLogin);
router.post('/fcm-token', updateFcmToken);

module.exports = router;