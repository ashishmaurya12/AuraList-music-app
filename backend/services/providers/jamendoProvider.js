/**
 * backend/services/providers/jamendoProvider.js
 *
 * Jamendo Music Provider Adapter
 * Official Jamendo API v3.0 tracks endpoint.
 * Requires JAMENDO_CLIENT_ID only when enabled.
 * If JAMENDO_CLIENT_ID is not provided, gracefully disables Jamendo without errors.
 * Never exposes credentials in logs, HTML, or responses.
 * Uses audio URL strictly for streaming.
 * Respects license and download permissions.
 */

const { formatAudioUrl, formatImageUrl } = require('../urlHelper');

const JAMENDO_BASE_URL = 'https://api.jamendo.com/v3.0';
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

function isPlaceholderClientId(id) {
  if (!id || typeof id !== 'string') return false;
  const lower = id.toLowerCase().trim();
  return (
    lower.includes('your_jamendo_client_id') ||
    lower.includes('placeholder') ||
    lower === 'client_id_here'
  );
}

function isEnabled() {
  const clientId = process.env.JAMENDO_CLIENT_ID;
  return Boolean(clientId && typeof clientId === 'string' && clientId.trim().length > 0 && !isPlaceholderClientId(clientId));
}

function getClientId() {
  return (process.env.JAMENDO_CLIENT_ID || '').trim();
}

let providerHealth = {
  available: false,
  status: 'unknown',
  lastChecked: null,
  errorCode: null,
  consecutiveFailures: 0
};

function getHealth() {
  const enabled = isEnabled();
  const isChecked = providerHealth.lastChecked !== null;
  return {
    enabled,
    available: enabled ? providerHealth.available : false,
    status: !enabled ? 'disabled' : (!isChecked ? 'unknown' : (providerHealth.available ? 'healthy' : 'degraded')),
    errorCode: enabled ? providerHealth.errorCode : 'JAMENDO_NOT_CONFIGURED',
    lastChecked: providerHealth.lastChecked
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

  const headers = {
    'User-Agent': 'AuraList-MusicApp/1.0 (https://github.com/ashishmaurya12/AuraList-music-app)',
    Accept: 'application/json',
    ...(options.headers || {})
  };

  try {
    const response = await fetch(url, {
      ...options,
      headers,
      signal: controller.signal
    });

    if (!response.ok) {
      const errCode = response.status === 429 ? 'RATE_LIMIT_EXCEEDED' : `HTTP_${response.status}`;
      setHealth({ available: false, errorCode: errCode });
      return null;
    }

    const data = await response.json();
    if (data && typeof data === 'object' && data.headers && data.headers.status === 'failed') {
      const jamCode = data.headers.code;
      const jamMsg = data.headers.error_message || 'Jamendo API request failed';
      let errorCode = 'PROVIDER_UNAVAILABLE';
      if (jamCode === 5 || /rate limit/i.test(jamMsg)) {
        errorCode = 'RATE_LIMIT_EXCEEDED';
      } else if (jamCode === 4 || /client_id/i.test(jamMsg)) {
        errorCode = 'INVALID_CREDENTIALS';
      } else {
        errorCode = `JAMENDO_ERROR_${jamCode || 'FAILED'}`;
      }
      setHealth({ available: false, errorCode });
      return null;
    }

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
 * Normalize Jamendo track object to AuraList track shape
 */
function normalizeTrack(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;

  const rawId = item.id;
  if (!rawId || (typeof rawId !== 'string' && typeof rawId !== 'number')) {
    return null;
  }
  const trackId = String(rawId).trim();
  if (!trackId || !/^[0-9a-zA-Z_\-]+$/.test(trackId)) return null;

  const title = (typeof item.name === 'string' && item.name.trim())
    ? item.name.trim()
    : 'Untitled Track';

  const artist = (typeof item.artist_name === 'string' && item.artist_name.trim())
    ? item.artist_name.trim()
    : 'Various Artists';

  const album = (typeof item.album_name === 'string' && item.album_name.trim())
    ? item.album_name.trim()
    : 'Single';

  let durationSec = 0;
  if (typeof item.duration === 'number' && Number.isFinite(item.duration) && item.duration >= 0) {
    durationSec = Math.floor(item.duration);
  }

  const coverUrl = formatImageUrl(item.image || item.album_image);

  // Audio URL strictly used for streaming
  const rawAudio = item.audio || item.audio_stream;
  const audioUrl = formatAudioUrl(rawAudio);

  // License and download permission handling: official response field audiodownload_allowed
  const licenseUrl = item.license_ccurl || 'https://creativecommons.org/licenses/by-nc-nd/3.0/';
  const isDownloadAllowed = Boolean(item.audiodownload_allowed);

  const musicinfo = (item.musicinfo && typeof item.musicinfo === 'object') ? item.musicinfo : {};
  const tagsObj = (musicinfo.tags && typeof musicinfo.tags === 'object') ? musicinfo.tags : {};
  const jamendoGenres = Array.isArray(tagsObj.genres) ? tagsObj.genres.map(g => String(g).toLowerCase().trim()) : [];
  const jamendoVartags = Array.isArray(tagsObj.vartags) ? tagsObj.vartags.map(t => String(t).toLowerCase().trim()) : [];
  const rawTags = (typeof item.tags === 'string') ? item.tags.split(',').map(t => t.trim().toLowerCase()) : (Array.isArray(item.tags) ? item.tags : []);
  const allTags = Array.from(new Set([...jamendoGenres, ...jamendoVartags, ...rawTags])).filter(Boolean);

  return {
    id: `jamendo_${trackId}`,
    provider: 'Jamendo',
    providerId: trackId,
    title,
    artist,
    album,
    coverUrl,
    audioUrl,
    duration: durationSec,
    license: licenseUrl,
    source: 'Jamendo',
    downloadAllowed: isDownloadAllowed,
    jamendoId: `jamendo_${trackId}`,
    genres: jamendoGenres,
    tags: allTags
  };
}

/**
 * Search tracks on Jamendo
 */
async function searchTracks(query, { artist, limit = 20, offset = 0, timeoutMs = FETCH_TIMEOUT_MS } = {}) {
  if (!isEnabled()) {
    return [];
  }

  const cleanQuery = (query || '').trim().slice(0, 200);
  const cleanArtist = (artist || '').trim().slice(0, 150);
  if (!cleanQuery && !cleanArtist) return [];

  const clampedLimit = Math.max(1, Math.min(50, Number(limit) || 20));
  const clampedOffset = Math.max(0, Number(offset) || 0);

  const cacheKey = `jamendo_search_${cleanQuery.toLowerCase()}_${cleanArtist.toLowerCase()}_${clampedLimit}_${clampedOffset}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const clientId = getClientId();
  const params = new URLSearchParams({
    client_id: clientId,
    format: 'json',
    limit: String(clampedLimit),
    offset: String(clampedOffset),
    include: 'licenses+musicinfo',
    audioformat: 'mp32'
  });

  if (cleanArtist) {
    params.set('artist_name', cleanArtist);
  }
  if (cleanQuery && cleanQuery.toLowerCase() !== cleanArtist.toLowerCase()) {
    params.set('search', cleanQuery);
  }

  const searchUrl = `${JAMENDO_BASE_URL}/tracks/?${params.toString()}`;

  const fetcher = (module.exports && module.exports.safeFetchJson) || safeFetchJson;
  const data = await fetcher(searchUrl, {}, timeoutMs);

  if (data && typeof data === 'object' && Array.isArray(data.results)) {
    const normalized = data.results
      .map(normalizeTrack)
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
  if (!isEnabled()) return null;
  if (!id || typeof id !== 'string') return null;

  const cleanId = id.replace(/^jamendo_/, '').trim();
  if (!cleanId || !/^[0-9a-zA-Z_\-]+$/.test(cleanId)) return null;

  const cacheKey = `jamendo_track_${cleanId}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const clientId = getClientId();
  const url = `${JAMENDO_BASE_URL}/tracks/?client_id=${encodeURIComponent(clientId)}&format=json&id=${encodeURIComponent(cleanId)}&include=licenses&audioformat=mp32`;

  const fetcher = (module.exports && module.exports.safeFetchJson) || safeFetchJson;
  const data = await fetcher(url, {}, timeoutMs);

  if (data && typeof data === 'object' && Array.isArray(data.results) && data.results.length > 0) {
    const normalized = normalizeTrack(data.results[0]);
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
  isEnabled,
  getHealth,
  setHealth,
  clearCache,
  JAMENDO_BASE_URL
};
