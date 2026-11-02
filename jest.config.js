module.exports = {
  preset: '@react-native/jest-preset',
  // Google Sign-In ships a ready-made mock of its native module for tests
  setupFiles: [
    './node_modules/@react-native-google-signin/google-signin/jest/build/jest/setup.js',
    './jest.setup.js',
  ],
  // The backend servers are separate Node projects with their own tests (npm test in call-backend/ and backend/)
  modulePathIgnorePatterns: ['<rootDir>/call-backend/', '<rootDir>/backend/'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@react-navigation|react-native-vector-icons|@react-native-google-signin|react-native-image-picker)/)',
  ],
};
