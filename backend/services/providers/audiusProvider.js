/**
 * backend/services/providers/audiusProvider.js
 *
 * Audius Decentralized Music Provider Adapter
 * Uses official REST search, stream, and track endpoints.
 * Never hardcodes credentials. Respects optional AUDIUS_API_KEY.
 * Never downloads or saves audio files locally; only formats stream URLs.
 */

const { formatAudioUrl, formatImageUrl } = require('../urlHelper');

const DEFAULT_HOSTS = [
  'https://discoveryprovider.audius.co',
  'https://audius-dp.singapore.creatorseed.com',
  'https://audius-discovery-1.cultur3stake.com'
];

const APP_NAME = 'AuraList';
const FETCH_TIMEOUT_MS = 5000;
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const MAX_CACHE_SIZE = 100;

// Bounded in-memory cache
const cache = new Map();

function getCached(key) {
  if (!key || typeof key !== 'string') return null;
  const item = cache.get(key);
  if (!item) return null;
  if (Date.now() - item.timestamp > item.ttl) {
    cache.delete(key);
    return null;
  }
  return item.data;
}

function setCache(key, data, ttlMs = CACHE_TTL_MS) {
  if (!key || !data) return;
  if (cache.size >= MAX_CACHE_SIZE && !cache.has(key)) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) cache.delete(oldestKey);
  }
  cache.set(key, { timestamp: Date.now(), data, ttl: ttlMs });
}

function clearCache() {
  cache.clear();
}

let activeHostIndex = 0;

function getHost() {
  return DEFAULT_HOSTS[activeHostIndex % DEFAULT_HOSTS.length];
}

function rotateHost() {
  activeHostIndex = (activeHostIndex + 1) % DEFAULT_HOSTS.length;
  return getHost();
}

let providerHealth = {
  available: false,
  status: 'unknown',
  lastChecked: null,
  errorCode: null,
  consecutiveFailures: 0
};

function getHealth() {
  const isChecked = providerHealth.lastChecked !== null;
  return {
    ...providerHealth,
    status: !isChecked ? 'unknown' : (providerHealth.available ? 'healthy' : 'degraded')
  };
}

function setHealth({ available, errorCode = null }) {
  providerHealth.available = Boolean(available);
  providerHealth.lastChecked = Date.now();
  providerHealth.status = available ? 'healthy' : 'degraded';
  if (available) {
    providerHealth.consecutiveFailures = 0;
    providerHealth.errorCode = null;
  } else {
    providerHealth.consecutiveFailures++;
    providerHealth.errorCode = errorCode || 'PROVIDER_UNAVAILABLE';
  }
}

/**
 * Safe fetch with AbortController timeout & defensive error handling
 */
async function safeFetchJson(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const apiKey = (process.env.AUDIUS_API_KEY || '').trim();
  const headers = {
    'User-Agent': 'AuraList-MusicApp/1.0 (https://github.com/ashishmaurya12/AuraList-music-app)',
    Accept: 'application/json',
    ...(apiKey ? { 'x-api-key': apiKey } : {}),
    ...(options.headers || {})
  };

  try {
    const response = await fetch(url, {
      ...options,
      headers,
      signal: controller.signal
    });

    if (!response.ok) {
      setHealth({ available: false, errorCode: `HTTP_${response.status}` });
      return null;
    }

    const data = await response.json();
    setHealth({ available: true });
    return data;
  } catch (error) {
    const isTimeout = error.name === 'AbortError' || controller.signal.aborted;
    setHealth({
      available: false,
      errorCode: isTimeout ? 'PROVIDER_TIMEOUT' : 'PROVIDER_UNAVAILABLE'
    });
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Normalize Audius track object to the AuraList track schema
 */
function normalizeTrack(item, host = getHost()) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;

  const rawId = item.id;
  if (!rawId || (typeof rawId !== 'string' && typeof rawId !== 'number')) {
    return null;
  }
  const trackId = String(rawId).trim();
  if (!trackId) return null;

  const title = (typeof item.title === 'string' && item.title.trim())
    ? item.title.trim()
    : 'Untitled Track';

  const user = item.user && typeof item.user === 'object' ? item.user : {};
  const artist = (typeof user.name === 'string' && user.name.trim())
    ? user.name.trim()
    : ((typeof user.handle === 'string' && user.handle.trim()) ? user.handle.trim() : 'Audius Artist');

  const album = (typeof item.genre === 'string' && item.genre.trim())
    ? item.genre.trim()
    : 'Audius Release';

  let durationSec = 0;
  if (typeof item.duration === 'number' && Number.isFinite(item.duration) && item.duration >= 0) {
    durationSec = Math.floor(item.duration);
  }

  // Cover image: pick highest resolution available
  const artwork = item.artwork && typeof item.artwork === 'object' ? item.artwork : {};
  const candidateCover = artwork['480x480'] || artwork['1000x1000'] || artwork['150x150'] || item.image;
  const coverUrl = formatImageUrl(candidateCover);

  // Stream URL: official REST track stream endpoint (API key is strictly backend-only, never in stream URLs)
  const streamEndpoint = `${host}/v1/tracks/${encodeURIComponent(trackId)}/stream?app_name=${APP_NAME}`;
  const audioUrl = formatAudioUrl(streamEndpoint);

  const isDownloadable = Boolean(item.downloadable);
  const audiusGenre = typeof item.genre === 'string' ? item.genre.trim() : '';
  const audiusMood = typeof item.mood === 'string' ? item.mood.trim() : '';
  const audiusTags = typeof item.tags === 'string'
    ? item.tags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean)
    : (Array.isArray(item.tags) ? item.tags.map(t => String(t).trim().toLowerCase()).filter(Boolean) : []);

  return {
    id: `audius_${trackId}`,
    provider: 'Audius',
    providerId: trackId,
    title,
    artist,
    album,
    coverUrl,
    audioUrl,
    duration: durationSec,
    license: isDownloadable ? 'Audius Free Stream (Creator Download Enabled)' : 'Audius Stream (Streaming Only)',
    source: 'Audius',
    downloadAllowed: isDownloadable,
    jamendoId: `audius_${trackId}`,
    genre: audiusGenre,
    genres: audiusGenre ? [audiusGenre.toLowerCase()] : [],
    mood: audiusMood,
    moods: audiusMood ? [audiusMood.toLowerCase()] : [],
    tags: audiusTags
  };
}

/**
 * Search tracks on Audius
 */
async function searchTracks(query, { limit = 20, offset = 0, timeoutMs = FETCH_TIMEOUT_MS } = {}) {
  if (!query || typeof query !== 'string' || !query.trim()) return [];

  const cleanQuery = query.trim().slice(0, 200);
  const clampedLimit = Math.max(1, Math.min(50, Number(limit) || 20));
  const clampedOffset = Math.max(0, Number(offset) || 0);

  const cacheKey = `audius_search_${cleanQuery.toLowerCase()}_${clampedLimit}_${clampedOffset}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const host = getHost();
  let workingHost = host;
  const searchUrl = `${host}/v1/tracks/search?query=${encodeURIComponent(cleanQuery)}&limit=${clampedLimit}&offset=${clampedOffset}&app_name=${APP_NAME}`;

  const fetcher = (module.exports && module.exports.safeFetchJson) || safeFetchJson;
  let data = await fetcher(searchUrl, {}, timeoutMs);

  // If first mirror fails, try next mirror and track the working host
  if (!data) {
    const backupHost = rotateHost();
    const backupUrl = `${backupHost}/v1/tracks/search?query=${encodeURIComponent(cleanQuery)}&limit=${clampedLimit}&offset=${clampedOffset}&app_name=${APP_NAME}`;
    data = await fetcher(backupUrl, {}, timeoutMs);
    if (data) {
      workingHost = backupHost;
    }
  }

  if (data && typeof data === 'object' && Array.isArray(data.data)) {
    const normalized = data.data
      .map(item => normalizeTrack(item, workingHost))
      .filter(t => t !== null && Boolean(t.audioUrl));

    setCache(cacheKey, normalized);
    return normalized;
  }

  return [];
}

/**
 * Get single track details by ID
 */
async function getTrackById(id, { timeoutMs = FETCH_TIMEOUT_MS } = {}) {
  if (!id || typeof id !== 'string') return null;
  const cleanId = id.replace(/^audius_/, '').trim();
  if (!cleanId || !/^[0-9a-zA-Z_\-]+$/.test(cleanId)) return null;

  const cacheKey = `audius_track_${cleanId}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const host = getHost();
  let workingHost = host;
  const url = `${host}/v1/tracks/${encodeURIComponent(cleanId)}?app_name=${APP_NAME}`;

  const fetcher = (module.exports && module.exports.safeFetchJson) || safeFetchJson;
  let data = await fetcher(url, {}, timeoutMs);

  if (!data) {
    const backupHost = rotateHost();
    const backupUrl = `${backupHost}/v1/tracks/${encodeURIComponent(cleanId)}?app_name=${APP_NAME}`;
    data = await fetcher(backupUrl, {}, timeoutMs);
    if (data) {
      workingHost = backupHost;
    }
  }

  if (data && typeof data === 'object' && (data.data || data.id)) {
    const item = data.data || data;
    const normalized = normalizeTrack(item, workingHost);
    if (normalized) {
      setCache(cacheKey, normalized);
      return normalized;
    }
  }

  return null;
}

module.exports = {
  searchTracks,
  getTrackById,
  normalizeTrack,
  safeFetchJson,
  getHealth,
  setHealth,
  getHost,
  rotateHost,
  clearCache,
  DEFAULT_HOSTS
};
