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

const authRoutes = require('./routes/authRoutes');
app.use('/api/auth', authRoutes);

const busRoutes = require('./routes/busRoutes');
app.use('/api/buses', busRoutes);

const tripRoutes = require('./routes/tripRoutes');
app.use('/api/trips', tripRoutes);

const stopRoutes = require('./routes/stopRoutes');
app.use('/api/stops', stopRoutes);

// ✅ Notification Route ADD KIYA
const notificationRoutes = require('./routes/notificationRoutes');
app.use('/api/notifications', notificationRoutes);

// ✅ Naye Routes ADD KIYE
const driverRoutes = require('./routes/driverRoutes');
app.use('/api/drivers', driverRoutes);

const studentRoutes = require('./routes/studentRoutes');
app.use('/api/students', studentRoutes);

const attendanceRoutes = require('./routes/attendanceRoutes');
app.use('/api/attendance', attendanceRoutes);

const maintenanceRoutes = require('./routes/maintenanceRoutes');
app.use('/api/maintenance', maintenanceRoutes);

const fuelRoutes = require('./routes/fuelRoutes');
app.use('/api/fuel', fuelRoutes);

const sosRoutes = require('./routes/sosRoutes');
app.use('/api/sos', sosRoutes);


const adminRoutes = require('./routes/adminRoutes');
app.use('/api', adminRoutes);

// ✅ Test SOS Route
app.post('/api/test-sos', async (req, res) => {
  try {
    const { busId } = req.body;
    const { sendMulticast } = require('./services/notificationService');

    const parents = await prisma.user.findMany({
      where: { role: 'PARENT', fcmToken: { not: null } }
    });

    const tokens = parents.map(p => p.fcmToken).filter(Boolean);
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