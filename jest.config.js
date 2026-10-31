/**
 * jest.config.js  — Integration test configuration (requires MongoDB)
 *
 * Integration tests:
 *   - Require a running MongoDB test instance.
 *   - Verify real database-backed routes: auth, history, likes, playlists, etc.
 *   - Always fail clearly if the test database is unavailable.
 *   - NEVER run against the production database.
 *
 * Set MONGODB_TEST_URI to point to your dedicated test database, e.g.:
 *   MONGODB_TEST_URI=mongodb://127.0.0.1:27017/auralist_test
 *
 * Run via: npm run test:integration
 * Run everything: npm test  (runs both unit + integration)
 */
module.exports = {
  testEnvironment: 'node',
  testTimeout: 15000,
  verbose: true,
  coverageDirectory: 'coverage/integration',
  collectCoverageFrom: [
    'backend/**/*.js',
    'public/js/**/*.js',
    '!**/node_modules/**'
  ],
  // Lightweight env vars first, then the DB-connecting hook.
  setupFiles: ['<rootDir>/tests/setup-env.js'],
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  // Integration test files — all require a live test database.
  testMatch: [
    '<rootDir>/tests/auth.test.js',
    '<rootDir>/tests/history.test.js',
    '<rootDir>/tests/likes.test.js',
    '<rootDir>/tests/music.test.js',
    '<rootDir>/tests/playlists.test.js',
    '<rootDir>/tests/regression.test.js',
    '<rootDir>/tests/security.test.js',
    '<rootDir>/tests/validation.test.js',
    '<rootDir>/tests/player.test.js',
    '<rootDir>/tests/artist_search.test.js',
    '<rootDir>/tests/audio_quality.test.js',
    '<rootDir>/tests/review_fixes_regression.test.js',
    '<rootDir>/tests/settings.test.js',
    // Any test explicitly placed in the integration sub-folder
    '<rootDir>/tests/integration/**/*.test.js'
  ]
};
