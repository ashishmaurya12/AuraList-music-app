const express = require('express');
const router = express.Router();
const CryptoJS = require('crypto-js');
const fs = require('fs');
const path = require('path');

const JAMENDO_CLIENT_ID = process.env.JAMENDO_CLIENT_ID || '3dce8b55';
const JAMENDO_BASE_URL = 'https://api.jamendo.com/v3.0/tracks/';
const JIOSAAVN_BASE_URL = 'https://www.jiosaavn.com/api.php';

// In-memory 2000+ catalog
let localCatalog = [];
let lastMtime = 0;
const CATALOG_PATH = path.join(__dirname, '../../data/catalog.json');

function loadLocalCatalog() {
  try {
    if (fs.existsSync(CATALOG_PATH)) {
      const stat = fs.statSync(CATALOG_PATH);
      if (stat.mtimeMs !== lastMtime) {
        const raw = fs.readFileSync(CATALOG_PATH, 'utf8');
        localCatalog = JSON.parse(raw || '[]');
        lastMtime = stat.mtimeMs;
        console.log(`[Catalog] Reloaded ${localCatalog.length} songs from catalog.json`);
      }
    }
  } catch (err) {
    console.error('[Catalog] Error loading catalog.json:', err.message);
  }
}
loadLocalCatalog();

// In-memory cache
const cache = new Map();
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes

function getCached(key) {
  const item = cache.get(key);
  if (!item) return null;
  if (Date.now() - item.timestamp > CACHE_TTL) {
    cache.delete(key);
    return null;
  }
  return item.data;
}

function setCache(key, data) {
  cache.set(key, { timestamp: Date.now(), data });
}

// Decode HTML entities in track strings
function decodeHTMLEntities(str) {
  if (!str) return '';
  return str
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

// Decrypt JioSaavn media URL into 320kbps MP4 audio stream
function decryptJioSaavnUrl(encryptedMediaUrl) {
  if (!encryptedMediaUrl) return '';
  try {
    const key = CryptoJS.enc.Utf8.parse('38346591');
    const decrypted = CryptoJS.DES.decrypt(
      { ciphertext: CryptoJS.enc.Base64.parse(encryptedMediaUrl) },
      key,
      { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.Pkcs7 }
    );
    const url = decrypted.toString(CryptoJS.enc.Utf8);
    if (!url) return '';
    return url.replace('_96.mp4', '_320.mp4').replace('_160.mp4', '_320.mp4');
  } catch (e) {
    return '';
  }
}

// Format image URL to high quality (500x500)
function formatImageUrl(url) {
  if (!url) return 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop';
  return url
    .replace('150x150', '500x500')
    .replace('50x50', '500x500')
    .replace('http://', 'https://');
}

// Format JioSaavn track object to unified app track format
function formatJioSaavnTrack(item) {
  const moreInfo = item.more_info || {};
  const encryptedUrl = moreInfo.encrypted_media_url || item.encrypted_media_url;
  const audioUrl = decryptJioSaavnUrl(encryptedUrl);

  let artistName = item.subtitle || '';
  if (moreInfo.artistMap?.primary_artists && moreInfo.artistMap.primary_artists.length > 0) {
    artistName = moreInfo.artistMap.primary_artists.map(a => a.name).join(', ');
  } else if (moreInfo.singers) {
    artistName = moreInfo.singers;
  } else if (moreInfo.music) {
    artistName = moreInfo.music;
  }

  const titleClean = decodeHTMLEntities(item.title || item.song || 'Untitled Track');
  const artistClean = decodeHTMLEntities(artistName || 'Various Artists');
  const albumClean = decodeHTMLEntities(moreInfo.album || item.album || 'Single');
  const durationSec = parseInt(moreInfo.duration || item.duration || '240', 10);

  const trackId = String(item.id || item.song_id || Math.random().toString(36).substring(7));

  return {
    id: trackId,
    jamendoId: trackId,
    title: titleClean,
    artist: artistClean,
    album: albumClean,
    coverUrl: formatImageUrl(item.image),
    audioUrl: audioUrl,
    duration: durationSec,
    license: 'Full-Length Original Stream',
    source: 'JioSaavn Official Catalog'
  };
}

// Helper to fetch songs from JioSaavn API by query term
async function fetchJioSaavnSongs(query, page = 1, limit = 40) {
  const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' };
  const url = `${JIOSAAVN_BASE_URL}?__call=search.getResults&_format=json&_marker=0&api_version=4&ctx=web6dot0&q=${encodeURIComponent(query)}&p=${page}&n=${limit}`;

  try {
    const response = await fetch(url, { headers });
    const data = await response.json();
    if (data && data.results && data.results.length > 0) {
      return data.results
        .map(formatJioSaavnTrack)
        .filter(t => t.audioUrl && t.audioUrl.length > 0);
    }
  } catch (err) {
    console.error(`JioSaavn fetch error [${query}]:`, err.message);
  }
  return [];
}

// GET /api/music/catalog - Paginated access to 1000+ song catalog
router.get('/catalog', (req, res) => {
  if (localCatalog.length === 0) {
    loadLocalCatalog();
  }
  const page = parseInt(req.query.page || '1', 10);
  const limit = parseInt(req.query.limit || '40', 10);
  const start = (page - 1) * limit;
  const paginated = localCatalog.slice(start, start + limit);

  res.json({
    totalSongs: localCatalog.length,
    page,
    limit,
    totalPages: Math.ceil(localCatalog.length / limit),
    tracks: paginated
  });
});

// GET /api/music/trending - Trending Indian Full Length Original Songs
router.get('/trending', async (req, res) => {
  const cacheKey = 'indian_trending_full_length';
  const cachedData = getCached(cacheKey);
  if (cachedData && cachedData.length > 0) {
    return res.json(cachedData);
  }

  // Use pre-seeded 1000+ catalog if available
  if (localCatalog.length > 0) {
    const catalogSlice = localCatalog.slice(0, 100);
    setCache(cacheKey, catalogSlice);
    return res.json(catalogSlice);
  }

  try {
    const queries = ['Hindi Hits', 'Bollywood Top 50', 'Arijit Singh Hits', 'Punjabi Top Hits', 'Hindi Romantic Songs', 'South Indian Blockbusters'];
    const resultsArray = await Promise.all(queries.map(q => fetchJioSaavnSongs(q, 1, 20)));

    const seenIds = new Set();
    const combinedTracks = [];

    const maxLength = Math.max(...resultsArray.map(r => r.length));
    for (let i = 0; i < maxLength; i++) {
      for (let j = 0; j < resultsArray.length; j++) {
        const track = resultsArray[j][i];
        if (track && !seenIds.has(track.id) && !seenIds.has(track.title.toLowerCase())) {
          seenIds.add(track.id);
          seenIds.add(track.title.toLowerCase());
          combinedTracks.push(track);
        }
      }
    }

    if (combinedTracks.length > 0) {
      setCache(cacheKey, combinedTracks);
      return res.json(combinedTracks);
    }
  } catch (error) {
    console.error('Trending fetch error:', error.message);
  }

  res.json([]);
});

// GET /api/music/search?q=&genre=&limit=&offset=&page=
router.get('/search', async (req, res) => {
  if (localCatalog.length === 0) {
    loadLocalCatalog();
  }

  const { q, genre, limit = 40, offset = 0, page: reqPage } = req.query;
  const page = reqPage ? parseInt(reqPage, 10) : Math.floor(offset / limit) + 1;

  let searchQuery = (q || '').trim();
  const genreTag = (genre || '').trim().toLowerCase();

  // 1. Search local 1056+ catalog first
  let localMatches = [];
  if (searchQuery || (genreTag && genreTag !== 'all')) {
    const searchTerm = searchQuery.toLowerCase();
    localMatches = localCatalog.filter(t => {
      const matchTitle = t.title.toLowerCase().includes(searchTerm);
      const matchArtist = t.artist.toLowerCase().includes(searchTerm);
      const matchAlbum = t.album.toLowerCase().includes(searchTerm);

      let matchGenre = true;
      if (genreTag && genreTag !== 'all') {
        if (genreTag === 'bollywood') matchGenre = t.album.toLowerCase().includes('bollywood') || t.artist.toLowerCase().includes('pritam') || t.artist.toLowerCase().includes('arijit') || t.title.toLowerCase().includes('from');
        else if (genreTag === 'punjabi') matchGenre = t.artist.toLowerCase().includes('karan') || t.artist.toLowerCase().includes('moose') || t.artist.toLowerCase().includes('diljit') || t.title.toLowerCase().includes('punjabi');
        else if (genreTag === 'arijit') matchGenre = t.artist.toLowerCase().includes('arijit');
        else if (genreTag === 'arrahman') matchGenre = t.artist.toLowerCase().includes('rahman');
        else if (genreTag === 'nusrat') matchGenre = t.artist.toLowerCase().includes('nusrat') || t.title.toLowerCase().includes('nusrat');
        else if (genreTag === 'kishore') matchGenre = t.artist.toLowerCase().includes('kishore');
        else if (genreTag === 'lata') matchGenre = t.artist.toLowerCase().includes('lata');
        else if (genreTag === 'atif') matchGenre = t.artist.toLowerCase().includes('atif');
        else if (genreTag === 'diljit') matchGenre = t.artist.toLowerCase().includes('diljit');
        else if (genreTag === 'karan') matchGenre = t.artist.toLowerCase().includes('karan');
        else if (genreTag === 'shreya') matchGenre = t.artist.toLowerCase().includes('shreya');
        else if (genreTag === 'sonu') matchGenre = t.artist.toLowerCase().includes('sonu');
        else if (genreTag === 'jubin') matchGenre = t.artist.toLowerCase().includes('jubin');
        else if (genreTag === 'darshan') matchGenre = t.artist.toLowerCase().includes('darshan');
        else if (genreTag === 'taylor') matchGenre = t.artist.toLowerCase().includes('swift');
        else if (genreTag === 'edsheeran') matchGenre = t.artist.toLowerCase().includes('sheeran');
        else if (genreTag === 'weeknd') matchGenre = t.artist.toLowerCase().includes('weeknd');
        else if (genreTag === 'drake') matchGenre = t.artist.toLowerCase().includes('drake');
        else if (genreTag === 'south') matchGenre = t.title.toLowerCase().includes('telugu') || t.title.toLowerCase().includes('tamil') || t.artist.toLowerCase().includes('anirudh');
        else if (genreTag === 'romantic') matchGenre = t.title.toLowerCase().includes('love') || t.title.toLowerCase().includes('romantic') || t.artist.toLowerCase().includes('atif');
        else if (genreTag === 'hollywood' || genreTag === 'english') matchGenre = t.category === 'hollywood' || t.artist.toLowerCase().includes('swift') || t.artist.toLowerCase().includes('sheeran') || t.artist.toLowerCase().includes('drake') || t.artist.toLowerCase().includes('weeknd') || t.artist.toLowerCase().includes('bieber') || t.artist.toLowerCase().includes('coldplay') || t.artist.toLowerCase().includes('mars');
        else matchGenre = t.artist.toLowerCase().includes(genreTag) || t.title.toLowerCase().includes(genreTag);
      }

      return (searchTerm ? (matchTitle || matchArtist || matchAlbum) : true) && matchGenre;
    });
  } else {
    localMatches = localCatalog;
  }

  // Paginate local matches
  const start = (page - 1) * limit;
  const localSlice = localMatches.slice(start, start + limit);

  if (localSlice.length >= 10) {
    return res.json(localSlice);
  }

  // 2. Fetch live from JioSaavn API if local matches are sparse
  if (!searchQuery) {
    switch (genreTag) {
      case 'bollywood': searchQuery = 'Bollywood Hits'; break;
      case 'punjabi': searchQuery = 'Punjabi Top Hits'; break;
      case 'romantic': searchQuery = 'Hindi Romantic Songs'; break;
      case 'arijit': searchQuery = 'Arijit Singh Best Songs'; break;
      case 'arrahman': searchQuery = 'A.R. Rahman Hits'; break;
      case 'nusrat': searchQuery = 'Nusrat Fateh Ali Khan'; break;
      case 'kishore': searchQuery = 'Kishore Kumar Hits'; break;
      case 'lata': searchQuery = 'Lata Mangeshkar Songs'; break;
      case 'atif': searchQuery = 'Atif Aslam Songs'; break;
      case 'diljit': searchQuery = 'Diljit Dosanjh Hits'; break;
      case 'karan': searchQuery = 'Karan Aujla Songs'; break;
      case 'shreya': searchQuery = 'Shreya Ghoshal Songs'; break;
      case 'sonu': searchQuery = 'Sonu Nigam Hits'; break;
      case 'jubin': searchQuery = 'Jubin Nautiyal Hits'; break;
      case 'darshan': searchQuery = 'Darshan Raval Songs'; break;
      case 'taylor': searchQuery = 'Taylor Swift Songs'; break;
      case 'edsheeran': searchQuery = 'Ed Sheeran Songs'; break;
      case 'weeknd': searchQuery = 'The Weeknd Hits'; break;
      case 'drake': searchQuery = 'Drake Songs'; break;
      case 'south': searchQuery = 'Telugu Tamil Hits'; break;
      case 'hiphop': searchQuery = 'Desi Hip Hop'; break;
      case 'rock': searchQuery = 'Indian Rock'; break;
      case 'lofi': searchQuery = 'Hindi Lofi Hits'; break;
      case 'hollywood': searchQuery = 'Billboard Top 50'; break;
      default: searchQuery = `${genreTag} Songs`; break;
    }
  } else if (genreTag && genreTag !== 'all') {
    searchQuery = `${searchQuery} ${genreTag}`;
  }

  let liveTracks = await fetchJioSaavnSongs(searchQuery, page, limit);

  // Combine local and live results without duplicates
  const seenIds = new Set(localSlice.map(t => t.id));
  const finalTracks = [...localSlice];
  for (const lt of liveTracks) {
    if (!seenIds.has(lt.id) && !seenIds.has(lt.title.toLowerCase())) {
      seenIds.add(lt.id);
      seenIds.add(lt.title.toLowerCase());
      finalTracks.push(lt);
    }
  }

  res.json(finalTracks);
});

// GET /api/music/track/:id
router.get('/track/:id', async (req, res) => {
  const { id } = req.params;

  // Search local catalog first
  if (localCatalog.length > 0) {
    const found = localCatalog.find(t => t.id === id || t.jamendoId === id);
    if (found) return res.json(found);
  }

  try {
    const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' };
    const url = `${JIOSAAVN_BASE_URL}?__call=song.getDetails&_format=json&_marker=0&api_version=4&ctx=web6dot0&pids=${id}`;
    const response = await fetch(url, { headers });
    const data = await response.json();

    if (data && (data[id] || data.songs?.[0])) {
      const item = data[id] || data.songs[0];
      const formatted = formatJioSaavnTrack(item);
      if (formatted.audioUrl) {
        return res.json(formatted);
      }
    }
  } catch (error) {}

  res.status(404).json({ error: 'Track details not found.' });
});

// GET /api/music/lyrics/:id
router.get('/lyrics/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' };
    const url = `${JIOSAAVN_BASE_URL}?__call=lyrics.getLyrics&_format=json&_marker=0&api_version=4&ctx=web6dot0&lyrics_id=${id}`;
    const response = await fetch(url, { headers });
    const data = await response.json();

    if (data && data.lyrics) {
      const cleanLyrics = decodeHTMLEntities(data.lyrics).replace(/<br\s*\/?>/gi, '\n');
      return res.json({ lyrics: cleanLyrics, copyright: data.snippet || 'Official Lyrics' });
    }
  } catch (err) {}

  // Fallback nicely formatted song lyrics
  if (localCatalog.length === 0) loadLocalCatalog();
  let track = localCatalog.find(t => t.id === id);
  if (track) {
    const defaultLyrics = `[Verse 1]\nListening to ${track.title}\nBy ${track.artist}\nAlbum: ${track.album}\n\n[Chorus]\nFeel the rhythm, feel the flow\nStreaming in 320kbps High Definition\nPowered by Auralist Music Engine\n\n[Verse 2]\n${track.title} playing live\nOnly on Auralist Music\n\n[Outro]\nEnjoying ${track.title} by ${track.artist}`;
    return res.json({ lyrics: defaultLyrics, copyright: 'Auralist Music Catalog' });
  }

  res.json({ lyrics: 'Lyrics unavailable for this track.', copyright: '' });
});

module.exports = router;
