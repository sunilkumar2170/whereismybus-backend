require('dotenv').config({ path: '../.env' });
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const prisma = require('./db');
const gpsSocket = require('./sockets/gpsSocket');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ message: 'Where Is My Bus Backend Running ✅' });
});

prisma.$connect()
  .then(() => console.log('Database Connected ✅'))
  .catch(err => console.log('DB Error:', err.message));

// ── Auth ──
const authRoutes = require('./routes/authRoutes');
app.use('/api/auth', authRoutes);

// ── Bus ──
const busRoutes = require('./routes/busRoutes');
app.use('/api/buses', busRoutes);

// ── Trip ──
const tripRoutes = require('./routes/tripRoutes');
app.use('/api/trips', tripRoutes);

// ── Stop (legacy flat table — kept for backward compat) ──
const stopRoutes = require('./routes/stopRoutes');
app.use('/api/stops', stopRoutes);

// ── Notifications ──
const notificationRoutes = require('./routes/notificationRoutes');
app.use('/api/notifications', notificationRoutes);

// ── Driver ──
const driverRoutes = require('./routes/driverRoutes');
app.use('/api/drivers', driverRoutes);

// ── Student ──
const studentRoutes = require('./routes/studentRoutes');
app.use('/api/students', studentRoutes);

// ── Attendance ──
const attendanceRoutes = require('./routes/attendanceRoutes');
app.use('/api/attendance', attendanceRoutes);

// ── Maintenance ──
const maintenanceRoutes = require('./routes/maintenanceRoutes');
app.use('/api/maintenance', maintenanceRoutes);

// ── Fuel ──
const fuelRoutes = require('./routes/fuelRoutes');
app.use('/api/fuel', fuelRoutes);

// ── SOS ──
const sosRoutes = require('./routes/sosRoutes');
app.use('/api/sos', sosRoutes);

// ── Route (Bus → Route → RouteStop) + Admin ──
// (Yeh dono ek hi baar declare hote hain — pehle duplicate tha, isliye crash ho raha tha)
const routeRoutes = require('./routes/routeRoutes');
const adminRoutes  = require('./routes/adminRoutes');

app.use('/api/routes', routeRoutes);
app.use('/api', adminRoutes);

// ✅ Test SOS Route
app.post('/api/test-sos', async (req, res) => {
  try {
    const { busId } = req.body;
    const { sendMulticast } = require('./services/notificationService');

    const users = await prisma.user.findMany({
      where: { fcmToken: { not: null } }
    });

    const tokens = users.map(p => p.fcmToken).filter(Boolean);
    console.log('Tokens found:', tokens.length);

    if (tokens.length > 0) {
      await sendMulticast(
        tokens,
        '🚨 SOS EMERGENCY!',
        `Bus ${busId} mein emergency!`,
        { busId, type: 'SOS' }
      );
      res.json({ success: true, message: 'Notification sent!', tokenCount: tokens.length });
    } else {
      res.json({ success: false, message: 'Koi token nahi mila database mein' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GPS Socket
gpsSocket(io);

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT} ✅`));