const express = require('express');
const router = express.Router();
const { register, login } = require('../controllers/authController');

router.post('/register', register);
router.post('/login', login);
router.post('/admin-login', authController.adminLogin);

module.exports = router;
