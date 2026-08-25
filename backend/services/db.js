const fs = require('fs').promises;
const path = require('path');

const DATA_DIR = path.join(__dirname, '../../data');

const FILES = {
  users: path.join(DATA_DIR, 'users.json'),
  playlists: path.join(DATA_DIR, 'playlists.json'),
  likes: path.join(DATA_DIR, 'likes.json'),
  history: path.join(DATA_DIR, 'history.json')
};

// Ensure data directory and JSON files exist
async function initDb() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    for (const [key, filePath] of Object.entries(FILES)) {
      try {
        await fs.access(filePath);
      } catch (err) {
        // File doesn't exist, create it with empty array []
        await fs.writeFile(filePath, JSON.stringify([], null, 2), 'utf8');
      }
    }
    console.log('[DB] Database initialized successfully.');
  } catch (error) {
    console.error('[DB] Initialization error:', error);
  }
}

// Read collection from file
async function readData(collection) {
  const filePath = FILES[collection];
  if (!filePath) {
    throw new Error(`Invalid collection name: ${collection}`);
  }
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw || '[]');
  } catch (error) {
    console.error(`[DB] Error reading ${collection}:`, error);
    return [];
  }
}

// Write collection to file
async function writeData(collection, data) {
  const filePath = FILES[collection];
  if (!filePath) {
    throw new Error(`Invalid collection name: ${collection}`);
  }
  try {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error(`[DB] Error writing ${collection}:`, error);
    throw error;
  }
}

module.exports = {
  initDb,
  readData,
  writeData
};
