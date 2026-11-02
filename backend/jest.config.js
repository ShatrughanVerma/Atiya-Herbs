module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/**/*.test.js'],
  // The generated Prisma client is not our code
  collectCoverageFrom: ['src/**/*.js'],
  clearMocks: true,
};
