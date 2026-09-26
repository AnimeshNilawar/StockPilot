// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  console.error('Error:', err);

  const statusCode = err.status || 500;
  const message = err.message || 'Internal Server Error';

  const response = {
    success: false,
    message,
    code: err.code || 'INTERNAL_SERVER_ERROR',
  };

  // In production, we might want to hide internal server error details
  // For Phase 0, we'll keep it simple but structured.

  res.status(statusCode).json(response);
}

module.exports = errorHandler;
