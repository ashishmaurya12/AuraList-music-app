const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const validate = require('../middleware/validate');
const { likeParamSchema, likeBodySchema } = require('../validators/like');
const Like = require('../models/Like');

router.use(authMiddleware);

// GET /api/likes - Get user's liked tracks
router.get('/', async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.user.id)) {
      return res.status(400).json({ error: 'Invalid resource ID.' });
    }
    const userLikes = await Like.find({ userId: req.user.id }).sort({ likedAt: -1 });
    res.json(userLikes);
  } catch (error) {
    next(error);
  }
});

// POST /api/likes/:jamendoId - Toggle like / unlike track
router.post('/:jamendoId', validate(likeParamSchema, 'params'), validate(likeBodySchema, 'body'), async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.user.id)) {
      return res.status(400).json({ error: 'Invalid resource ID.' });
    }
    const { jamendoId } = req.params;
    const { title, artist, coverUrl, audioUrl, duration } = req.body;

    const existingLike = await Like.findOne({
      userId: req.user.id,
      jamendoId: String(jamendoId)
    });

    if (existingLike) {
      // Unlike: remove from database
      await Like.findOneAndDelete({ _id: existingLike._id });
      return res.json({ liked: false, jamendoId: String(jamendoId), message: 'Removed from Liked Songs.' });
    } else {
      // Like: add track metadata
      const effectiveAudioUrl = audioUrl || (jamendoId ? `/api/music/stream/${jamendoId}` : '');
      if (!title || !artist || !effectiveAudioUrl) {
        return res.status(400).json({ error: 'Missing track metadata to like track.' });
      }

      const newLike = await Like.create({
        userId: req.user.id,
        jamendoId: String(jamendoId),
        title,
        artist,
        coverUrl: coverUrl || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop',
        audioUrl: effectiveAudioUrl,
        duration: duration || 0
      });

      return res.json({ liked: true, track: newLike, message: 'Added to Liked Songs.' });
    }
  } catch (error) {
    if (error.code === 11000) {
      return res.json({ liked: true, message: 'Track is already liked.' });
    }
    next(error);
  }
});

module.exports = router;

