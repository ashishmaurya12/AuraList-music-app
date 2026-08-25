const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const { readData, writeData } = require('../services/db');

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}

router.use(authMiddleware);

// GET /api/history - Get user's play history (sorted newest first)
router.get('/', async (req, res) => {
  try {
    const history = await readData('history');
    const userHistory = history
      .filter(h => h.userId === req.user.id)
      .sort((a, b) => new Date(b.playedAt) - new Date(a.playedAt));
    res.json(userHistory);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch play history.' });
  }
});

// POST /api/history - Record a track playback
router.post('/', async (req, res) => {
  try {
    const { jamendoId, title, artist, coverUrl, audioUrl, duration } = req.body;

    if (!jamendoId || !title || !artist) {
      return res.status(400).json({ error: 'Track details (jamendoId, title, artist) are required.' });
    }

    const history = await readData('history');

    const newEntry = {
      id: generateId(),
      userId: req.user.id,
      jamendoId: String(jamendoId),
      title,
      artist,
      coverUrl: coverUrl || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop',
      audioUrl: audioUrl || '',
      duration: duration || 0,
      playedAt: new Date().toISOString()
    };

    history.push(newEntry);
    
    // Keep max 100 entries per user to prevent bloated files
    const userEntries = history.filter(h => h.userId === req.user.id);
    if (userEntries.length > 100) {
      // Remove oldest
      userEntries.sort((a, b) => new Date(a.playedAt) - new Date(b.playedAt));
      const toRemoveId = userEntries[0].id;
      const removeIndex = history.findIndex(h => h.id === toRemoveId);
      if (removeIndex !== -1) history.splice(removeIndex, 1);
    }

    await writeData('history', history);
    res.status(201).json(newEntry);
  } catch (error) {
    res.status(500).json({ error: 'Failed to log play history.' });
  }
});

module.exports = router;
