require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../backend/config/db');
const User = require('../backend/models/User');

async function auditDatabasePasswords() {
  console.log('=== Database Password Storage Audit ===');
  await connectDB();

  const users = await User.find({});
  console.log(`Found ${users.length} user records in MongoDB.`);

  let plaintextFound = 0;
  let validHashes = 0;

  for (const user of users) {
    const pwd = user.password || '';
    const isBcrypt = pwd.startsWith('$2a$') || pwd.startsWith('$2b$');
    if (isBcrypt) {
      validHashes++;
    } else {
      plaintextFound++;
      console.error(`❌ User ${user.email} (ID: ${user.id}) has non-bcrypt password!`);
    }
  }

  console.log(`\nAudit Results:`);
  console.log(`- Valid bcrypt hashes: ${validHashes}/${users.length}`);
  console.log(`- Plaintext passwords: ${plaintextFound}/${users.length}`);

  if (plaintextFound === 0) {
    console.log('✓ AUDIT PASSED: ZERO plaintext passwords in MongoDB!');
  } else {
    console.error('❌ AUDIT FAILED: Plaintext passwords detected in database!');
  }

  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close();
  }
  process.exit(plaintextFound === 0 ? 0 : 1);
}

auditDatabasePasswords().catch(err => {
  console.error('Audit failed:', err.message || err);
  process.exit(1);
});

