const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const receipts = await prisma.receipt.findMany();
  console.log('Receipts with null partnerId:', receipts.filter((r) => !r.partnerId).length);
  console.log('Total receipts:', receipts.length);
}
main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
