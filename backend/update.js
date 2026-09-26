const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  await prisma.$executeRawUnsafe(`UPDATE receipts SET supplier = NULL`);
  console.log('Supplier column nullified');
}
main().catch(console.error).finally(() => prisma.$disconnect());
