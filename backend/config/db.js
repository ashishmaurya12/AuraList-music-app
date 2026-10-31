const mongoose = require('mongoose');

function redactMongoCredentials(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    // Redact protocol://user:pass@host -> protocol://[REDACTED_CREDENTIALS]@host
    .replace(/([a-zA-Z0-9+]+:\/\/)(?:[^\/@\s]+@)+/g, '$1[REDACTED_CREDENTIALS]@')
    // Redact user "[username]" patterns in errors
    .replace(/user\s+"[^"]+"/gi, 'user "[REDACTED]"')
    // Redact any remaining user:pass@ patterns in strings
    .replace(/(?:^|\s|\b)[a-zA-Z0-9_.%+-]+:[^@\s/]+@/g, ' [REDACTED_CREDENTIALS]@')
    // Redact password query parameters if present
    .replace(/([?&](?:password|pwd|secret)=)[^&]*/gi, '$1***');
}

function getRedactedDbTarget(rawUri) {
  if (!rawUri || typeof rawUri !== 'string') return '(none provided)';
  try {
    const cleaned = redactMongoCredentials(rawUri.trim());
    const match = cleaned.match(/^([a-zA-Z0-9+]+:\/\/)([^/?#]+)(?:\/([^?#]*))?/);
    if (match) {
      const protocol = match[1];
      const hosts = match[2];
      const database = match[3] ? `/${match[3]}` : '';
      return `${protocol}${hosts}${database}`;
    }
  } catch (_) {}
  return '(redacted)';
}

function printDbConnectionError(uri, error) {
  const safeTarget = getRedactedDbTarget(uri);
  const errMsg = error && error.message
    ? redactMongoCredentials(String(error.message))
    : 'Unknown error';
  console.error('\n╔══════════════════════════════════════════════════════════════╗');
  console.error('║  ⛔  DATABASE CONNECTION FAILED                              ║');
  console.error('╠══════════════════════════════════════════════════════════════╣');
  console.error(`║  Safe Target: ${safeTarget.slice(0, 44).padEnd(44)}║`);
  console.error(`║  Error      : ${errMsg.slice(0, 44).padEnd(44)}║`);
  console.error('║                                                              ║');
  console.error('║  How to start MongoDB:                                       ║');
  console.error('║    Windows : mongod --dbpath C:/data/db                      ║');
  console.error('║    Docker  : docker run -d -p 27017:27017 mongo:7            ║');
  console.error('║    Or set MONGODB_URI to a reachable cluster connection.     ║');
  console.error('║                                                              ║');
  console.error('║  To run tests without a database:                            ║');
  console.error('║    npm run test:unit                                         ║');
  console.error('╚══════════════════════════════════════════════════════════════╝\n');
}

function verifyDatabaseSafety(uri) {
  if (process.env.NODE_ENV === 'test') {
    try {
      const parsedUrl = new URL(uri);
      const dbName = parsedUrl.pathname.replace(/^\//, '').trim().toLowerCase();
      const unsafeNames = ['auralist', 'production', 'prod'];
      if (unsafeNames.includes(dbName)) {
        throw new Error(
          `[SAFETY CHECK FAILED] Refusing to use production database "${dbName}" in test environment. ` +
          `Set MONGODB_TEST_URI to a dedicated test database (e.g. mongodb://127.0.0.1:27017/auralist_test).`
        );
      }
    } catch (err) {
      if (err.message.includes('SAFETY CHECK FAILED')) throw err;
    }
  }
}

const connectDB = async () => {
  if (mongoose.connection.readyState !== 0) {
    return mongoose.connection;
  }
  const connStr = process.env.MONGODB_URI;
  if (!connStr || !connStr.trim()) {
    const missingErr = new Error('[DB] MONGODB_URI environment variable is missing or empty.');
    printDbConnectionError('', missingErr);
    throw missingErr;
  }

  verifyDatabaseSafety(connStr.trim());

  try {
    const conn = await mongoose.connect(connStr.trim(), {
      serverSelectionTimeoutMS: 5000,
      maxPoolSize: Number(process.env.DB_MAX_POOL_SIZE) || 25,
      minPoolSize: Number(process.env.DB_MIN_POOL_SIZE) || 2
    });
    console.log(`[DB] MongoDB Connected successfully: ${conn.connection.host}`);
    return conn;
  } catch (error) {
    printDbConnectionError(connStr.trim(), error);
    const safeMsg = redactMongoCredentials(error.message || '');
    throw new Error(`[DB] Database connection error: ${safeMsg}`);
  }
};

connectDB.getRedactedDbTarget = getRedactedDbTarget;
connectDB.redactMongoCredentials = redactMongoCredentials;
module.exports = connectDB;
