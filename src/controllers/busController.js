const prisma = require('../db');

// Bus banao
const createBus = async (req, res) => {
  try {
    const { busNo, driverName, status } = req.body;

    if (!busNo) {
      return res.status(400).json({
        message: 'busNo is required',
      });
    }

    const existing = await prisma.bus.findUnique({
      where: { busNo },
    });

    if (existing) {
      return res.status(400).json({
        message: 'Bus already exists',
      });
    }

    const bus = await prisma.bus.create({
      data: {
        busNo,
        driverName: driverName || '',
        status: status || 'ACTIVE',
      },
    });

    res.status(201).json({
      success: true,
      bus,
    });
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
};


// Sab buses dekho
const getAllBuses = async (req, res) => {
  try {
    const buses = await prisma.bus.findMany({
      orderBy: {
        busNo: 'asc',
      },
    });

    res.json({
      success: true,
      buses,
    });
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
};


// Bus update karo
const updateBus = async (req, res) => {
  try {
    const { busNo, driverName, status } = req.body;

    const bus = await prisma.bus.update({
      where: {
        id: req.params.id,
      },
      data: {
        ...(busNo !== undefined
          ? { busNo }
          : {}),

        ...(driverName !== undefined
          ? { driverName }
          : {}),

        ...(status !== undefined
          ? { status }
          : {}),
      },
    });

    res.json({
      success: true,
      bus,
    });
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
};


// Bus deactivate karo
const deactivateBus = async (req, res) => {
  try {
    const bus = await prisma.bus.update({
      where: {
        id: req.params.id,
      },
      data: {
        status: 'INACTIVE',
      },
    });

    res.json({
      success: true,
      bus,
    });
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
};


// Ek bus ki latest live location
const getBusLocation = async (req, res) => {
  try {
    const { busId } = req.params;

    const location = await prisma.liveLocation.findFirst({
      where: {
        busId,
      },
      orderBy: {
        timestamp: 'desc',
      },
    });

    if (!location) {
      return res.status(404).json({
        message: 'No location found',
      });
    }

    res.json({
      success: true,
      location,
    });
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
};


// Ek bus ki complete information
const getBusFullInfo = async (req, res) => {
  try {
    const { busId } = req.params;

    if (!busId) {
      return res.status(400).json({
        message: 'busId required',
      });
    }

    const bus = await prisma.bus.findUnique({
      where: {
        id: busId,
      },
    });

    if (!bus) {
      return res.status(404).json({
        message: 'Bus not found',
      });
    }


    const driver = await prisma.driver.findFirst({
      where: {
        busId,
      },
    });


    const stops = await prisma.stop.findMany({
      where: {
        busId,
      },
      orderBy: {
        order: 'asc',
      },
    });


    const liveLocation = await prisma.liveLocation.findFirst({
      where: {
        busId,
      },
      orderBy: {
        timestamp: 'desc',
      },
    });


    res.json({
      success: true,

      busId: bus.id,

      busNo: bus.busNo,

      status: bus.status,

      tripActive: bus.status === 'ON_TRIP',

      driver: driver
        ? {
            id: driver.id,
            name: driver.name,
            phone: driver.phone,
          }
        : null,

      stops: stops.map((s) => ({
        id: s.id,
        name: s.name,
        lat: s.lat,
        lng: s.lng,
        order: s.order,
      })),

      liveLocation: liveLocation
        ? {
            lat: liveLocation.lat,
            lng: liveLocation.lng,
            speed: liveLocation.speed,
            timestamp: liveLocation.timestamp,
          }
        : null,
    });

  } catch (err) {
    console.log(
      'getBusFullInfo error:',
      err.message
    );

    res.status(500).json({
      message: err.message,
    });
  }
};


// Admin ke liye sabhi ON_TRIP buses ki live location
const getLiveBuses = async (req, res) => {
  try {

    const buses = await prisma.bus.findMany({
      where: {
        status: 'ON_TRIP',
      },
    });


    const busesWithLocation = await Promise.all(

      buses.map(async (bus) => {

        const location =
          await prisma.liveLocation.findFirst({
            where: {
              busId: bus.id,
            },
            orderBy: {
              timestamp: 'desc',
            },
          });


        const driver =
          await prisma.driver.findFirst({
            where: {
              busId: bus.id,
            },
          });


        return {

          busId: bus.id,

          busNo: bus.busNo,

          driverName: driver
            ? driver.name
            : null,

          location: location
            ? {
                lat: location.lat,
                lng: location.lng,
                speed: location.speed,
                timestamp: location.timestamp,
              }
            : null,
        };

      })

    );


    res.json({

      success: true,

      buses: busesWithLocation.filter(
        (bus) => bus.location !== null
      ),

    });

  } catch (err) {

    console.log(
      'getLiveBuses error:',
      err.message
    );

    res.status(500).json({
      message: err.message,
    });

  }
};


// EXPORTS
module.exports = {

  createBus,

  getAllBuses,

  updateBus,

  deactivateBus,

  getBusLocation,

  getBusFullInfo,

  getLiveBuses,

};