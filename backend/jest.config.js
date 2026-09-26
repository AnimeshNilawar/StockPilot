process.env.NODE_ENV = process.env.NODE_ENV || 'test';

module.exports = {
  testEnvironment: 'node',
  testTimeout: 30000,
  setupFiles: ['<rootDir>/tests/setup.js'],
  testPathIgnorePatterns: ['/node_modules/', '/tests/helpers.js'],
  collectCoverageFrom: ['src/**/*.js'],
};
