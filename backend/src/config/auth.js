module.exports = {
  jwt: {
    secret: process.env.JWT_SECRET || 'super-secret-local-dev-key',
    accessExpiration: '15m', // Short-lived access token
    refreshExpirationDays: 7,
  },
  cookie: {
    name: 'refreshToken',
    options: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    },
  },
  otp: {
    expirationMinutes: 10,
    maxAttempts: 5,
  },
};
