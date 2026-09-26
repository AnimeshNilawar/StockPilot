const crypto = require('crypto');
const { prisma } = require('../lib/prisma');
const { conflict, badRequest } = require('../utils/appError');

/**
 * Idempotency keys make `POST /:id/validate` safe to retry. A replayed request
 * returns the original response instead of mutating stock a second time.
 *
 * The claim, the business transaction and the stored response all live in ONE
 * transaction:
 *
 *   - the key row is inserted with `ON CONFLICT DO NOTHING`, so the first
 *     caller wins and a concurrent duplicate *blocks* on the unique index until
 *     that transaction commits, then observes the stored response and replays it;
 *   - a failed business transaction rolls the key row back too, so a retry is
 *     still allowed;
 *   - a crashed process can never leave a half-written key behind, because there
 *     is no intermediate committed state.
 */

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MIN_KEY_LENGTH = 8;
const MAX_KEY_LENGTH = 200;

const requestHash = (payload) => {
  const canonical = JSON.stringify(payload === undefined ? null : payload);
  return crypto.createHash('sha256').update(canonical).digest('hex');
};

/** Rejects missing / malformed `Idempotency-Key` headers. */
const readIdempotencyKey = (req) => {
  const raw = req.get('Idempotency-Key');
  if (!raw) {
    throw badRequest(
      'Idempotency-Key header is required for this operation',
      'IDEMPOTENCY_KEY_REQUIRED',
    );
  }
  const key = String(raw).trim();
  if (key.length < MIN_KEY_LENGTH || key.length > MAX_KEY_LENGTH) {
    throw badRequest(
      `Idempotency-Key must be between ${MIN_KEY_LENGTH} and ${MAX_KEY_LENGTH} characters`,
      'IDEMPOTENCY_KEY_INVALID',
    );
  }
  return key;
};

/**
 * Express middleware: enforces the header's presence and puts the validated
 * value on `req.idempotencyKey`.
 */
const requireIdempotencyKey = (req, res, next) => {
  try {
    req.idempotencyKey = readIdempotencyKey(req);
    return next();
  } catch (error) {
    return next(error);
  }
};

/**
 * Runs `handler(tx)` at most once per key.
 *
 * @param key       the Idempotency-Key value.
 * @param endpoint  logical operation name, namespacing the key.
 * @param userId    acting user, for traceability.
 * @param payload   request body; the same key with a different body is rejected.
 * @param handler   async (tx) => { statusCode, body }
 * @returns {{ replayed, statusCode, body }}
 */
const withIdempotency = async ({
  key,
  endpoint,
  userId,
  payload,
  handler,
  ttlMs = DEFAULT_TTL_MS,
}) => {
  const hash = requestHash(payload);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs);

  return prisma.$transaction(async (tx) => {
    const { count } = await tx.idempotencyKey.createMany({
      data: [
        {
          key,
          endpoint,
          userId: userId || null,
          requestHash: hash,
          statusCode: 0,
          responseBody: {},
          expiresAt,
        },
      ],
      skipDuplicates: true,
    });

    if (count > 0) {
      // We own the key: run the real work and record the response.
      const result = await handler(tx);
      await tx.idempotencyKey.update({
        where: { key },
        data: { statusCode: result.statusCode, responseBody: result.body },
      });
      return { replayed: false, ...result };
    }

    // Someone else already used this key. A concurrent duplicate is blocked on
    // the unique index until the winner commits, so what we read here is final.
    const existing = await tx.idempotencyKey.findUnique({ where: { key } });

    if (!existing) {
      // The winner rolled back between our insert and this read. Extremely rare;
      // treat it as a fresh attempt on the next request.
      throw conflict('Idempotency key could not be acquired, please retry', 'IDEMPOTENCY_KEY_BUSY');
    }

    if (existing.expiresAt.getTime() <= now.getTime()) {
      throw conflict(
        'Idempotency-Key has expired; use a new key to retry the operation',
        'IDEMPOTENCY_KEY_EXPIRED',
      );
    }

    if (existing.requestHash !== hash) {
      throw conflict(
        'Idempotency-Key was already used with a different request payload',
        'IDEMPOTENCY_KEY_REUSE',
      );
    }

    return {
      replayed: true,
      statusCode: existing.statusCode,
      body: existing.responseBody,
    };
  });
};

/** Housekeeping helper: drop keys that can no longer be replayed. */
const purgeExpired = async () => {
  const { count } = await prisma.idempotencyKey.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return count;
};

module.exports = {
  DEFAULT_TTL_MS,
  readIdempotencyKey,
  requireIdempotencyKey,
  withIdempotency,
  purgeExpired,
};
