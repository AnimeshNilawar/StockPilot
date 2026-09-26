const { Prisma, PrismaClient } = require('@prisma/client');
const {
  prisma,
  createTrackedPartner,
  createTrackedProduct,
  createTrackedWarehouseWithLocations,
  createTrackedReceipt,
  unique,
  cleanupFixtures,
} = require('./helpers');
const documentService = require('../src/services/document.service');
const { DOC_STATES } = require('../src/domain/documentState');

const localPrisma = new PrismaClient();

/**
 * The guarantee under test: a state change is a compare-and-set, so a request
 * that races another one cannot both commit. HTTP-level tests cannot reliably
 * open that window — two requests rarely overlap inside their transactions — so
 * the race is reproduced here at the service boundary, with a deliberate pause
 * between reading the state and writing it.
 */
describe('document service concurrency', () => {
  let warehouse;
  let loc;
  let product;
  let partner;
  let receipt;

  beforeAll(async () => {
    const wh = await createTrackedWarehouseWithLocations();
    warehouse = wh.warehouse;
    loc = wh.locations;
    product = await createTrackedProduct();
    partner = await createTrackedPartner();

    receipt = await createTrackedReceipt({
      reference: unique('RCP'),
      partnerId: partner.id,
      warehouseId: warehouse.id,
      state: DOC_STATES.READY,
      lines: {
        create: {
          productId: product.id,
          quantity: '10',
          destinationLocationId: loc.store.id,
        },
      },
    });
  });

  afterAll(async () => {
    await cleanupFixtures();
    await localPrisma.$disconnect();
  });

  const onHand = async () => {
    const quant = await prisma.stockQuant.findUnique({
      where: { productId_locationId: { productId: product.id, locationId: loc.store.id } },
    });
    return quant ? Number(quant.onHand) : 0;
  };

  /**
   * Mirrors the real validation order: post the side effect, then flip the
   * state. The side effect lands in its own idempotency-key row so it never
   * contends with the other racer, leaving the state write as the only
   * contended operation.
   */
  const validatingTransaction = (racer) =>
    localPrisma.$transaction(async (tx) => {
      await tx.idempotencyKey.create({
        data: {
          key: `race:${receipt.id}:${racer}`,
          endpoint: 'document-race-probe',
          userId: null,
          requestHash: 'race',
          statusCode: 0,
          responseBody: { racer },
          expiresAt: new Date(Date.now() + 60_000),
        },
      });
      await documentService.finalize(tx, { document: tx.receipt, documentId: receipt.id });
      return { racer };
    });

  const committedRacers = async () => {
    const rows = await prisma.idempotencyKey.findMany({
      where: { endpoint: 'document-race-probe' },
      orderBy: { key: 'asc' },
    });
    return rows.map((r) => r.key.split(':').pop());
  };

  beforeEach(async () => {
    await prisma.idempotencyKey.deleteMany({ where: { endpoint: 'document-race-probe' } });
    await localPrisma.receipt.update({
      where: { id: receipt.id },
      data: { state: DOC_STATES.READY },
    });
  });

  it('commits exactly one of two validations that both read the same state', async () => {
    // Holding the row lock keeps the document at READY until both racers have
    // already passed the service's own re-read, so only the compare-and-set on
    // the UPDATE can separate them.
    const blocker = localPrisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe('SELECT id FROM receipts WHERE id = $1 FOR UPDATE', receipt.id);
      await tx.$executeRawUnsafe('SELECT pg_sleep(0.4)');
    });

    await new Promise((resolve) => setTimeout(resolve, 100));
    const results = await Promise.allSettled([
      validatingTransaction('a'),
      validatingTransaction('b'),
    ]);
    await blocker;

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason.code).toBe('DOCUMENT_STATE_CONFLICT');

    // The loser's whole transaction rolled back, including its side effect.
    expect(await committedRacers()).toHaveLength(1);
    expect((await prisma.receipt.findUnique({ where: { id: receipt.id } })).state).toBe(
      DOC_STATES.DONE,
    );
  });

  it('rolls the losing validation back so stock cannot be posted twice', async () => {
    const before = await onHand();
    const postedBy = new Map();

    const race = (quantity) =>
      localPrisma.$transaction(async (tx) => {
        const current = await tx.receipt.findUnique({
          where: { id: receipt.id },
          select: { state: true },
        });

        // Widen the window: both racers have now read the same state.
        await tx.$executeRawUnsafe('SELECT pg_sleep(0.25)');

        await tx.stockQuant.upsert({
          where: { productId_locationId: { productId: product.id, locationId: loc.store.id } },
          create: {
            productId: product.id,
            locationId: loc.store.id,
            onHand: new Prisma.Decimal(quantity),
          },
          update: { onHand: { increment: new Prisma.Decimal(quantity) } },
        });
        postedBy.set(current.state, quantity);

        await documentService.finalize(tx, { document: tx.receipt, documentId: receipt.id });
        return { observed: current.state };
      });

    const results = await Promise.allSettled([race(7), race(7)]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(await onHand()).toBe(before + 7);
  });

  it('rejects a validation of a document that is already DONE', async () => {
    const before = await onHand();

    await localPrisma.$transaction((tx) =>
      documentService.finalize(tx, { document: tx.receipt, documentId: receipt.id }),
    );
    expect((await prisma.receipt.findUnique({ where: { id: receipt.id } })).state).toBe(
      DOC_STATES.DONE,
    );

    await expect(validatingTransaction('late')).rejects.toMatchObject({
      code: 'DOCUMENT_ALREADY_VALIDATED',
    });
    expect(await onHand()).toBe(before);
  });

  it('refuses to transition out of a terminal state', async () => {
    await localPrisma.$transaction((tx) =>
      documentService.finalize(tx, { document: tx.receipt, documentId: receipt.id }),
    );

    await expect(
      localPrisma.$transaction((tx) =>
        documentService.transition(tx, {
          document: tx.receipt,
          documentId: receipt.id,
          to: 'WAITING',
        }),
      ),
    ).rejects.toMatchObject({ code: 'DOCUMENT_ALREADY_FINAL' });
  });

  it('honours an expectedStates whitelist', async () => {
    const draft = await createTrackedReceipt({
      reference: unique('RCP'),
      partnerId: partner.id,
      warehouseId: warehouse.id,
      state: DOC_STATES.DRAFT,
    });

    await expect(
      localPrisma.$transaction((tx) =>
        documentService.transition(tx, {
          document: tx.receipt,
          documentId: draft.id,
          to: DOC_STATES.READY,
          expectedStates: [DOC_STATES.WAITING],
        }),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });

    const updated = await localPrisma.$transaction((tx) =>
      documentService.transition(tx, {
        document: tx.receipt,
        documentId: draft.id,
        to: DOC_STATES.READY,
        expectedStates: [DOC_STATES.DRAFT],
      }),
    );
    expect(updated.state).toBe(DOC_STATES.READY);
  });

  it('rejects an unknown target state before touching the database', async () => {
    await expect(
      localPrisma.$transaction((tx) =>
        documentService.transition(tx, {
          document: tx.receipt,
          documentId: receipt.id,
          to: 'SHIPPED',
        }),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });
});
