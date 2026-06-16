const admin = require('firebase-admin');

// ✅ Render pe Environment Variable se lo
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

// Firebase initialize
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

// Single token pe notification bhejo
const sendNotification = async (fcmToken, title, body, data = {}) => {
  try {
    const message = {
      token: fcmToken,
      notification: { title, body },
      data: data,
      android: {
        priority: 'high',
        notification: {
          sound: 'default',
          channelId: 'whereismybus'
        }
      }
    };
    const response = await admin.messaging().send(message);
    console.log('Notification sent:', response);
    return response;
  } catch (err) {
    console.log('Notification error:', err.message);
  }
};

// Multiple tokens pe bhejo (broadcast)
const sendMulticast = async (fcmTokens, title, body, data = {}) => {
  if (!fcmTokens || fcmTokens.length === 0) return;
  try {
    const message = {
      tokens: fcmTokens,
      notification: { title, body },
      data: data,
      android: {
        priority: 'high',
        notification: {
          sound: 'default',
          channelId: 'whereismybus'
        }
      }
    };
    const response = await admin.messaging().sendEachForMulticast(message);
    console.log(`Sent: ${response.successCount}, Failed: ${response.failureCount}`);
    return response;
  } catch (err) {
    console.log('Multicast error:', err.message);
  }
};

module.exports = { sendNotification, sendMulticast };