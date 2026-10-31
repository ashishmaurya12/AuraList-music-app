require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const connectDB = require('../backend/config/db');
const User = require('../backend/models/User');
const Playlist = require('../backend/models/Playlist');
const Like = require('../backend/models/Like');
const History = require('../backend/models/History');

const DATA_DIR = path.join(__dirname, '../data');

function readJsonFile(filename) {
  const filePath = path.join(DATA_DIR, filename);
  if (!fs.existsSync(filePath)) {
    return { exists: false, data: [], error: null };
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.trim()) {
      return { exists: true, data: [], error: null };
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return {
        exists: true,
        data: null,
        error: `Expected JSON array in ${filename}, but found ${typeof parsed}`
      };
    }
    return { exists: true, data: parsed, error: null };
  } catch (err) {
    return { exists: true, data: null, error: err.message };
  }
}

async function migrate() {
  await connectDB();

  console.log('[Migration] Starting JSON to MongoDB data import...');

  const legacyFileNames = ['users.json', 'playlists.json', 'likes.json', 'history.json'];
  const filesFound = legacyFileNames.filter(file => fs.existsSync(path.join(DATA_DIR, file)));

  const stats = {
    users: { imported: 0, skipped: 0, failed: 0 },
    playlists: { imported: 0, skipped: 0, failed: 0 },
    likes: { imported: 0, skipped: 0, failed: 0 },
    history: { imported: 0, skipped: 0, failed: 0 }
  };
  const parseErrors = [];

  if (filesFound.length === 0) {
    console.warn('[Migration] Warning: No legacy JSON files (users.json, playlists.json, likes.json, history.json) were found in data directory.');
    console.log('[Migration] Summary: SUCCESS');
    console.log('[Migration] Zero-import summary: 0 users, 0 playlists, 0 likes, 0 history entries imported.');
    if (mongoose.connection && mongoose.connection.readyState !== 0) {
      await mongoose.connection.close();
    }
    return {
      status: 'SUCCESS',
      stats,
      hasErrors: false,
      users: 0,
      playlists: 0,
      likes: 0,
      history: 0
    };
  }

  // Read and validate all files
  const fileResults = {
    users: readJsonFile('users.json'),
    playlists: readJsonFile('playlists.json'),
    likes: readJsonFile('likes.json'),
    history: readJsonFile('history.json')
  };

  for (const [key, res] of Object.entries(fileResults)) {
    if (res.error) {
      parseErrors.push(`${key}.json: ${res.error}`);
      console.error(`[Migration] File parsing error in ${key}.json: ${res.error}`);
    }
  }

  const legacyUsers = fileResults.users.data || [];
  const legacyPlaylists = fileResults.playlists.data || [];
  const legacyLikes = fileResults.likes.data || [];
  const legacyHistory = fileResults.history.data || [];

  const userIdMap = {}; // legacyUserId -> mongoId

  // 1. Migrate Users
  for (const u of legacyUsers) {
    if (!u || typeof u !== 'object') {
      stats.users.failed++;
      continue;
    }
    const cleanEmail = (u.email || '').toLowerCase().trim();
    if (!cleanEmail) {
      stats.users.failed++;
      console.warn('[Migration] User record missing valid email.');
      continue;
    }

    try {
      let existingUser = await User.findOne({ email: cleanEmail });
      if (!existingUser) {
        existingUser = await User.create({
          name: (u.name || 'User').trim(),
          email: cleanEmail,
          password: u.password,
          createdAt: u.createdAt ? new Date(u.createdAt) : new Date()
        });
        stats.users.imported++;
        console.log(`[Migration] User created: ${cleanEmail}`);
      } else {
        stats.users.skipped++;
        console.log(`[Migration] User existing (idempotent skip): ${cleanEmail}`);
      }

      if (u.id) {
        userIdMap[u.id] = existingUser._id;
      }
    } catch (err) {
      stats.users.failed++;
      console.error(`[Migration] Error migrating user ${cleanEmail}:`, err.message);
    }
  }

  // 2. Migrate Playlists
  for (const p of legacyPlaylists) {
    if (!p || typeof p !== 'object' || !p.name) {
      stats.playlists.failed++;
      continue;
    }
    const mongoUserId = userIdMap[p.userId];
    if (!mongoUserId) {
      stats.playlists.failed++;
      console.warn(`[Migration] Playlist "${p.name}" failed: legacy userId "${p.userId}" not found in MongoDB.`);
      continue;
    }

    try {
      const existingPlaylist = await Playlist.findOne({
        userId: mongoUserId,
        name: p.name
      });

      if (!existingPlaylist) {
        await Playlist.create({
          userId: mongoUserId,
          name: p.name,
          tracks: (p.tracks || []).map(t => ({
            jamendoId: String(t.jamendoId || t.id || ''),
            title: t.title || 'Untitled Track',
            artist: t.artist || 'Unknown Artist',
            coverUrl: t.coverUrl || '',
            audioUrl: t.audioUrl || '',
            duration: t.duration || 0,
            addedAt: t.addedAt ? new Date(t.addedAt) : new Date()
          })),
          createdAt: p.createdAt ? new Date(p.createdAt) : new Date()
        });
        stats.playlists.imported++;
        console.log(`[Migration] Playlist created: "${p.name}" for user ${mongoUserId}`);
      } else {
        stats.playlists.skipped++;
        console.log(`[Migration] Playlist already exists (idempotent skip): "${p.name}" for user ${mongoUserId}`);
      }
    } catch (err) {
      stats.playlists.failed++;
      console.error(`[Migration] Error migrating playlist "${p.name}":`, err.message);
    }
  }

  // 3. Migrate Likes
  for (const l of legacyLikes) {
    if (!l || typeof l !== 'object') {
      stats.likes.failed++;
      continue;
    }
    const mongoUserId = userIdMap[l.userId];
    if (!mongoUserId) {
      stats.likes.failed++;
      continue;
    }

    try {
      await Like.create({
        userId: mongoUserId,
        jamendoId: String(l.jamendoId || l.id || ''),
        title: l.title || 'Untitled Track',
        artist: l.artist || 'Unknown Artist',
        coverUrl: l.coverUrl || '',
        audioUrl: l.audioUrl || '',
        duration: l.duration || 0,
        likedAt: l.likedAt ? new Date(l.likedAt) : new Date()
      });
      stats.likes.imported++;
      console.log(`[Migration] Like added: track ${l.jamendoId} for user ${mongoUserId}`);
    } catch (err) {
      if (err.code === 11000) {
        // Idempotent duplicate like entry: not a failure
        stats.likes.skipped++;
      } else {
        stats.likes.failed++;
        console.error(`[Migration] Error migrating like:`, err.message);
      }
    }
  }

  // 4. Migrate History
  for (const h of legacyHistory) {
    if (!h || typeof h !== 'object') {
      stats.history.failed++;
      continue;
    }
    const mongoUserId = userIdMap[h.userId];
    if (!mongoUserId) {
      stats.history.failed++;
      continue;
    }

    try {
      await History.create({
        userId: mongoUserId,
        jamendoId: String(h.jamendoId || h.id || ''),
        title: h.title || 'Untitled Track',
        artist: h.artist || 'Unknown Artist',
        coverUrl: h.coverUrl || '',
        audioUrl: h.audioUrl || '',
        duration: h.duration || 0,
        playedAt: h.playedAt ? new Date(h.playedAt) : new Date()
      });
      stats.history.imported++;
    } catch (err) {
      stats.history.failed++;
      console.error(`[Migration] Error migrating history entry:`, err.message);
    }
  }

  const totalImported = stats.users.imported + stats.playlists.imported + stats.likes.imported + stats.history.imported;
  const totalFailed = stats.users.failed + stats.playlists.failed + stats.likes.failed + stats.history.failed + parseErrors.length;
  const hasErrors = totalFailed > 0;

  let status = 'SUCCESS';
  if (parseErrors.length > 0 || (hasErrors && totalImported === 0)) {
    status = 'FAILED';
  } else if (hasErrors && totalImported > 0) {
    status = 'PARTIAL FAILURE';
  }

  console.log(`\n=================== MIGRATION SUMMARY ===================`);
  console.log(`STATUS    : ${status}`);
  console.log(`Users     : ${stats.users.imported} imported, ${stats.users.skipped} skipped, ${stats.users.failed} failed`);
  console.log(`Playlists : ${stats.playlists.imported} imported, ${stats.playlists.skipped} skipped, ${stats.playlists.failed} failed`);
  console.log(`Likes     : ${stats.likes.imported} imported, ${stats.likes.skipped} skipped, ${stats.likes.failed} failed`);
  console.log(`History   : ${stats.history.imported} imported, ${stats.history.skipped} skipped, ${stats.history.failed} failed`);
  if (parseErrors.length > 0) {
    console.error(`File Errors:\n  - ${parseErrors.join('\n  - ')}`);
  }
  console.log(`=========================================================\n`);

  if (mongoose.connection && mongoose.connection.readyState !== 0) {
    await mongoose.connection.close();
  }

  return {
    status,
    stats,
    hasErrors,
    parseErrors,
    users: stats.users.imported,
    playlists: stats.playlists.imported,
    likes: stats.likes.imported,
    history: stats.history.imported
  };
}

if (require.main === module) {
  migrate().then((result) => {
    if (result.status === 'FAILED' || result.status === 'PARTIAL FAILURE' || result.hasErrors) {
      process.exit(1);
    }
    process.exit(0);
  }).catch(err => {
    console.error('[Migration] Migration failed:', err);
    process.exit(1);
  });
}

module.exports = {
  migrate,
  readJsonFile
};
