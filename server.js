require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const { initDb } = require('./backend/services/db');

// Import routes
const authRoutes = require('./backend/routes/auth');
const musicRoutes = require('./backend/routes/music');
const playlistRoutes = require('./backend/routes/playlists');
const likeRoutes = require('./backend/routes/likes');
const historyRoutes = require('./backend/routes/history');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

// Mount API Routes
app.use('/api/auth', authRoutes);
app.use('/api/music', musicRoutes);
app.use('/api/playlists', playlistRoutes);
app.use('/api/likes', likeRoutes);
app.use('/api/history', historyRoutes);

// SPA Fallback routes for navigation
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/register', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

app.get('/app', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'app.html'));
});

// Fallback to index.html for root or unknown static requests
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Function to start server on PORT with automatic fallback if in use
function startServer(portToUse) {
  const server = app.listen(portToUse, () => {
    console.log(`=================================================`);
    console.log(`  🎵 Auralist Server running at http://localhost:${portToUse}`);
    console.log(`=================================================`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[Server] Port ${portToUse} is in use. Trying port ${portToUse + 1}...`);
      startServer(portToUse + 1);
    } else {
      console.error('[Server] Startup error:', err);
    }
  });
}

// Initialize DB and start server
initDb().then(() => {
  startServer(Number(PORT));
}).catch(err => {
  console.error('Failed to initialize database:', err);
});

