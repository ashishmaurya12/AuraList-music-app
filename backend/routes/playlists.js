const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const validate = require('../middleware/validate');
const {
  createPlaylistSchema,
  renamePlaylistSchema,
  playlistIdParamSchema,
  addTrackSchema,
  removeTrackParamSchema
} = require('../validators/playlist');
const Playlist = require('../models/Playlist');

// All playlist routes require authentication
router.use(authMiddleware);

// GET /api/playlists - Get all playlists for current user
router.get('/', async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.user.id)) {
      return res.status(400).json({ error: 'Invalid resource ID.' });
    }
    const userPlaylists = await Playlist.find({ userId: req.user.id }).sort({ createdAt: -1 });
    res.json(userPlaylists);
  } catch (error) {
    next(error);
  }
});

// GET /api/playlists/:id - Get single playlist by ID for current user
router.get('/:id', validate(playlistIdParamSchema, 'params'), async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(req.user.id)) {
      return res.status(400).json({ error: 'Invalid resource ID.' });
    }

    const playlist = await Playlist.findOne({ _id: id, userId: req.user.id });

    if (!playlist) {
      return res.status(404).json({ error: 'Playlist not found or unauthorized.' });
    }

    res.json(playlist);
  } catch (error) {
    next(error);
  }
});

// POST /api/playlists - Create new playlist
router.post('/', validate(createPlaylistSchema, 'body'), async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.user.id)) {
      return res.status(400).json({ error: 'Invalid resource ID.' });
    }
    const { name } = req.body;

    const newPlaylist = await Playlist.create({
      userId: req.user.id,
      name: name.trim(),
      tracks: []
    });

    res.status(201).json(newPlaylist);
  } catch (error) {
    next(error);
  }
});

// PUT /api/playlists/:id - Rename playlist
router.put('/:id', validate(playlistIdParamSchema, 'params'), validate(renamePlaylistSchema, 'body'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name } = req.body;

    if (!mongoose.Types.ObjectId.isValid(req.user.id)) {
      return res.status(400).json({ error: 'Invalid resource ID.' });
    }

    const playlist = await Playlist.findOneAndUpdate(
      { _id: id, userId: req.user.id },
      { name: name.trim() },
      { returnDocument: 'after' }
    );

    if (!playlist) {
      return res.status(404).json({ error: 'Playlist not found or unauthorized.' });
    }

    res.json(playlist);
  } catch (error) {
    next(error);
  }
});

// DELETE /api/playlists/:id - Delete playlist
router.delete('/:id', validate(playlistIdParamSchema, 'params'), async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(req.user.id)) {
      return res.status(400).json({ error: 'Invalid resource ID.' });
    }

    const playlist = await Playlist.findOneAndDelete({ _id: id, userId: req.user.id });

    if (!playlist) {
      return res.status(404).json({ error: 'Playlist not found or unauthorized.' });
    }

    res.json({ message: 'Playlist deleted successfully.' });
  } catch (error) {
    next(error);
  }
});

// POST /api/playlists/:id/tracks - Add track to playlist
router.post('/:id/tracks', validate(playlistIdParamSchema, 'params'), validate(addTrackSchema, 'body'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { jamendoId, title, artist, coverUrl, audioUrl, duration } = req.body;

    if (!mongoose.Types.ObjectId.isValid(req.user.id)) {
      return res.status(400).json({ error: 'Invalid resource ID.' });
    }

    const trackStr = String(jamendoId);

    // Atomic concurrency protection: only push track if it does not already exist in playlist
    const updated = await Playlist.findOneAndUpdate(
      {
        _id: id,
        userId: req.user.id,
        'tracks.jamendoId': { $ne: trackStr }
      },
      {
        $push: {
          tracks: {
            jamendoId: trackStr,
            title,
            artist,
            coverUrl: coverUrl || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop',
            audioUrl,
            duration: duration || 0,
            addedAt: new Date()
          }
        }
      },
      { returnDocument: 'after' }
    );

    if (!updated) {
      // Differentiate between non-existent playlist (404) and duplicate track rejection (400)
      const existing = await Playlist.findOne({ _id: id, userId: req.user.id });
      if (!existing) {
        return res.status(404).json({ error: 'Playlist not found or unauthorized.' });
      }
      return res.status(400).json({ error: 'Track is already in this playlist.' });
    }

    res.status(201).json(updated);
  } catch (error) {
    next(error);
  }
});

// DELETE /api/playlists/:id/tracks/:jamendoId - Remove track from playlist
router.delete('/:id/tracks/:jamendoId', validate(removeTrackParamSchema, 'params'), async (req, res, next) => {
  try {
    const { id, jamendoId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(req.user.id)) {
      return res.status(400).json({ error: 'Invalid resource ID.' });
    }

    const updated = await Playlist.findOneAndUpdate(
      { _id: id, userId: req.user.id },
      { $pull: { tracks: { jamendoId: String(jamendoId) } } },
      { returnDocument: 'after' }
    );

    if (!updated) {
      return res.status(404).json({ error: 'Playlist not found or unauthorized.' });
    }

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

module.exports = router;

