import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';

const API = 'https://whereismybus-backend.onrender.com';
const authHeader = (token) => ({ headers: { Authorization: `Bearer ${token}` } });

// ── AUTH ──
export const loginUser = async (phone, role) => {
  const res = await axios.post(`${API}/api/auth/login`, { phone, role });
  return res.data;
};
export const registerUser = async (phone, name, role) => {
  const res = await axios.post(`${API}/api/auth/register`, { phone, name, role });
  return res.data;
};
export const adminLogin = async (email, password) => {
  const res = await axios.post(`${API}/api/auth/admin-login`, { email, password });
  return res.data;
};

// ── BUS — single source of truth for Driver/Parent screens: busNo,
// driver{id,name,phone}, stops[] (order sorted), liveLocation, status.
// There is NO Route model in the schema — stops belong directly to a
// Bus — so this ONE endpoint replaces the old (broken/nonexistent)
// /api/routes/bus/:busId call. Every screen (Driver, Parent) should
// call this, not a "route" endpoint. ──
export const getBusFullInfo = async (busId, token) =>
  (await axios.get(`${API}/api/buses/${busId}/full`, authHeader(token))).data;

export const getBuses = async (token) => (await axios.get(`${API}/api/buses`, authHeader(token))).data;
export const createBus = async (payload, token) => (await axios.post(`${API}/api/buses`, payload, authHeader(token))).data;
export const updateBus = async (id, payload, token) => (await axios.put(`${API}/api/buses/${id}`, payload, authHeader(token))).data;
export const deactivateBus = async (id, token) => (await axios.delete(`${API}/api/buses/${id}`, authHeader(token))).data;
export const getLiveBuses = async (token) =>
  (await axios.get(`${API}/api/buses/live`, authHeader(token))).data;
export const postBusLocation = async (payload) =>
  (await axios.post(`${API}/api/buses/location`, payload)).data;





// ── ROUTES ──
export const getRouteByBus = async (busId, token) => {
  const res = await axios.get(
    `${API}/api/routes/bus/${busId}`,
    authHeader(token)
  );
  return res.data.routes?.[0] || null;
};

export const getRoutes = async (token) =>
  (await axios.get(`${API}/api/routes`, authHeader(token))).data;

export const getRouteById = async (id, token) =>
  (await axios.get(`${API}/api/routes/${id}`, authHeader(token))).data;

export const createRoute = async (payload, token) =>
  (await axios.post(`${API}/api/routes`, payload, authHeader(token))).data;

export const updateRoute = async (id, payload, token) =>
  (await axios.put(`${API}/api/routes/${id}`, payload, authHeader(token))).data;

export const addStopToRoute = async (routeId, payload, token) =>
  (
    await axios.post(
      `${API}/api/routes/${routeId}/stops`,
      payload,
      authHeader(token)
    )
  ).data;

export const deleteRouteStop = async (stopId, token) =>
  (
    await axios.delete(
      `${API}/api/routes/stops/${stopId}`,
      authHeader(token)
    )
  ).data;

export const deleteRoute = async (id, token) =>
  (await axios.delete(`${API}/api/routes/${id}`, authHeader(token))).data;

// ── DRIVERS (Driver table — separate from the User auth table) ──
export const getDrivers = async (token) => (await axios.get(`${API}/api/drivers`, authHeader(token))).data;
export const createDriver = async (payload, token) => (await axios.post(`${API}/api/drivers`, payload, authHeader(token))).data;
export const updateDriver = async (id, payload, token) => (await axios.put(`${API}/api/drivers/${id}`, payload, authHeader(token))).data;
export const deleteDriver = async (id, token) => (await axios.delete(`${API}/api/drivers/${id}`, authHeader(token))).data;
export const assignDriverBus = async (driverId, busId, token) =>
  (await axios.patch(`${API}/api/drivers/${driverId}/assign-bus`, { busId }, authHeader(token))).data;

// ── STOPS (directly tied to a Bus — no Route model) ──
export const getAllStops = async (token) => (await axios.get(`${API}/api/stops`, authHeader(token))).data;
export const createStop = async (payload, token) => (await axios.post(`${API}/api/stops`, payload, authHeader(token))).data;
export const reorderStops = async (busId, stopIds, token) =>
  (await axios.patch(`${API}/api/stops/reorder`, { busId, stopIds }, authHeader(token))).data;
export const deleteStopApi = async (id, token) => (await axios.delete(`${API}/api/stops/${id}`, authHeader(token))).data;

// LEGACY — GET /api/stops/:busId (unchanged endpoint, still works exactly as before)
export const getStops = async (busId, token) => {
  const res = await axios.get(`${API}/api/stops/${busId}`, authHeader(token));
  return res.data.stops;
};

// ── STUDENTS ──
export const getStudents = async (token) => (await axios.get(`${API}/api/students`, authHeader(token))).data;
export const addStudentApi = async (payload, token) => (await axios.post(`${API}/api/students`, payload, authHeader(token))).data;
export const deleteStudentApi = async (id, token) => (await axios.delete(`${API}/api/students/${id}`, authHeader(token))).data;

// ── ATTENDANCE ──
export const markAttendanceApi = async (payload, token) =>
  (await axios.post(`${API}/api/attendance`, payload, authHeader(token))).data;
export const getAttendanceApi = async (busId, date, token) =>
  (await axios.get(`${API}/api/attendance?busId=${busId}&date=${date}`, authHeader(token))).data;

// ── SESSION ──
export const saveAuth = async (token, user) => {
  await AsyncStorage.setItem('token', token);
  await AsyncStorage.setItem('user', JSON.stringify(user));
};
export const getToken = async () => AsyncStorage.getItem('token');
export const getUser = async () => {
  const u = await AsyncStorage.getItem('user');
  return u ? JSON.parse(u) : null;
};
export const logout = async () => {
  await AsyncStorage.removeItem('token');
  await AsyncStorage.removeItem('user');
};

export const SOCKET_URL = API;