import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  SafeAreaView, ScrollView, TextInput, Modal,
  Alert, StatusBar, Dimensions, RefreshControl,
  ActivityIndicator,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { logout } from '../services/api';

import * as Location from 'expo-location';
import { WebView } from 'react-native-webview';
import { io } from 'socket.io-client';

const API = 'https://whereismybus-backend.onrender.com';
const W   = Dimensions.get('window').width;
const P   = '#1A73E8';

const getGreeting = () => {
  const h = new Date().getHours();
  if (h >= 5  && h < 12) return '🌅 Good Morning';
  if (h >= 12 && h < 17) return '☀️ Good Afternoon';
  if (h >= 17 && h < 21) return '🌆 Good Evening';
  return '🌙 Good Night';
};

const api = async (method, path, body, token) => {
  try {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json();
    return { ...json, __status: res.status };
  } catch (e) {
    console.log('API error:', e.message);
    return { error: e.message };
  }
};

const safeFixed = (val, digits = 3) => {
  const n = parseFloat(val);
  return isNaN(n) ? '—' : n.toFixed(digits);
};

const safeDateStr = (val) => {
  if (!val) return '—';
  const d = new Date(val);
  return isNaN(d.getTime()) ? '—' : d.toLocaleString();
};

// ── Bus is always displayed by busNo — never id/UUID. ──
const busLabel = (b, fallback = 'N/A') => (b && b.busNo) || fallback;

// ── Normalizes a phone string for duplicate comparison — strips
// spaces/dashes so "9680002257" and "968-000-2257" are recognized
// as the same number. ──
const normalizePhone = (p) => String(p || '').replace(/[^\d]/g, '');

// ── Response-shape-safe array extractor — a record that saved on the
// backend never silently "disappears" from a list because of an
// unexpected response wrapper shape. ──
const extractArray = (res, keys = []) => {
  if (Array.isArray(res)) return res;
  for (const k of keys) {
    if (Array.isArray(res?.[k])) return res[k];
  }
  if (Array.isArray(res?.data)) return res.data;
  for (const k of keys) {
    if (Array.isArray(res?.data?.[k])) return res.data[k];
  }
  return [];
};

const getCurrentLocation = () =>
  new Promise(async (resolve, reject) => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') { reject(new Error('PERMISSION_DENIED')); return; }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude });
    } catch (e) { reject(e); }
  });

// ── Free location search (OpenStreetMap Nominatim) — no API key needed.
// Nominatim's usage policy asks for a descriptive User-Agent and no more
// than ~1 request/second, which is naturally satisfied by a person typing
// and tapping "Search". ──
const searchPlaces = async (query, { biasIN = true } = {}) => {
  const params = new URLSearchParams({
    q: query,
    format: 'json',
    addressdetails: '1',
    limit: '6',
    ...(biasIN ? { countrycodes: 'in' } : {}),
  });
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
    headers: { 'User-Agent': 'WhereIsMyBus-AdminApp/1.0' },
  });
  if (!res.ok) throw new Error(`Search failed (${res.status})`);
  const json = await res.json();
  return json.map(r => ({
    lat: parseFloat(r.lat),
    lng: parseFloat(r.lon),
    label: r.display_name,
  }));
};

// ── Live single-bus location viewer — a plain marker on a Leaflet map,
// updated in place via window.updateMarker() so the marker glides
// instead of the whole WebView reloading on every 5s poll. ──
const buildLiveLocationHtml = (lat, lng, busNo) => `
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <style>
    html, body, #map { height: 100%; margin: 0; padding: 0; }
    .busIcon{background:#1A73E8;border:3px solid #fff;border-radius:50%;width:36px;height:36px;display:flex;align-items:center;justify-content:center;font-size:18px;box-shadow:0 2px 8px rgba(0,0,0,0.35)}
  </style>
</head>
<body>
  <div id="map"></div>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    var lat = ${lat}, lng = ${lng};
    var map = L.map('map').setView([lat, lng], 16);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors', maxZoom: 19
    }).addTo(map);
    var icon = L.divIcon({ html: '<div class="busIcon">\u{1F68C}<\/div>', className: '', iconSize: [36,36], iconAnchor: [18,18] });
    var marker = L.marker([lat, lng], { icon: icon }).addTo(map).bindPopup(${JSON.stringify(busNo || 'Bus')});
    window.updateMarker = function(la, ln) {
      marker.setLatLng([la, ln]);
      map.panTo([la, ln], { animate: true });
    };
  </script>
</body>
</html>
`;

const buildMapPickerHtml = (lat, lng) => `
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <style>html, body, #map { height: 100%; margin: 0; padding: 0; }</style>
</head>
<body>
  <div id="map"></div>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    var lat = ${lat};
    var lng = ${lng};
    var map = L.map('map').setView([lat, lng], 15);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19
    }).addTo(map);
    var marker = L.marker([lat, lng], { draggable: true }).addTo(map);
    function sendCoords(la, ln) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ lat: la, lng: ln }));
    }
    marker.on('dragend', function () {
      var pos = marker.getLatLng();
      sendCoords(pos.lat, pos.lng);
    });
    map.on('click', function (e) {
      marker.setLatLng(e.latlng);
      sendCoords(e.latlng.lat, e.latlng.lng);
    });
  </script>
</body>
</html>
`;

// ── CSV PARSER ──
const parseCSVLine = (line) => {
  const result = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else { inQuotes = false; }
      } else cur += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { result.push(cur); cur = ''; }
      else cur += ch;
    }
  }
  result.push(cur);
  return result;
};

const parseCSV = (text) => {
  if (!text) return [];
  let clean = text.replace(/^\uFEFF/, '');
  clean = clean.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = clean.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length < 2) return [];
  const headers = parseCSVLine(lines[0]).map(h => h.trim().toLowerCase().replace(/\s+/g, ''));
  return lines.slice(1).map(line => {
    const vals = parseCSVLine(line).map(v => v.trim());
    const obj  = {};
    headers.forEach((h, i) => { obj[h] = vals[i] || ''; });
    return obj;
  });
};

// ── UI COMPONENTS ──
const Inp = ({ label, value, onChange, placeholder, keyboard = 'default', multi = false }) => (
  <View style={{ marginBottom: 14 }}>
    {label ? <Text style={c.label}>{label}</Text> : null}
    <TextInput
      style={[c.inp, multi && { height: 80, textAlignVertical: 'top' }]}
      value={value}
      onChangeText={onChange}
      placeholder={placeholder || ''}
      placeholderTextColor="#bbb"
      keyboardType={keyboard}
      autoCapitalize="none"
      multiline={multi}
    />
  </View>
);

const PBtn = ({ label, onPress, color = P, disabled = false }) => (
  <TouchableOpacity
    style={[c.pBtn, { backgroundColor: color }, disabled && { opacity: 0.6 }]}
    onPress={disabled ? undefined : onPress}
    activeOpacity={0.85}
    disabled={disabled}
  >
    {disabled ? <ActivityIndicator color="#fff" /> : <Text style={c.pBtnTxt}>{label}</Text>}
  </TouchableOpacity>
);

const OBtn = ({ label, onPress, color = P }) => (
  <TouchableOpacity style={[c.oBtn, { borderColor: color }]} onPress={onPress} activeOpacity={0.85}>
    <Text style={[c.oBtnTxt, { color }]}>{label}</Text>
  </TouchableOpacity>
);

const Tag = ({ label, color = P }) => (
  <View style={[c.tag, { backgroundColor: color + '18', borderColor: color }]}>
    <Text style={[c.tagTxt, { color }]}>{label}</Text>
  </View>
);

const FormModal = ({ visible, title, onClose, children }) => (
  <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
    <SafeAreaView style={{ flex: 1, backgroundColor: '#F5F7FA' }}>
      <View style={c.mHead}>
        <Text style={c.mTitle}>{title}</Text>
        <TouchableOpacity onPress={onClose} style={{ padding: 8 }}>
          <Text style={{ fontSize: 22, color: '#888' }}>✕</Text>
        </TouchableOpacity>
      </View>
      <ScrollView style={{ flex: 1, padding: 16 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {children}
        <View style={{ height: 80 }} />
      </ScrollView>
    </SafeAreaView>
  </Modal>
);

const ChipSelect = ({ items, selected, onSelect }) => (
  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
    {items.map((item, i) => (
      <TouchableOpacity
        key={i}
        style={[c.chip, selected === item.id && c.chipOn]}
        onPress={() => onSelect(selected === item.id ? '' : item.id)}
      >
        <Text style={[c.chipTxt, selected === item.id && { color: '#fff' }]}>{item.name}</Text>
      </TouchableOpacity>
    ))}
    {items.length === 0 && <Text style={{ color: '#aaa', padding: 8 }}>No options</Text>}
  </ScrollView>
);

function AdminScreenContent({ user, onLogout }) {
  const [tab,        setTab]        = useState('dash');
  const [token,      setToken]      = useState('');
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [buses,       setBuses]       = useState([]);
  const [students,    setStudents]    = useState([]);
  const [stops,       setStops]       = useState([]);
  const [drivers,     setDrivers]     = useState([]);
  const [trips,       setTrips]       = useState([]);
  const [emergencies, setEmergencies] = useState([]);
  const [attendance,  setAttendance]  = useState([]);

  const [mBus,     setMBus]     = useState(false);
  const [mStudent, setMStudent] = useState(false);
  const [mStop,    setMStop]    = useState(false);
  const [mDriver,  setMDriver]  = useState(false);
  const [mEmerg,   setMEmerg]   = useState(false);
  const [mAttend,  setMAttend]  = useState(false);

  const [fBus,     setFBus]     = useState({ busNo: '', driverName: '', status: 'ACTIVE' });
  const [fStudent, setFStudent] = useState({ name: '', admissionNo: '', busId: '', parentPhone: '', class: '', stopId: '' });
  const [fStop,    setFStop]    = useState({ name: '', lat: '', lng: '', busId: '' });
  const [fDriver,  setFDriver]  = useState({ name: '', phone: '', licenseNo: '', licenseExpiry: '', busId: '', experience: '0' });
  const [fEmerg,   setFEmerg]   = useState({ busId: '', driverName: '', type: 'SOS', notes: '' });
  const [fAttend,  setFAttend]  = useState({ busId: '', studentId: '', date: new Date().toISOString().slice(0, 10), tripType: 'pickup', boarded: false });
  const [csvText,  setCSVText]  = useState('');
  const [csvStatus, setCSVStatus] = useState('');
  const [csvUploading, setCSVUploading] = useState(false);

  const [stopLocating, setStopLocating] = useState(false);
  const [stopLocManual, setStopLocManual] = useState(false);
  const [mMapPicker, setMMapPicker] = useState(false);
  const [mapMarker,  setMapMarker]  = useState(null);

  // ── Location search (Nominatim — free, no API key) ──
  const [stopSearchQuery,   setStopSearchQuery]   = useState('');
  const [stopSearchResults, setStopSearchResults] = useState([]);
  const [stopSearching,     setStopSearching]     = useState(false);
  const [stopSearchError,   setStopSearchError]   = useState('');

  const [csvPreviewVisible, setCSVPreviewVisible] = useState(false);
  const [csvPreviewRows, setCSVPreviewRows] = useState([]);

  const [reorderingStopId, setReorderingStopId] = useState('');

  // Which driver's "assign bus" chip-picker is open, per-row
  const [assigningDriverId, setAssigningDriverId] = useState('');

  // ── FIX (gap #4): search on Buses/Drivers/Students tabs ──
  const [busSearch,     setBusSearch]     = useState('');
  const [driverSearch,  setDriverSearch]  = useState('');
  const [studentSearch, setStudentSearch] = useState('');
  const [parentSearch,  setParentSearch]  = useState('');

  // ── FIX (gap #3): Edit Bus / Edit Driver ──
  const [editingBusId,    setEditingBusId]    = useState(''); // '' = Add mode, else editing this bus.id
  const [editingDriverId, setEditingDriverId] = useState(''); // '' = Add mode, else editing this driver.id

  // ── FIX (gap #6): live-GPS staleness per bus (busId -> lastSeenMs) ──
  const [liveGpsMap, setLiveGpsMap] = useState({});
  const GPS_STALE_MS = 2 * 60 * 1000; // 2 minutes with no update = "not updating"

  // ── Live Location viewer (single-bus) ──
  const [liveLocModal,   setLiveLocModal]   = useState(false);
  const [liveLocBus,     setLiveLocBus]     = useState(null); // { id, busNo }
  const [liveLocData,    setLiveLocData]    = useState(null); // { lat, lng, speed, timestamp } | null
  const [liveLocLoading, setLiveLocLoading] = useState(false);
  const liveLocWebViewRef  = useRef(null);
  const liveLocIntervalRef = useRef(null);

  // ── Route Management (Route + RouteStop APIs — separate system from
  // the flat Stop.busId one; both now coexist per explicit decision) ──
  const [routes,       setRoutes]       = useState([]);
  const [mRoute,        setMRoute]        = useState(false);
  const [editingRouteId, setEditingRouteId] = useState('');
  const [fRoute,        setFRoute]        = useState({ name: '', busId: '', startPoint: '', endPoint: '' });
  const [expandedRouteId,  setExpandedRouteId]  = useState('');
  const [routeDetailsMap,  setRouteDetailsMap]  = useState({}); // routeId -> { ...route, stops: [...] }
  const [routeDetailLoading, setRouteDetailLoading] = useState('');
  const [mRouteStop,    setMRouteStop]    = useState(false);
  const [routeStopForRouteId, setRouteStopForRouteId] = useState('');
  const [fRouteStop,    setFRouteStop]    = useState({ name: '', lat: '', lng: '', order: '' });
  const [routeStopSearchQuery,   setRouteStopSearchQuery]   = useState('');
  const [routeStopSearchResults, setRouteStopSearchResults] = useState([]);
  const [routeStopSearching,     setRouteStopSearching]     = useState(false);
  const [routeStopSearchError,   setRouteStopSearchError]   = useState('');

  const adminSocketRef = useRef(null);

  useEffect(() => {
    AsyncStorage.getItem('token')
      .then(t => {
        if (t) { setToken(t); loadAll(t); }
        else setLoading(false);
      })
      .catch(e => { console.log('AsyncStorage error:', e.message); setLoading(false); });
  }, []);

  // 🚨 Real-time Socket Listener for Admin (SOS Alerts & Live Updates)
  useEffect(() => {
    adminSocketRef.current = io(API, { transports: ['websocket'], reconnection: true });
    adminSocketRef.current.on('connect', () => {
      adminSocketRef.current.emit('joinAsAdmin');
      console.log('[ADMIN] Joined admins socket room ✅');
    });

    adminSocketRef.current.on('sosAlert', (data) => {
      console.log('[ADMIN] REALTIME SOS ALERT:', data);
      Alert.alert(
        '🚨 EMERGENCY SOS ALERT!',
        `Bus ${data.busId || ''} mein emergency alert trigger hua hai!\n\nDriver: ${data.driverName || 'Driver'}\nTime: ${new Date(data.timestamp || Date.now()).toLocaleTimeString()}`,
        [
          { text: 'View SOS Tab 🚨', onPress: () => setTab('sos') },
          { text: 'Acknowledge', style: 'cancel' }
        ]
      );
      if (token) loadAll(token);
    });

    return () => adminSocketRef.current?.disconnect();
  }, [token, loadAll]);

  const loadAll = useCallback(async (t) => {
    if (!t) return;
    setLoading(true);
    try {
      const [b, st, dr, tr, em, sp, at, rt] = await Promise.all([
        api('GET', '/api/buses', null, t),
        api('GET', '/api/students', null, t),
        api('GET', '/api/drivers', null, t),
        api('GET', '/api/trips/active', null, t),
        api('GET', '/api/emergencies', null, t),
        api('GET', '/api/stops', null, t),
        api('GET', '/api/attendance', null, t),
        api('GET', '/api/routes', null, t),
      ]);

      setBuses(extractArray(b, ['buses']));
      setStudents(extractArray(st, ['students']));
      setDrivers(extractArray(dr, ['drivers']));
      setTrips(extractArray(tr, ['trips', 'buses']));
      setEmergencies(extractArray(em, ['emergencies']));
      setStops(extractArray(sp, ['stops']));
      setAttendance(extractArray(at, ['attendance']));
      setRoutes(extractArray(rt, ['routes']));

      console.log('[ADMIN] Drivers fetched:', extractArray(dr, ['drivers']));

      // ── FIX (gap #6): for every bus with an active trip, fetch its
      // latest LiveLocation timestamp so the dashboard can warn when a
      // trip is ACTIVE but GPS hasn't updated recently — using the
      // existing GET /api/buses/:busId/location endpoint, no new
      // backend route needed. ──
      const liveTrips = extractArray(tr, ['trips', 'buses']);
      const liveBusIds = liveTrips.map(t => t.busId || t.id).filter(Boolean);
      if (liveBusIds.length) {
        const locResults = await Promise.all(
          liveBusIds.map(async (bid) => {
            const r = await api('GET', `/api/buses/${bid}/location`, null, t);
            const ts = r?.location?.timestamp || r?.timestamp || null;
            return [bid, ts ? new Date(ts).getTime() : null];
          })
        );
        setLiveGpsMap(Object.fromEntries(locResults));
      } else {
        setLiveGpsMap({});
      }
    } catch (e) {
      console.log('loadAll error:', e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadAll(token);
    setRefreshing(false);
  }, [token, loadAll]);

  // ── Live Location viewer — fetches GET /api/buses/:busId/location
  // (the existing endpoint, already used for the gap #6 GPS-staleness
  // check) for ONE selected bus, then polls it every 5s while the
  // modal is open. Never fetches or shows any other bus. ──
  const fetchBusLocation = useCallback(async (busId) => {
    const r = await api('GET', `/api/buses/${busId}/location`, null, token);
    const loc = r?.location || (r?.lat != null ? r : null);
    return loc;
  }, [token]);

  const openLiveLocation = (bus) => {
    setLiveLocBus({ id: bus.id, busNo: bus.busNo });
    setLiveLocData(null);
    setLiveLocLoading(true);
    setLiveLocModal(true);

    const poll = async () => {
      const loc = await fetchBusLocation(bus.id);
      setLiveLocData(loc);
      setLiveLocLoading(false);
      if (loc && liveLocWebViewRef.current) {
        liveLocWebViewRef.current.injectJavaScript(`window.updateMarker(${loc.lat}, ${loc.lng}); true;`);
      }
    };
    poll();
    if (liveLocIntervalRef.current) clearInterval(liveLocIntervalRef.current);
    liveLocIntervalRef.current = setInterval(poll, 5000);
  };

  const closeLiveLocation = () => {
    if (liveLocIntervalRef.current) { clearInterval(liveLocIntervalRef.current); liveLocIntervalRef.current = null; }
    setLiveLocModal(false);
    setLiveLocBus(null);
    setLiveLocData(null);
  };

  useEffect(() => () => { if (liveLocIntervalRef.current) clearInterval(liveLocIntervalRef.current); }, []);

  // ── ROUTE MANAGEMENT (Route + RouteStop APIs — separate from the
  // flat Stop.busId system used everywhere else in this file) ──
  const saveRoute = async () => {
    if (!fRoute.name.trim()) return Alert.alert('Required', 'Route name daalo');
    if (!fRoute.busId) return Alert.alert('Required', 'Bus select karo');
    if (!fRoute.startPoint.trim()) return Alert.alert('Required', 'Start point daalo');

    const payload = { name: fRoute.name, busId: fRoute.busId, startPoint: fRoute.startPoint, endPoint: fRoute.endPoint || null };

    if (editingRouteId) {
      const r = await api('PUT', `/api/routes/${editingRouteId}`, payload, token);
      if (r?.error || (r.__status && r.__status >= 400)) {
        Alert.alert('Error', r?.message || 'Failed to update route');
        return;
      }
      Alert.alert('✅ Success', 'Route updated!');
    } else {
      const r = await api('POST', '/api/routes', payload, token);
      if (r?.error || (r.__status && r.__status >= 400)) {
        Alert.alert('Error', r?.message || 'Failed to create route');
        return;
      }
      Alert.alert('✅ Success', 'Route created!');
    }
    setMRoute(false); setEditingRouteId('');
    setFRoute({ name: '', busId: '', startPoint: '', endPoint: '' });
    loadAll(token);
  };

  const openEditRoute = (r) => {
    setEditingRouteId(r.id);
    setFRoute({ name: r.name || '', busId: r.busId || '', startPoint: r.startPoint || '', endPoint: r.endPoint || '' });
    setMRoute(true);
  };

  const deleteRouteConfirm = (routeId) => confirmDelete('routes', routeId, `/api/routes/${routeId}`);

  // Loads a single route's full detail (with ordered RouteStops) —
  // only called when Admin expands that specific route, and cached so
  // re-expanding doesn't re-fetch.
  const toggleRouteExpand = async (routeId) => {
    if (expandedRouteId === routeId) { setExpandedRouteId(''); return; }
    setExpandedRouteId(routeId);
    if (routeDetailsMap[routeId]) return; // cached
    setRouteDetailLoading(routeId);
    const r = await api('GET', `/api/routes/${routeId}`, null, token);
    const detail = r?.route || r;
    setRouteDetailsMap(prev => ({ ...prev, [routeId]: detail }));
    setRouteDetailLoading('');
  };

  const refreshRouteDetail = async (routeId) => {
    const r = await api('GET', `/api/routes/${routeId}`, null, token);
    const detail = r?.route || r;
    setRouteDetailsMap(prev => ({ ...prev, [routeId]: detail }));
  };

  const openAddRouteStop = (routeId) => {
    const detail = routeDetailsMap[routeId];
    const nextOrder = (detail?.stops?.length || 0) + 1;
    setRouteStopForRouteId(routeId);
    setFRouteStop({ name: '', lat: '', lng: '', order: String(nextOrder) });
    setRouteStopSearchQuery(''); setRouteStopSearchResults([]); setRouteStopSearchError('');
    setMRouteStop(true);
  };

  const runRouteStopSearch = async () => {
    const q = routeStopSearchQuery.trim();
    if (!q) return;
    setRouteStopSearching(true);
    setRouteStopSearchError('');
    try {
      const results = await searchPlaces(q);
      setRouteStopSearchResults(results);
      if (results.length === 0) setRouteStopSearchError('Kuch nahi mila — naam thoda alag try karo');
    } catch (e) {
      setRouteStopSearchError(e.message || 'Search failed');
      setRouteStopSearchResults([]);
    } finally {
      setRouteStopSearching(false);
    }
  };

  const pickRouteStopSearchResult = (r) => {
    setFRouteStop(prev => ({ ...prev, lat: String(r.lat), lng: String(r.lng) }));
    setRouteStopSearchResults([]); setRouteStopSearchQuery('');
  };

  const saveRouteStop = async () => {
    if (!fRouteStop.name.trim()) return Alert.alert('Required', 'Stop name daalo');
    if (!fRouteStop.lat || !fRouteStop.lng) return Alert.alert('Required', 'Location select karo (search se)');
    const payload = {
      name: fRouteStop.name, lat: parseFloat(fRouteStop.lat), lng: parseFloat(fRouteStop.lng),
      order: parseInt(fRouteStop.order) || 1,
    };
    const r = await api('POST', `/api/routes/${routeStopForRouteId}/stops`, payload, token);
    if (r?.error || (r.__status && r.__status >= 400)) {
      Alert.alert('Error', r?.message || 'Failed to add stop');
      return;
    }
    Alert.alert('✅ Success', 'Stop added to route!');
    setMRouteStop(false);
    await refreshRouteDetail(routeStopForRouteId);
    loadAll(token);
  };

  const deleteRouteStopConfirm = (routeId, stopId) => {
    Alert.alert('Delete Stop', 'Sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        const r = await api('DELETE', `/api/routes/stops/${stopId}`, null, token);
        if (r?.error || (r.__status && r.__status >= 400)) {
          Alert.alert('Error', r?.message || 'Delete failed');
        }
        await refreshRouteDetail(routeId);
        loadAll(token);
      }},
    ]);
  };

  const confirmDelete = (type, id, endpoint) => {
    Alert.alert('Delete', 'Sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        const r = await api('DELETE', endpoint || `/api/${type}/${id}`, null, token);
        if (r?.error || (r.__status && r.__status >= 400)) {
          Alert.alert('Error', r.message || 'Delete failed');
        }
        loadAll(token);
      }},
    ]);
  };

  // ── BUS ──
  // FIX (gap #3): now handles both create (editingBusId === '') and
  // edit (PATCH the existing bus) from the same form/modal.
  const addBus = async () => {
    if (!fBus.busNo) return Alert.alert('Required', 'Bus number is required');
    if (editingBusId) {
      const r = await api('PATCH', `/api/buses/${editingBusId}`, fBus, token);
      if (r?.error || (r.__status && r.__status >= 400)) {
        Alert.alert('Error', r?.message || 'Failed to update bus');
        return;
      }
      Alert.alert('✅ Success', 'Bus updated!');
      setMBus(false); setEditingBusId(''); setFBus({ busNo: '', driverName: '', status: 'ACTIVE' });
      loadAll(token);
      return;
    }
    const r = await api('POST', '/api/buses', fBus, token);
    if (r?.success || r?.id || r?.bus) {
      Alert.alert('✅ Success', 'Bus added!');
      setMBus(false); setFBus({ busNo: '', driverName: '', status: 'ACTIVE' });
      const newBus = r?.bus || r;
      if (newBus?.id) setBuses(prev => [...prev, newBus]);
      loadAll(token);
    } else Alert.alert('Error', r?.message || 'Failed to add bus');
  };

  const openEditBus = (b) => {
    setEditingBusId(b.id);
    setFBus({ busNo: b.busNo || '', driverName: b.driverName || '', status: b.status || 'ACTIVE' });
    setMBus(true);
  };

  // ── DRIVER ──
  // Creates the driver via the real Driver table (POST /api/drivers).
  // Before that, checks the already-loaded drivers list for a matching
  // phone number and asks for confirmation — this is a client-side
  // safety net against accidentally creating a second Driver row for
  // someone who already exists (Driver.phone has no unique constraint
  // in the schema, so nothing stops a dupe at the DB level either).
  const doCreateDriver = async () => {
    const payload = { ...fDriver, experience: parseInt(fDriver.experience) || 0, busId: fDriver.busId || null };
    console.log('[ADMIN] Driver create:', payload);
    const r = await api('POST', '/api/drivers', payload, token);
    console.log('[ADMIN] Driver create response:', r);

    if (r?.success && r?.driver) {
      Alert.alert('✅ Success', 'Driver added!');
      setMDriver(false);
      setFDriver({ name: '', phone: '', licenseNo: '', licenseExpiry: '', busId: '', experience: '0' });
      setDrivers(prev => [...prev, r.driver]); // instant — don't wait for reload
      loadAll(token);
    } else {
      Alert.alert('Error', r?.message || 'Failed to add driver');
    }
  };

  // FIX (gap #3): edit an existing driver — PATCH instead of POST.
  const doUpdateDriver = async () => {
    const payload = { ...fDriver, experience: parseInt(fDriver.experience) || 0, busId: fDriver.busId || null };
    const r = await api('PATCH', `/api/drivers/${editingDriverId}`, payload, token);
    if (r?.error || (r.__status && r.__status >= 400)) {
      Alert.alert('Error', r?.message || 'Failed to update driver');
      return;
    }
    Alert.alert('✅ Success', 'Driver updated!');
    setMDriver(false); setEditingDriverId('');
    setFDriver({ name: '', phone: '', licenseNo: '', licenseExpiry: '', busId: '', experience: '0' });
    loadAll(token);
  };

  const addDriver = async () => {
    if (!fDriver.name || !fDriver.phone)
      return Alert.alert('Required', 'Name and phone are required');

    if (editingDriverId) { doUpdateDriver(); return; }

    const enteredPhone = normalizePhone(fDriver.phone);
    const existing = drivers.find(d => normalizePhone(d.phone) === enteredPhone);
    if (existing) {
      Alert.alert(
        '⚠️ Driver already exists',
        `"${existing.name}" is already registered with this phone number (${existing.phone}). Add a duplicate anyway?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Add anyway', style: 'destructive', onPress: doCreateDriver },
        ]
      );
      return;
    }

    doCreateDriver();
  };

  const openEditDriver = (d) => {
    setEditingDriverId(d.id);
    setFDriver({
      name: d.name || '', phone: d.phone || '', licenseNo: d.licenseNo || '',
      licenseExpiry: d.licenseExpiry || '', busId: d.busId || '', experience: String(d.experience || 0),
    });
    setMDriver(true);
  };

  const assignBusToDriver = async (driverId, busId) => {
    const r = await api('PATCH', `/api/drivers/${driverId}/assign-bus`, { busId: busId || null }, token);
    if (r?.success) {
      setAssigningDriverId('');
      loadAll(token);
    } else {
      // Conflict message ("bus already assigned to another driver") shown directly
      Alert.alert('Cannot assign', r?.message || 'Failed to assign bus');
    }
  };

  // ── STOP (directly under a Bus — no Route model) ──
  // FIX (gap #8): block adding a stop whose name already exists on this
  // same bus (case-insensitive) — the spec calls this out as a required
  // duplicate check ("Duplicate stop on same route").
  const addStop = async (keepOpen = false) => {
    if (!fStop.name) return Alert.alert('Required', 'Stop name daalo');
    if (!fStop.busId) return Alert.alert('Required', 'Bus select karo');
    if (!fStop.lat || !fStop.lng)
      return Alert.alert('Required', '"Current Location" ya "Choose from Map" se location select karo');

    const dupe = stops.find(s => s.busId === fStop.busId && s.name.trim().toLowerCase() === fStop.name.trim().toLowerCase());
    if (dupe) {
      return Alert.alert('Duplicate Stop', `"${fStop.name}" is already added to this bus.`);
    }

    const r = await api('POST', '/api/stops', {
      busId: fStop.busId, name: fStop.name, lat: parseFloat(fStop.lat), lng: parseFloat(fStop.lng),
    }, token);
    if (r?.success || r?.stop) {
      if (!keepOpen) {
        Alert.alert('✅ Success', 'Stop added!');
        setMStop(false);
      } else {
        Alert.alert('✅ Success', `"${fStop.name}" added! Next stop add karo.`);
      }
      setFStop({ name: '', lat: '', lng: '', busId: fStop.busId }); // keep bus selected for adding more stops
      setStopLocManual(false);
      loadAll(token);
    } else Alert.alert('Error', r?.message || 'Failed to add stop');
  };

  const deleteStop = (stopId) => confirmDelete('stops', stopId, `/api/stops/${stopId}`);

  const moveStopOrder = async (busId, stopId, direction) => {
    const busStops = stops
      .filter(s => s.busId === busId)
      .sort((a, b) => (a.order || 0) - (b.order || 0));
    const idx = busStops.findIndex(s => s.id === stopId);
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (idx === -1 || swapIdx < 0 || swapIdx >= busStops.length) return;

    const reordered = [...busStops];
    [reordered[idx], reordered[swapIdx]] = [reordered[swapIdx], reordered[idx]];
    const orderedStopIds = reordered.map(s => s.id);

    const prevStops = stops;
    setStops(prev => prev.map(s => {
      const newIdx = orderedStopIds.indexOf(s.id);
      return newIdx === -1 ? s : { ...s, order: newIdx + 1 };
    }));

    setReorderingStopId(stopId);
    const r = await api('PATCH', '/api/stops/reorder', { busId, stopIds: orderedStopIds }, token);
    setReorderingStopId('');

    if (r?.error || (r.__status && r.__status >= 400)) {
      setStops(prevStops);
      Alert.alert('Error', r?.message || 'Reorder failed');
      return;
    }
    loadAll(token);
  };

  const captureStopLocation = async () => {
    setStopLocating(true);
    try {
      const loc = await getCurrentLocation();
      setFStop(prev => ({ ...prev, lat: String(loc.lat), lng: String(loc.lng) }));
      setStopLocManual(false);
    } catch (e) {
      Alert.alert(
        'Location Error',
        e.message === 'PERMISSION_DENIED' || e.code === 1
          ? 'Location permission allow karo Settings mein, ya "Choose from Map" use karo.'
          : (e.message || 'GPS location nahi mil paya, "Choose from Map" try karo ya manually bharo.')
      );
      setStopLocManual(true);
    } finally {
      setStopLocating(false);
    }
  };

  const runStopSearch = async () => {
    const q = stopSearchQuery.trim();
    if (!q) return;
    setStopSearching(true);
    setStopSearchError('');
    try {
      const results = await searchPlaces(q);
      setStopSearchResults(results);
      if (results.length === 0) setStopSearchError('Kuch nahi mila — naam thoda alag try karo');
    } catch (e) {
      setStopSearchError(e.message || 'Search failed');
      setStopSearchResults([]);
    } finally {
      setStopSearching(false);
    }
  };

  const pickStopSearchResult = (r) => {
    setFStop(prev => ({ ...prev, lat: String(r.lat), lng: String(r.lng) }));
    setStopLocManual(false);
    setStopSearchResults([]);
    setStopSearchQuery('');
  };

  const openMapPicker = () => {
    setMapMarker(fStop.lat && fStop.lng ? { lat: parseFloat(fStop.lat), lng: parseFloat(fStop.lng) } : null);
    setMMapPicker(true);
  };

  const confirmMapLocation = async () => {
    if (!mapMarker) return Alert.alert('Select Location', 'Map par tap karke pehle location select karo');
    setFStop(prev => ({ ...prev, lat: String(mapMarker.lat), lng: String(mapMarker.lng) }));
    setStopLocManual(false);
    setMMapPicker(false);

    if (!fStop.name.trim()) {
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${mapMarker.lat}&lon=${mapMarker.lng}&format=json`);
        const json = await res.json();
        const placeName = json.address?.road || json.address?.suburb || json.address?.city || json.display_name?.split(',')[0];
        if (placeName) {
          setFStop(prev => ({ ...prev, name: placeName }));
        }
      } catch(e){}
    }
  };

  // ── STUDENT ──
  const addStudent = async () => {
    if (!fStudent.name || !fStudent.parentPhone)
      return Alert.alert('Required', 'Name aur Parent Phone zaroori hai');
    if (!fStudent.busId) return Alert.alert('Required', 'Bus select karo');
    const r = await api('POST', '/api/students', fStudent, token);
    if (r?.success || r?.id || r?.student) {
      Alert.alert('✅ Success', 'Student added!');
      setMStudent(false);
      setFStudent({ name: '', admissionNo: '', busId: '', parentPhone: '', class: '', stopId: '' });
      loadAll(token);
    } else Alert.alert('Error', r?.message || 'Failed to add student');
  };

  const addEmergency = async () => {
    if (!fEmerg.busId) return Alert.alert('Required', 'Please select a bus');
    const r = await api('POST', '/api/emergencies', fEmerg, token);
    if (r?.success || r?.id || r?.emergency) {
      Alert.alert('✅ Success', 'Emergency logged!');
      setMEmerg(false); loadAll(token);
    } else Alert.alert('Error', r?.message || 'Failed');
  };

  const markAttendance = async () => {
    if (!fAttend.busId || !fAttend.studentId)
      return Alert.alert('Required', 'Select bus and student');
    const r = await api('POST', '/api/attendance', fAttend, token);
    if (r?.success || r?.id || r?.attendance) {
      Alert.alert('✅ Success', 'Attendance marked!');
      setMAttend(false); loadAll(token);
    } else Alert.alert('Error', r?.message || 'Failed');
  };

  // ── CSV IMPORT — resolves "Bus Number" + "Bus Stop" TEXT columns to
  // real busId/stopId using the buses/stops already loaded. Admin never
  // types an ID, and a stop that doesn't belong to that bus is rejected. ──
  const previewCSV = () => {
    if (!csvText.trim()) return Alert.alert('Error', 'Paste CSV data first');

    let rows = [];
    try {
      rows = parseCSV(csvText);
    } catch (e) {
      return Alert.alert('Error', 'CSV format samajh nahi aaya.');
    }
    if (rows.length === 0) {
      return Alert.alert('Error', 'CSV mein data nahi mila. Headers: name,parentphone,class,admissionno,busnumber,busstop');
    }

    const existingAdmissions = new Set(students.map(s => (s.admissionNo || '').toLowerCase()).filter(Boolean));
    const busByNo = Object.fromEntries(buses.map(b => [String(b.busNo).toLowerCase().trim(), b]));

    const validated = rows.map(row => {
      const name        = row.name || row.studentname || '';
      const parentPhone = row.parentphone || row.phone || row.contact || '';
      const className    = row.class || row.grade || '';
      const admissionNo  = row.admissionno || row.admission || row.id || '';
      const busNoRaw      = row.busnumber || row.busno || row.bus || '';
      const stopNameRaw   = row.busstop || row.stop || row.stopname || '';

      let error = null;
      let busId = '', stopId = '';

      if (!name) error = 'Name missing';
      else if (!parentPhone) error = 'Parent phone missing';
      else if (admissionNo && existingAdmissions.has(admissionNo.toLowerCase())) {
        error = `Admission No "${admissionNo}" already exists (duplicate)`;
      } else if (!busNoRaw) {
        error = 'Bus Number missing';
      } else {
        const bus = busByNo[busNoRaw.toLowerCase().trim()];
        if (!bus) {
          error = `Bus "${busNoRaw}" does not exist`;
        } else {
          busId = bus.id;
          if (stopNameRaw) {
            const stop = stops.find(s => s.busId === bus.id && s.name.toLowerCase().trim() === stopNameRaw.toLowerCase().trim());
            if (!stop) {
              error = `"${stopNameRaw}" does not belong to ${busNoRaw}`;
            } else {
              stopId = stop.id;
            }
          }
        }
      }

      return { name, parentPhone, className, admissionNo, busNoRaw, stopNameRaw, busId, stopId, error };
    });

    setCSVPreviewRows(validated);
    setCSVPreviewVisible(true);
  };

  const confirmCSVImport = async () => {
    if (csvUploading) return;
    const validRows = csvPreviewRows.filter(r => !r.error);
    if (validRows.length === 0) {
      Alert.alert('Nothing to import', 'Koi valid row nahi hai import karne ke liye');
      return;
    }

    setCSVPreviewVisible(false);
    setCSVUploading(true);
    setCSVStatus(`Processing ${validRows.length} rows...`);
    let success = 0, failed = 0;

    for (const row of validRows) {
      try {
        const r = await api('POST', '/api/students', {
          name: row.name, parentPhone: row.parentPhone, class: row.className,
          admissionNo: row.admissionNo, busId: row.busId, stopId: row.stopId || '',
        }, token);
        if (r?.success || r?.id || r?.student) success++;
        else failed++;
      } catch (e) {
        failed++;
      }
      setCSVStatus(`Processing... ✅ ${success}  ❌ ${failed}  (${success + failed}/${validRows.length})`);
    }

    setCSVStatus(`✅ Done! Added: ${success} | Failed: ${failed}`);
    setCSVUploading(false);
    setCSVPreviewRows([]);
    loadAll(token);
  };

  if (loading) {
    return (
      <SafeAreaView style={[c.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={P} />
        <Text style={{ color: '#888', marginTop: 12, fontSize: 14 }}>Loading admin panel...</Text>
      </SafeAreaView>
    );
  }

  const TABS = [
    { id: 'dash',     icon: '📊', label: 'Home' },
    { id: 'buses',    icon: '🚌', label: 'Buses' },
    { id: 'routes',   icon: '🗺️', label: 'Routes' },
    { id: 'students', icon: '🎓', label: 'Students' },
    { id: 'parents',  icon: '👪', label: 'Parents' },
    { id: 'drivers',  icon: '👨‍✈️', label: 'Drivers' },
    { id: 'stops',    icon: '📍', label: 'Stops' },
    { id: 'attend',   icon: '✅', label: 'Attend' },
    { id: 'sos',      icon: '🆘', label: 'SOS' },
    { id: 'csv',      icon: '📄', label: 'CSV' },
  ];

  // ── DASHBOARD ALERTS (#19 auto warnings) ──
  const dashAlerts = (() => {
    const alerts = [];

    const wrongBusStudents = students.filter(st => {
      if (!st.stopId) return false;
      const stop = stops.find(sp => sp.id === st.stopId);
      return stop && stop.busId && st.busId && stop.busId !== st.busId;
    });
    if (wrongBusStudents.length > 0) {
      alerts.push({ icon: '⚠️', color: '#EA4335', text: `${wrongBusStudents.length} student(s) ka pickup stop unki bus se match nahi karta`, tab: 'students' });
    }

    const noStopStudents = students.filter(st => !st.stopId);
    if (noStopStudents.length > 0) {
      alerts.push({ icon: '📍', color: '#FF9800', text: `${noStopStudents.length} student(s) ka pickup stop set nahi hai`, tab: 'students' });
    }

    const busesNoDriver = buses.filter(b => !drivers.some(d => d.busId === b.id));
    if (busesNoDriver.length > 0) {
      alerts.push({ icon: '👨‍✈️', color: '#EA4335', text: `${busesNoDriver.length} bus(es) ka driver assign nahi hai`, tab: 'buses' });
    }

    const driversNoBus = drivers.filter(d => !d.busId);
    if (driversNoBus.length > 0) {
      alerts.push({ icon: '🚌', color: '#FF9800', text: `${driversNoBus.length} driver(s) ko koi bus assign nahi hai`, tab: 'drivers' });
    }

    const busesNoStops = buses.filter(b => !stops.some(s => s.busId === b.id));
    if (busesNoStops.length > 0) {
      alerts.push({ icon: '📍', color: '#FF9800', text: `${busesNoStops.length} bus(es) mein abhi koi stop nahi hai`, tab: 'stops' });
    }

    // Duplicate driver phone numbers — flags exactly the kind of dupe
    // record that a broken login flow can create.
    const phoneGroups = {};
    drivers.forEach(d => {
      const key = normalizePhone(d.phone);
      if (!key) return;
      (phoneGroups[key] = phoneGroups[key] || []).push(d);
    });
    const dupeDriverCount = Object.values(phoneGroups).filter(g => g.length > 1).length;
    if (dupeDriverCount > 0) {
      alerts.push({ icon: '👥', color: '#EA4335', text: `${dupeDriverCount} phone number(s) have duplicate driver records`, tab: 'drivers' });
    }

    // FIX (gap #6): active trip but GPS hasn't updated in a while.
    const staleBuses = trips.filter(t => {
      const bid = t.busId || t.id;
      const lastSeen = liveGpsMap[bid];
      return lastSeen == null || (Date.now() - lastSeen) > GPS_STALE_MS;
    });
    if (staleBuses.length > 0) {
      alerts.push({ icon: '📡', color: '#EA4335', text: `${staleBuses.length} active trip(s) — GPS not updating`, tab: 'buses' });
    }

    return alerts;
  })();

  const liveBusesSorted = [...buses].sort((a, b) => {
    const aLive = trips.some(t => t.id === a.id || t.busId === a.id) ? 1 : 0;
    const bLive = trips.some(t => t.id === b.id || t.busId === b.id) ? 1 : 0;
    return bLive - aLive;
  });
  const isBusLive = (busId) => trips.some(t => t.id === busId || t.busId === busId);

  // ── DASH ──
  const renderDash = () => (
    <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[P]} />} showsVerticalScrollIndicator={false}>
      <View style={[c.card, { margin: 16, backgroundColor: P }]}>
        <Text style={{ fontSize: 20, fontWeight: 'bold', color: '#fff' }}>{getGreeting()}, Admin!</Text>
        <Text style={{ color: '#BBDEFB', marginTop: 4 }}>Where Is My Bus</Text>
        <Text style={{ color: '#BBDEFB', fontSize: 11, marginTop: 2 }}>
          {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
        </Text>
      </View>

      {dashAlerts.length > 0 && (
        <View style={[c.card, { margin: 16, marginTop: 0, borderLeftWidth: 4, borderLeftColor: '#EA4335' }]}>
          <Text style={c.cardHead}>🚨 Alerts ({dashAlerts.length})</Text>
          {dashAlerts.map((al, i) => (
            <TouchableOpacity key={i} onPress={() => setTab(al.tab)} style={[c.row, { borderBottomWidth: i === dashAlerts.length - 1 ? 0 : 1 }]}>
              <Text style={{ fontSize: 13, color: '#333', flex: 1 }}>{al.icon}  {al.text}</Text>
              <Text style={{ color: al.color, fontSize: 12, fontWeight: 'bold' }}>Fix ›</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <View style={c.statsGrid}>
        {[
          { icon: '🚌', label: 'Buses',    val: buses.length,    color: P,        tab: 'buses' },
          { icon: '👨‍✈️', label: 'Drivers', val: drivers.length,  color: '#673AB7', tab: 'drivers' },
          { icon: '🎓', label: 'Students', val: students.length, color: '#34A853', tab: 'students' },
          { icon: '👪', label: 'Parents',  val: new Set(students.map(s => normalizePhone(s.parentPhone)).filter(Boolean)).size, color: '#009688', tab: 'parents' },
          { icon: '📍', label: 'Stops',    val: stops.length,    color: '#FF9800', tab: 'stops' },
          { icon: '🗺️', label: 'Live',    val: trips.length,    color: '#00BCD4', tab: 'buses' },
          { icon: '🆘', label: 'SOS',      val: emergencies.filter(e => e.status === 'open').length, color: '#EA4335', tab: 'sos' },
        ].map((item, i) => (
          <TouchableOpacity key={i} style={c.statCard} onPress={() => setTab(item.tab)} activeOpacity={0.8}>
            <Text style={{ fontSize: 26 }}>{item.icon}</Text>
            <Text style={[c.statVal, { color: item.color }]}>{item.val}</Text>
            <Text style={c.statLbl}>{item.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={[c.card, { margin: 16, marginTop: 0 }]}>
        <Text style={c.cardHead}>⚡ Quick Actions</Text>
        <View style={c.qaGrid}>
          {[
            { icon: '🚌', label: 'Add Bus',     onPress: () => setMBus(true) },
            { icon: '📍', label: 'Add Stop',    onPress: () => setMStop(true) },
            { icon: '🎓', label: 'Add Student', onPress: () => setMStudent(true) },
            { icon: '👨‍✈️',label: 'Add Driver', onPress: () => setMDriver(true) },
            { icon: '✅', label: 'Attendance',  onPress: () => setMAttend(true) },
            { icon: '📄', label: 'CSV Upload',  onPress: () => setTab('csv') },
            { icon: '🆘', label: 'Log SOS',     onPress: () => setMEmerg(true), red: true },
          ].map((item, i) => (
            <TouchableOpacity key={i} style={[c.qaBtn, item.red && { borderColor: '#EA4335' }]} onPress={item.onPress} activeOpacity={0.75}>
              <Text style={{ fontSize: 22 }}>{item.icon}</Text>
              <Text style={[c.qaLbl, item.red && { color: '#EA4335' }]}>{item.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={[c.card, { margin: 16, marginTop: 0 }]}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <Text style={[c.cardHead, { marginBottom: 0 }]}>🚌 Fleet Status</Text>
          <Text style={{ fontSize: 12, color: '#34A853', fontWeight: 'bold' }}>{trips.length} running now</Text>
        </View>
        {buses.length === 0 && <Text style={c.empty}>No buses — use Add Bus</Text>}
        {liveBusesSorted.slice(0, 10).map((b, i) => {
          const live = isBusLive(b.id);
          const driver = drivers.find(d => d.busId === b.id);
          return (
            <TouchableOpacity key={i} style={c.row} onPress={() => setTab('buses')} activeOpacity={0.7}>
              <View>
                <Text style={c.rowTitle}>{busLabel(b)}</Text>
                <Text style={c.rowSub}>{driver?.name || 'No driver'}</Text>
              </View>
              <Tag label={live ? '● LIVE' : '○ IDLE'} color={live ? '#34A853' : '#888'} />
            </TouchableOpacity>
          );
        })}
      </View>
      <View style={{ height: 20 }} />
    </ScrollView>
  );

  // ── BUSES (each bus shows its own stops inline — no Route tab) ──
  const renderBuses = () => {
    const filteredBuses = buses.filter(b =>
      !busSearch.trim() || String(b.busNo || '').toLowerCase().includes(busSearch.trim().toLowerCase())
    );
    return (
    <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[P]} />} showsVerticalScrollIndicator={false}>
      <View style={c.secHead}>
        <Text style={c.secTitle}>🚌 Buses ({buses.length})</Text>
        <TouchableOpacity style={c.addBtn} onPress={() => { setEditingBusId(''); setFBus({ busNo: '', driverName: '', status: 'ACTIVE' }); setMBus(true); }}>
          <Text style={c.addBtnTxt}>+ Add Bus</Text>
        </TouchableOpacity>
      </View>
      <View style={{ paddingHorizontal: 16, marginBottom: 8 }}>
        <TextInput style={c.inp} value={busSearch} onChangeText={setBusSearch} placeholder="Search bus number" placeholderTextColor="#bbb" />
      </View>
      {buses.length === 0 && <View style={c.emptyBox}><Text style={{ fontSize: 40 }}>🚌</Text><Text style={c.emptyTxt}>No buses yet</Text></View>}
      {filteredBuses.map((b, i) => {
        const live      = isBusLive(b.id);
        const driver    = drivers.find(d => d.busId === b.id);
        const busStops  = stops.filter(s => s.busId === b.id).sort((a, x) => (a.order || 0) - (x.order || 0));
        const stCount   = students.filter(s => s.busId === b.id).length;
        const gpsStale  = live && (liveGpsMap[b.id] == null || (Date.now() - liveGpsMap[b.id]) > GPS_STALE_MS);
        return (
          <View key={b.id || i} style={[c.card, { margin: 12, marginBottom: 0 }]}>
            <View style={c.row}>
              <View style={{ flex: 1 }}>
                <Text style={c.itemTitle}>{busLabel(b)}</Text>
                <Text style={c.itemSub}>👨‍✈️ {driver?.name || 'No driver'}</Text>
                <Text style={c.itemSub}>📍 {busStops.length} stops • 🎓 {stCount} students</Text>
                {gpsStale && <Text style={[c.itemSub, { color: '#EA4335', fontWeight: 'bold' }]}>📡 GPS not updating</Text>}
              </View>
              <View style={{ alignItems: 'flex-end', gap: 6 }}>
                <Tag label={live ? '● LIVE' : b.status === 'INACTIVE' ? '○ INACTIVE' : '○ IDLE'} color={live ? '#34A853' : '#888'} />
                <TouchableOpacity onPress={() => openLiveLocation(b)}>
                  <Text style={{ color: '#00BCD4', fontSize: 12 }}>📍 View Live Location</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => openEditBus(b)}>
                  <Text style={{ color: P, fontSize: 12 }}>✎ Edit</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => confirmDelete('buses', b.id)}>
                  <Text style={{ color: '#EA4335', fontSize: 12 }}>🗑 Deactivate</Text>
                </TouchableOpacity>
              </View>
            </View>
            {busStops.map((st, j) => (
              <View key={j} style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                <View style={[c.dot, { backgroundColor: j === 0 ? '#34A853' : j === busStops.length - 1 ? '#EA4335' : P }]}>
                  <Text style={{ color: '#fff', fontSize: 9, fontWeight: 'bold' }}>{j + 1}</Text>
                </View>
                <Text style={{ fontSize: 12, color: '#555', flex: 1 }}>{st.name}</Text>
                {/* FIX (gap #1): reorder buttons — were defined (moveStopOrder) but never wired to any button */}
                <TouchableOpacity
                  disabled={j === 0 || reorderingStopId === st.id}
                  onPress={() => moveStopOrder(b.id, st.id, 'up')}
                  style={{ paddingHorizontal: 6, opacity: j === 0 ? 0.25 : 1 }}
                >
                  <Text style={{ fontSize: 14 }}>▲</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  disabled={j === busStops.length - 1 || reorderingStopId === st.id}
                  onPress={() => moveStopOrder(b.id, st.id, 'down')}
                  style={{ paddingHorizontal: 6, opacity: j === busStops.length - 1 ? 0.25 : 1 }}
                >
                  <Text style={{ fontSize: 14 }}>▼</Text>
                </TouchableOpacity>
                {reorderingStopId === st.id
                  ? <ActivityIndicator size="small" color={P} style={{ marginLeft: 4 }} />
                  : <Text style={{ fontSize: 10, color: '#aaa', marginLeft: 4 }}>{safeFixed(st.lat, 3)},{safeFixed(st.lng, 3)}</Text>}
              </View>
            ))}
            <TouchableOpacity onPress={() => { setFStop({ name: '', lat: '', lng: '', busId: b.id }); setMStop(true); }}>
              <Text style={{ color: P, fontSize: 12, marginTop: 8 }}>+ {busStops.length ? 'Aur stop add karo' : 'Pehla stop add karo'}</Text>
            </TouchableOpacity>
          </View>
        );
      })}
      <View style={{ height: 20 }} />
    </ScrollView>
    );
  };

  // ── STUDENTS ──
  // ── ROUTES tab ──
  const renderRoutes = () => (
    <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[P]} />} showsVerticalScrollIndicator={false}>
      <View style={c.secHead}>
        <Text style={c.secTitle}>🗺️ Routes ({routes.length})</Text>
        <TouchableOpacity style={c.addBtn} onPress={() => { setEditingRouteId(''); setFRoute({ name: '', busId: '', startPoint: '', endPoint: '' }); setMRoute(true); }}>
          <Text style={c.addBtnTxt}>+ Create Route</Text>
        </TouchableOpacity>
      </View>
      {routes.length === 0 && <View style={c.emptyBox}><Text style={{ fontSize: 40 }}>🗺️</Text><Text style={c.emptyTxt}>No routes yet</Text></View>}
      {routes.map((r, i) => {
        const bus = buses.find(b => b.id === r.busId);
        const isExpanded = expandedRouteId === r.id;
        const detail = routeDetailsMap[r.id];
        const routeStops = (detail?.stops || r.stops || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
        return (
          <View key={r.id || i} style={[c.card, { margin: 12, marginBottom: 0 }]}>
            <View style={c.row}>
              <View style={{ flex: 1 }}>
                <Text style={c.itemTitle}>{r.name}</Text>
                <Text style={c.itemSub}>🚌 {bus ? busLabel(bus) : 'No bus assigned'}</Text>
                <Text style={c.itemSub}>🟢 {r.startPoint} {r.endPoint ? `→ 🏫 ${r.endPoint}` : ''}</Text>
                <Text style={c.itemSub}>📍 {(detail?.stops?.length ?? r._count?.stops ?? r.stops?.length ?? '—')} stops</Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 6 }}>
                <TouchableOpacity onPress={() => openEditRoute(r)}>
                  <Text style={{ color: P, fontSize: 12 }}>✎ Edit</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => deleteRouteConfirm(r.id)}>
                  <Text style={{ color: '#EA4335', fontSize: 12 }}>🗑 Delete</Text>
                </TouchableOpacity>
              </View>
            </View>
            <TouchableOpacity onPress={() => toggleRouteExpand(r.id)} style={{ marginTop: 8 }}>
              <Text style={{ color: P, fontSize: 12, fontWeight: 'bold' }}>{isExpanded ? '▲ Hide Stops' : '▼ View/Edit Stops'}</Text>
            </TouchableOpacity>
            {isExpanded && (
              <View style={{ marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#F5F5F5' }}>
                {routeDetailLoading === r.id ? (
                  <ActivityIndicator color={P} />
                ) : (
                  <>
                    {routeStops.length === 0 && <Text style={{ fontSize: 12, color: '#aaa', marginBottom: 8 }}>Is route mein abhi koi stop nahi hai</Text>}
                    {routeStops.map((st, j) => (
                      <View key={st.id || j} style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                        <View style={[c.dot, { backgroundColor: P }]}>
                          <Text style={{ color: '#fff', fontSize: 9, fontWeight: 'bold' }}>{st.order ?? j + 1}</Text>
                        </View>
                        <Text style={{ fontSize: 12, color: '#555', flex: 1 }}>{st.name}</Text>
                        <TouchableOpacity onPress={() => deleteRouteStopConfirm(r.id, st.id)}>
                          <Text style={{ color: '#EA4335', fontSize: 12, paddingHorizontal: 6 }}>🗑</Text>
                        </TouchableOpacity>
                      </View>
                    ))}
                    <TouchableOpacity onPress={() => openAddRouteStop(r.id)}>
                      <Text style={{ color: P, fontSize: 12, marginTop: 8 }}>+ Stop add karo route mein</Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>
            )}
          </View>
        );
      })}
      <View style={{ height: 20 }} />
    </ScrollView>
  );

  const renderStudents = () => {
    const filteredStudents = students.filter(st =>
      !studentSearch.trim() ||
      st.name.toLowerCase().includes(studentSearch.trim().toLowerCase()) ||
      (st.admissionNo || '').toLowerCase().includes(studentSearch.trim().toLowerCase()) ||
      normalizePhone(st.parentPhone).includes(normalizePhone(studentSearch))
    );
    return (
    <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[P]} />} showsVerticalScrollIndicator={false}>
      <View style={c.secHead}>
        <Text style={c.secTitle}>🎓 Students ({students.length})</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity style={[c.addBtn, { backgroundColor: '#34A853' }]} onPress={() => setTab('csv')}>
            <Text style={c.addBtnTxt}>CSV</Text>
          </TouchableOpacity>
          <TouchableOpacity style={c.addBtn} onPress={() => setMStudent(true)}>
            <Text style={c.addBtnTxt}>+ Add</Text>
          </TouchableOpacity>
        </View>
      </View>
      <View style={{ paddingHorizontal: 16, marginBottom: 8 }}>
        <TextInput style={c.inp} value={studentSearch} onChangeText={setStudentSearch} placeholder="Search by name, admission no, or parent phone" placeholderTextColor="#bbb" />
      </View>
      {students.length === 0 && <View style={c.emptyBox}><Text style={{ fontSize: 40 }}>🎓</Text><Text style={c.emptyTxt}>No students yet{'\n'}Use CSV upload to add many</Text></View>}
      {filteredStudents.map((st, i) => {
        const bus  = buses.find(b => b.id === st.busId);
        const stop = stops.find(sp => sp.id === st.stopId);
        return (
          <View key={st.id || i} style={[c.card, { margin: 12, marginBottom: 0 }]}>
            <View style={c.row}>
              <View style={{ flex: 1 }}>
                <Text style={c.itemTitle}>{st.name}</Text>
                <Text style={c.itemSub}>Class: {st.class || 'N/A'} • 📱 {st.parentPhone}</Text>
                <Text style={c.itemSub}>🚌 {bus ? busLabel(bus) : 'N/A'}</Text>
                {stop && <Text style={c.itemSub}>📍 Pickup: {stop.name}</Text>}
              </View>
              <TouchableOpacity onPress={() => confirmDelete('students', st.id)}>
                <Text style={{ color: '#EA4335', fontSize: 18 }}>🗑</Text>
              </TouchableOpacity>
            </View>
          </View>
        );
      })}
      <View style={{ height: 20 }} />
    </ScrollView>
    );
  };

  // ── DRIVERS ──
  const renderDrivers = () => {
    const filteredDrivers = drivers.filter(d =>
      !driverSearch.trim() ||
      (d.name || '').toLowerCase().includes(driverSearch.trim().toLowerCase()) ||
      normalizePhone(d.phone).includes(normalizePhone(driverSearch))
    );
    return (
    <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[P]} />} showsVerticalScrollIndicator={false}>
      <View style={c.secHead}>
        <Text style={c.secTitle}>👨‍✈️ Drivers ({drivers.length})</Text>
        <TouchableOpacity style={c.addBtn} onPress={() => { setEditingDriverId(''); setFDriver({ name: '', phone: '', licenseNo: '', licenseExpiry: '', busId: '', experience: '0' }); setMDriver(true); }}>
          <Text style={c.addBtnTxt}>+ Add</Text>
        </TouchableOpacity>
      </View>
      <View style={{ paddingHorizontal: 16, marginBottom: 8 }}>
        <TextInput style={c.inp} value={driverSearch} onChangeText={setDriverSearch} placeholder="Search by name or phone" placeholderTextColor="#bbb" />
      </View>
      {drivers.length === 0 && <View style={c.emptyBox}><Text style={{ fontSize: 40 }}>👨‍✈️</Text><Text style={c.emptyTxt}>No drivers yet</Text></View>}
      {filteredDrivers.map((d, i) => {
        const rawDays = d.licenseExpiry ? Math.floor((new Date(d.licenseExpiry) - new Date()) / 86400000) : 999;
        const days = isNaN(rawDays) ? 999 : rawDays;
        const bus  = buses.find(b => b.id === d.busId);
        const isAssigning = assigningDriverId === d.id;
        const isDupe = drivers.filter(x => normalizePhone(x.phone) === normalizePhone(d.phone)).length > 1;
        return (
          <View key={d.id || i} style={[c.card, { margin: 12, marginBottom: 0 }, isDupe && { borderWidth: 1, borderColor: '#EA4335' }]}>
            <View style={c.row}>
              <View style={{ flex: 1 }}>
                <Text style={c.itemTitle}>{d.name} {isDupe && <Text style={{ color: '#EA4335', fontSize: 12 }}>⚠️ duplicate phone</Text>}</Text>
                <Text style={c.itemSub}>📱 {d.phone} • {d.experience || 0} yrs exp</Text>
                <Text style={[c.itemSub, days <= 30 && { color: '#FF9800', fontWeight: 'bold' }]}>
                  License: {d.licenseNo || 'N/A'} {days <= 30 ? `⚠️ expires in ${days}d` : '✅'}
                </Text>
                <Text style={c.itemSub}>
                  🚌 {bus ? busLabel(bus) : <Text style={{ color: '#FF9800' }}>No bus assigned</Text>}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 6 }}>
                {days <= 30 && <Tag label="EXPIRING" color="#FF9800" />}
                <TouchableOpacity onPress={() => openEditDriver(d)}>
                  <Text style={{ color: P, fontSize: 12 }}>✎ Edit</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setAssigningDriverId(isAssigning ? '' : d.id)}>
                  <Text style={{ color: P, fontSize: 12 }}>🚌 Assign</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => confirmDelete('drivers', d.id)}>
                  <Text style={{ color: '#EA4335', fontSize: 12 }}>🗑 Delete</Text>
                </TouchableOpacity>
              </View>
            </View>
            {isAssigning && (
              <View style={{ marginTop: 8 }}>
                <ChipSelect
                  items={buses.map(b => ({ id: b.id, name: busLabel(b) }))}
                  selected={d.busId || ''}
                  onSelect={(v) => assignBusToDriver(d.id, v)}
                />
              </View>
            )}
          </View>
        );
      })}
      <View style={{ height: 20 }} />
    </ScrollView>
    );
  };

  // ── STOPS ──
  const renderStops = () => (
    <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[P]} />} showsVerticalScrollIndicator={false}>
      <View style={c.secHead}>
        <Text style={c.secTitle}>📍 Stops ({stops.length})</Text>
        <TouchableOpacity style={c.addBtn} onPress={() => setMStop(true)}>
          <Text style={c.addBtnTxt}>+ Add</Text>
        </TouchableOpacity>
      </View>
      {stops.length === 0 && <View style={c.emptyBox}><Text style={{ fontSize: 40 }}>📍</Text><Text style={c.emptyTxt}>No stops yet</Text></View>}
      {stops.map((st, i) => {
        const bus = buses.find(b => b.id === st.busId);
        const cnt = students.filter(s => s.stopId === st.id).length;
        return (
          <View key={st.id || i} style={[c.card, { margin: 12, marginBottom: 0 }]}>
            <View style={c.row}>
              <View style={{ flex: 1 }}>
                <Text style={c.itemTitle}>{st.name}</Text>
                <Text style={c.itemSub}>🚌 {bus ? busLabel(bus) : 'N/A'} • Order: {st.order} • 🎓 {cnt}</Text>
                <Text style={c.itemSub}>📍 {safeFixed(st.lat, 5)}, {safeFixed(st.lng, 5)}</Text>
              </View>
              <TouchableOpacity onPress={() => deleteStop(st.id)}>
                <Text style={{ color: '#EA4335' }}>🗑</Text>
              </TouchableOpacity>
            </View>
          </View>
        );
      })}
      <View style={{ height: 20 }} />
    </ScrollView>
  );

  // ── ATTENDANCE ──
  // ── PARENTS (gap #2) — no separate Parent model in the schema, so
  // parents are derived by grouping Students on parentPhone. Each group
  // is "one parent" with however many children/stops/buses they have. ──
  const renderParents = () => {
    const groups = {};
    students.forEach(st => {
      const key = normalizePhone(st.parentPhone) || `_unknown_${st.id}`;
      if (!groups[key]) groups[key] = { phone: st.parentPhone, children: [] };
      groups[key].children.push(st);
    });
    const parentList = Object.values(groups).filter(g =>
      !parentSearch.trim() ||
      g.phone.includes(parentSearch.trim()) ||
      g.children.some(c => c.name.toLowerCase().includes(parentSearch.trim().toLowerCase()))
    );

    return (
      <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[P]} />} showsVerticalScrollIndicator={false}>
        <View style={c.secHead}>
          <Text style={c.secTitle}>👪 Parents ({Object.keys(groups).length})</Text>
        </View>
        <View style={{ paddingHorizontal: 16, marginBottom: 8 }}>
          <TextInput
            style={c.inp}
            value={parentSearch}
            onChangeText={setParentSearch}
            placeholder="Search by parent phone or child name"
            placeholderTextColor="#bbb"
          />
        </View>
        {parentList.length === 0 && <View style={c.emptyBox}><Text style={{ fontSize: 40 }}>👪</Text><Text style={c.emptyTxt}>No parents yet</Text></View>}
        {parentList.map((g, i) => (
          <View key={i} style={[c.card, { margin: 12, marginBottom: 0 }]}>
            <Text style={c.itemTitle}>📱 {g.phone}</Text>
            {g.children.map((ch, j) => {
              const bus  = buses.find(b => b.id === ch.busId);
              const stop = stops.find(sp => sp.id === ch.stopId);
              return (
                <View key={j} style={{ marginTop: 6, paddingTop: 6, borderTopWidth: j === 0 ? 0 : 1, borderTopColor: '#F5F5F5' }}>
                  <Text style={{ fontSize: 13, fontWeight: '600', color: '#333' }}>🎓 {ch.name} {ch.class ? `(${ch.class})` : ''}</Text>
                  <Text style={c.itemSub}>🚌 {bus ? busLabel(bus) : 'No bus'} {stop ? `• 📍 ${stop.name}` : ''}</Text>
                </View>
              );
            })}
          </View>
        ))}
        <View style={{ height: 20 }} />
      </ScrollView>
    );
  };

  const renderAttend = () => (
    <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[P]} />} showsVerticalScrollIndicator={false}>
      <View style={c.secHead}>
        <Text style={c.secTitle}>✅ Attendance ({attendance.length})</Text>
        <TouchableOpacity style={c.addBtn} onPress={() => setMAttend(true)}>
          <Text style={c.addBtnTxt}>+ Mark</Text>
        </TouchableOpacity>
      </View>
      {attendance.length === 0 && <View style={c.emptyBox}><Text style={{ fontSize: 40 }}>✅</Text><Text style={c.emptyTxt}>No records yet</Text></View>}
      {attendance.slice(0, 30).map((a, i) => {
        const st  = students.find(x => x.id === a.studentId);
        const bus = buses.find(b => b.id === a.busId);
        return (
          <View key={a.id || i} style={[c.card, { margin: 12, marginBottom: 0 }]}>
            <View style={c.row}>
              <View>
                <Text style={c.itemTitle}>{st?.name || 'Student'}</Text>
                <Text style={c.itemSub}>{a.date} • {a.tripType} • 🚌 {bus ? busLabel(bus) : 'N/A'}</Text>
              </View>
              <Tag label={a.boarded ? 'BOARDED' : 'ABSENT'} color={a.boarded ? '#34A853' : '#EA4335'} />
            </View>
          </View>
        );
      })}
      <View style={{ height: 20 }} />
    </ScrollView>
  );

  // ── SOS ──
  const renderSOS = () => (
    <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[P]} />} showsVerticalScrollIndicator={false}>
      <View style={c.secHead}>
        <Text style={c.secTitle}>🆘 Emergency / SOS</Text>
        <TouchableOpacity style={[c.addBtn, { backgroundColor: '#EA4335' }]} onPress={() => setMEmerg(true)}>
          <Text style={c.addBtnTxt}>+ Log SOS</Text>
        </TouchableOpacity>
      </View>
      {emergencies.length === 0 && <View style={c.emptyBox}><Text style={{ fontSize: 40 }}>🆘</Text><Text style={c.emptyTxt}>No emergencies 🎉</Text></View>}
      {emergencies.map((e, i) => {
        const bus = buses.find(b => b.id === e.busId);
        return (
          <View key={e.id || i} style={[c.card, { margin: 12, marginBottom: 0, borderLeftWidth: 4, borderLeftColor: e.status === 'open' ? '#EA4335' : '#34A853' }]}>
            <View style={c.row}>
              <View style={{ flex: 1 }}>
                <Text style={c.itemTitle}>{e.type}</Text>
                <Text style={c.itemSub}>🚌 {bus ? busLabel(bus) : 'N/A'} • 👨‍✈️ {e.driverName || 'N/A'}</Text>
                {e.notes ? <Text style={c.itemSub}>📝 {e.notes}</Text> : null}
                <Text style={c.itemSub}>{safeDateStr(e.createdAt)}</Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 6 }}>
                <Tag label={e.status?.toUpperCase() || 'OPEN'} color={e.status === 'open' ? '#EA4335' : '#34A853'} />
                <TouchableOpacity onPress={() => confirmDelete('emergencies', e.id)}>
                  <Text style={{ color: '#EA4335', fontSize: 12 }}>🗑</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        );
      })}
      <View style={{ height: 20 }} />
    </ScrollView>
  );

  // ── CSV UPLOAD ──
  const renderCSV = () => (
    <ScrollView showsVerticalScrollIndicator={false} style={{ padding: 16 }}>
      <View style={[c.card, { backgroundColor: '#EEF2FF', marginBottom: 16 }]}>
        <Text style={[c.cardHead, { color: P }]}>📄 CSV Bulk Upload</Text>
        <Text style={{ fontSize: 13, color: '#555', lineHeight: 20 }}>
          Required columns: name, parentphone, busnumber{'\n'}
          Optional: class, admissionno, busstop{'\n'}
          Bus Number aur Bus Stop se system khud busId/stopId nikal lega — koi ID type karne ki zaroorat nahi.
        </Text>
        <View style={[c.card, { backgroundColor: '#fff', marginTop: 10 }]}>
          <Text style={{ fontSize: 12, color: '#888', fontFamily: 'monospace' }}>
            name,parentphone,class,admissionno,busnumber,busstop{'\n'}
            Rahul,9876543210,5A,ADM001,RJ 37 PE 5505,KPS{'\n'}
            Priya,9811111111,6B,ADM002,RJ 37 PE 5505,Gandhi Chowk{'\n'}
            Aman,9822222222,7A,ADM003,RJ 37 PE 5505,Sadar Bazar
          </Text>
        </View>
      </View>

      <Text style={c.label}>Paste CSV Data *</Text>
      <TextInput
        style={[c.inp, { height: 180, textAlignVertical: 'top', fontFamily: 'monospace', fontSize: 12 }]}
        value={csvText}
        onChangeText={setCSVText}
        placeholder="name,parentphone,class,admissionno,busnumber,busstop"
        placeholderTextColor="#bbb"
        multiline
        autoCapitalize="none"
        autoCorrect={false}
        editable={!csvUploading}
      />

      {csvStatus ? (
        <View style={[c.card, { backgroundColor: csvStatus.includes('✅ Done') ? '#E8F5E9' : '#FFF8E1', marginVertical: 10 }]}>
          <Text style={{ color: csvStatus.includes('✅ Done') ? '#34A853' : '#FF9800', fontWeight: 'bold' }}>{csvStatus}</Text>
        </View>
      ) : null}

      <PBtn label="👁 Preview Import" onPress={previewCSV} disabled={csvUploading} />
      <View style={{ height: 8 }} />
      <OBtn label="Clear" onPress={() => { if (!csvUploading) { setCSVText(''); setCSVStatus(''); } }} color="#888" />

      <View style={{ height: 40 }} />
    </ScrollView>
  );

  const renderTab = () => {
    switch (tab) {
      case 'dash':     return renderDash();
      case 'buses':    return renderBuses();
      case 'routes':   return renderRoutes();
      case 'students': return renderStudents();
      case 'parents':  return renderParents();
      case 'drivers':  return renderDrivers();
      case 'stops':    return renderStops();
      case 'attend':   return renderAttend();
      case 'sos':      return renderSOS();
      case 'csv':      return renderCSV();
      default:         return renderDash();
    }
  };

  return (
    <SafeAreaView style={c.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />

      <View style={c.header}>
        <View>
          <Text style={c.headerTitle}>🚌 Admin Panel</Text>
          <Text style={c.headerSub}>Where Is My Bus</Text>
        </View>
        <TouchableOpacity style={c.logoutBtn} onPress={async () => { try { await logout(); } catch (e) { console.log('logout error:', e.message); } onLogout(); }}>
          <Text style={c.logoutTxt}>Logout</Text>
        </TouchableOpacity>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={c.tabBar}>
        {TABS.map(t => (
          <TouchableOpacity key={t.id} style={[c.tabBtn, tab === t.id && c.tabBtnActive]} onPress={() => setTab(t.id)}>
            <Text style={{ fontSize: 15 }}>{t.icon}</Text>
            <Text style={[c.tabLbl, tab === t.id && c.tabLblActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <View style={{ flex: 1 }}>{renderTab()}</View>

      {/* ════ MODALS ════ */}

      <FormModal visible={mBus} title={editingBusId ? '✎ Edit Bus' : '🚌 Add Bus'} onClose={() => { setMBus(false); setEditingBusId(''); }}>
        <Inp label="Bus Number *" placeholder="RJ 37 PE 5505" value={fBus.busNo} onChange={v => setFBus({ ...fBus, busNo: v })} />
        <Inp label="Driver Name (display only)" placeholder="Sunil" value={fBus.driverName} onChange={v => setFBus({ ...fBus, driverName: v })} />
        <Text style={{ fontSize: 11, color: '#888', marginTop: -8, marginBottom: 14 }}>
          Iska real driver "Drivers" tab se assign hota hai — ye field sirf display label hai.
        </Text>
        <PBtn label={editingBusId ? '✅ Save Changes' : '✅ Add Bus'} onPress={addBus} />
      </FormModal>

      <FormModal visible={mStudent} title="🎓 Add Student" onClose={() => setMStudent(false)}>
        <Inp label="Name *" value={fStudent.name} onChange={v => setFStudent({ ...fStudent, name: v })} />
        <Inp label="Class" placeholder="5-A" value={fStudent.class} onChange={v => setFStudent({ ...fStudent, class: v })} />
        <Inp label="Admission No" value={fStudent.admissionNo} onChange={v => setFStudent({ ...fStudent, admissionNo: v })} />
        <Inp label="Parent Phone *" value={fStudent.parentPhone} onChange={v => setFStudent({ ...fStudent, parentPhone: v })} keyboard="phone-pad" />
        <Text style={c.label}>Select Bus *</Text>
        <ChipSelect
          items={buses.map(b => ({ id: b.id, name: busLabel(b) }))}
          selected={fStudent.busId}
          onSelect={v => setFStudent({ ...fStudent, busId: v, stopId: '' })}
        />
        <Text style={c.label}>Select Pickup Stop</Text>
        <ChipSelect
          items={stops.filter(st => fStudent.busId && st.busId === fStudent.busId).map(s => ({ id: s.id, name: s.name }))}
          selected={fStudent.stopId}
          onSelect={v => setFStudent({ ...fStudent, stopId: v })}
        />
        <PBtn label="✅ Add Student" onPress={addStudent} />
      </FormModal>

      <FormModal visible={mStop} title="📍 Add Stop" onClose={() => { setMStop(false); setStopLocManual(false); setStopSearchQuery(''); setStopSearchResults([]); setStopSearchError(''); }}>
        <Text style={c.label}>Select Bus *</Text>
        <ChipSelect
          items={buses.map(b => ({ id: b.id, name: busLabel(b) }))}
          selected={fStop.busId}
          onSelect={v => setFStop({ ...fStop, busId: v })}
        />
        {fStop.busId && (() => {
          const existing = stops.filter(s => s.busId === fStop.busId).sort((a, b) => (a.order||0)-(b.order||0));
          return existing.length > 0 ? (
            <View style={[c.card, { backgroundColor: '#F5F7FA', marginBottom: 12 }]}>
              <Text style={{ fontSize: 11, color: '#888', marginBottom: 6, fontWeight: 'bold' }}>EXISTING STOPS ON THIS BUS</Text>
              {existing.map((s, i) => (
                <Text key={i} style={{ fontSize: 12, color: '#555' }}>{i + 1}. {s.name}</Text>
              ))}
            </View>
          ) : null;
        })()}

        <Inp label="Stop Name *" placeholder="Gandhi Chowk" value={fStop.name} onChange={v => setFStop({ ...fStop, name: v })} />

        <Text style={c.label}>Location *</Text>
        {fStop.lat && fStop.lng ? (
          <View style={[c.card, { backgroundColor: '#E8F5E9', marginBottom: 12 }]}>
            <Text style={{ color: '#34A853', fontWeight: 'bold' }}>✓ Location Selected</Text>
            <Text style={{ color: '#666', fontSize: 12, marginTop: 2 }}>{fStop.lat}, {fStop.lng}</Text>
          </View>
        ) : null}

        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
          <TextInput
            style={[c.inp, { flex: 1 }]}
            value={stopSearchQuery}
            onChangeText={setStopSearchQuery}
            placeholder="Search place name (e.g. Gandhi Chowk, Raipur)"
            placeholderTextColor="#bbb"
            onSubmitEditing={runStopSearch}
            returnKeyType="search"
          />
          <TouchableOpacity
            style={{ backgroundColor: P, borderRadius: 10, paddingHorizontal: 16, justifyContent: 'center', opacity: stopSearching ? 0.6 : 1 }}
            onPress={runStopSearch}
            disabled={stopSearching}
          >
            {stopSearching ? <ActivityIndicator color="#fff" size="small" /> : <Text style={{ color: '#fff', fontWeight: 'bold' }}>🔍</Text>}
          </TouchableOpacity>
        </View>
        {stopSearchError ? (
          <Text style={{ fontSize: 12, color: '#EA4335', marginBottom: 10 }}>{stopSearchError}</Text>
        ) : null}
        {stopSearchResults.length > 0 && (
          <View style={[c.card, { backgroundColor: '#F5F7FA', marginBottom: 12, padding: 8 }]}>
            {stopSearchResults.map((r, i) => (
              <TouchableOpacity
                key={i}
                style={{ paddingVertical: 8, borderBottomWidth: i === stopSearchResults.length - 1 ? 0 : 1, borderBottomColor: '#E8EAED' }}
                onPress={() => pickStopSearchResult(r)}
              >
                <Text style={{ fontSize: 13, color: '#333' }} numberOfLines={2}>📍 {r.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <PBtn label={stopLocating ? 'Getting...' : '📍 Current Location'} onPress={captureStopLocation} color="#34A853" disabled={stopLocating} />
          </View>
          <View style={{ flex: 1 }}>
            <PBtn label="🗺️ Choose from Map" onPress={openMapPicker} color={P} />
          </View>
        </View>

        {stopLocManual && (
          <View style={{ marginTop: 12 }}>
            <Text style={{ fontSize: 12, color: '#FF9800', marginBottom: 8 }}>
              ⚠️ GPS location nahi mil paaya — "Choose from Map" try karo, ya neeche manually bhar do:
            </Text>
            <Inp label="Latitude" placeholder="21.2514" value={fStop.lat} onChange={v => setFStop({ ...fStop, lat: v })} keyboard="decimal-pad" />
            <Inp label="Longitude" placeholder="81.6296" value={fStop.lng} onChange={v => setFStop({ ...fStop, lng: v })} keyboard="decimal-pad" />
          </View>
        )}

        <Text style={{ fontSize: 11, color: '#888', marginTop: 8, marginBottom: 4 }}>
          Order automatically set hoga (is bus ke end mein add hoga; "Buses" tab se ▲▼ se reorder kar sakte ho)
        </Text>

        <View style={{ height: 8 }} />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <PBtn label="➕ Add & Next Stop" onPress={() => addStop(true)} color="#34A853" />
          </View>
          <View style={{ flex: 1 }}>
            <PBtn label="✅ Add & Close" onPress={() => addStop(false)} color={P} />
          </View>
        </View>
      </FormModal>

      <Modal visible={mMapPicker} animationType="slide" onRequestClose={() => setMMapPicker(false)}>
        <SafeAreaView style={{ flex: 1 }}>
          <View style={c.mHead}>
            <Text style={c.mTitle}>🗺️ Tap to Select Location</Text>
            <TouchableOpacity onPress={() => setMMapPicker(false)} style={{ padding: 8 }}>
              <Text style={{ fontSize: 22, color: '#888' }}>✕</Text>
            </TouchableOpacity>
          </View>
          {mMapPicker && (
            <WebView
              style={{ flex: 1 }}
              originWhitelist={['*']}
              source={{ html: buildMapPickerHtml(mapMarker?.lat || 21.2514, mapMarker?.lng || 81.6296) }}
              onMessage={(e) => {
                try {
                  const data = JSON.parse(e.nativeEvent.data);
                  if (typeof data.lat === 'number' && typeof data.lng === 'number') {
                    setMapMarker({ lat: data.lat, lng: data.lng });
                  }
                } catch (err) { console.log('map picker message error:', err.message); }
              }}
            />
          )}
          <View style={{ padding: 16, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#E8EAED' }}>
            <Text style={{ textAlign: 'center', color: '#666', marginBottom: 10 }}>
              {mapMarker ? `${safeFixed(mapMarker.lat, 5)}, ${safeFixed(mapMarker.lng, 5)}` : 'Map par tap karo location select karne ke liye'}
            </Text>
            <PBtn label="✅ Confirm Location" onPress={confirmMapLocation} />
          </View>
        </SafeAreaView>
      </Modal>

      {/* ── Live Location viewer — shows ONLY the one selected bus ── */}
      <Modal visible={liveLocModal} animationType="slide" onRequestClose={closeLiveLocation}>
        <SafeAreaView style={{ flex: 1 }}>
          <View style={c.mHead}>
            <Text style={c.mTitle}>📍 {liveLocBus?.busNo || 'Bus'} — Live Location</Text>
            <TouchableOpacity onPress={closeLiveLocation} style={{ padding: 8 }}>
              <Text style={{ fontSize: 22, color: '#888' }}>✕</Text>
            </TouchableOpacity>
          </View>
          {liveLocLoading ? (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
              <ActivityIndicator size="large" color={P} />
            </View>
          ) : liveLocData ? (
            <>
              <WebView
                ref={liveLocWebViewRef}
                style={{ flex: 1 }}
                originWhitelist={['*']}
                source={{ html: buildLiveLocationHtml(liveLocData.lat, liveLocData.lng, liveLocBus?.busNo) }}
              />
              <View style={{ padding: 16, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#E8EAED' }}>
                <Text style={{ fontSize: 15, fontWeight: 'bold', color: '#111' }}>🚌 {liveLocBus?.busNo}</Text>
                <Text style={{ fontSize: 13, color: '#666', marginTop: 4 }}>⚡ Speed: {liveLocData.speed != null ? `${Math.round(liveLocData.speed)} km/h` : '—'}</Text>
                <Text style={{ fontSize: 12, color: '#999', marginTop: 2 }}>Last updated: {safeDateStr(liveLocData.timestamp)} • refreshes every 5s</Text>
              </View>
            </>
          ) : (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 }}>
              <Text style={{ fontSize: 40 }}>📡</Text>
              <Text style={{ fontSize: 15, color: '#888', marginTop: 12, textAlign: 'center' }}>No live location available for this bus.</Text>
            </View>
          )}
        </SafeAreaView>
      </Modal>

      <FormModal visible={mDriver} title={editingDriverId ? '✎ Edit Driver' : '👨‍✈️ Add Driver'} onClose={() => { setMDriver(false); setEditingDriverId(''); }}>
        <Inp label="Name *" value={fDriver.name} onChange={v => setFDriver({ ...fDriver, name: v })} />
        <Inp label="Phone *" value={fDriver.phone} onChange={v => setFDriver({ ...fDriver, phone: v })} keyboard="phone-pad" />
        <Inp label="License No" value={fDriver.licenseNo} onChange={v => setFDriver({ ...fDriver, licenseNo: v })} />
        <Inp label="License Expiry (YYYY-MM-DD)" placeholder="2027-01-01" value={fDriver.licenseExpiry} onChange={v => setFDriver({ ...fDriver, licenseExpiry: v })} />
        <Inp label="Experience (years)" value={fDriver.experience} onChange={v => setFDriver({ ...fDriver, experience: v })} keyboard="number-pad" />
        <Text style={c.label}>Assign Bus</Text>
        <ChipSelect items={buses.map(b => ({ id: b.id, name: busLabel(b) }))} selected={fDriver.busId} onSelect={v => setFDriver({ ...fDriver, busId: v })} />
        <PBtn label={editingDriverId ? '✅ Save Changes' : '✅ Add Driver'} onPress={addDriver} />
      </FormModal>

      <FormModal visible={mRoute} title={editingRouteId ? '✎ Edit Route' : '🗺️ Create Route'} onClose={() => { setMRoute(false); setEditingRouteId(''); }}>
        <Inp label="Route Name *" placeholder="Route A" value={fRoute.name} onChange={v => setFRoute({ ...fRoute, name: v })} />
        <Text style={c.label}>Assigned Bus *</Text>
        <ChipSelect items={buses.map(b => ({ id: b.id, name: busLabel(b) }))} selected={fRoute.busId} onSelect={v => setFRoute({ ...fRoute, busId: v })} />
        <Inp label="Start Point *" placeholder="KPS" value={fRoute.startPoint} onChange={v => setFRoute({ ...fRoute, startPoint: v })} />
        <Inp label="End Point" placeholder="School" value={fRoute.endPoint} onChange={v => setFRoute({ ...fRoute, endPoint: v })} />
        <PBtn label={editingRouteId ? '✅ Save Changes' : '✅ Create Route'} onPress={saveRoute} />
      </FormModal>

      <FormModal visible={mRouteStop} title="📍 Add Stop to Route" onClose={() => { setMRouteStop(false); setRouteStopSearchQuery(''); setRouteStopSearchResults([]); setRouteStopSearchError(''); }}>
        <Inp label="Stop Name *" placeholder="Gandhi Chowk" value={fRouteStop.name} onChange={v => setFRouteStop({ ...fRouteStop, name: v })} />
        <Inp label="Order" placeholder="2" value={fRouteStop.order} onChange={v => setFRouteStop({ ...fRouteStop, order: v })} keyboard="number-pad" />

        <Text style={c.label}>Location *</Text>
        {fRouteStop.lat && fRouteStop.lng ? (
          <View style={[c.card, { backgroundColor: '#E8F5E9', marginBottom: 12 }]}>
            <Text style={{ color: '#34A853', fontWeight: 'bold' }}>✓ Location Selected</Text>
            <Text style={{ color: '#666', fontSize: 12, marginTop: 2 }}>{fRouteStop.lat}, {fRouteStop.lng}</Text>
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
          <TextInput
            style={[c.inp, { flex: 1 }]}
            value={routeStopSearchQuery}
            onChangeText={setRouteStopSearchQuery}
            placeholder="Search place name"
            placeholderTextColor="#bbb"
            onSubmitEditing={runRouteStopSearch}
            returnKeyType="search"
          />
          <TouchableOpacity
            style={{ backgroundColor: P, borderRadius: 10, paddingHorizontal: 16, justifyContent: 'center', opacity: routeStopSearching ? 0.6 : 1 }}
            onPress={runRouteStopSearch}
            disabled={routeStopSearching}
          >
            {routeStopSearching ? <ActivityIndicator color="#fff" size="small" /> : <Text style={{ color: '#fff', fontWeight: 'bold' }}>🔍</Text>}
          </TouchableOpacity>
        </View>
        {routeStopSearchError ? <Text style={{ fontSize: 12, color: '#EA4335', marginBottom: 10 }}>{routeStopSearchError}</Text> : null}
        {routeStopSearchResults.length > 0 && (
          <View style={[c.card, { backgroundColor: '#F5F7FA', marginBottom: 12, padding: 8 }]}>
            {routeStopSearchResults.map((r, i) => (
              <TouchableOpacity
                key={i}
                style={{ paddingVertical: 8, borderBottomWidth: i === routeStopSearchResults.length - 1 ? 0 : 1, borderBottomColor: '#E8EAED' }}
                onPress={() => pickRouteStopSearchResult(r)}
              >
                <Text style={{ fontSize: 13, color: '#333' }} numberOfLines={2}>📍 {r.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
        <PBtn label="✅ Add Stop" onPress={saveRouteStop} />
      </FormModal>

      <FormModal visible={mAttend} title="✅ Mark Attendance" onClose={() => setMAttend(false)}>
        <Text style={c.label}>Select Bus *</Text>
        <ChipSelect items={buses.map(b => ({ id: b.id, name: busLabel(b) }))} selected={fAttend.busId} onSelect={v => setFAttend({ ...fAttend, busId: v, studentId: '' })} />
        <Text style={c.label}>Select Student *</Text>
        <ChipSelect items={students.filter(st => !fAttend.busId || st.busId === fAttend.busId)} selected={fAttend.studentId} onSelect={v => setFAttend({ ...fAttend, studentId: v })} />
        <Inp label="Date" value={fAttend.date} onChange={v => setFAttend({ ...fAttend, date: v })} />
        <Text style={c.label}>Trip Type</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
          {['pickup', 'drop'].map(t => (
            <TouchableOpacity key={t} style={[c.chip, fAttend.tripType === t && c.chipOn]} onPress={() => setFAttend({ ...fAttend, tripType: t })}>
              <Text style={[c.chipTxt, fAttend.tripType === t && { color: '#fff' }]}>{t.toUpperCase()}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <PBtn label="✅ Save Attendance" onPress={markAttendance} color="#34A853" />
      </FormModal>

      <FormModal visible={csvPreviewVisible} title="👁 Import Preview" onClose={() => setCSVPreviewVisible(false)}>
        {(() => {
          const validCount = csvPreviewRows.filter(r => !r.error).length;
          const errorCount = csvPreviewRows.length - validCount;
          return (
            <>
              <View style={[c.card, { backgroundColor: '#EEF2FF', marginBottom: 16 }]}>
                <Text style={{ fontSize: 14, color: '#333' }}>Total rows: <Text style={{ fontWeight: 'bold' }}>{csvPreviewRows.length}</Text></Text>
                <Text style={{ fontSize: 14, color: '#34A853', marginTop: 4 }}>✅ Valid: <Text style={{ fontWeight: 'bold' }}>{validCount}</Text></Text>
                <Text style={{ fontSize: 14, color: '#EA4335', marginTop: 4 }}>❌ Errors: <Text style={{ fontWeight: 'bold' }}>{errorCount}</Text></Text>
              </View>

              {errorCount > 0 && (
                <View style={{ marginBottom: 16 }}>
                  <Text style={[c.label, { color: '#EA4335' }]}>Errors ({errorCount}):</Text>
                  {csvPreviewRows.filter(r => r.error).slice(0, 50).map((r, i) => (
                    <View key={i} style={[c.card, { backgroundColor: '#FFF5F5', marginBottom: 6, padding: 10 }]}>
                      <Text style={{ fontSize: 12, fontWeight: 'bold', color: '#333' }}>❌ {r.name || '(no name)'}</Text>
                      <Text style={{ fontSize: 11, color: '#EA4335', marginTop: 2 }}>{r.error}</Text>
                    </View>
                  ))}
                </View>
              )}

              <Text style={[c.label, { color: '#34A853' }]}>Valid rows ({validCount}):</Text>
              {csvPreviewRows.filter(r => !r.error).slice(0, 8).map((r, i) => (
                <Text key={i} style={{ fontSize: 12, color: '#555', marginBottom: 4 }}>
                  ✅ {r.name} — {r.busNoRaw}{r.stopNameRaw ? ` — ${r.stopNameRaw}` : ''}
                </Text>
              ))}
              {validCount > 8 && <Text style={{ fontSize: 12, color: '#888' }}>+{validCount - 8} more...</Text>}

              <View style={{ height: 16 }} />
              <PBtn label={`✅ Confirm Import (${validCount})`} onPress={confirmCSVImport} color="#34A853" disabled={validCount === 0} />
              <View style={{ height: 8 }} />
              <OBtn label="Cancel" onPress={() => setCSVPreviewVisible(false)} color="#888" />
            </>
          );
        })()}
      </FormModal>

      <FormModal visible={mEmerg} title="🆘 Log Emergency" onClose={() => setMEmerg(false)}>
        <Text style={c.label}>Select Bus *</Text>
        <ChipSelect items={buses.map(b => ({ id: b.id, name: busLabel(b) }))} selected={fEmerg.busId} onSelect={v => setFEmerg({ ...fEmerg, busId: v })} />
        <Inp label="Driver Name" value={fEmerg.driverName} onChange={v => setFEmerg({ ...fEmerg, driverName: v })} />
        <Inp label="Type" placeholder="SOS / Accident / Medical" value={fEmerg.type} onChange={v => setFEmerg({ ...fEmerg, type: v })} />
        <Inp label="Notes" value={fEmerg.notes} onChange={v => setFEmerg({ ...fEmerg, notes: v })} multi />
        <PBtn label="🆘 Log Emergency" onPress={addEmergency} color="#EA4335" />
      </FormModal>

    </SafeAreaView>
  );
}

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, errorMsg: '' };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, errorMsg: error?.message || 'Unknown error' };
  }
  componentDidCatch(error, info) { console.log('AdminScreen crashed:', error, info); }
  render() {
    if (this.state.hasError) {
      return (
        <SafeAreaView style={{ flex: 1, backgroundColor: '#F5F7FA', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <Text style={{ fontSize: 40 }}>⚠️</Text>
          <Text style={{ fontSize: 16, fontWeight: 'bold', color: '#111', marginTop: 12, textAlign: 'center' }}>Kuch gadbad ho gayi</Text>
          <Text style={{ fontSize: 12, color: '#888', marginTop: 6, textAlign: 'center' }}>{this.state.errorMsg}</Text>
          <TouchableOpacity
            style={{ marginTop: 20, backgroundColor: P, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 10 }}
            onPress={() => this.setState({ hasError: false, errorMsg: '' })}
          >
            <Text style={{ color: '#fff', fontWeight: 'bold' }}>Dobara try karein</Text>
          </TouchableOpacity>
        </SafeAreaView>
      );
    }
    return this.props.children;
  }
}

export default function AdminScreen(props) {
  return (
    <ErrorBoundary>
      <AdminScreenContent {...props} />
    </ErrorBoundary>
  );
}

const c = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#F5F7FA' },
  header:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#fff', paddingHorizontal: 16, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: '#E8EAED' },
  headerTitle:  { fontSize: 18, fontWeight: 'bold', color: '#111' },
  headerSub:    { fontSize: 11, color: '#888' },
  logoutBtn:    { backgroundColor: '#F5F5F5', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, borderWidth: 1, borderColor: '#DDD' },
  logoutTxt:    { fontSize: 13, color: '#555' },
  tabBar:       { backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#E8EAED', maxHeight: 60, flexGrow: 0 },
  tabBtn:       { paddingHorizontal: 12, paddingVertical: 10, alignItems: 'center', minWidth: 60 },
  tabBtnActive: { borderBottomWidth: 3, borderBottomColor: P },
  tabLbl:       { fontSize: 10, color: '#888', marginTop: 2 },
  tabLblActive: { color: P, fontWeight: 'bold' },
  statsGrid:    { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 8, paddingTop: 8 },
  statCard:     { width: (W - 48) / 2, margin: 8, backgroundColor: '#fff', borderRadius: 14, padding: 16, alignItems: 'center', elevation: 3, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 6 },
  statVal:      { fontSize: 28, fontWeight: 'bold', marginTop: 6 },
  statLbl:      { fontSize: 12, color: '#666', marginTop: 4 },
  qaGrid:       { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 8 },
  qaBtn:        { width: (W - 80) / 4, alignItems: 'center', backgroundColor: '#F5F7FA', borderRadius: 12, paddingVertical: 12, borderWidth: 1, borderColor: '#E8EAED' },
  qaLbl:        { fontSize: 10, color: '#444', marginTop: 4, fontWeight: '600', textAlign: 'center' },
  card:         { backgroundColor: '#fff', borderRadius: 14, padding: 16, elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4 },
  cardHead:     { fontSize: 14, fontWeight: 'bold', color: '#111', marginBottom: 10 },
  secHead:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', margin: 16, marginBottom: 8 },
  secTitle:     { fontSize: 17, fontWeight: 'bold', color: '#111' },
  addBtn:       { backgroundColor: P, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
  addBtnTxt:    { color: '#fff', fontWeight: 'bold', fontSize: 13 },
  row:          { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#F5F5F5' },
  rowTitle:     { fontSize: 14, fontWeight: '600', color: '#111' },
  rowSub:       { fontSize: 12, color: '#666' },
  itemTitle:    { fontSize: 15, fontWeight: '700', color: '#111' },
  itemSub:      { fontSize: 12, color: '#666', marginTop: 2 },
  tag:          { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, borderWidth: 1 },
  tagTxt:       { fontSize: 11, fontWeight: 'bold' },
  dot:          { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginRight: 8 },
  emptyBox:     { alignItems: 'center', padding: 40 },
  emptyTxt:     { fontSize: 14, color: '#888', marginTop: 8, textAlign: 'center' },
  empty:        { color: '#888', fontSize: 13, padding: 10, textAlign: 'center' },
  mHead:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#fff', padding: 16, borderBottomWidth: 1, borderBottomColor: '#E8EAED' },
  mTitle:       { fontSize: 18, fontWeight: 'bold', color: '#111' },
  label:        { fontSize: 13, fontWeight: '600', color: '#333', marginBottom: 6 },
  inp:          { backgroundColor: '#F8F9FA', borderWidth: 1, borderColor: '#E0E0E0', borderRadius: 10, padding: 12, fontSize: 15, color: '#111' },
  chip:         { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#F0F4FF', borderWidth: 1, borderColor: '#DDD', marginRight: 8 },
  chipOn:       { backgroundColor: P, borderColor: P },
  chipTxt:      { fontSize: 13, color: '#444', fontWeight: '500' },
  pBtn:         { borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 8, marginBottom: 4 },
  pBtnTxt:      { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  oBtn:         { borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 4, borderWidth: 1.5 },
  oBtnTxt:      { fontWeight: 'bold', fontSize: 15 },
});