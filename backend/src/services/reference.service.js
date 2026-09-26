const { prisma } = require('../lib/prisma');

/**
 * Human-readable document references (RCP-000001, DLV-000042, ...).
 *
 * The counter is the PostgreSQL sequence `document_reference_seq`, which Prisma's
 * DSL cannot express, so it is created by a hand-edited migration. `nextval` is
 * atomic, so two concurrent creates can never collide on a reference.
 */
const formatReference = (prefix, value) => `${prefix}-${String(value).padStart(6, '0')}`;

const nextReference = async (tx, prefix) => {
  const rows = await tx.$queryRaw`SELECT nextval('document_reference_seq') AS "value"`;
  return formatReference(prefix, rows[0].value);
};

const nextReferenceStandalone = async (prefix) =>
  prisma.$transaction((tx) => nextReference(tx, prefix));

module.exports = { formatReference, nextReference, nextReferenceStandalone };
