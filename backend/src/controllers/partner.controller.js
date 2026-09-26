const { prisma } = require('../lib/prisma');

const list = async (req, res) => {
  const partners = await prisma.partner.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: { name: 'asc' }
  });

  res.status(200).json({
    status: 'success',
    data: partners,
  });
};

module.exports = {
  list,
};
