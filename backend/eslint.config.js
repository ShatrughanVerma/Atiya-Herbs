const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  {ignores: ['node_modules/**', 'coverage/**']},
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {ecmaVersion: 2023, sourceType: 'commonjs', globals: {...globals.node}},
    rules: {
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
      // Security: never build code or queries from strings
      'no-eval': 'error',
      'no-new-func': 'error',
      'no-implied-eval': 'error',
    },
  },
  {files: ['test/**/*.js'], languageOptions: {globals: {...globals.node, ...globals.jest}}},
];
