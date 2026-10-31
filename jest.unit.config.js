/**
 * jest.unit.config.js
 *
 * Jest configuration for UNIT tests only.
 *
 * Unit tests:
 *   - Do NOT require a running MongoDB instance.
 *   - Cover pure logic, validators, UI utilities, and mocked-DB service tests.
 *   - Run fast in any environment without infrastructure.
 *
 * Run via: npm run test:unit
 */
module.exports = {
  testEnvironment: 'node',
  testTimeout: 15000,
  verbose: true,
  coverageDirectory: 'coverage/unit',
  collectCoverageFrom: [
    'backend/**/*.js',
    'public/js/**/*.js',
    '!**/node_modules/**'
  ],
  // Lightweight env setup only — NO database connection hook.
  setupFiles: ['<rootDir>/tests/setup-env.js'],
  // No setupFilesAfterEnv: MongoDB is never touched in unit tests.
  testMatch: [
    // Pure logic / UI / service tests that mock all DB calls
    '<rootDir>/tests/frontend.test.js',
    '<rootDir>/tests/dedupe.test.js',
    '<rootDir>/tests/recommendations.test.js',
    '<rootDir>/tests/features_phase234.test.js',
    '<rootDir>/tests/artist_search.test.js',
    '<rootDir>/tests/audio_quality.test.js',
    '<rootDir>/tests/search_ranking.test.js',
    '<rootDir>/tests/intent_search.test.js',
    '<rootDir>/tests/providers_integration.test.js',
    '<rootDir>/tests/search.test.js',
    '<rootDir>/tests/navigation_and_profile.test.js',
    // Any test explicitly placed in the unit sub-folder
    '<rootDir>/tests/unit/**/*.test.js'
  ]
};