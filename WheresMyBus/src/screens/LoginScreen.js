import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, SafeAreaView, ActivityIndicator, Alert, ScrollView, KeyboardAvoidingView, Platform
} from 'react-native';
import { saveAuth, loginUser, registerUser, adminLogin as adminLoginApi } from '../services/api';

// (API_BASE ab yahan nahi chahiye — adminLogin() api.js ke andar hi
// sahi route /api/auth/admin-login use karta hai)

export default function LoginScreen({ onLogin }) {
  const [phone,   setPhone]   = useState('');
  const [name,    setName]    = useState('');
  const [role,    setRole]    = useState('PARENT');
  const [step,    setStep]    = useState('phone');
  const [otp,     setOtp]     = useState(['', '', '', '', '', '']);
  const [loading, setLoading] = useState(false);
  const inputs = [];

  // ── NEW: Admin ke liye email/password state ──
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [adminError, setAdminError] = useState('');

  const sendOTP = async () => {
    if (!phone || phone.length < 10) {
      Alert.alert('Error', 'Please enter valid 10 digit number');
      return;
    }
    if (!name) {
      Alert.alert('Error', 'Please enter your name');
      return;
    }
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      setStep('otp');
    }, 1000);
  };

  const verifyOTP = async () => {
    const code = otp.join('');
    if (code.length < 6) {
      Alert.alert('Error', 'Please enter 6 digit OTP');
      return;
    }
    if (code !== '123456') {
      Alert.alert('Error', 'Invalid OTP. Please try again.');
      return;
    }

    console.log('[LOGIN] selected role:', role);
    console.log('[LOGIN] name:', name);
    console.log('[LOGIN] phone:', phone);

    setLoading(true);
    try {
      let data;
      try {
        // Pehle login try karo — role bhi bhejo, taaki backend
        // existing driver ke liye SAHI role ke saath busId attach kare.
        // (Pehle yahan role ko local state mein overwrite kar dete the,
        // jisse busId purane/galat role ke hisaab se attached reh jaata
        // tha — "No Bus Assigned" bug isi wajah se aata tha.)
        data = await loginUser(phone, role);
      } catch {
        // User exist nahi karta — register karo selected role ke saath
        data = await registerUser(phone, name, role);
      }

      console.log('[LOGIN] existing driver:', data.user);
      console.log('[LOGIN] driver id:', data.user?.driverId ?? data.user?.id);
      console.log('[LOGIN] driver busId:', data.user?.busId);

      await saveAuth(data.token, data.user);
      onLogin(data.user);
    } catch (err) {
      Alert.alert('Error', err.response?.data?.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  // ── NEW: Admin email/password login — OTP nahi lagta, seedha dashboard khulega ──
  const adminLogin = async () => {
    if (!email || !password) {
      setAdminError('Email aur Password dono daalo');
      return;
    }
    setAdminError('');
    setLoading(true);
    try {
      const data = await adminLoginApi(email.trim(), password); // { token, user }

      if (!data?.token) {
        setAdminError('Login failed — email/password check karo');
        setLoading(false);
        return;
      }

      const user = { ...(data.user || {}), role: (data.user && data.user.role) || 'ADMIN' };
      await saveAuth(data.token, user); // wahi helper jo phone-login bhi use karta hai
      onLogin(user); // App.js isi se decide karega ki AdminScreen kholna hai
    } catch (err) {
      setAdminError(err.response?.data?.message || 'Server se connect nahi ho paya');
    } finally {
      setLoading(false);
    }
  };

  const handleOtpChange = (text, index) => {
    const newOtp = [...otp];
    newOtp[index] = text;
    setOtp(newOtp);
    if (text && index < 5) inputs[index + 1]?.focus();
    if (!text && index > 0) inputs[index - 1]?.focus();
  };

  const isAdmin = role === 'ADMIN';

  return (
    <SafeAreaView style={s.container}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">

          <Text style={s.logo}>🚌</Text>
          <Text style={s.title}>Where Is My Bus</Text>
          <Text style={s.subtitle}>Know where your child is, always</Text>

          {/* Role Selector — hamesha dikhega, chahe phone-flow ho ya admin-flow */}
          <View style={s.roleTabs}>
            {['PARENT', 'DRIVER', 'ADMIN'].map(r => (
              <TouchableOpacity
                key={r}
                style={[s.roleTab, role === r && s.roleTabActive]}
                onPress={() => { setRole(r); setStep('phone'); setAdminError(''); }}
              >
                <Text style={[s.roleTabText, role === r && s.roleTabTextActive]}>
                  {r === 'PARENT'  ? '👨‍👩‍👧 Parent'  :
                   r === 'DRIVER'  ? '🚌 Driver'  :
                                     '⚙️ Admin'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* ══════════════════ ADMIN FLOW — email + password ══════════════════ */}
          {isAdmin ? (
            <>
              <View style={s.roleIndicator}>
                <Text style={s.roleIndicatorText}>
                  Logging in as: <Text style={{ color: '#00D4AA', fontWeight: 'bold' }}>ADMIN</Text>
                </Text>
              </View>

              <TextInput
                style={s.input}
                placeholder="Email"
                placeholderTextColor="#8892A4"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
              />

              <TextInput
                style={s.input}
                placeholder="Password"
                placeholderTextColor="#8892A4"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoCapitalize="none"
              />

              {adminError ? <Text style={s.errorText}>{adminError}</Text> : null}

              <TouchableOpacity style={s.btn} onPress={adminLogin} disabled={loading}>
                {loading
                  ? <ActivityIndicator color="#000" />
                  : <Text style={s.btnText}>Login →</Text>
                }
              </TouchableOpacity>
            </>
          ) : step === 'phone' ? (
            /* ══════════════════ PARENT / DRIVER FLOW — same as pehle ══════════════════ */
            <>
              <View style={s.roleIndicator}>
                <Text style={s.roleIndicatorText}>
                  Logging in as: <Text style={{ color: '#00D4AA', fontWeight: 'bold' }}>{role}</Text>
                </Text>
              </View>

              <TextInput
                style={s.input}
                placeholder="Enter your name"
                placeholderTextColor="#8892A4"
                value={name}
                onChangeText={setName}
              />

              <View style={s.phoneRow}>
                <Text style={s.flag}>🇮🇳 +91</Text>
                <TextInput
                  style={s.phoneInput}
                  placeholder="Mobile number"
                  placeholderTextColor="#8892A4"
                  value={phone}
                  onChangeText={setPhone}
                  keyboardType="phone-pad"
                  maxLength={10}
                />
              </View>

              <TouchableOpacity style={s.btn} onPress={sendOTP} disabled={loading}>
                {loading
                  ? <ActivityIndicator color="#000" />
                  : <Text style={s.btnText}>Send OTP →</Text>
                }
              </TouchableOpacity>
            </>
          ) : (
            <>
              {/* OTP Step — sirf Parent/Driver ke liye */}
              <Text style={s.otpTitle}>Enter OTP</Text>
              <Text style={s.otpSubtitle}>OTP sent to +91 {phone}</Text>

              <View style={s.roleReminder}>
                <Text style={s.roleReminderText}>
                  {role === 'DRIVER' ? '🚌 Driver Login' : '👨‍👩‍👧 Parent Login'}
                </Text>
              </View>

              <View style={s.hintBox}>
                <Text style={s.hintText}>Test OTP: 123456</Text>
              </View>

              <View style={s.otpRow}>
                {otp.map((digit, index) => (
                  <TextInput
                    key={index}
                    ref={ref => inputs[index] = ref}
                    style={[s.otpBox, digit && s.otpBoxFilled]}
                    value={digit}
                    onChangeText={text => handleOtpChange(text, index)}
                    keyboardType="number-pad"
                    maxLength={1}
                    textAlign="center"
                  />
                ))}
              </View>

              <TouchableOpacity style={s.btn} onPress={verifyOTP} disabled={loading}>
                {loading
                  ? <ActivityIndicator color="#000" />
                  : <Text style={s.btnText}>Verify OTP ✓</Text>
                }
              </TouchableOpacity>

              <TouchableOpacity onPress={() => {
                setStep('phone');
                setOtp(['', '', '', '', '', '']);
              }}>
                <Text style={s.back}>← Change number / role</Text>
              </TouchableOpacity>

              <TouchableOpacity onPress={sendOTP}>
                <Text style={s.resend}>Resend OTP</Text>
              </TouchableOpacity>
            </>
          )}

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container      : { flex: 1, backgroundColor: '#0A0F1C' },
  content        : { padding: 24, justifyContent: 'center', alignItems: 'center', minHeight: '100%' },
  logo           : { fontSize: 72, marginBottom: 8 },
  title          : { fontSize: 28, fontWeight: 'bold', color: '#F9FAFB', textAlign: 'center' },
  subtitle       : { fontSize: 14, color: '#8892A4', textAlign: 'center', marginBottom: 32 },

  roleTabs       : { flexDirection: 'row', marginBottom: 12, gap: 8, width: '100%' },
  roleTab        : { flex: 1, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#1E2D45', alignItems: 'center' },
  roleTabActive  : { backgroundColor: '#00D4AA', borderColor: '#00D4AA' },
  roleTabText    : { color: '#8892A4', fontWeight: '600', fontSize: 11 },
  roleTabTextActive: { color: '#000' },

  roleIndicator  : { backgroundColor: '#111827', borderRadius: 8, paddingHorizontal: 16,
                     paddingVertical: 8, marginBottom: 20, borderWidth: 1, borderColor: '#1E2D45' },
  roleIndicatorText: { color: '#8892A4', fontSize: 13 },

  input          : { backgroundColor: '#111827', borderRadius: 12, padding: 16, color: '#F9FAFB',
                     marginBottom: 16, borderWidth: 1, borderColor: '#1E2D45', width: '100%' },
  phoneRow       : { flexDirection: 'row', backgroundColor: '#111827', borderRadius: 12,
                     borderWidth: 1, borderColor: '#1E2D45', marginBottom: 16,
                     alignItems: 'center', paddingHorizontal: 16, width: '100%' },
  flag           : { fontSize: 16, color: '#F9FAFB', marginRight: 8 },
  phoneInput     : { flex: 1, padding: 16, color: '#F9FAFB', fontSize: 16 },
  btn            : { backgroundColor: '#00D4AA', borderRadius: 12, padding: 16,
                     alignItems: 'center', marginBottom: 16, width: '100%' },
  btnText        : { color: '#000', fontSize: 16, fontWeight: 'bold' },

  errorText      : { color: '#FF6B6B', fontSize: 13, marginBottom: 12, textAlign: 'center', width: '100%' },

  otpTitle       : { fontSize: 24, fontWeight: 'bold', color: '#F9FAFB', marginBottom: 8 },
  otpSubtitle    : { fontSize: 14, color: '#8892A4', marginBottom: 12, textAlign: 'center' },
  roleReminder   : { backgroundColor: '#00D4AA20', borderRadius: 8, paddingHorizontal: 16,
                     paddingVertical: 6, marginBottom: 12, borderWidth: 1, borderColor: '#00D4AA40' },
  roleReminderText: { color: '#00D4AA', fontSize: 13, fontWeight: 'bold' },
  hintBox        : { backgroundColor: '#1E2D45', borderRadius: 8, paddingHorizontal: 16,
                     paddingVertical: 8, marginBottom: 24 },
  hintText       : { color: '#00D4AA', fontSize: 13, fontWeight: 'bold' },
  otpRow         : { flexDirection: 'row', gap: 12, marginBottom: 32 },
  otpBox         : { width: 48, height: 56, backgroundColor: '#111827', borderRadius: 12,
                     borderWidth: 1, borderColor: '#1E2D45', color: '#F9FAFB',
                     fontSize: 22, fontWeight: 'bold' },
  otpBoxFilled   : { borderColor: '#00D4AA', borderWidth: 2 },
  back           : { color: '#8892A4', fontSize: 14, marginBottom: 12 },
  resend         : { color: '#00D4AA', fontSize: 14 },
});