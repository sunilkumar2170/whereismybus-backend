import React, { useState, useEffect } from 'react';
import { View, ActivityIndicator, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import LoginScreen from './src/screens/LoginScreen';
import HomeScreen from './src/screens/HomeScreen';
import DriverScreen from './src/screens/DriverScreen';
import AdminScreen from './src/screens/AdminScreen';

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkLogin = async () => {
      try {
        const token = await AsyncStorage.getItem('token');
        const userStr = await AsyncStorage.getItem('user');
        if (token && userStr) {
          setUser(JSON.parse(userStr));
        }
      } catch (e) {
        console.log('Auto login error:', e);
      } finally {
        setLoading(false);
      }
    };
    checkLogin();
  }, []);

  const handleLogin  = (u) => setUser(u);
  const handleLogout = () => setUser(null);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff' }}>
        <ActivityIndicator size="large" color="#1A73E8" />
      </View>
    );
  }

  if (!user)                return <LoginScreen onLogin={handleLogin} />;
  if (user.role === 'DRIVER') return <DriverScreen user={user} onLogout={handleLogout} />;
  if (user.role === 'ADMIN')  return <AdminScreen  user={user} onLogout={handleLogout} />;
  return <HomeScreen user={user} onLogout={handleLogout} />;
}