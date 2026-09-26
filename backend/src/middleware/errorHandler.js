const { Prisma } = require('@prisma/client');
const { ZodError } = require('zod');
const { env } = require('../config/env');

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const normalized = normalize(err);

  if (normalized.status >= 500) {
    console.error('Error:', err);
  }

  const response = {
    success: false,
    message: normalized.message,
    code: normalized.code,
  };

  if (normalized.details) {
    response.errors = normalized.details;
  }

  res.status(normalized.status).json(response);
}

/**
 * Translates known library errors into the API error envelope
 * (`{ success, message, code }`). Unknown errors become a generic 500 so
 * internal details (SQL, stack traces, column names) never leak to clients.
 */
function normalize(err) {
  if (err instanceof ZodError) {
    return {
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'Validation failed',
      details: err.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    };
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    switch (err.code) {
      case 'P2002':
        return {
          status: 409,
          code: 'DUPLICATE_RESOURCE',
          message: duplicateMessage(err),
          details: targetFields(err),
        };
      case 'P2003':
        return {
          status: 400,
          code: 'INVALID_REFERENCE',
          message: 'Referenced record does not exist',
        };
      case 'P2025':
        return {
          status: 404,
          code: 'NOT_FOUND',
          message: 'Resource not found',
        };
      case 'P2004':
        return {
          status: 400,
          code: 'CONSTRAINT_VIOLATION',
          message: 'A database constraint was violated',
        };
      default:
        return { status: 400, code: err.code, message: 'Database request failed' };
    }
  }

  if (err instanceof Prisma.PrismaClientValidationError) {
    return { status: 400, code: 'INVALID_QUERY', message: 'Invalid database query' };
  }

  const status = err.status || err.statusCode;
  if (typeof status === 'number' && status >= 400 && status < 600) {
    return {
      status,
      code: err.code || 'ERROR',
      message: err.message || 'Request failed',
      details: err.details,
    };
  }

  return {
    status: 500,
    code: 'INTERNAL_SERVER_ERROR',
    message:
      env.NODE_ENV === 'production'
        ? 'Internal Server Error'
        : err.message || 'Internal Server Error',
  };
}

function duplicateMessage(err) {
  const fields = targetFields(err);
  if (fields.length > 0) {
    return `${fields.join(', ')} already exists`;
  }
  return 'A record with these values already exists';
}

/** Reads the constraint target out of a P2002 so the message names the field. */
function targetFields(err) {
  const target = err.meta && err.meta.target;
  if (Array.isArray(target)) return target.map((field) => humanize(String(field)));
  if (typeof target === 'string') {
    // Composite keys arrive as `locations_warehouse_id_short_code_key`.
    if (target.includes('_')) {
      return [humanize(target.replace(/_key$/, '').split('_').join(' '))];
    }
    return [humanize(target)];
  }
  return [];
}

const humanize = (value) =>
  value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (char) => char.toUpperCase());

module.exports = errorHandler;
module.exports.normalize = normalize;
