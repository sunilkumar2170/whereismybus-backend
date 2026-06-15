const prisma = require('../db');
const { sendMulticast } = require('../services/notificationService');

const gpsSocket = (io) => {
  io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    // Driver GPS bhejta hai
    socket.on('sendLocation', async (data) => {
      const { busId, lat, lng, speed } = data;
      try {
        // Database mein save karo
        await prisma.liveLocation.create({
          data: { busId, lat: parseFloat(lat), lng: parseFloat(lng), speed: parseFloat(speed) || 0 }
        });

        // Sab parents ko broadcast karo
        io.emit('locationUpdate', { busId, lat, lng, speed });

        // Speed alert — 60+ pe admin ko notify karo
        if (parseFloat(speed) > 60) {
          const admins = await prisma.user.findMany({
            where: { role: 'ADMIN', fcmToken: { not: null } }
          });
          const tokens = admins.map(p => p.fcmToken).filter(Boolean);
          if (tokens.length > 0) {
            await sendMulticast(
              tokens,
              '⚠️ Speed Alert!',
              `Bus ${busId} overspeeding — ${speed} km/h`,
              { busId, type: 'SPEED_ALERT', speed: String(speed) }
            );
          }
        }

        console.log(`Bus ${busId} → ${lat}, ${lng} @ ${speed}km/h`);
      } catch (err) {
        console.log('GPS Error:', err.message);
      }
    });

    // Driver trip start karta hai
    socket.on('startTrip', async (data) => {
      const { busId } = data;
      try {
        await prisma.bus.update({
          where: { id: busId },
          data: { status: 'ON_TRIP' }
        });

        // Sab parents ko notify karo
        const parents = await prisma.user.findMany({
          where: { role: 'PARENT', fcmToken: { not: null } }
        });
        const tokens = parents.map(p => p.fcmToken).filter(Boolean);
        if (tokens.length > 0) {
          await sendMulticast(
            tokens,
            '🚌 Bus Trip Started!',
            `Bus ${busId} ne apna safar shuru kar diya.`,
            { busId, type: 'TRIP_STARTED' }
          );
        }

        io.emit('tripStarted', { busId });
        console.log(`Trip started: Bus ${busId}`);
      } catch (err) {
        console.log('Start trip error:', err.message);
      }
    });

    // Driver trip end karta hai
    socket.on('endTrip', async (data) => {
      const { busId } = data;
      try {
        await prisma.bus.update({
          where: { id: busId },
          data: { status: 'ACTIVE' }
        });

        // Sab parents ko notify karo
        const parents = await prisma.user.findMany({
          where: { role: 'PARENT', fcmToken: { not: null } }
        });
        const tokens = parents.map(p => p.fcmToken).filter(Boolean);
        if (tokens.length > 0) {
          await sendMulticast(
            tokens,
            '✅ Trip Ended',
            `Bus ${busId} ka safar khatam ho gaya.`,
            { busId, type: 'TRIP_ENDED' }
          );
        }

        io.emit('tripEnded', { busId });
        console.log(`Trip ended: Bus ${busId}`);
      } catch (err) {
        console.log('End trip error:', err.message);
      }
    });

    // SOS Emergency
    socket.on('sos', async (data) => {
      const { busId, driverName, lat, lng } = data;
      console.log('🚨 SOS triggered:', busId);
      try {
        // Sab parents ko emergency alert
        const parents = await prisma.user.findMany({
          where: { role: 'PARENT', fcmToken: { not: null } }
        });
        const tokens = parents.map(p => p.fcmToken).filter(Boolean);
        if (tokens.length > 0) {
          await sendMulticast(
            tokens,
            '🚨 SOS EMERGENCY!',
            `Bus ${busId} mein emergency! Driver: ${driverName || 'Unknown'}`,
            { busId, type: 'SOS', lat: String(lat), lng: String(lng) }
          );
        }

        // Admins ko bhi alert
        const admins = await prisma.user.findMany({
          where: { role: 'ADMIN', fcmToken: { not: null } }
        });
        const adminTokens = admins.map(a => a.fcmToken).filter(Boolean);
        if (adminTokens.length > 0) {
          await sendMulticast(
            adminTokens,
            '🚨 SOS EMERGENCY ALERT!',
            `Bus ${busId} — Driver: ${driverName} — Turant action lo!`,
            { busId, type: 'SOS_ADMIN', lat: String(lat), lng: String(lng) }
          );
        }

        // Socket broadcast
        io.emit('sosAlert', { busId, driverName, lat, lng });
        console.log(`SOS broadcast done for bus: ${busId}`);
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