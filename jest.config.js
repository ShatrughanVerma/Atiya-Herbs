module.exports = {
  preset: '@react-native/jest-preset',
  // Google Sign-In ships a ready-made mock of its native module for tests
  setupFiles: [
    './node_modules/@react-native-google-signin/google-signin/jest/build/jest/setup.js',
    './jest.setup.js',
  ],
  // The call backend is a separate Node project with its own tests (npm test in call-backend/)
  modulePathIgnorePatterns: ['<rootDir>/call-backend/'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@react-navigation|react-native-vector-icons|@react-native-google-signin|react-native-image-picker)/)',
  ],
};
