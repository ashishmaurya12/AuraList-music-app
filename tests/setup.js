/**
 * tests/setup.js
 *
 * Integration-test lifecycle hook (Jest setupFilesAfterEnv).
 *
 * What it does:
 *   1. Enforces a DEDICATED test database — refuses to run against a production DB name.
 *   2. Connects to MongoDB before each test suite; FAILS HARD (never silently skips)
 *      if the database is unavailable.
 *   3. Cleans all test-database collections before and after each suite run.
 *   4. Closes the connection cleanly after the suite finishes.
 *
 * STATUS SEMANTICS:
 *   PASS    — MongoDB connected, tests ran, all assertions passed.
 *   FAIL    — MongoDB connected, tests ran, one or more assertions failed.
 *   BLOCKED — MongoDB is unavailable. Tests have NOT run. Fix the DB first.
 *             This file throws so Jest marks the entire suite as FAILED,
 *             which is the correct signal — not "passed with 0 tests".
 */

const mongoose = require('mongoose');

// ── 1. Force test environment ──────────────────────────────────────────────
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_key_1234567890123456';

// ── 2. Dedicated test database — NEVER fall back to production URI ─────────
const testUri = process.env.MONGODB_TEST_URI || 'mongodb://127.0.0.1:27017/auralist_test';
process.env.MONGODB_URI = testUri;

// ── 3. Safety: refuse production database names ────────────────────────────
function verifyTestDatabaseSafety(uri) {
  try {
    const parsedUrl = new URL(uri);
    const dbName = parsedUrl.pathname.replace(/^\//, '').trim().toLowerCase();
    const unsafeNames = ['auralist', 'production', 'prod'];
    if (unsafeNames.includes(dbName)) {
      throw new Error(
        `[SAFETY CHECK FAILED] Refusing to run destructive test cleanup on ` +
        `database "${dbName}". Use a dedicated test database such as ` +
        `"mongodb://127.0.0.1:27017/auralist_test".`
      );
    }
  } catch (err) {
    if (err.message.includes('SAFETY CHECK FAILED')) throw err;
    // URL parse error — let the connect step surface the issue
  }
}

// Run the safety check immediately on load so misconfigured environments
// are caught even before beforeAll fires.
verifyTestDatabaseSafety(testUri);

// ── 4. Helper: print a clear startup guide when MongoDB is unavailable ─────
function getRedactedDbTarget(rawUri) {
  if (!rawUri || typeof rawUri !== 'string') return '(none provided)';
  try {
    const match = rawUri.match(/^([a-zA-Z0-9+]+:\/\/)(?:[^@]+@)?([^/?#]+)(?:\/([^?#]*))?/);
    if (match) {
      const protocol = match[1];
      const hosts = match[2];
      const database = match[3] ? `/${match[3]}` : '';
      return `${protocol}${hosts}${database}`;
    }
  } catch (_) {}
  return '(redacted)';
}

function printDbStartupGuide(uri, err) {
  const safeTarget = getRedactedDbTarget(uri);
  const safeErrMsg = (err && err.message ? String(err.message) : 'Unknown error')
    .replace(/:\/\/([^@]+)@/g, '://');
  console.error('\n╔══════════════════════════════════════════════════════════════╗');
  console.error('║  ⛔  INTEGRATION TESTS — BLOCKED: MongoDB unavailable         ║');
  console.error('╠══════════════════════════════════════════════════════════════╣');
  console.error('║                                                              ║');
  console.error(`║  Safe Target   : ${safeTarget.slice(0, 44).padEnd(44)}║`);
  console.error(`║  Error         : ${safeErrMsg.slice(0, 44).padEnd(44)}║`);
  console.error('║                                                              ║');
  console.error('║  How to start a local test database:                         ║');
  console.error('║    Windows (mongod): mongod --dbpath C:/data/db              ║');
  console.error('║    Docker:  docker run -p 27017:27017 mongo:7                ║');
  console.error('║    Or set MONGODB_TEST_URI to a remote test-only cluster.    ║');
  console.error('║                                                              ║');
  console.error('║  These tests are BLOCKED, not passed.                        ║');
  console.error('║  Run unit tests (no DB needed): npm run test:unit            ║');
  console.error('╚══════════════════════════════════════════════════════════════╝\n');
}

// ── 5. Jest lifecycle ──────────────────────────────────────────────────────
beforeAll(async () => {
  verifyTestDatabaseSafety(testUri);

  if (mongoose.connection.readyState === 0) {
    try {
      await mongoose.connect(testUri, { serverSelectionTimeoutMS: 5000 });
    } catch (err) {
      printDbStartupGuide(testUri, err);
      const safeErrMsg = (err.message || '').replace(/:\/\/([^@]+)@/g, '://');
      // Throw — Jest marks the suite as FAILED, not silently skipped.
      throw new Error(
        `[BLOCKED] Integration tests require MongoDB but the test database ` +
        `is unavailable (${safeErrMsg}). ` +
        `Run \`npm run test:unit\` for tests that do not need a database.`
      );
    }
  }

  // Clean all collections before the suite so each run starts fresh.
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
});

afterAll(async () => {
  if (mongoose.connection.readyState !== 0) {
    // Clean up after the suite — keep the test DB in a known-empty state.
    const collections = mongoose.connection.collections;
    for (const key in collections) {
      await collections[key].deleteMany({});
    }
    await mongoose.connection.close();
  }
});

