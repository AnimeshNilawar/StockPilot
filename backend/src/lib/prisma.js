const { PrismaClient } = require('@prisma/client');

// A single PrismaClient for the whole process. Every file used to build its own
// instance, which multiplied the connection pool (Prisma opens a pool per
// client) and made the Phase 3 row-locking transactions contend for slots.
const prisma = new PrismaClient();

module.exports = { prisma };
