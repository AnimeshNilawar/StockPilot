const { PrismaClient } = require('@prisma/client');
const authService = require('../src/services/auth.service');
const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  const roles = ['ADMIN', 'INVENTORY_MANAGER', 'WAREHOUSE_STAFF'];
  
  for (const roleName of roles) {
    await prisma.role.upsert({
      where: { name: roleName },
      update: {},
      create: { name: roleName },
    });
  }

  const permissions = [
    'user.manage', 'warehouse.read', 'warehouse.write',
    'location.read', 'location.write', 'product.read', 'product.write',
    'receipt.create', 'receipt.edit', 'receipt.validate',
    'delivery.create', 'delivery.edit', 'delivery.pick', 'delivery.validate',
    'internal_transfer.create', 'internal_transfer.validate',
    'adjustment.create', 'adjustment.validate',
    'dashboard.view_all', 'move_history.view'
  ];

  for (const action of permissions) {
    await prisma.permission.upsert({
      where: { action },
      update: {},
      create: { action },
    });
  }

  const adminRole = await prisma.role.findUnique({ where: { name: 'ADMIN' } });
  const allPerms = await prisma.permission.findMany();

  for (const p of allPerms) {
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: adminRole.id, permissionId: p.id } },
      update: {},
      create: { roleId: adminRole.id, permissionId: p.id },
    });
  }

  const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@stockpilot.local';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'Admin@1234';
  const adminHash = await authService.hashPassword(adminPassword);

  const adminUser = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      name: 'System Admin',
      passwordHash: adminHash,
      roleId: adminRole.id,
      status: 'ACTIVE',
    },
  });

  console.log(`Seeding finished. Admin user: ${adminUser.email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
