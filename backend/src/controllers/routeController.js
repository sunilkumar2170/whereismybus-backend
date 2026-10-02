const prisma = require('../db');

// ── GET ALL ROUTES (with stops embedded, ordered) ──
const getRoutes = async (req, res) => {
  try {
    const routes = await prisma.$queryRaw`
      SELECT r.*,
        COALESCE(
          json_agg(rs.* ORDER BY rs."order") FILTER (WHERE rs.id IS NOT NULL),
          '[]'
        ) as stops
      FROM "Route" r
      LEFT JOIN "RouteStop" rs ON rs."routeId" = r.id
      GROUP BY r.id
      ORDER BY r."createdAt" DESC
    `;
    res.json({ success: true, routes });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

// ── GET ONE ROUTE BY ID ──
const getRouteById = async (req, res) => {
  try {
    const { id } = req.params;
    const routes = await prisma.$queryRaw`
      SELECT r.*,
        COALESCE(
          json_agg(rs.* ORDER BY rs."order") FILTER (WHERE rs.id IS NOT NULL),
          '[]'
        ) as stops
      FROM "Route" r
      LEFT JOIN "RouteStop" rs ON rs."routeId" = r.id
      WHERE r.id = ${id}
      GROUP BY r.id
    `;
    if (!routes[0]) return res.status(404).json({ message: 'Route not found' });
    res.json({ success: true, route: routes[0] });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

// ── GET ROUTE BY BUS ──
// FIX: pehle sirf Route + RouteStop return hota tha — Driver kabhi query
// hi nahi hui thi, isliye Parent Screen mein route?.driver hamesha
// undefined aata tha. Ab har route ke saath uske busId se Driver table
// (Driver.busId = Bus.id) lookup karke real name/phone attach karte hain.
// Bus.driverName ya User.name kahin use nahi kiya — sirf Driver table.
const getRouteByBus = async (req, res) => {
  try {
    const { busId } = req.params;
    console.log('[BACKEND] getRouteByBus called for assigned busId:', busId);

    // STRICT: sirf isi busId ka route — koi aur bus ke stops kabhi nahi aa sakte
    const routes = await prisma.$queryRaw`
      SELECT r.*,
        COALESCE(
          json_agg(rs.* ORDER BY rs."order") FILTER (WHERE rs.id IS NOT NULL),
          '[]'
        ) as stops
      FROM "Route" r
      LEFT JOIN "RouteStop" rs ON rs."routeId" = r.id
      WHERE r."busId" = ${busId}
      GROUP BY r.id
    `;
    console.log('[BACKEND] routes found for this busId:', routes.length);
    console.log('[BACKEND] ADMIN STOPS (order preserved):', routes[0]?.stops?.map(s => s.name));
    console.log('[BACKEND] STOP COUNT:', routes[0]?.stops?.length || 0);

    const driver = await prisma.driver.findFirst({ where: { busId } });
    const driverInfo = driver
      ? { name: driver.name, phone: driver.phone }
      : null; // null => frontend "Driver not assigned" state
    console.log('[BACKEND] driver for this busId:', driverInfo);

    const routesWithDriver = routes.map(r => ({ ...r, driver: driverInfo }));

    res.json({ success: true, routes: routesWithDriver });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

// ── CREATE ROUTE (with stops in one shot) ──
const createRoute = async (req, res) => {
  try {
    const { name, busId, startPoint, endPoint, stops } = req.body;
    if (!name || !busId || !startPoint)
      return res.status(400).json({ message: 'name, busId, startPoint required' });

    const route = await prisma.$queryRaw`
      INSERT INTO "Route" ("name","busId","startPoint","endPoint")
      VALUES (${name},${busId},${startPoint},${endPoint || ''})
      RETURNING *
    `;
    const routeId = route[0].id;

    if (Array.isArray(stops) && stops.length > 0) {
      for (let i = 0; i < stops.length; i++) {
        const stop = stops[i];
        await prisma.$executeRaw`
          INSERT INTO "RouteStop" ("routeId","name","lat","lng","order","distanceFromStart","estimatedTime")
          VALUES (
            ${routeId},
            ${stop.name},
            ${parseFloat(stop.lat) || 0},
            ${parseFloat(stop.lng) || 0},
            ${stop.order || i + 1},
            ${stop.distanceFromStart || 0},
            ${stop.estimatedTime || 0}
          )
        `;
      }
    }

    res.json({ success: true, route: route[0] });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

// ── UPDATE ROUTE BASICS ──
const updateRoute = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, busId, startPoint, endPoint } = req.body;

    const existing = await prisma.$queryRaw`SELECT * FROM "Route" WHERE id = ${id}`;
    if (!existing[0]) return res.status(404).json({ message: 'Route not found' });
    const cur = existing[0];

    const updated = await prisma.$queryRaw`
      UPDATE "Route" SET
        "name"       = ${name       ?? cur.name},
        "busId"      = ${busId      ?? cur.busId},
        "startPoint" = ${startPoint ?? cur.startPoint},
        "endPoint"   = ${endPoint   ?? cur.endPoint}
      WHERE id = ${id}
      RETURNING *
    `;
    res.json({ success: true, route: updated[0] });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

// ── ADD A SINGLE STOP TO AN EXISTING ROUTE ──
const addStopToRoute = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, lat, lng, order, distanceFromStart, estimatedTime } = req.body;
    if (!name || lat == null || lng == null)
      return res.status(400).json({ message: 'name, lat, lng required' });

    let finalOrder = order;
    if (finalOrder == null) {
      const maxRow = await prisma.$queryRaw`
        SELECT COALESCE(MAX("order"), 0) as "maxOrder" FROM "RouteStop" WHERE "routeId" = ${id}
      `;
      finalOrder = (maxRow[0]?.maxOrder || 0) + 1;
    }

    const stop = await prisma.$queryRaw`
      INSERT INTO "RouteStop" ("routeId","name","lat","lng","order","distanceFromStart","estimatedTime")
      VALUES (
        ${id}, ${name}, ${parseFloat(lat)}, ${parseFloat(lng)},
        ${finalOrder}, ${distanceFromStart || 0}, ${estimatedTime || 0}
      )
      RETURNING *
    `;
    res.json({ success: true, stop: stop[0] });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

// ── DELETE A SINGLE STOP FROM A ROUTE ──
const deleteRouteStop = async (req, res) => {
  try {
    const { stopId } = req.params;
    await prisma.$executeRaw`DELETE FROM "RouteStop" WHERE id = ${stopId}`;
    res.json({ success: true });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

// ── DELETE ROUTE (and its stops) ──
const deleteRoute = async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.$executeRaw`DELETE FROM "RouteStop" WHERE "routeId" = ${id}`;
    await prisma.$executeRaw`DELETE FROM "Route" WHERE id = ${id}`;
    res.json({ success: true });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

module.exports = {
  getRoutes,
  getRouteById,
  getRouteByBus,
  createRoute,
  updateRoute,
  addStopToRoute,
  deleteRouteStop,
  deleteRoute,
};