/**
 * backend/services/providers/radioBrowserProvider.js
 *
 * Radio Browser Provider Adapter
 * Rotates official API mirrors as recommended by Radio Browser documentation.
 * Uses descriptive User-Agent.
 * Stores station UUID (not unstable numeric IDs).
 * Formats stations as live streams within the AuraList track shape.
 * Never downloads or saves audio files locally; only formats stream URLs.
 */

const { formatRadioStreamUrl, formatImageUrl } = require('../urlHelper');

const OFFICIAL_MIRRORS = [
  'https://de1.api.radio-browser.info',
  'https://nl1.api.radio-browser.info',
  'https://at1.api.radio-browser.info'
];


const USER_AGENT = 'AuraList-MusicApp/1.0 (https://github.com/ashishmaurya12/AuraList-music-app)';
const FETCH_TIMEOUT_MS = 5000;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
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

let activeMirrorIndex = 0;

function getMirror() {
  return OFFICIAL_MIRRORS[activeMirrorIndex % OFFICIAL_MIRRORS.length];
}

function rotateMirror() {
  activeMirrorIndex = (activeMirrorIndex + 1) % OFFICIAL_MIRRORS.length;
  return getMirror();
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
 * Safe fetch with AbortController timeout & automatic mirror rotation on network failure
 */
async function safeFetchJson(pathAndQuery, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const attempts = OFFICIAL_MIRRORS.length;
  let lastError = null;

  for (let i = 0; i < attempts; i++) {
    const mirror = getMirror();
    const url = `${mirror}${pathAndQuery}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'application/json',
          ...(options.headers || {})
        },
        signal: controller.signal
      });

      if (!response.ok) {
        rotateMirror();
        continue;
      }

      const data = await response.json();
      setHealth({ available: true });
      return data;
    } catch (err) {
      lastError = err;
      rotateMirror();
    } finally {
      clearTimeout(timeoutId);
    }
  }

  const isTimeout = lastError && (lastError.name === 'AbortError');
  setHealth({
    available: false,
    errorCode: isTimeout ? 'PROVIDER_TIMEOUT' : 'PROVIDER_UNAVAILABLE'
  });
  return null;
}

/**
 * Normalize Radio Browser station to AuraList track shape
 */
function normalizeStation(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;

  // Radio Browser stations must have a stationuuid
  const uuid = item.stationuuid;
  if (!uuid || typeof uuid !== 'string' || !uuid.trim()) {
    return null;
  }
  const stationUuid = uuid.trim();

  const name = (typeof item.name === 'string' && item.name.trim())
    ? item.name.trim()
    : 'Live Radio Station';

  const country = (typeof item.country === 'string' && item.country.trim()) ? item.country.trim() : '';
  const language = (typeof item.language === 'string' && item.language.trim()) ? item.language.trim() : '';
  const tags = (typeof item.tags === 'string' && item.tags.trim()) ? item.tags.trim() : '';

  const artistLabel = country
    ? `${country}${language ? ' · ' + language : ''}`
    : (language || 'Live Radio');

  const albumLabel = tags
    ? tags.split(',').slice(0, 3).map(t => t.trim()).filter(Boolean).join(', ')
    : 'Live Broadcast';

  // Station stream URL: preserve actual http:// or https:// without string-replacement rewriting
  const rawStream = item.url_resolved || item.url;
  const audioUrl = formatRadioStreamUrl(rawStream);

  const isHttps = audioUrl.startsWith('https://');
  const isHttpOnly = audioUrl.startsWith('http://');
  const isProduction = process.env.NODE_ENV === 'production';
  const isUnavailable = isProduction && isHttpOnly;

  const fallbackRadioCover = 'https://images.unsplash.com/photo-1598488035139-bdbb2231ce04?w=600&auto=format&fit=crop';
  let coverUrl = fallbackRadioCover;
  if (item.favicon && typeof item.favicon === 'string' && item.favicon.trim().startsWith('http')) {
    const rawFav = item.favicon.trim();
    try {
      const parsedFav = new URL(rawFav);
      const host = (parsedFav.hostname || '').toLowerCase();
      const isAllowedDirectly =
        host.endsWith('.radio-browser.info') ||
        host.endsWith('.radioline.co') ||
        host === 'images.unsplash.com' ||
        host.endsWith('.saavncdn.com') ||
        host.endsWith('.audius.co') ||
        host.endsWith('.jamendo.com');

      if (isAllowedDirectly && parsedFav.protocol === 'https:') {
        coverUrl = rawFav;
      } else {
        // Route through same-origin image proxy to guarantee CSP compliance and eliminate mixed content
        coverUrl = `/api/music/proxy-image?url=${encodeURIComponent(rawFav)}`;
      }
    } catch (e) {
      coverUrl = fallbackRadioCover;
    }
  }

  return {
    id: `radio_${stationUuid}`,
    provider: 'RadioBrowser',
    providerId: stationUuid,
    title: name,
    artist: artistLabel,
    album: albumLabel,
    coverUrl,
    audioUrl,
    duration: 0, // Live stream indicator
    license: 'Public Radio Broadcast',
    source: 'Radio Browser',
    isLiveRadio: true,
    isHttps,
    isHttpOnly,
    isUnavailable,
    unavailableReason: isUnavailable ? 'HTTP stream unavailable in production HTTPS mode' : null,
    country,
    language,
    tags,
    homepage: (typeof item.homepage === 'string') ? item.homepage.trim() : '',
    votes: typeof item.votes === 'number' ? item.votes : 0,
    codec: (typeof item.codec === 'string') ? item.codec.trim() : '',
    bitrate: typeof item.bitrate === 'number' ? item.bitrate : 0,
    jamendoId: `radio_${stationUuid}`
  };
}

/**
 * Search radio stations by name, country, language, tag
 */
async function searchStations({ name = '', country = '', language = '', tag = '', limit = 30, offset = 0, httpsOnly = false, timeoutMs = FETCH_TIMEOUT_MS } = {}) {
  const cleanName = (name || '').trim().slice(0, 100);
  const cleanCountry = (country || '').trim().slice(0, 100);
  const cleanLanguage = (language || '').trim().slice(0, 100);
  const cleanTag = (tag || '').trim().slice(0, 100);
  const clampedLimit = Math.max(1, Math.min(100, Number(limit) || 30));
  const clampedOffset = Math.max(0, Number(offset) || 0);

  const cacheKey = `radio_search_${cleanName}_${cleanCountry}_${cleanLanguage}_${cleanTag}_${clampedLimit}_${clampedOffset}_${Boolean(httpsOnly)}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const params = new URLSearchParams();
  if (cleanName) params.set('name', cleanName);
  if (cleanCountry) params.set('country', cleanCountry);
  if (cleanLanguage) params.set('language', cleanLanguage);
  if (cleanTag) params.set('tag', cleanTag);
  params.set('limit', String(clampedLimit));
  params.set('offset', String(clampedOffset));
  params.set('order', 'votes');
  params.set('reverse', 'true');
  params.set('hidebroken', 'true');

  const pathAndQuery = `/json/stations/search?${params.toString()}`;
  const fetcher = (module.exports && module.exports.safeFetchJson) || safeFetchJson;
  const data = await fetcher(pathAndQuery, {}, timeoutMs);

  if (Array.isArray(data)) {
    let normalized = data
      .map(normalizeStation)
      .filter(s => s !== null && Boolean(s.audioUrl));

    if (httpsOnly) {
      normalized = normalized.filter(s => s.isHttps);
    }

    setCache(cacheKey, normalized);
    return normalized;
  }

  return [];
}

/**
 * Get top voted radio stations
 */
async function getTopStations({ limit = 30, offset = 0, httpsOnly = false, timeoutMs = FETCH_TIMEOUT_MS } = {}) {
  const clampedLimit = Math.max(1, Math.min(100, Number(limit) || 30));
  const clampedOffset = Math.max(0, Number(offset) || 0);

  const cacheKey = `radio_top_${clampedLimit}_${clampedOffset}_${Boolean(httpsOnly)}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const pathAndQuery = `/json/stations/topvote/${clampedLimit}?offset=${clampedOffset}&hidebroken=true`;
  const fetcher = (module.exports && module.exports.safeFetchJson) || safeFetchJson;
  const data = await fetcher(pathAndQuery, {}, timeoutMs);

  if (Array.isArray(data)) {
    let normalized = data
      .map(normalizeStation)
      .filter(s => s !== null && Boolean(s.audioUrl));

    if (httpsOnly) {
      normalized = normalized.filter(s => s.isHttps);
    }

    setCache(cacheKey, normalized);
    return normalized;
  }

  return [];
}

/**
 * Get station details by station UUID
 */
async function getStationByUuid(uuid, { timeoutMs = FETCH_TIMEOUT_MS } = {}) {
  if (!uuid || typeof uuid !== 'string') return null;
  const cleanUuid = uuid.replace(/^radio_/, '').trim();
  const RADIO_UUID_REGEX = /^[0-9a-zA-Z_\-]{1,64}$/;
  if (!cleanUuid || !RADIO_UUID_REGEX.test(cleanUuid)) return null;

  const cacheKey = `radio_uuid_${cleanUuid}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const pathAndQuery = `/json/stations/byuuid/${encodeURIComponent(cleanUuid)}`;
  const fetcher = (module.exports && module.exports.safeFetchJson) || safeFetchJson;
  const data = await fetcher(pathAndQuery, {}, timeoutMs);

  if (Array.isArray(data) && data.length > 0) {
    const normalized = normalizeStation(data[0]);
    if (normalized) {
      setCache(cacheKey, normalized);
      return normalized;
    }
  }

  return null;
}

module.exports = {
  searchStations,
  getTopStations,
  getStationByUuid,
  normalizeStation,
  safeFetchJson,
  getHealth,
  setHealth,
  getMirror,
  rotateMirror,
  clearCache,
  OFFICIAL_MIRRORS,
  USER_AGENT
};
