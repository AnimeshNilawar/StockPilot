module.exports = [
  {
    ignores: ['node_modules/**', 'dist/**'],
  },
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        console: 'readonly',
        process: 'readonly',
        __dirname: 'readonly',
        module: 'readonly',
        require: 'readonly',
        exports: 'readonly',
        __filename: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setImmediate: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        queueMicrotask: 'readonly',
        structuredClone: 'readonly',
      },
    },
    rules: {
      // A reference to an identifier that was never declared is a runtime
      // ReferenceError, and neither the bundler nor the test run reports it
      // before it is hit, so it has to be a static error.
      'no-undef': 'error',
      'no-unused-vars': 'warn',
      'no-console': 'off',
    },
  },
  {
    // Jest injects its API as globals, so `no-undef` has to know about them.
    files: ['tests/**/*.js', 'prisma/**/*.js'],
    languageOptions: {
      globals: {
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeAll: 'readonly',
        beforeEach: 'readonly',
        afterAll: 'readonly',
        afterEach: 'readonly',
        jest: 'readonly',
      },
    },
  },
];
