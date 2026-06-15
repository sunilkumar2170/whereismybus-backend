const { PrismaClient } = require('./generated/prisma');
const { Pool, neonConfig } = require('@neondatabase/serverless');
const { PrismaNeon } = require('@prisma/adapter-neon');
const ws = require('ws');

neonConfig.webSocketConstructor = ws;

const pool = new Pool({ 
  connectionString: 'postgresql://neondb_owner:npg_12QzlVTtNFWa@ep-small-king-apdccq1c-pooler.c-7.us-east-1.aws.neon.tech/neondb?sslmode=require'
});

const adapter = new PrismaNeon(pool);
const prisma = new PrismaClient({ adapter });

module.exports = prisma;