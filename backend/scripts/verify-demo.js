const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('\nStockPilot Demo Data');
  console.log('--------------------\n');

  const usersCount = await prisma.user.count();
  console.log(`Users:\n  ${usersCount}\n`);

  const warehouses = await prisma.warehouse.findMany({ select: { name: true } });
  console.log(`Warehouses:\n  ${warehouses.length}`);
  warehouses.forEach(w => console.log(`  - ${w.name}`));
  console.log();

  const locationsCount = await prisma.location.count();
  console.log(`Locations:\n  ${locationsCount}\n`);

  const categoriesCount = await prisma.category.count();
  console.log(`Categories:\n  ${categoriesCount}\n`);

  const productsCount = await prisma.product.count();
  console.log(`Products:\n  ${productsCount}\n`);

  const receiptsCount = await prisma.receipt.count();
  const doneReceiptsCount = await prisma.receipt.count({ where: { state: 'DONE' } });
  const draftReceiptsCount = await prisma.receipt.count({ where: { state: 'DRAFT' } });
  console.log(`Receipts:\n  ${receiptsCount}`);
  console.log(`DONE Receipts:\n  ${doneReceiptsCount}`);
  console.log(`DRAFT Receipts:\n  ${draftReceiptsCount}\n`);

  const movesCount = await prisma.stockMove.count();
  console.log(`Stock Moves:\n  ${movesCount}\n`);

  const quantsCount = await prisma.stockQuant.count();
  console.log(`Stock Quants:\n  ${quantsCount}\n`);

  const stockQuants = await prisma.stockQuant.findMany({
    include: { product: true, location: true },
    where: { onHand: { gt: 0 } },
    orderBy: { product: { name: 'asc' } }
  });

  console.log('Current Stock:');
  for (const sq of stockQuants) {
    if (sq.location.type === 'INTERNAL' || sq.location.type === 'PRODUCTION') {
      const padName = sq.product.name.padEnd(25, ' ');
      const padQty = Number(sq.onHand).toString().padStart(8, ' ');
      console.log(`  ${padName} ${padQty} ${sq.product.uomId} (at ${sq.location.name})`);
    }
  }
  console.log();
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
