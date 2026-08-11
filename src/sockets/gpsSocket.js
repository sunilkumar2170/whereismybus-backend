const prisma = require('../db');
const { sendMulticast } = require('../services/notificationService');

// ── Helper: sirf usi bus ke students ke parents ke FCM tokens lao ──
const getParentTokensForBus = async (busId) => {
  try {
    const rows = await prisma.$queryRaw`
      SELECT DISTINCT u."fcmToken"
      FROM "Student" s
      JOIN "User" u ON u.phone = s."parentPhone"
      WHERE s."busId" = ${busId} AND u."fcmToken" IS NOT NULL
    `;
    return rows.map(r => r.fcmToken).filter(Boolean);
  } catch (err) {
    console.log('getParentTokensForBus error:', err.message);
    return [];
  }
};

const getAdminTokens = async () => {
  const admins = await prisma.user.findMany({
    where: { role: 'ADMIN', fcmToken: { not: null } }
  });
  return admins.map(a => a.fcmToken).filter(Boolean);
};

const gpsSocket = (io) => {
  io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    // ── PARENT apne bus ke room mein join karta hai ──
    socket.on('joinBus', ({ busId }) => {
      if (!busId) return;
      socket.join(`bus_${busId}`);
      socket.data.busId = busId;
      console.log(`Parent ${socket.id} joined room: bus_${busId}`);
    });

    // ── DRIVER apne bus ke room mein join karta hai ──
    socket.on('joinAsDriver', ({ busId }) => {
      if (!busId) return;
      socket.join(`bus_${busId}`);
      socket.data.busId = busId;
      socket.data.isDriver = true;
      console.log(`Driver ${socket.id} joined room: bus_${busId}`);
    });

    // ── ADMIN sab updates dekhne ke liye admins room join kare ──
    socket.on('joinAsAdmin', () => {
      socket.join('admins');
      console.log(`Admin ${socket.id} joined admins room`);
    });

    // ── Driver GPS bhejta hai — SIRF usi bus ke room ko jaata hai ──
    socket.on('sendLocation', async (data) => {
      const { busId, lat, lng, speed } = data;
      if (!busId) return;

      try {
        const parsedLat = parseFloat(lat);
        const parsedLng = parseFloat(lng);
        const parsedSpeed = parseFloat(speed) || 0;

        // Database mein save karo
        await prisma.liveLocation.create({
          data: { busId, lat: parsedLat, lng: parsedLng, speed: parsedSpeed }
        });

        // ✅ SIRF isi bus ke room ko broadcast — poore server ko nahi
        io.to(`bus_${busId}`).emit('locationUpdate', { busId, lat: parsedLat, lng: parsedLng, speed: parsedSpeed });

        // Admin panel ko bhi live update chahiye ho to
        io.to('admins').emit('locationUpdate', { busId, lat: parsedLat, lng: parsedLng, speed: parsedSpeed });

        // Speed alert — 60+ pe sirf admin ko notify karo
        if (parsedSpeed > 60) {
          const adminTokens = await getAdminTokens();
          if (adminTokens.length > 0) {
            await sendMulticast(
              adminTokens,
              '⚠️ Speed Alert!',
              `Bus ${busId} overspeeding — ${parsedSpeed} km/h`,
              { busId, type: 'SPEED_ALERT', speed: String(parsedSpeed) }
            );
          }
        }

        console.log(`Bus ${busId} -> ${parsedLat}, ${parsedLng} @ ${parsedSpeed}km/h [room: bus_${busId}]`);
      } catch (err) {
        console.log('GPS Error:', err.message);
      }
    });

    // ── Driver trip start karta hai ──
    socket.on('startTrip', async (data) => {
      const { busId } = data;
      if (!busId) return;
      try {
        await prisma.bus.update({
          where: { id: busId },
          data: { status: 'ON_TRIP' }
        });

        // ✅ Sirf isi bus ke students ke parents ko notify karo
        const tokens = await getParentTokensForBus(busId);
        if (tokens.length > 0) {
          await sendMulticast(
            tokens,
            '🚌 Bus Trip Started!',
            `Aapki bus ne apna safar shuru kar diya.`,
            { busId, type: 'TRIP_STARTED' }
          );
        }

        io.to(`bus_${busId}`).emit('tripStarted', { busId });
        io.to('admins').emit('tripStarted', { busId });
        console.log(`Trip started: Bus ${busId}`);
      } catch (err) {
        console.log('Start trip error:', err.message);
      }
    });

    // ── Driver trip end karta hai ──
    socket.on('endTrip', async (data) => {
      const { busId } = data;
      if (!busId) return;
      try {
        await prisma.bus.update({
          where: { id: busId },
          data: { status: 'ACTIVE' }
        });

        const tokens = await getParentTokensForBus(busId);
        if (tokens.length > 0) {
          await sendMulticast(
            tokens,
            '✅ Trip Ended',
            `Aapki bus ka safar khatam ho gaya.`,
            { busId, type: 'TRIP_ENDED' }
          );
        }

        io.to(`bus_${busId}`).emit('tripEnded', { busId });
        io.to('admins').emit('tripEnded', { busId });
        console.log(`Trip ended: Bus ${busId}`);
      } catch (err) {
        console.log('End trip error:', err.message);
      }
    });

    // ── SOS Emergency — sirf isi bus ke parents + admin ko ──
    socket.on('sos', async (data) => {
      const { busId, driverName, lat, lng } = data;
      if (!busId) return;
      console.log('SOS triggered:', busId);

      try {
        // Sirf isi bus ke students ke parents ko alert
        const tokens = await getParentTokensForBus(busId);
        if (tokens.length > 0) {
          await sendMulticast(
            tokens,
            '🚨 SOS EMERGENCY!',
            `Aapki bus mein emergency! Driver: ${driverName || 'Unknown'}`,
            { busId, type: 'SOS', lat: String(lat), lng: String(lng) }
          );
        }

        // Admins ko bhi alert
        const adminTokens = await getAdminTokens();
        if (adminTokens.length > 0) {
          await sendMulticast(
            adminTokens,
            '🚨 SOS EMERGENCY ALERT!',
            `Bus ${busId} — Driver: ${driverName} — Turant action lo!`,
            { busId, type: 'SOS_ADMIN', lat: String(lat), lng: String(lng) }
          );
        }

        // Socket broadcast — sirf isi bus ke room + admins
        io.to(`bus_${busId}`).emit('sosAlert', { busId, driverName, lat, lng, timestamp: new Date().toISOString() });
        io.to('admins').emit('sosAlert', { busId, driverName, lat, lng, timestamp: new Date().toISOString() });

        console.log(`SOS broadcast done for bus: ${busId} [room: bus_${busId}]`);
      } catch (err) {
        console.log('SOS error:', err.message);
      }
    });

    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
    });
  });
};

module.exports = gpsSocket;