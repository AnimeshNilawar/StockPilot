const { z } = require('zod');
const { badRequest } = require('./appError');

/**
 * Validates the incoming request against Zod schemas and stores the *parsed*
 * (coerced, stripped) result on `req.valid`. Express 5 exposes `req.query` as a
 * getter-only property, so parsed data is never written back onto the request.
 *
 * Zod issues are converted into a 400 `VALIDATION_ERROR` AppError with a
 * `details` array of `{ path, message }` entries.
 */
const validate =
  (schemas = {}) =>
  (req, res, next) => {
    const result = {};

    for (const source of ['params', 'query', 'body']) {
      const schema = schemas[source];
      if (!schema) {
        result[source] = req[source];
        continue;
      }

      const parsed = schema.safeParse(req[source] ?? {});
      if (!parsed.success) {
        const details = parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        }));
        return next(badRequest('Validation failed', 'VALIDATION_ERROR', details));
      }
      result[source] = parsed.data;
    }

    req.valid = result;
    return next();
  };

/**
 * Standard list-endpoint pagination. `page` is 1-based, `pageSize` is capped so
 * a client cannot ask the database for an unbounded result set.
 */
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 200;

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

const parsePagination = (query = {}) => {
  const { page, pageSize } = paginationSchema.parse(query);
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
};

/** Envelope every list endpoint returns alongside the rows. */
const paginated = (rows, total, { page, pageSize }) => ({
  items: rows,
  pagination: {
    page,
    pageSize,
    total,
    totalPages: pageSize > 0 ? Math.ceil(total / pageSize) : 0,
  },
});

/** `?flag=true|false|1|0` -> boolean | undefined */
const parseBoolean = (value) => {
  if (value === undefined || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).toLowerCase();
  if (['true', '1', 'yes'].includes(normalized)) return true;
  if (['false', '0', 'no'].includes(normalized)) return false;
  return undefined;
};

/**
 * Reusable `?isActive=true` filter. `.optional()` sits *outside* the transform
 * so an absent query parameter short-circuits instead of failing the union.
 */
const booleanFilter = () =>
  z
    .union([z.boolean(), z.enum(['true', 'false', '1', '0', 'yes', 'no'])])
    .transform((value) => parseBoolean(value))
    .optional();

const optionalDate = (value, field) => {
  if (value === undefined || value === '') return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw badRequest(`Invalid date for ${field}`, 'VALIDATION_ERROR');
  }
  return date;
};

const optionalString = (value) => {
  if (value === undefined || value === null || value === '') return undefined;
  return String(value).trim();
};

module.exports = {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  validate,
  paginationSchema,
  parsePagination,
  paginated,
  parseBoolean,
  booleanFilter,
  optionalDate,
  optionalString,
};
