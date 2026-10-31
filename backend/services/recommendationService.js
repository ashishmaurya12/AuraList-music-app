const Like = require('../models/Like');
const History = require('../models/History');
const musicProvider = require('./musicProvider');

/**
 * Transparent, Rule-Based Recommendation Engine
 * Analyzes authenticated user activity (likes, history, artists, genres)
 * and scores catalog tracks without external AI dependencies.
 */

// Helper to normalize artist names for consistent comparison
function extractArtistTokens(artistStr) {
  if (!artistStr || typeof artistStr !== 'string') return [];
  return artistStr
    .toLowerCase()
    .split(/[,&]|\band\b|\bfeat\b|\bft\b|\bwith\b/i)
    .map(s => s.replace(/[^\p{L}\p{N}\s]/gu, '').trim())
    .filter(s => s.length >= 2);
}

// Calculate recommendations for a user
async function getRecommendations(userId, options = {}) {
  const limit = Math.min(Math.max(1, Number(options.limit) || 20), 50);
  const catalog = musicProvider.getLocalCatalog({ limit: 4000 }).tracks || [];

  if (catalog.length === 0) {
    return [];
  }

  // 1. Gather User Activity (if authenticated)
  let userLikes = [];
  let userHistory = [];

  if (userId) {
    try {
      [userLikes, userHistory] = await Promise.all([
        Like.find({ userId }).select('jamendoId title artist album').lean(),
        History.find({ userId }).sort({ playedAt: -1 }).limit(100).select('jamendoId title artist duration position').lean()
      ]);
    } catch (err) {
      console.warn('[Recommendations] Failed to query user activity:', err.message);
    }
  }

  const hasActivity = userLikes.length > 0 || userHistory.length > 0;

  // 2. Cold-Start Discovery for new users or unauthenticated visitors
  if (!hasActivity) {
    return getColdStartDiscovery(catalog, limit);
  }

  // 3. Extract Preferences (Artists & Categories)
  const artistScores = new Map(); // token -> score
  const favoriteArtistsDisplay = new Map(); // token -> nicely capitalized artist name
  const heardTrackKeys = new Set(); // tracks already liked or listened to

  // Score likes higher (weight = 4)
  for (const like of userLikes) {
    const trackId = String(like.jamendoId || '');
    if (trackId) heardTrackKeys.add(trackId);
    
    const tokens = extractArtistTokens(like.artist);
    tokens.forEach(tok => {
      artistScores.set(tok, (artistScores.get(tok) || 0) + 4);
      if (!favoriteArtistsDisplay.has(tok) && like.artist) {
        favoriteArtistsDisplay.set(tok, like.artist.split(/[,&]/)[0].trim());
      }
    });
  }

  // Score play history (weight = 1 per play, +1 bonus if listened >= 30s)
  for (const hist of userHistory) {
    const trackId = String(hist.jamendoId || '');
    if (trackId) heardTrackKeys.add(trackId);

    const tokens = extractArtistTokens(hist.artist);
    const bonus = (hist.position >= 30 || (hist.duration > 0 && hist.position >= 0.3 * hist.duration)) ? 1 : 0;
    tokens.forEach(tok => {
      artistScores.set(tok, (artistScores.get(tok) || 0) + (1 + bonus));
      if (!favoriteArtistsDisplay.has(tok) && hist.artist) {
        favoriteArtistsDisplay.set(tok, hist.artist.split(/[,&]/)[0].trim());
      }
    });
  }

  // Determine top favored artist tokens
  const sortedFavTokens = Array.from(artistScores.entries())
    .sort((a, b) => b[1] - a[1]);
  
  const topFavTokens = new Set(sortedFavTokens.slice(0, 5).map(e => e[0]));
  const secondaryFavTokens = new Set(sortedFavTokens.slice(5, 15).map(e => e[0]));

  // 4. Candidate Selection & Scoring
  const candidates = [];

  for (const track of catalog) {
    const trackId = String(track.id || track.jamendoId || '');
    const isAlreadyHeard = heardTrackKeys.has(trackId);

    // Filter out tracks without valid audio
    if (!track.audioUrl) continue;

    const trackTokens = extractArtistTokens(track.artist);
    let score = 0;
    let primaryReason = '';

    // Artist affinity match
    for (const tok of trackTokens) {
      if (topFavTokens.has(tok)) {
        score += 12;
        const displayName = favoriteArtistsDisplay.get(tok) || tok;
        primaryReason = `Because you enjoy ${displayName}`;
        break;
      } else if (secondaryFavTokens.has(tok)) {
        score += 6;
        const displayName = favoriteArtistsDisplay.get(tok) || tok;
        primaryReason = `From an artist you've listened to (${displayName})`;
        break;
      }
    }

    // Category / genre affinity
    if (score > 0 && track.category) {
      score += 3;
    }

    // Do not recommend songs the user already listened to if relevant alternatives exist
    if (isAlreadyHeard) {
      score -= 20; // Heavy penalty so unheard songs take precedence
    }

    if (score > 0) {
      candidates.push({
        track,
        score,
        reason: primaryReason || 'Recommended based on your taste',
        isAlreadyHeard
      });
    }
  }

  // 5. Exclude duplicates and sort by score descending
  candidates.sort((a, b) => b.score - a.score);

  // If we don't have enough unheard recommendations, supplement with top catalog songs
  let finalTracks = [];
  const seenIds = new Set();

  for (const item of candidates) {
    const t = item.track;
    const tid = String(t.id || t.jamendoId);
    if (!seenIds.has(tid)) {
      seenIds.add(tid);
      finalTracks.push({
        ...t,
        recommendationReason: item.reason,
        isPersonalized: true
      });
      if (finalTracks.length >= limit) break;
    }
  }

  // If finalTracks is still short of limit, supplement with discovery items
  if (finalTracks.length < limit) {
    const discovery = getColdStartDiscovery(catalog, limit - finalTracks.length, seenIds);
    finalTracks.push(...discovery);
  }

  // Run through deduplication filter
  return musicProvider.filterAndDeduplicateTracks(finalTracks);
}

// Cold start discovery for users without history
function getColdStartDiscovery(catalog, limit = 20, excludeIds = new Set()) {
  const discovery = [];
  const selectedIds = new Set(excludeIds);

  // Pick high quality catalog items across different categories
  const categories = ['indian', 'hollywood', 'qawwali'];
  
  for (const cat of categories) {
    const subset = catalog.filter(t => t.category === cat && !selectedIds.has(String(t.id || t.jamendoId)));
    for (const track of subset.slice(0, Math.ceil(limit / categories.length))) {
      selectedIds.add(String(track.id || track.jamendoId));
      discovery.push({
        ...track,
        recommendationReason: `Featured Discovery • ${cat.charAt(0).toUpperCase() + cat.slice(1)}`,
        isPersonalized: false
      });
      if (discovery.length >= limit) break;
    }
    if (discovery.length >= limit) break;
  }

  // If still need more, take remaining catalog items
  if (discovery.length < limit) {
    for (const track of catalog) {
      const tid = String(track.id || track.jamendoId);
      if (!selectedIds.has(tid)) {
        selectedIds.add(tid);
        discovery.push({
          ...track,
          recommendationReason: 'Featured Discovery',
          isPersonalized: false
        });
        if (discovery.length >= limit) break;
      }
    }
  }

  return musicProvider.filterAndDeduplicateTracks(discovery.slice(0, limit));
}

module.exports = {
  getRecommendations,
  getColdStartDiscovery,
  extractArtistTokens
};
