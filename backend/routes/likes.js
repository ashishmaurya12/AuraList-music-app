const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const { readData, writeData } = require('../services/db');

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}

router.use(authMiddleware);

// GET /api/likes - Get user's liked tracks
router.get('/', async (req, res) => {
  try {
    const likes = await readData('likes');
    const userLikes = likes.filter(l => l.userId === req.user.id);
    res.json(userLikes);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch liked tracks.' });
  }
});

// POST /api/likes/:jamendoId - Toggle like / unlike track
router.post('/:jamendoId', async (req, res) => {
  try {
    const { jamendoId } = req.params;
    const { title, artist, coverUrl, audioUrl, duration } = req.body;

    const likes = await readData('likes');
    const existingIndex = likes.findIndex(l => l.userId === req.user.id && String(l.jamendoId) === String(jamendoId));

    if (existingIndex !== -1) {
      // Unlike: remove from likes
      likes.splice(existingIndex, 1);
      await writeData('likes', likes);
      return res.json({ liked: false, jamendoId: String(jamendoId), message: 'Removed from Liked Songs.' });
    } else {
      // Like: add track metadata
      if (!title || !artist || !audioUrl) {
        return res.status(400).json({ error: 'Missing track metadata to like track.' });
      }

      const newLike = {
        id: generateId(),
        userId: req.user.id,
        jamendoId: String(jamendoId),
        title,
        artist,
        coverUrl: coverUrl || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop',
        audioUrl,
        duration: duration || 0,
        likedAt: new Date().toISOString()
      };

      likes.push(newLike);
      await writeData('likes', likes);
      return res.json({ liked: true, track: newLike, message: 'Added to Liked Songs.' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to toggle like.' });
  }
});

module.exports = router;
