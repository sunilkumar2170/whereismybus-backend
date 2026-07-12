const express = require('express');
const router = express.Router();
const { register, login, adminLogin } = require('../controllers/authController');

router.post('/register', register);s
router.post('/login', login);
router.post('/admin-login', adminLogin);

module.exports = router;