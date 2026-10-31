const fs = require('fs');
const path = require('path');
const CryptoJS = require('crypto-js');
const {
  normalizeText,
  tokenize,
  tokenSimilarity,
  evaluateTrackRelevance,
  rankAndGroupTracks
} = require('./searchRelevance');
const {
  isImageUrl,
  formatAudioUrl,
  formatImageUrl
} = require('./urlHelper');
const { enrichTrack } = require('./catalogEnricher');
const { parseSearchIntent } = require('./searchIntent');
const audiusProvider = require('./providers/audiusProvider');
const jamendoProvider = require('./providers/jamendoProvider');
const radioBrowserProvider = require('./providers/radioBrowserProvider');

const JIOSAAVN_BASE_URL = 'https://www.jiosaavn.com/api.php';
const CATALOG_PATH = path.join(__dirname, '../../data/catalog.json');
const FETCH_TIMEOUT_MS = 6000;
const JIOSAAVN_DES_KEY = CryptoJS.enc.Utf8.parse('38346591');

// Decrypt DES-ECB encrypted media URL provided by JioSaavn
function decryptMediaUrl(encrypted) {
  if (!encrypted || typeof encrypted !== 'string' || !encrypted.trim()) return '';
  try {
    const decrypted = CryptoJS.DES.decrypt(
      { ciphertext: CryptoJS.enc.Base64.parse(encrypted.trim()) },
      JIOSAAVN_DES_KEY,
      { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.Pkcs7 }
    );
    const url = decrypted.toString(CryptoJS.enc.Utf8);
    if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
      return url.replace(/^http:\/\//i, 'https://');
    }
    return '';
  } catch (err) {
    return '';
  }
}

// In-memory local catalog
let localCatalog = [];
let lastMtime = 0;

// Pre-computed and memoized structures for instantaneous response
let memoizedAlbums = null;
let memoizedArtists = null;
const memoizedMoodTracks = new Map();
let preIndexedArtists = null;
let preIndexedAlbums = null;
let preIndexedTracks = null;

function invalidateCatalogMemoization() {
  memoizedAlbums = null;
  memoizedArtists = null;
  memoizedMoodTracks.clear();
  preIndexedArtists = null;
  preIndexedAlbums = null;
  preIndexedTracks = null;
}

function loadLocalCatalog() {
  try {
    if (fs.existsSync(CATALOG_PATH)) {
      const stat = fs.statSync(CATALOG_PATH);
      if (stat.mtimeMs !== lastMtime) {
        const raw = fs.readFileSync(CATALOG_PATH, 'utf8');
        const parsed = JSON.parse(raw || '[]');
        localCatalog = parsed.map(t => {
          const base = {
            ...t,
            id: String(t.id || t.jamendoId),
            jamendoId: String(t.jamendoId || t.id),
            provider: t.provider || 'Local',
            providerId: String(t.providerId || t.id),
            license: t.license || 'Local Archive',
            source: t.source || 'Local Catalog'
          };
          return enrichTrack(base);
        });
        lastMtime = stat.mtimeMs;
        invalidateCatalogMemoization();
        ensurePreIndexedSuggestions();
        console.log(`[Catalog] Reloaded ${localCatalog.length} songs from catalog.json`);
      }
    }
  } catch (err) {
    console.error('[Catalog] Error loading catalog.json:', err.message);
  }
}
loadLocalCatalog();

// Bounded in-memory cache
const cache = new Map();
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes
const MAX_CACHE_SIZE = 100;

function getCached(key) {
  if (!key || typeof key !== 'string') return null;
  const item = cache.get(key);
  if (!item) return null;
  const ttl = typeof item.ttl === 'number' ? item.ttl : CACHE_TTL;
  if (Date.now() - item.timestamp > ttl) {
    cache.delete(key);
    return null;
  }
  return item.data;
}


function setCache(key, data, customTtl) {
  if (!key || typeof key !== 'string') return;
  if (!data || (Array.isArray(data) && data.length === 0)) return; // Never cache empty/null data
  if (cache.size >= MAX_CACHE_SIZE && !cache.has(key)) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) cache.delete(oldestKey);
  }
  const ttl = typeof customTtl === 'number' ? customTtl : CACHE_TTL;
  cache.set(key, { timestamp: Date.now(), data, ttl });
}

function clearCache() {
  cache.clear();
}

// Decode HTML entities
function decodeHTMLEntities(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

// Provider Health Tracking State
let providerHealth = {
  available: false,
  status: 'unknown',
  lastChecked: null,
  lastError: null, // Retained for internal server logging only
  errorCode: null, // Safe client-facing error code
  consecutiveFailures: 0
};

function getProviderHealth() {
  const isChecked = providerHealth.lastChecked !== null;
  const status = !isChecked ? 'unknown' : (providerHealth.available ? 'healthy' : 'degraded');
  return {
    available: providerHealth.available,
    status,
    providerStatus: status,
    providerErrorCode: providerHealth.available ? null : (isChecked ? (providerHealth.errorCode || 'PROVIDER_UNAVAILABLE') : null),
    lastChecked: providerHealth.lastChecked,
    consecutiveFailures: providerHealth.consecutiveFailures
  };
}

function setProviderHealth({ available, errorCode = null, error = null }) {
  providerHealth.available = Boolean(available);
  providerHealth.lastChecked = Date.now();
  providerHealth.lastError = error;
  if (available) {
    providerHealth.consecutiveFailures = 0;
    providerHealth.errorCode = null;
    providerHealth.lastError = null;
  } else {
    providerHealth.consecutiveFailures++;
    if (errorCode) {
      providerHealth.errorCode = errorCode;
    } else if (error) {
      const errStr = String(error);
      if (/timeout/i.test(errStr)) {
        providerHealth.errorCode = 'PROVIDER_TIMEOUT';
      } else if (/malformed|json/i.test(errStr)) {
        providerHealth.errorCode = 'PROVIDER_BAD_RESPONSE';
      } else if (/http/i.test(errStr)) {
        providerHealth.errorCode = 'PROVIDER_HTTP_ERROR';
      } else {
        providerHealth.errorCode = 'PROVIDER_UNAVAILABLE';
      }
    } else {
      providerHealth.errorCode = 'PROVIDER_UNAVAILABLE';
    }
  }
}

// Safely normalize external track data with robust defaults
function normalizeProviderTrack(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;

  const rawId = item.id || item.song_id || item.jamendoId;
  if (!rawId || (typeof rawId !== 'string' && typeof rawId !== 'number')) {
    return null; // Skip tracks without a valid ID
  }
  const trackId = String(rawId).trim();
  if (!trackId) return null;

  const moreInfo = (item.more_info && typeof item.more_info === 'object' && !Array.isArray(item.more_info)) ? item.more_info : {};

  // Extract Audio URL safely (including decrypting DES-ECB encrypted_media_url when provided by JioSaavn)
  let rawAudioUrl = item.audioUrl || item.audio_url || item.media_url || moreInfo.media_url || moreInfo.audio_url || '';

  // Guard against artwork/image URLs accidentally occupying audioUrl fields
  const candidateCover = item.image || item.coverUrl || item.cover_url || moreInfo.image || '';
  if (isImageUrl(rawAudioUrl) || (candidateCover && rawAudioUrl === candidateCover)) {
    rawAudioUrl = '';
  }

  if (!rawAudioUrl && (moreInfo.encrypted_media_url || item.encrypted_media_url)) {
    rawAudioUrl = decryptMediaUrl(moreInfo.encrypted_media_url || item.encrypted_media_url);
  }
  const audioUrl = formatAudioUrl(rawAudioUrl);

  // Extract Title
  const rawTitle = item.title || item.song;
  const titleClean = (typeof rawTitle === 'string' && rawTitle.trim()) ? decodeHTMLEntities(rawTitle.trim()) : 'Untitled Track';

  // Extract Artist
  let artistName = item.subtitle || item.artist || '';
  if (moreInfo.artistMap?.primary_artists && Array.isArray(moreInfo.artistMap.primary_artists) && moreInfo.artistMap.primary_artists.length > 0) {
    artistName = moreInfo.artistMap.primary_artists
      .map(a => (a && typeof a === 'object' && typeof a.name === 'string') ? a.name : '')
      .filter(Boolean)
      .join(', ');
  } else if (typeof moreInfo.singers === 'string' && moreInfo.singers.trim()) {
    artistName = moreInfo.singers;
  } else if (typeof moreInfo.music === 'string' && moreInfo.music.trim()) {
    artistName = moreInfo.music;
  }
  const artistClean = (typeof artistName === 'string' && artistName.trim()) ? decodeHTMLEntities(artistName.trim()) : 'Various Artists';

  // Extract Album
  const rawAlbum = moreInfo.album || item.album;
  const albumClean = (typeof rawAlbum === 'string' && rawAlbum.trim()) ? decodeHTMLEntities(rawAlbum.trim()) : 'Single';

  // Extract Duration safely
  const rawDuration = moreInfo.duration || item.duration;
  let durationSec = 0;
  if (typeof rawDuration === 'number' && Number.isFinite(rawDuration) && rawDuration >= 0) {
    durationSec = Math.floor(rawDuration);
  } else if (typeof rawDuration === 'string') {
    const parsed = parseInt(rawDuration, 10);
    if (!isNaN(parsed) && parsed >= 0) {
      durationSec = parsed;
    }
  }

  // Cover URL
  const coverUrl = formatImageUrl(item.image || item.coverUrl || item.cover_url);

  return {
    id: trackId,
    jamendoId: trackId, // Retained for backward compatibility
    provider: 'JioSaavn',
    providerId: trackId,
    title: titleClean,
    artist: artistClean,
    album: albumClean,
    coverUrl,
    audioUrl,
    duration: durationSec,
    versionInfo: 'Standard',
    licensingStatus: 'Third-Party Stream (Unverified)',
    license: 'Third-Party Stream (Unverified)',
    source: 'JioSaavn Provider Stream'
  };
}

// Safe HTTP Fetch wrapper with AbortController timeout & error handling
async function safeFetchJson(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const defaultHeaders = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' };

  try {
    const response = await fetch(url, {
      ...options,
      headers: { ...defaultHeaders, ...(options.headers || {}) },
      signal: controller.signal
    });

    if (!response.ok) {
      const errMsg = `HTTP ${response.status}`;
      console.error(`[MusicProvider] ${errMsg} from provider URL: ${url.split('?')[0]}`);
      setProviderHealth({
        available: false,
        errorCode: 'PROVIDER_HTTP_ERROR',
        error: errMsg
      });
      return null;
    }

    let data;
    try {
      data = await response.json();
    } catch (err) {
      if (controller.signal.aborted || err.name === 'AbortError') {
        throw err;
      }
      console.error(`[MusicProvider] Malformed JSON from provider URL: ${url.split('?')[0]}:`, err.message);
      setProviderHealth({
        available: false,
        errorCode: 'PROVIDER_BAD_RESPONSE',
        error: 'Malformed JSON payload from provider'
      });
      return null;
    }

    if (data !== null) {
      setProviderHealth({ available: true, error: null });
    }
    return data;
  } catch (error) {
    let errorDetail = error.message;
    let safeCode = 'PROVIDER_UNAVAILABLE';
    if (error.name === 'AbortError' || controller.signal.aborted) {
      safeCode = 'PROVIDER_TIMEOUT';
      errorDetail = `Request timeout (${timeoutMs}ms)`;
      console.error(`[MusicProvider] Timeout (${timeoutMs}ms) for provider URL: ${url.split('?')[0]}`);
    } else {
      console.error(`[MusicProvider] Network error for provider URL: ${url.split('?')[0]}:`, error.message);
    }
    setProviderHealth({ available: false, errorCode: safeCode, error: errorDetail });
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

// Fetch provider songs by search query
async function fetchProviderSongs(query, page = 1, limit = 40) {
  if (!query || typeof query !== 'string' || !query.trim()) return [];
  const url = `${JIOSAAVN_BASE_URL}?__call=search.getResults&_format=json&_marker=0&api_version=4&ctx=web6dot0&q=${encodeURIComponent(query.trim())}&p=${page}&n=${limit}`;
  const fetcher = (module.exports && module.exports.safeFetchJson) || safeFetchJson;
  const data = await fetcher(url);

  if (data && typeof data === 'object' && Array.isArray(data.results)) {
    return data.results
      .map(normalizeProviderTrack)
      .filter(t => t !== null && typeof t === 'object');
  }
  return [];
}

// Get paginated catalog from local file
function getLocalCatalog({ page = 1, limit = 40 } = {}) {
  if (localCatalog.length === 0) loadLocalCatalog();
  const start = (page - 1) * limit;
  const paginated = localCatalog.slice(start, start + limit);
  return {
    totalSongs: localCatalog.length,
    page,
    limit,
    totalPages: Math.ceil(localCatalog.length / limit),
    tracks: paginated
  };
}

// Get curated and popular albums grouped from local catalog (memoized)
function getLocalAlbums({ limit = 60 } = {}) {
  if (localCatalog.length === 0) loadLocalCatalog();
  if (!memoizedAlbums) {
    const albumMap = new Map();
    for (const track of localCatalog) {
      const albumName = track.album || track.album_name;
      if (!albumName || albumName.trim() === '') continue;
      const key = albumName.trim().toLowerCase();
      if (!albumMap.has(key)) {
        albumMap.set(key, {
          id: `album_${albumMap.size + 1}`,
          title: albumName.trim(),
          artist: track.artist || 'Various Artists',
          coverUrl: track.coverUrl || '',
          year: track.year || null,
          songCount: 1,
          tracks: [track]
        });
      } else {
        const existing = albumMap.get(key);
        existing.songCount += 1;
        if (existing.tracks.length < 20) {
          existing.tracks.push(track);
        }
        if (!existing.coverUrl && track.coverUrl) {
          existing.coverUrl = track.coverUrl;
        }
      }
    }
    memoizedAlbums = Array.from(albumMap.values()).sort((a, b) => b.songCount - a.songCount);
  }
  const safeLimit = (typeof limit === 'number' && Number.isInteger(limit) && limit > 0)
    ? Math.min(limit, 100)
    : 60;
  return memoizedAlbums.slice(0, safeLimit);
}

// Get popular artists grouped from local catalog (memoized)
function getLocalArtists({ limit = 60 } = {}) {
  if (localCatalog.length === 0) loadLocalCatalog();
  if (!memoizedArtists) {
    const artistMap = new Map();
    for (const track of localCatalog) {
      const rawArtist = track.artist;
      if (!rawArtist || rawArtist.trim() === '') continue;
      const artists = rawArtist.split(/[,&/|]/).map(a => a.trim()).filter(a => a.length > 1 && a.length < 50);
      for (const name of artists) {
        const key = name.toLowerCase();
        if (!artistMap.has(key)) {
          artistMap.set(key, {
            id: `artist_${artistMap.size + 1}`,
            name: name,
            songCount: 1,
            coverUrl: track.coverUrl || '',
            sampleTrack: track
          });
        } else {
          const existing = artistMap.get(key);
          existing.songCount += 1;
          if (!existing.coverUrl && track.coverUrl) {
            existing.coverUrl = track.coverUrl;
          }
        }
      }
    }
    memoizedArtists = Array.from(artistMap.values())
      .filter(a => a.songCount >= 2)
      .sort((a, b) => b.songCount - a.songCount);
  }
  const safeLimit = (typeof limit === 'number' && Number.isInteger(limit) && limit > 0)
    ? Math.min(limit, 100)
    : 60;
  return memoizedArtists.slice(0, safeLimit);
}

// Get trending songs
async function getProviderTrending() {
  const cacheKey = 'indian_trending_full_length';
  const cachedData = getCached(cacheKey);
  if (cachedData && cachedData.length > 0) {
    return cachedData;
  }

  if (localCatalog.length === 0) loadLocalCatalog();
  if (localCatalog.length > 0) {
    const catalogSlice = localCatalog.slice(0, 100);
    setCache(cacheKey, catalogSlice);
    return catalogSlice;
  }

  try {
    const queries = ['Hindi Hits', 'Bollywood Top 50', 'Arijit Singh Hits', 'Punjabi Top Hits', 'Hindi Romantic Songs', 'South Indian Blockbusters'];
    const resultsArray = await Promise.all(queries.map(q => fetchProviderSongs(q, 1, 20)));

    const seenIds = new Set();
    const combinedTracks = [];

    const maxLength = Math.max(...resultsArray.map(r => r.length), 0);
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
      return combinedTracks;
    }
  } catch (error) {
    console.error('[MusicProvider] Trending fetch error:', error.message);
  }

  return [];
}

// Score relevance of a track against search terms
function getSearchRelevanceScore(track, term, isArtistSearch = false) {
  if (!track || !term) return 0;
  return evaluateTrackRelevance(track, term, isArtistSearch).score;
}

// Search tracks (combining local catalog & live provider API)
async function searchProviderTracks({ q = '', genre = '', artist = '', type = 'all', limit = 40, offset = 0, page: reqPage } = {}) {
  if (localCatalog.length === 0) loadLocalCatalog();

  const page = reqPage ? reqPage : Math.floor(offset / limit) + 1;
  let searchQuery = (q || '').trim();
  let artistQuery = (artist || '').trim();
  const searchType = (type || 'all').trim().toLowerCase();
  const genreTag = (genre || '').trim().toLowerCase();

  const normSearch = searchQuery.toLowerCase().trim();
  const normArtist = artistQuery.toLowerCase().trim();

  // Bounded cache check
  const searchCacheKey = `search_${normSearch}_${normArtist}_${genreTag}_${searchType}_${page}_${limit}`;
  const cachedSearchResults = getCached(searchCacheKey);
  if (cachedSearchResults) {
    return cachedSearchResults;
  }

  // Determine if artist filter is specified or implied
  const hasExplicitArtist = Boolean(artistQuery || searchType === 'artist');
  const artistTerm = (artistQuery || (searchType === 'artist' ? searchQuery : '')).toLowerCase().trim();

  // Is searchQuery redundant with the artist name? (e.g. q="kumar" & artist="Kishore Kumar", or q="Arijit Singh" & artist="Arijit Singh")
  const isSearchRedundantWithArtist = Boolean(
    artistTerm && normSearch && (
      artistTerm.includes(normSearch) || normSearch.includes(artistTerm)
    )
  );

  const isPureArtistSearch = Boolean(artistTerm && (!normSearch || isSearchRedundantWithArtist));
  const isCombinedSearch = Boolean(artistTerm && normSearch && !isSearchRedundantWithArtist);
  const isArtistSearch = Boolean(isPureArtistSearch || hasExplicitArtist);

  let localMatches = [];
  if (searchQuery || artistQuery || (genreTag && genreTag !== 'all')) {
    localMatches = localCatalog.filter(t => {
      let matchGenre = true;
      if (genreTag && genreTag !== 'all') {
        const cat = (t.category || '').toLowerCase();
        const genreField = (t.genre || '').toLowerCase();
        const albumLower = (t.album || '').toLowerCase();
        const titleLower = (t.title || '').toLowerCase();
        const artistLower = (t.artist || '').toLowerCase();

        // 1. Check genuine category and genre metadata first
        if (cat === genreTag || genreField === genreTag) {
          matchGenre = true;
        } else if (genreTag === 'indian' || genreTag === 'desi') {
          matchGenre = cat === 'indian';
        } else if (genreTag === 'hollywood' || genreTag === 'english') {
          matchGenre = cat === 'hollywood' || artistLower.includes('swift') || artistLower.includes('sheeran') || artistLower.includes('drake') || artistLower.includes('weeknd') || artistLower.includes('bieber') || artistLower.includes('coldplay') || artistLower.includes('mars');
        } else if (genreTag === 'qawwali') {
          matchGenre = cat === 'qawwali' || titleLower.includes('qawwali') || artistLower.includes('nusrat');
        } else if (genreTag === 'bollywood') {
          matchGenre = albumLower.includes('bollywood') || titleLower.includes('from') || artistLower.includes('pritam') || artistLower.includes('arijit');
        } else if (genreTag === 'punjabi') {
          matchGenre = albumLower.includes('punjabi') || titleLower.includes('punjabi') || artistLower.includes('karan') || artistLower.includes('moose') || artistLower.includes('diljit');
        } else if (genreTag === 'arijit') {
          matchGenre = artistLower.includes('arijit');
        } else if (genreTag === 'arrahman') {
          matchGenre = artistLower.includes('rahman');
        } else if (genreTag === 'nusrat') {
          matchGenre = artistLower.includes('nusrat') || titleLower.includes('nusrat');
        } else if (genreTag === 'kishore') {
          matchGenre = artistLower.includes('kishore');
        } else if (genreTag === 'lata') {
          matchGenre = artistLower.includes('lata');
        } else if (genreTag === 'atif') {
          matchGenre = artistLower.includes('atif');
        } else if (genreTag === 'diljit') {
          matchGenre = artistLower.includes('diljit');
        } else if (genreTag === 'karan') {
          matchGenre = artistLower.includes('karan');
        } else if (genreTag === 'shreya') {
          matchGenre = artistLower.includes('shreya');
        } else if (genreTag === 'sonu') {
          matchGenre = artistLower.includes('sonu');
        } else if (genreTag === 'jubin') {
          matchGenre = artistLower.includes('jubin');
        } else if (genreTag === 'darshan') {
          matchGenre = artistLower.includes('darshan');
        } else if (genreTag === 'taylor') {
          matchGenre = artistLower.includes('swift');
        } else if (genreTag === 'edsheeran') {
          matchGenre = artistLower.includes('sheeran');
        } else if (genreTag === 'weeknd') {
          matchGenre = artistLower.includes('weeknd');
        } else if (genreTag === 'drake') {
          matchGenre = artistLower.includes('drake');
        } else if (genreTag === 'south') {
          matchGenre = titleLower.includes('telugu') || titleLower.includes('tamil') || artistLower.includes('anirudh');
        } else if (genreTag === 'romantic') {
          matchGenre = titleLower.includes('love') || titleLower.includes('romantic') || albumLower.includes('romantic') || artistLower.includes('atif');
        } else if (genreTag === 'workout') {
          matchGenre = titleLower.includes('workout') || titleLower.includes('gym') || titleLower.includes('pump') || titleLower.includes('beat');
        } else if (genreTag === 'relax') {
          matchGenre = titleLower.includes('relax') || titleLower.includes('chill') || titleLower.includes('peace') || titleLower.includes('calm');
        } else {
          matchGenre = cat.includes(genreTag) || genreField.includes(genreTag) || artistLower.includes(genreTag) || titleLower.includes(genreTag);
        }
      }

      if (!matchGenre) return false;

      // Pure artist search (authoritative artist filter)
      if (isPureArtistSearch) {
        const tArtist = (t.artist || '').toLowerCase();
        return tArtist.includes(artistTerm) || evaluateTrackRelevance(t, artistTerm, true).score > 0;
      }

      // Combined search: Must match artist filter AND match song query
      if (isCombinedSearch) {
        const tArtist = (t.artist || '').toLowerCase();
        const artistOk = tArtist.includes(artistTerm) || evaluateTrackRelevance(t, artistTerm, true).score > 0;
        if (!artistOk) return false;
        return evaluateTrackRelevance(t, searchQuery, false).score > 0;
      }

      if (searchType === 'song' || searchType === 'track') {
        const rel = evaluateTrackRelevance(t, searchQuery, false);
        return rel.score > 0 && (rel.tier.includes('title') || rel.matchType === 'exact');
      }

      if (searchQuery) {
        const rel = evaluateTrackRelevance(t, searchQuery, false);
        return rel.score > 0;
      }

      return true;
    });

    if (normSearch || artistTerm) {
      if (isPureArtistSearch) {
        localMatches = rankAndGroupTracks(localMatches, artistTerm, true);
      } else if (isCombinedSearch) {
        localMatches = rankAndGroupTracks(localMatches, searchQuery, false);
      } else {
        localMatches = rankAndGroupTracks(localMatches, searchQuery, false);
      }
    }
  } else {
    localMatches = localCatalog;
  }

  // Ensure local matches follow identical alternate and deduplication filtering rules
  const filterQuery = isPureArtistSearch ? artistTerm : searchQuery;
  const filteredLocal = filterAndDeduplicateTracks(localMatches, filterQuery, genreTag);
  const start = (page - 1) * limit;
  let localSlice = filteredLocal.slice(start, start + limit);

  // Attach grouped match subsets to localSlice
  localSlice.exactMatches = localSlice.filter(t => t.matchType === 'exact');
  localSlice.fuzzyMatches = localSlice.filter(t => t.matchType === 'fuzzy');
  localSlice.relatedMatches = localSlice.filter(t => t.matchType === 'related' || (!t.matchType && t.matchType !== 'exact' && t.matchType !== 'fuzzy'));
  localSlice.externalMatches = [];

  const queryIntent = parseSearchIntent(searchQuery);
  let liveQuery = isPureArtistSearch ? artistTerm : (isCombinedSearch ? `${searchQuery} ${artistTerm}` : searchQuery);
  if (queryIntent.isPureIntent) {
    if (queryIntent.detectedMoods.includes('romantic')) liveQuery = 'Hindi Romantic Songs';
    else if (queryIntent.detectedMoods.includes('sad') || queryIntent.detectedMoods.includes('heartbreak')) liveQuery = 'Hindi Sad Songs';
    else if (queryIntent.detectedMoods.includes('party') || queryIntent.detectedMoods.includes('dance')) liveQuery = 'Bollywood Party Dance Hits';
    else if (queryIntent.detectedMoods.includes('workout')) liveQuery = 'Workout Gym Fitness Hits';
    else if (queryIntent.detectedMoods.includes('relaxing')) liveQuery = 'Chill Relaxing Acoustic Songs';
    else if (queryIntent.detectedMoods.includes('devotional')) liveQuery = 'Hindi Devotional Bhakti Songs';
    else if (queryIntent.detectedEras.includes('90s')) liveQuery = '90s Bollywood Evergreen Hits';
    else if (queryIntent.detectedEras.includes('retro')) liveQuery = 'Old Classic Hindi Songs';
  } else if (!liveQuery && genreTag && genreTag !== 'all') {
    switch (genreTag) {
      case 'bollywood': liveQuery = 'Bollywood Hits'; break;
      case 'punjabi': liveQuery = 'Punjabi Top Hits'; break;
      case 'romantic': liveQuery = 'Hindi Romantic Songs'; break;
      case 'arijit': liveQuery = 'Arijit Singh Best Songs'; break;
      case 'arrahman': liveQuery = 'A.R. Rahman Hits'; break;
      case 'nusrat': liveQuery = 'Nusrat Fateh Ali Khan'; break;
      case 'kishore': liveQuery = 'Kishore Kumar Hits'; break;
      case 'lata': liveQuery = 'Lata Mangeshkar Songs'; break;
      case 'atif': liveQuery = 'Atif Aslam Songs'; break;
      case 'diljit': liveQuery = 'Diljit Dosanjh Hits'; break;
      case 'karan': liveQuery = 'Karan Aujla Songs'; break;
      case 'shreya': liveQuery = 'Shreya Ghoshal Songs'; break;
      case 'sonu': liveQuery = 'Sonu Nigam Hits'; break;
      case 'jubin': liveQuery = 'Jubin Nautiyal Hits'; break;
      case 'darshan': liveQuery = 'Darshan Raval Songs'; break;
      case 'taylor': liveQuery = 'Taylor Swift Songs'; break;
      case 'edsheeran': liveQuery = 'Ed Sheeran Songs'; break;
      case 'weeknd': liveQuery = 'The Weeknd Hits'; break;
      case 'drake': liveQuery = 'Drake Songs'; break;
      case 'south': liveQuery = 'Telugu Tamil Hits'; break;
      case 'hiphop': liveQuery = 'Desi Hip Hop'; break;
      case 'rock': liveQuery = 'Indian Rock'; break;
      case 'lofi': liveQuery = 'Hindi Lofi Hits'; break;
      case 'hollywood': liveQuery = 'Billboard Top 50'; break;
      case 'workout': liveQuery = 'Workout Energy Hits'; break;
      case 'relax': liveQuery = 'Chill and Relaxing Songs'; break;
      default: liveQuery = genreTag ? `${genreTag} Songs` : ''; break;
    }
  }

  // 1. Concurrently query Audius and Jamendo when searching
  let externalMatches = [];
  const audius = (module.exports && module.exports.audiusProvider) || audiusProvider;
  const jamendo = (module.exports && module.exports.jamendoProvider) || jamendoProvider;

  // Determine if external provider calls are needed:
  // Avoid unnecessary external provider calls when local catalog already has relevant matches,
  // or when unit testing without provider mocks to prevent network cluster timeouts.
  const isProviderMocked = Boolean(
    (audius && audius.searchTracks && (audius.searchTracks._isMockFunction || typeof audius.searchTracks.mock === 'object')) ||
    (jamendo && jamendo.searchTracks && (jamendo.searchTracks._isMockFunction || typeof jamendo.searchTracks.mock === 'object'))
  );
  const isTestEnv = process.env.NODE_ENV === 'test';
  const hasExactLocal = localMatches.some(t => t.matchType === 'exact');
  const shouldSkipExternal = (!isProviderMocked && isTestEnv && localMatches.length > 0) ||
    (!isProviderMocked && hasExactLocal && localMatches.length >= 5);

  if (liveQuery && !shouldSkipExternal) {
    const providerLimit = Math.max(1, Math.min(Number(limit) || 20, 50));
    const providerOffset = Math.max(0, (Math.max(1, Number(page) || 1) - 1) * providerLimit);
    const [audiusSettled, jamendoSettled] = await Promise.allSettled([
      audius.searchTracks(liveQuery, { limit: providerLimit, offset: providerOffset }),
      jamendo.searchTracks(liveQuery, { limit: providerLimit, offset: providerOffset })
    ]);

    const rawExternal = [];
    if (audiusSettled.status === 'fulfilled' && Array.isArray(audiusSettled.value)) {
      rawExternal.push(...audiusSettled.value);
    } else if (audiusSettled.status === 'rejected') {
      console.warn('[Audius] Search error:', audiusSettled.reason?.message);
    }

    if (jamendoSettled.status === 'fulfilled' && Array.isArray(jamendoSettled.value)) {
      rawExternal.push(...jamendoSettled.value);
    } else if (jamendoSettled.status === 'rejected') {
      console.warn('[Jamendo] Search error:', jamendoSettled.reason?.message);
    }

    // If explicit artist search, ensure external tracks strictly match the artist
    let filteredExternal = rawExternal.map(enrichTrack);
    if (isPureArtistSearch) {
      filteredExternal = filteredExternal.filter(t => (t.artist || '').toLowerCase().includes(artistTerm) || evaluateTrackRelevance(t, artistTerm, true).score > 0);
    } else if (isCombinedSearch) {
      filteredExternal = filteredExternal.filter(t => {
        const artistOk = (t.artist || '').toLowerCase().includes(artistTerm) || evaluateTrackRelevance(t, artistTerm, true).score > 0;
        return artistOk && evaluateTrackRelevance(t, searchQuery, false).score > 0;
      });
    } else if (searchQuery) {
      filteredExternal = filteredExternal.filter(t => evaluateTrackRelevance(t, searchQuery, false).score > 0);
    }

    // Deduplicate external results against local tracks and each other
    if (filteredExternal.length > 0) {
      const seenIds = new Set(localSlice.map(t => t.id));
      const seenStreams = new Set(localSlice.map(t => t.audioUrl).filter(Boolean));
      const seenTitleKeys = new Set(localSlice.map(t => cleanTitleForComparison(t.title)));

      for (const extTrack of filteredExternal) {
        if (!extTrack || typeof extTrack !== 'object') continue;
        if (!extTrack.audioUrl || typeof extTrack.audioUrl !== 'string') continue;
        if (seenIds.has(extTrack.id) || seenStreams.has(extTrack.audioUrl)) continue;

        const titleKey = cleanTitleForComparison(extTrack.title);
        if (titleKey && seenTitleKeys.has(titleKey)) continue;

        seenIds.add(extTrack.id);
        seenStreams.add(extTrack.audioUrl);
        if (titleKey) seenTitleKeys.add(titleKey);

        // Evaluate true search relevance for external track
        const queryForEval = isPureArtistSearch ? artistTerm : (liveQuery || searchQuery);
        if (queryForEval) {
          const evalResult = evaluateTrackRelevance(extTrack, queryForEval, isPureArtistSearch);
          extTrack.matchScore = evalResult.score > 0 ? evalResult.score : 100;
          extTrack.matchType = evalResult.matchType || 'related';
          extTrack.matchTier = evalResult.tier || 'external';
        } else {
          extTrack.matchScore = 100;
          extTrack.matchType = 'related';
          extTrack.matchTier = 'general';
        }
        extTrack.provider = extTrack.provider || extTrack.source || 'Jamendo';

        externalMatches.push(extTrack);
      }
      externalMatches = filterAndDeduplicateTracks(externalMatches, filterQuery, genreTag);
    }
  }

  // 2. If local catalog has few matches, optionally supplement with live JioSaavn tracks
  if (localSlice.length < 10 && liveQuery) {
    try {
      const fetchSongs = (module.exports && module.exports.fetchProviderSongs) || fetchProviderSongs;
      let liveTracks = await fetchSongs(liveQuery, page, limit);

      if (Array.isArray(liveTracks) && liveTracks.length > 0) {
        liveTracks = liveTracks.map(enrichTrack);
        if (isPureArtistSearch) {
          liveTracks = liveTracks.filter(lt => (lt.artist || '').toLowerCase().includes(artistTerm) || evaluateTrackRelevance(lt, artistTerm, true).score > 0);
          liveTracks = rankAndGroupTracks(liveTracks, artistTerm, true);
        } else if (isCombinedSearch) {
          liveTracks = liveTracks.filter(lt => {
            const artistOk = (lt.artist || '').toLowerCase().includes(artistTerm) || evaluateTrackRelevance(lt, artistTerm, true).score > 0;
            return artistOk && evaluateTrackRelevance(lt, searchQuery, false).score > 0;
          });
          liveTracks = rankAndGroupTracks(liveTracks, searchQuery, false);
        } else if (searchQuery) {
          liveTracks = rankAndGroupTracks(liveTracks, searchQuery, false);
        }

        const seenIds = new Set(localSlice.map(t => t.id));
        const seenTitles = new Set(localSlice.map(t => (t.title || '').toLowerCase()));
        const combined = [...localSlice];
        for (const lt of liveTracks) {
          const tLower = (lt.title || '').toLowerCase();
          if (!seenIds.has(lt.id) && !seenTitles.has(tLower)) {
            seenIds.add(lt.id);
            seenTitles.add(tLower);
            combined.push(lt);
          }
        }
        localSlice = filterAndDeduplicateTracks(combined, filterQuery, genreTag);
      }
    } catch (e) {
      console.warn('[MusicProvider] Supplemental live search failed:', e.message);
    }
  }

  // Combine local and external matches and rank consistently by true relevance
  const allCandidateTracks = [...localSlice, ...externalMatches];

  // Separate by genuine search relevance matchType
  const exactMatches = allCandidateTracks.filter(t => t.matchType === 'exact');
  const relatedMatches = allCandidateTracks.filter(t => t.matchType === 'related' || (!t.matchType && t.matchType !== 'exact' && t.matchType !== 'fuzzy'));
  const fuzzyMatches = allCandidateTracks.filter(t => t.matchType === 'fuzzy');

  // Sort each category by relevance matchScore descending, then shorter title
  const sortByScore = (list) => list.sort((a, b) => {
    const sA = typeof a.matchScore === 'number' ? a.matchScore : 0;
    const sB = typeof b.matchScore === 'number' ? b.matchScore : 0;
    if (sB !== sA) return sB - sA;
    return (a.title || '').length - (b.title || '').length;
  });

  sortByScore(exactMatches);
  sortByScore(relatedMatches);
  sortByScore(fuzzyMatches);

  // Strict deduplication across all combined result subsets
  const seenFinalIds = new Set();
  const seenFinalAudioUrls = new Set();
  const seenFinalTitleComboKeys = new Set();

  function dedupeTrackList(list) {
    const out = [];
    for (const t of list) {
      if (!t || typeof t !== 'object') continue;
      const tid = String(t.id || t.jamendoId || '').trim();
      const aUrl = (t.audioUrl || '').trim();
      const tKey = cleanTitleForComparison(t.title);
      const artKey = (t.artist || '').toLowerCase().trim();
      const comboKey = `${tKey}:::${artKey}`;

      if (tid && seenFinalIds.has(tid)) continue;
      if (aUrl && seenFinalAudioUrls.has(aUrl)) continue;
      if (tKey && artKey && seenFinalTitleComboKeys.has(comboKey)) continue;

      if (tid) seenFinalIds.add(tid);
      if (aUrl) seenFinalAudioUrls.add(aUrl);
      if (tKey && artKey) seenFinalTitleComboKeys.add(comboKey);
      out.push(t);
    }
    return out;
  }

  const dedupedExact = dedupeTrackList(exactMatches);
  const dedupedRelated = dedupeTrackList(relatedMatches);
  const dedupedFuzzy = dedupeTrackList(fuzzyMatches);

  const allRanked = [...dedupedExact, ...dedupedRelated, ...dedupedFuzzy];
  const finalTracks = allRanked.slice(0, limit);
  finalTracks.exactMatches = dedupedExact.slice(0, limit);
  finalTracks.fuzzyMatches = dedupedFuzzy.slice(0, limit);
  finalTracks.relatedMatches = dedupedRelated.slice(0, limit);
  finalTracks.externalMatches = (allRanked.filter(t => t.provider && t.provider.toLowerCase() !== 'local' && t.provider.toLowerCase() !== 'jiosaavn')).slice(0, limit);
  finalTracks.tracks = finalTracks;

  setCache(searchCacheKey, finalTracks, 5 * 60 * 1000);
  return finalTracks;
}

// Clean title for duplicate comparison (Unicode-aware: preserves letters, matras/marks, digits)
function cleanTitleForComparison(title) {
  if (!title || typeof title !== 'string') return '';
  return title.toLowerCase()
    .replace(/[\(\[]\s*from\s+.*?[\)\]]/gi, '')
    .replace(/[\-\–]\s*(new version|single|audio|original motion picture soundtrack|soundtrack)\s*/gi, '')
    .replace(/[\(\[]\s*(feat|ft)\.?\s+.*?[\)\]]/gi, '')
    .replace(/[^\p{L}\p{M}\p{N}]/gu, ' ')
    .replace(/\s+/g, ' ').trim();
}

// Filter out unofficial spin-offs (lo-fi, slowed+reverb, nightcore, instrumental, karaoke, unofficial remixes)
// unless the user explicitly searched for those terms, and deduplicate identical recordings
function filterAndDeduplicateTracks(tracks, searchQuery = '', genre = '') {
  if (!Array.isArray(tracks) || tracks.length === 0) return [];

  const queryLower = (searchQuery || '').toLowerCase();
  const genreLower = (genre || '').toLowerCase();

  const wantsLofi = queryLower.includes('lofi') || queryLower.includes('lo-fi') || genreLower === 'lofi';
  const wantsSlowed = queryLower.includes('slowed') || queryLower.includes('reverb');
  const wantsInstrumental = queryLower.includes('instrumental') || queryLower.includes('karaoke');
  const wantsRemix = queryLower.includes('remix') || queryLower.includes('mashup') || queryLower.includes('mix') || queryLower.includes('dj');

  const filtered = [];
  const seenKeys = new Map();
  const seenTrackIds = new Set();
  const seenTrackAudioUrls = new Set();

  for (const track of tracks) {
    if (!track || typeof track !== 'object') continue;
    const trackId = String(track.id || track.jamendoId || '').trim();
    if (trackId && seenTrackIds.has(trackId)) continue;
    const aUrl = (track.audioUrl || '').trim();
    if (aUrl && seenTrackAudioUrls.has(aUrl)) continue;

    const title = (track.title || '').trim();

    // Check alternate versions
    if (!wantsLofi && /\b(lo[\s\-_]*fi|chillhop|lofi\s+flip|lofi\s+mix|lofi\s+remix)\b/i.test(title)) continue;
    if (!wantsSlowed && /\b(slowed(\s*[\+&]\s*reverb)?|reverb\s+pitch|slowed\s+and\s+reverb)\b/i.test(title)) continue;
    if (!wantsInstrumental && /\b(instrumental(\s+version)?|backing\s+track|karaoke(\s+version)?)\b/i.test(title)) continue;
    if (/\b(speed[\s\-_]*up|sped[\s\-_]*up|speeded|nightcore|fast\s+version|reversed?(\s+audio)?|8d\s+audio|bass\s+boosted)\b/i.test(title)) continue;
    if (!wantsRemix && !/dj\s+waley\s+babu/i.test(title) && /\b(unofficial\s+remix|club\s+mix|dance\s+mix|dj\s+[a-z0-9]+\s+remix|remix\s+by)\b/i.test(title)) continue;

    // Deduplicate identical recordings with slightly different formatting or compilation albums
    const baseT = cleanTitleForComparison(title) || title.toLowerCase().trim();
    const artistTokens = (track.artist || '').toLowerCase().split(/[,&]|\band\b|\bfeat\b|\bft\b/i).map(s => s.replace(/[^\p{L}\p{N}]/gu, '').trim()).filter(Boolean);
    const primaryArtists = artistTokens.slice(0, 2).sort().join('_') || 'unknown';
    const isAmbiguousRelease = /\b(acoustic|unplugged|tribute)\b/i.test(title);
    const versionQualifier = isAmbiguousRelease ? 'ambiguous_distinct' : 'standard';
    const dupeKey = `${baseT}:::${primaryArtists}:::${versionQualifier}`;

    if (seenKeys.has(dupeKey)) {
      const existing = seenKeys.get(dupeKey);
      if (Math.abs((existing.duration || 0) - (track.duration || 0)) <= 12) {
        continue;
      }
    }

    if (trackId) seenTrackIds.add(trackId);
    if (aUrl) seenTrackAudioUrls.add(aUrl);
    seenKeys.set(dupeKey, track);
    filtered.push(track);
  }

  return filtered;
}

// Fetch single track details
async function getProviderTrackDetails(id) {
  if (!id || typeof id !== 'string' || !/^[a-zA-Z0-9_\-.:@]+$/.test(id)) return null;

  if (localCatalog.length > 0) {
    const found = localCatalog.find(t => t.id === id || t.jamendoId === id);
    if (found) return found;
  }

  if (id.startsWith('audius_')) {
    const audius = (module.exports && module.exports.audiusProvider) || audiusProvider;
    return audius.getTrackById(id);
  }

  if (id.startsWith('jamendo_')) {
    const jamendo = (module.exports && module.exports.jamendoProvider) || jamendoProvider;
    return jamendo.getTrackById(id);
  }

  if (id.startsWith('radio_')) {
    const radio = (module.exports && module.exports.radioBrowserProvider) || radioBrowserProvider;
    return radio.getStationByUuid(id.replace(/^radio_/, ''));
  }

  const encodedId = encodeURIComponent(id);
  const url = `${JIOSAAVN_BASE_URL}?__call=song.getDetails&_format=json&_marker=0&api_version=4&ctx=web6dot0&pids=${encodedId}`;
  const data = await safeFetchJson(url);

  if (data && typeof data === 'object' && (data[id] || data.songs?.[0])) {
    const item = data[id] || data.songs[0];
    const formatted = normalizeProviderTrack(item);
    if (formatted) {
      return formatted;
    }
  }
  return null;
}

// Fetch track lyrics (returns safe default if unavailable, no fabricated lyrics)
async function getProviderLyrics(id) {
  if (!id || typeof id !== 'string' || !/^[a-zA-Z0-9_\-.:@]+$/.test(id)) {
    return { lyrics: 'Lyrics unavailable for this track.', copyright: '', isSynchronized: false, provider: 'JioSaavn' };
  }

  const cacheKey = `lyrics_${id}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const encodedId = encodeURIComponent(id);
  const url = `${JIOSAAVN_BASE_URL}?__call=lyrics.getLyrics&_format=json&_marker=0&api_version=4&ctx=web6dot0&lyrics_id=${encodedId}`;
  const data = await safeFetchJson(url);

  if (data && typeof data === 'object' && typeof data.lyrics === 'string' && data.lyrics.trim()) {
    const cleanLyrics = decodeHTMLEntities(data.lyrics).replace(/<br\s*\/?>/gi, '\n');
    const hasSync = /\[\d{2}:\d{2}(\.\d{2,3})?\]/.test(cleanLyrics);
    const result = {
      lyrics: cleanLyrics,
      copyright: typeof data.snippet === 'string' && data.snippet.trim() ? data.snippet : 'Third-Party Provider Lyrics (Unverified)',
      isSynchronized: hasSync,
      provider: 'JioSaavn'
    };
    setCache(cacheKey, result, 60 * 60 * 1000);
    return result;
  }

  return { lyrics: 'Lyrics unavailable for this track.', copyright: '', isSynchronized: false, provider: 'JioSaavn' };
}

// Mood Configuration and Metadata Mapping
const MOOD_CONFIG = {
  chill: {
    label: 'Chill',
    description: 'Relaxed grooves, mellow acoustic tones, and soothing vibes',
    regex: /\b(chill|relax|acoustic|peace|calm|soft|unplugged|ambient|lofi|lo-fi|meditation|soothing)\b/i,
    providerQuery: 'Chill Relaxing Music'
  },
  focus: {
    label: 'Focus',
    description: 'Peaceful instrumental melodies and ambient tracks for concentration',
    regex: /\b(focus|instrumental|study|piano|meditation|classical|peaceful|deep\s+focus)\b/i,
    providerQuery: 'Focus Instrumental Study Music'
  },
  workout: {
    label: 'Workout',
    description: 'High-energy beats and motivational anthems to power your session',
    regex: /\b(workout|gym|fitness|pump|energetic|motivation|beast|running|cardio|high\s+energy)\b/i,
    providerQuery: 'Workout Gym Fitness Hits'
  },
  romantic: {
    label: 'Romantic',
    description: 'Soulful love songs, heartfelt ballads, and gentle duets',
    regex: /\b(romantic|romance|love|ballad|ishq|pyaar|dil|heart|mohabbat|deewana|valentine)\b/i,
    providerQuery: 'Romantic Love Songs'
  },
  party: {
    label: 'Party',
    description: 'Upbeat dance tracks, festival anthems, and celebration hits',
    regex: /\b(party|dance|club|bhangra|dhol|celebration|dj|festive|wedding|dhamaka)\b/i,
    providerQuery: 'Party Dance Club Hits'
  },
  'night-drive': {
    label: 'Night Drive',
    description: 'Moody synth melodies, late-night rhythms, and cruising tracks',
    regex: /\b(night|drive|midnight|late\s+night|dark|moonlight|city\s+lights|cruise|raat)\b/i,
    providerQuery: 'Night Drive Midnight Music'
  },
  energize: {
    label: 'Energize',
    description: 'High-octane electronic beats, power anthems, and motivational rhythm',
    regex: /\b(energy|energize|power|hype|pump|anthem|edm|electro|dance|rock|blast|fast)\b/i,
    providerQuery: 'Energetic Upbeat Workout Music'
  },
  'feel-good': {
    label: 'Feel Good',
    description: 'Uplifting hits, bright melodies, and feel-good sunshine rhythms',
    regex: /\b(happy|joy|smile|good|positive|sunshine|groove|fun|vibes|cheerful)\b/i,
    providerQuery: 'Feel Good Happy Hits'
  },
  sad: {
    label: 'Sad',
    description: 'Heartfelt emotional songs, melancholy melodies, and sorrowful lyrics',
    regex: /\b(sad|dard|judai|bewafa|broken|alone|tears|pain|cry|tanha|gham|yaad|dukh)\b/i,
    providerQuery: 'Sad Hindi Songs Dard Bhare'
  },
  sleep: {
    label: 'Sleep',
    description: 'Gentle ambient soundscapes, soft lofi beats, and calming bedtime melodies',
    regex: /\b(sleep|lullaby|peace|calm|soft|ambient|gentle|dream|night|rest|whisper)\b/i,
    providerQuery: 'Sleep Relaxing Music Soothing'
  }
};

// Fetch tracks for a specific mood category using genuine metadata
async function getMoodTracks(moodKey, { limit = 30, page = 1 } = {}) {
  const normalizedKey = (moodKey || '').toLowerCase().trim().replace(/_/g, '-');
  const mood = MOOD_CONFIG[normalizedKey] || (normalizedKey === 'nightdrive' ? MOOD_CONFIG['night-drive'] : null);

  if (!mood) {
    return { mood: moodKey, label: moodKey, description: '', tracks: [], total: 0 };
  }

  // 1. Search local catalog matching mood regex against title, album, category, genre, mood, and tags (memoized)
  let localMatches = memoizedMoodTracks.get(normalizedKey);
  if (!localMatches) {
    localMatches = localCatalog.filter(track => {
      const titleMatch = mood.regex.test(track.title || '');
      const albumMatch = mood.regex.test(track.album || '');
      const categoryMatch = mood.regex.test(track.category || '');
      const genreMatch = mood.regex.test(track.genre || '');
      const moodMatch = mood.regex.test(track.mood || '');
      const tagMatch = Array.isArray(track.tags)
        ? track.tags.some(t => mood.regex.test(t))
        : mood.regex.test(track.tags || '');
      return titleMatch || albumMatch || categoryMatch || genreMatch || moodMatch || tagMatch;
    });
    memoizedMoodTracks.set(normalizedKey, localMatches);
  }

  let allTracks = filterAndDeduplicateTracks(localMatches, '', normalizedKey);

  // 2. If catalog has few matches, supplement with provider tracks
  if (allTracks.length < 15 && mood.providerQuery) {
    try {
      const providerResults = await searchProviderTracks({ q: mood.providerQuery, limit: 25 });
      if (Array.isArray(providerResults) && providerResults.length > 0) {
        const combined = [...allTracks, ...providerResults];
        allTracks = filterAndDeduplicateTracks(combined, '', normalizedKey);
      }
    } catch (e) {
      console.warn(`[Mood] Provider query failed for mood ${normalizedKey}:`, e.message);
    }
  }

  const start = (page - 1) * limit;
  const pagedTracks = allTracks.slice(start, start + limit);

  return {
    mood: normalizedKey,
    label: mood.label,
    description: mood.description,
    tracks: pagedTracks,
    total: allTracks.length,
    page,
    totalPages: Math.ceil(allTracks.length / limit) || 1
  };
}

// Fetch Artist Profile details from provider or local catalog with graceful fallbacks
async function getArtistProfile(artistQuery) {
  if (!artistQuery || typeof artistQuery !== 'string' || !artistQuery.trim()) {
    return null;
  }

  const cleanQuery = artistQuery.trim();
  const cacheKey = `artist_profile_${cleanQuery.toLowerCase()}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  // 1. Search artist via JioSaavn API
  try {
    const searchUrl = `${JIOSAAVN_BASE_URL}?__call=search.getArtistResults&_format=json&_marker=0&api_version=4&ctx=web6dot0&q=${encodeURIComponent(cleanQuery)}`;
    const searchData = await safeFetchJson(searchUrl);

    if (searchData && Array.isArray(searchData.results) && searchData.results.length > 0) {
      const firstArtist = searchData.results[0];
      const permaUrl = firstArtist.perma_url || '';
      const token = permaUrl ? permaUrl.split('/').filter(Boolean).pop() : null;

      if (token) {
        const detailUrl = `${JIOSAAVN_BASE_URL}?__call=webapi.get&token=${encodeURIComponent(token)}&type=artist&_format=json&_marker=0&api_version=4&ctx=web6dot0`;
        const details = await safeFetchJson(detailUrl);

        if (details && details.name) {
          // Parse bio safely
          let bioText = 'Biography currently unavailable for this artist.';
          if (Array.isArray(details.bio) && details.bio.length > 0) {
            bioText = details.bio
              .map(b => (b && typeof b.text === 'string') ? b.text.trim() : '')
              .filter(Boolean)
              .join('\n\n');
          } else if (typeof details.bio === 'string' && details.bio.trim()) {
            bioText = details.bio.trim();
          }

          // Format top songs
          const topSongsRaw = Array.isArray(details.topSongs) ? details.topSongs : [];
          const topSongs = topSongsRaw
            .map(normalizeProviderTrack)
            .filter(Boolean);
          const filteredSongs = filterAndDeduplicateTracks(topSongs);

          // Format top albums
          const topAlbumsRaw = Array.isArray(details.topAlbums) ? details.topAlbums : [];
          const albums = topAlbumsRaw.map(a => ({
            id: a.id || a.albumid || '',
            title: decodeHTMLEntities(a.title || a.name || 'Untitled Album'),
            year: a.year || '',
            coverUrl: formatImageUrl(a.image)
          })).filter(a => a.id && a.title);

          const artistData = {
            id: details.artistId || firstArtist.id || '',
            name: decodeHTMLEntities(details.name),
            image: formatImageUrl(details.image || firstArtist.image),
            bio: bioText,
            songs: filteredSongs,
            albums,
            similarArtists: Array.isArray(details.similarArtists) ? details.similarArtists.map(s => ({
              id: s.id || '',
              name: decodeHTMLEntities(s.name || ''),
              image: formatImageUrl(s.image)
            })) : [],
            source: 'Third-Party Provider (JioSaavn API)'
          };

          setCache(cacheKey, artistData, 30 * 60 * 1000);
          return artistData;
        }
      }
    }
  } catch (err) {
    console.warn(`[Artist] Provider search failed for "${cleanQuery}":`, err.message);
  }

  // 2. Fallback: Aggregate artist tracks and albums from local catalog
  const queryLower = cleanQuery.toLowerCase();
  const matchingTracks = localCatalog.filter(t => (t.artist || '').toLowerCase().includes(queryLower));

  if (matchingTracks.length === 0) {
    return null;
  }

  // Extract unique albums
  const albumMap = new Map();
  matchingTracks.forEach(t => {
    if (t.album && !albumMap.has(t.album)) {
      albumMap.set(t.album, {
        id: `local_album_${albumMap.size + 1}`,
        title: t.album,
        year: '',
        coverUrl: t.coverUrl
      });
    }
  });

  const fallbackData = {
    id: `local_artist_${Buffer.from(cleanQuery).toString('hex').slice(0, 10)}`,
    name: cleanQuery,
    image: matchingTracks[0]?.coverUrl || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop',
    bio: 'Biography currently unavailable for this artist.',
    songs: filterAndDeduplicateTracks(matchingTracks.slice(0, 100)),
    albums: Array.from(albumMap.values()),
    similarArtists: [],
    source: 'Local Catalog Archive'
  };

  setCache(cacheKey, fallbackData, 30 * 60 * 1000);
  return fallbackData;
}

function getAllProvidersHealth() {
  const audius = (module.exports && module.exports.audiusProvider) || audiusProvider;
  const jamendo = (module.exports && module.exports.jamendoProvider) || jamendoProvider;
  const radio = (module.exports && module.exports.radioBrowserProvider) || radioBrowserProvider;

  return {
    local: { available: true, status: 'healthy', totalSongs: localCatalog.length },
    jiosaavn: getProviderHealth(),
    audius: audius.getHealth(),
    jamendo: jamendo.getHealth(),
    radioBrowser: radio.getHealth()
  };
}

function ensurePreIndexedSuggestions() {
  if (preIndexedArtists && preIndexedAlbums && preIndexedTracks) return;

  const aMap = new Map();
  const albMap = new Map();
  preIndexedTracks = [];

  for (const track of localCatalog) {
    const artist = track.artist || track.artist_name;
    if (artist) {
      const normA = normalizeText(artist);
      if (normA) {
        if (!aMap.has(normA)) {
          aMap.set(normA, { name: artist, normalized: normA, tokens: tokenize(normA), count: 1 });
        } else {
          aMap.get(normA).count++;
        }
      }
    }

    const album = track.album || track.album_name;
    if (album) {
      const normAlb = normalizeText(album);
      if (normAlb) {
        if (!albMap.has(normAlb)) {
          albMap.set(normAlb, { name: album, normalized: normAlb, tokens: tokenize(normAlb), track, count: 1 });
        } else {
          albMap.get(normAlb).count++;
        }
      }
    }

    const title = track.title || track.name;
    if (title) {
      const normTitle = normalizeText(title);
      const normArtist = normalizeText(artist || '');
      if (normTitle) {
        preIndexedTracks.push({
          track,
          title,
          normalizedTitle: normTitle,
          normalizedArtist: normArtist,
          tokens: Array.from(new Set([...tokenize(normTitle), ...tokenize(normArtist)])),
          titleKey: cleanTitleForComparison(title)
        });
      }
    }
  }

  preIndexedArtists = Array.from(aMap.values());
  preIndexedAlbums = Array.from(albMap.values());
}

function getSuggestions(query, limit = 8) {
  if (!query || typeof query !== 'string') return [];

  const safeLimit = Math.max(1, Math.min(Number(limit) || 8, 30));
  const normalizedQuery = normalizeText(query);
  if (normalizedQuery.length < 2) return [];

  const cacheKey = `suggestions_${normalizedQuery}_${safeLimit}`;
  const defaultKey = `suggestions_${normalizedQuery}`;
  const cached = getCached(cacheKey) || (safeLimit === 8 ? getCached(defaultKey) : null);
  if (cached && Array.isArray(cached)) {
    return cached.slice(0, safeLimit);
  }

  ensurePreIndexedSuggestions();

  // 0. Intent suggestions (mood, era, genre)
  const intentSuggestions = [];
  const INTENT_SUGGESTION_DEFS = [
    { text: 'Romantic Songs', keys: ['romantic', 'romance', 'love', 'pyaar', 'ishq', 'dil', 'रोमांटिक', 'प्यार'], mood: 'romantic', type: 'mood' },
    { text: 'Sad Songs', keys: ['sad', 'dard', 'gam', 'gham', 'judaai', 'tanha', 'दर्द', 'उदास'], mood: 'sad', type: 'mood' },
    { text: 'Party Songs', keys: ['party', 'dance', 'club', 'bhangra', 'dhol', 'nach', 'पार्टी', 'नाच'], mood: 'party', type: 'mood' },
    { text: 'Workout Songs', keys: ['workout', 'gym', 'fitness', 'pump', 'energy', 'beast'], mood: 'workout', type: 'mood' },
    { text: 'Relaxing Songs', keys: ['relax', 'relaxing', 'chill', 'peace', 'calm', 'soothing', 'lofi'], mood: 'relaxing', type: 'mood' },
    { text: 'Devotional Songs', keys: ['devotional', 'bhajan', 'aarti', 'chalisa', 'bhakti', 'qawwali', 'भजन', 'आरती'], mood: 'devotional', type: 'mood' },
    { text: '90s Bollywood Songs', keys: ['90s', '90', 'nineties'], era: '90s', type: 'mood' },
    { text: 'Old Hindi Songs', keys: ['old', 'retro', 'purane', 'purana', 'evergreen', 'classic', 'पुराने'], era: 'retro', type: 'mood' }
  ];

  for (const item of INTENT_SUGGESTION_DEFS) {
    const matches = item.keys.some(k => k.startsWith(normalizedQuery) || normalizedQuery.startsWith(k) || item.text.toLowerCase().includes(normalizedQuery));
    if (matches) {
      intentSuggestions.push({
        type: 'mood',
        text: item.text
      });
    }
  }

  // 1. Matching artists (exact, prefix, phrase, and typo-tolerant fuzzy)
  const artistMap = new Map();
  for (const item of preIndexedArtists) {
    const normalizedArtist = item.normalized;
    let score = 0;
    if (normalizedArtist === normalizedQuery) {
      score = 100;
    } else if (normalizedArtist.startsWith(normalizedQuery)) {
      score = 85;
    } else if (normalizedArtist.includes(normalizedQuery)) {
      score = 70;
    } else if (normalizedQuery.length >= 3) {
      // Typo-tolerant matching on artist tokens
      for (const aTok of item.tokens) {
        const sim = tokenSimilarity(normalizedQuery, aTok);
        if (sim >= 0.7) {
          score = Math.max(score, Math.round(55 * sim));
        }
      }
    }

    if (score === 0) continue;
    artistMap.set(normalizedArtist, { name: item.name, count: item.count, score });
  }

  const artistSuggestions = Array.from(artistMap.values())
    .map(a => ({
      type: 'artist',
      text: a.name,
      count: a.count,
      _score: a.score,
      _normalized: normalizeText(a.name)
    }))
    .sort((a, b) => {
      if (b._score !== a._score) return b._score - a._score;
      const aStarts = a._normalized.startsWith(normalizedQuery) ? 1 : 0;
      const bStarts = b._normalized.startsWith(normalizedQuery) ? 1 : 0;
      if (aStarts !== bStarts) return bStarts - aStarts;
      return b.count - a.count;
    })
    .slice(0, 10)
    .map(({ _score, _normalized, ...rest }) => rest);

  // 2. Matching songs (exact, prefix, phrase, and typo-tolerant fuzzy)
  const trackSuggestions = [];
  const seenTrackTitles = new Set();

  for (const item of preIndexedTracks) {
    const track = item.track;
    const title = item.title;
    const normalizedTitle = item.normalizedTitle;
    const normalizedArtist = item.normalizedArtist;

    let score = 0;

    if (normalizedTitle === normalizedQuery) {
      score = 100;
    } else if (normalizedTitle.startsWith(normalizedQuery)) {
      score = 85;
    } else if (normalizedTitle.includes(normalizedQuery)) {
      score = 70;
    } else if (normalizedArtist && (normalizedArtist === normalizedQuery || normalizedArtist.startsWith(normalizedQuery) || normalizedArtist.includes(normalizedQuery))) {
      score = 65;
    } else if (normalizedQuery.length >= 3) {
      if (item.tokens && item.tokens.length > 0) {
        for (const t of item.tokens) {
          if (t.startsWith(normalizedQuery) || (t.length >= 3 && normalizedQuery.startsWith(t))) {
            score = 60;
            break;
          }
          if (Math.abs(t.length - normalizedQuery.length) <= 1) {
            const sim = tokenSimilarity(normalizedQuery, t);
            if (sim >= 0.75) {
              score = Math.round(55 * sim);
              break;
            }
          }
        }
      }
    }

    if (score === 0) continue;

    if (seenTrackTitles.has(item.titleKey)) continue;
    seenTrackTitles.add(item.titleKey);

    trackSuggestions.push({
      type: 'track',
      text: title,
      artist: track.artist || track.artist_name,
      id: track.id,
      coverUrl: track.coverUrl || track.image || track.album_image,
      duration: track.duration,
      audioUrl: track.audioUrl || track.audio,
      _score: score,
      _titleLen: normalizedTitle.length
    });
  }

  trackSuggestions.sort((a, b) => {
    if (a._score !== b._score) return b._score - a._score;
    return a._titleLen - b._titleLen;
  });

  const topTracks = trackSuggestions.slice(0, 15).map(({ _score, _titleLen, ...rest }) => {
    if (!rest.audioUrl) delete rest.audioUrl;
    return rest;
  });

  // 3. Matching albums
  const albumMap = new Map();
  for (const item of preIndexedAlbums) {
    const normalizedAlbum = item.normalized;
    let score = 0;
    if (normalizedAlbum === normalizedQuery) {
      score = 100;
    } else if (normalizedAlbum.startsWith(normalizedQuery)) {
      score = 85;
    } else if (normalizedAlbum.includes(normalizedQuery)) {
      score = 70;
    } else if (normalizedQuery.length >= 3) {
      for (const albTok of item.tokens) {
        const sim = tokenSimilarity(normalizedQuery, albTok);
        if (sim >= 0.7) {
          score = Math.max(score, Math.round(50 * sim));
        }
      }
    }

    if (score === 0) continue;

    albumMap.set(normalizedAlbum, {
      type: 'album',
      text: item.name,
      artist: item.track?.artist || item.track?.artist_name || 'Various Artists',
      coverUrl: item.track?.coverUrl || item.track?.image || '',
      _score: score
    });
  }

  const albumSuggestions = Array.from(albumMap.values())
    .sort((a, b) => b._score - a._score)
    .slice(0, 5)
    .map(({ _score, ...rest }) => rest);

  // Combine results for requested limit
  const limitedResults = [...intentSuggestions, ...artistSuggestions, ...topTracks, ...albumSuggestions].slice(0, safeLimit);

  if (limitedResults.length > 0) {
    setCache(cacheKey, limitedResults, 180000);
    if (safeLimit === 8) {
      setCache(defaultKey, limitedResults, 180000);
    }
  }

  return limitedResults;
}

module.exports = {
  fetchProviderSongs,
  normalizeProviderTrack,
  getLocalCatalog,
  getLocalAlbums,
  getLocalArtists,
  getProviderTrending,
  searchProviderTracks,
  getProviderTrackDetails,
  getProviderLyrics,
  getMoodTracks,
  getArtistProfile,
  MOOD_CONFIG,
  safeFetchJson,
  formatImageUrl,
  formatAudioUrl,
  isImageUrl,
  decryptMediaUrl,
  filterAndDeduplicateTracks,
  cleanTitleForComparison,
  getCached,
  setCache,
  clearCache,
  getProviderHealth,
  setProviderHealth,
  getAllProvidersHealth,
  getSuggestions,
  audiusProvider,
  jamendoProvider,
  radioBrowserProvider
};
