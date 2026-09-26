/**
 * Application error type. `errorHandler` already maps `status` / `message` /
 * `code` onto the API error envelope, so any thrown error carrying these three
 * properties produces a well-formed response without extra wiring.
 */
class AppError extends Error {
  constructor(message, { status = 500, code = 'INTERNAL_SERVER_ERROR', details = undefined } = {}) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    if (details !== undefined) {
      this.details = details;
    }
    Error.captureStackTrace(this, AppError);
  }
}

const badRequest = (message, code = 'BAD_REQUEST', details) =>
  new AppError(message, { status: 400, code, details });

const unauthorized = (message = 'Authentication required', code = 'UNAUTHORIZED') =>
  new AppError(message, { status: 401, code });

const forbidden = (message = 'Forbidden', code = 'FORBIDDEN') =>
  new AppError(message, { status: 403, code });

const notFound = (message = 'Resource not found', code = 'NOT_FOUND') =>
  new AppError(message, { status: 404, code });

const conflict = (message, code = 'CONFLICT') => new AppError(message, { status: 409, code });

const unprocessable = (message, code = 'UNPROCESSABLE_ENTITY', details) =>
  new AppError(message, { status: 422, code, details });

module.exports = {
  AppError,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  unprocessable,
};
