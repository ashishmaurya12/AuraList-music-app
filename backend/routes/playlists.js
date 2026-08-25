const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const { readData, writeData } = require('../services/db');

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}

// All playlist routes require authentication
router.use(authMiddleware);

// GET /api/playlists - Get all playlists for current user
router.get('/', async (req, res) => {
  try {
    const playlists = await readData('playlists');
    const userPlaylists = playlists.filter(p => p.userId === req.user.id);
    res.json(userPlaylists);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch playlists.' });
  }
});

// POST /api/playlists - Create new playlist
router.post('/', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Playlist name is required.' });
    }

    const playlists = await readData('playlists');
    const newPlaylist = {
      id: generateId(),
      userId: req.user.id,
      name: name.trim(),
      tracks: [],
      createdAt: new Date().toISOString()
    };

    playlists.push(newPlaylist);
    await writeData('playlists', playlists);

    res.status(201).json(newPlaylist);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create playlist.' });
  }
});

// PUT /api/playlists/:id - Rename playlist
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Playlist name is required.' });
    }

    const playlists = await readData('playlists');
    const index = playlists.findIndex(p => p.id === id && p.userId === req.user.id);

    if (index === -1) {
      return res.status(404).json({ error: 'Playlist not found or unauthorized.' });
    }

    playlists[index].name = name.trim();
    playlists[index].updatedAt = new Date().toISOString();

    await writeData('playlists', playlists);
    res.json(playlists[index]);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update playlist.' });
  }
});

// DELETE /api/playlists/:id - Delete playlist
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const playlists = await readData('playlists');
    const filtered = playlists.filter(p => !(p.id === id && p.userId === req.user.id));

    if (playlists.length === filtered.length) {
      return res.status(404).json({ error: 'Playlist not found or unauthorized.' });
    }

    await writeData('playlists', filtered);
    res.json({ message: 'Playlist deleted successfully.' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete playlist.' });
  }
});

// POST /api/playlists/:id/tracks - Add track to playlist
router.post('/:id/tracks', async (req, res) => {
  try {
    const { id } = req.params;
    const { jamendoId, title, artist, coverUrl, audioUrl, duration } = req.body;

    if (!jamendoId || !title || !artist || !audioUrl) {
      return res.status(400).json({ error: 'Missing track details (jamendoId, title, artist, audioUrl).' });
    }

    const playlists = await readData('playlists');
    const playlist = playlists.find(p => p.id === id && p.userId === req.user.id);

    if (!playlist) {
      return res.status(404).json({ error: 'Playlist not found or unauthorized.' });
    }

    // Check if track is already in playlist
    const trackExists = playlist.tracks.some(t => String(t.jamendoId) === String(jamendoId));
    if (trackExists) {
      return res.status(400).json({ error: 'Track is already in this playlist.' });
    }

    const newTrack = {
      jamendoId: String(jamendoId),
      title,
      artist,
      coverUrl: coverUrl || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop',
      audioUrl,
      duration: duration || 0,
      addedAt: new Date().toISOString()
    };

    playlist.tracks.push(newTrack);
    await writeData('playlists', playlists);

    res.status(201).json(playlist);
  } catch (error) {
    res.status(500).json({ error: 'Failed to add track to playlist.' });
  }
});

// DELETE /api/playlists/:id/tracks/:jamendoId - Remove track from playlist
router.delete('/:id/tracks/:jamendoId', async (req, res) => {
  try {
    const { id, jamendoId } = req.params;
    const playlists = await readData('playlists');
    const playlist = playlists.find(p => p.id === id && p.userId === req.user.id);

    if (!playlist) {
      return res.status(404).json({ error: 'Playlist not found or unauthorized.' });
    }

    playlist.tracks = playlist.tracks.filter(t => String(t.jamendoId) !== String(jamendoId));
    await writeData('playlists', playlists);

    res.json(playlist);
  } catch (error) {
    res.status(500).json({ error: 'Failed to remove track from playlist.' });
  }
});

module.exports = router;
