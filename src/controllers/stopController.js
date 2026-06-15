const prisma = require('../db');

const getStops = async (req, res) => {
  try {
    const { busId } = req.params;
    const stops = await prisma.$queryRaw`
      SELECT * FROM "Stop" 
      WHERE "busId" = ${busId} 
      ORDER BY "order" ASC
    `;
    res.json({ success: true, stops });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = { getStops };