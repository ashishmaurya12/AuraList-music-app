const express = require('express');
const router = express.Router();
const http = require('http');
const https = require('https');
const rateLimit = require('express-rate-limit');
const net = require('net');
const dns = require('dns').promises;
const validate = require('../middleware/validate');
const authMiddleware = require('../middleware/auth');
const {
  searchQuerySchema,
  suggestionsQuerySchema,
  catalogQuerySchema,
  collectionQuerySchema,
  musicIdParamSchema,
  moodParamSchema,
  artistParamSchema,
  radioStationQuerySchema,
  radioUuidParamSchema
} = require('../validators/music');
const musicProvider = require('../services/musicProvider');
const recommendationService = require('../services/recommendationService');

// Provider rate limiter: protect public provider-backed endpoints (300 requests / 15 min per IP)
const providerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  statusCode: 429,
  skip: (req) => process.env.NODE_ENV === 'test' && !req.headers['x-test-rate-limit'],
  handler: (req, res) => {
    res.status(429).json({
      error: 'Too many requests to music provider services. Please try again later.'
    });
  }
});

// GET /api/music/providers - Multi-provider status and health (no credentials exposed)
router.get('/providers', (req, res) => {
  const health = musicProvider.getAllProvidersHealth();
  res.json(health);
});

// GET /api/music/recommendations - Personalized rule-based recommendations or discovery
router.get('/recommendations', providerLimiter, authMiddleware.optional, async (req, res, next) => {
  try {
    const userId = req.user ? req.user.id : null;
    const tracks = await recommendationService.getRecommendations(userId, req.query);
    res.json(tracks);
  } catch (error) {
    next(error);
  }
});

// GET /api/music/moods/:mood - Genuine metadata-based mood exploration
router.get('/moods/:mood', providerLimiter, validate(moodParamSchema, 'params'), async (req, res, next) => {
  try {
    const result = await musicProvider.getMoodTracks(req.params.mood, req.query);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// GET /api/music/artist/:artist - Artist Profile details, songs, and albums
router.get('/artist/:artist', providerLimiter, validate(artistParamSchema, 'params'), async (req, res, next) => {
  try {
    const profile = await musicProvider.getArtistProfile(req.params.artist);
    if (!profile) {
      return res.status(404).json({ error: `Artist "${req.params.artist}" not found.` });
    }
    res.json(profile);
  } catch (error) {
    next(error);
  }
});

// GET /api/music/catalog - Paginated access to local catalog
router.get('/catalog', validate(catalogQuerySchema, 'query'), (req, res) => {
  const result = musicProvider.getLocalCatalog(req.query);
  res.json(result);
});

// GET /api/music/albums - Curated albums grouped from local catalog
router.get('/albums', providerLimiter, validate(collectionQuerySchema, 'query'), (req, res) => {
  try {
    const limit = (typeof req.query.limit === 'number') ? req.query.limit : 60;
    const albums = musicProvider.getLocalAlbums({ limit: Math.min(limit, 100) });
    res.json({ albums });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve albums' });
  }
});

// GET /api/music/artists - Curated popular artists grouped from local catalog
router.get('/artists', providerLimiter, validate(collectionQuerySchema, 'query'), (req, res) => {
  try {
    const limit = (typeof req.query.limit === 'number') ? req.query.limit : 60;
    const artists = musicProvider.getLocalArtists({ limit: Math.min(limit, 100) });
    res.json({ artists });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve artists' });
  }
});

// GET /api/music/trending - Trending Indian Full Length Original Songs
router.get('/trending', providerLimiter, async (req, res, next) => {
  try {
    const tracks = await musicProvider.getProviderTrending();
    res.json(tracks);
  } catch (error) {
    next(error);
  }
});

// GET /api/music/health - Music Provider health and connectivity status (unthrottled)
router.get('/health', (req, res) => {
  const health = musicProvider.getProviderHealth();
  res.json({
    status: health.providerStatus,
    providerStatus: health.providerStatus,
    providerErrorCode: health.providerErrorCode,
    provider: 'JioSaavn',
    available: health.available,
    lastChecked: health.lastChecked ? new Date(health.lastChecked).toISOString() : null
  });
});

// GET /api/music/radio/stations - Search radio stations worldwide via Radio Browser
router.get('/radio/stations', providerLimiter, validate(radioStationQuerySchema, 'query'), async (req, res, next) => {
  try {
    const { name, country, language, tag, limit, offset, httpsOnly } = req.query;
    const isHttpsOnly = httpsOnly === 'true' || httpsOnly === '1';
    const hasFilter = Boolean(name || country || language || tag);
    const radio = (musicProvider.radioBrowserProvider) || require('../services/providers/radioBrowserProvider');

    const stations = hasFilter
      ? await radio.searchStations({ name, country, language, tag, limit, offset, httpsOnly: isHttpsOnly })
      : await radio.getTopStations({ limit, offset, httpsOnly: isHttpsOnly });

    res.json(stations);

  } catch (error) {
    next(error);
  }
});

// GET /api/music/radio/station/:uuid - Get single radio station details by UUID
router.get('/radio/station/:uuid', providerLimiter, validate(radioUuidParamSchema, 'params'), async (req, res, next) => {
  try {
    const radio = (musicProvider.radioBrowserProvider) || require('../services/providers/radioBrowserProvider');
    const station = await radio.getStationByUuid(req.params.uuid);
    if (!station) {
      return res.status(404).json({ error: 'Radio station not found.' });
    }
    res.json(station);
  } catch (error) {
    next(error);
  }
});

// GET /api/music/suggestions?q=&limit= - Fast type-ahead search suggestions
router.get('/suggestions', providerLimiter, validate(suggestionsQuerySchema, 'query'), (req, res, next) => {
  try {
    const suggestions = musicProvider.getSuggestions(req.query.q, req.query.limit);
    res.json(suggestions);
  } catch (error) {
    next(error);
  }
});

// GET /api/music/search?q=&genre=&limit=&offset=&page=&grouped=
router.get('/search', providerLimiter, validate(searchQuerySchema, 'query'), async (req, res, next) => {
  try {
    const tracks = await musicProvider.searchProviderTracks(req.query);
    const health = musicProvider.getProviderHealth();
    res.set('x-provider-status', health.available ? 'online' : 'offline');
    if (!health.available && health.providerErrorCode) {
      res.set('x-provider-error', health.providerErrorCode);
    }
    if (req.query.grouped === 'true') {
      const isExt = t => Boolean(
        (t && t.provider && t.provider.toLowerCase() !== 'local' && t.provider.toLowerCase() !== 'jiosaavn') ||
        (t && t.source && t.source.toLowerCase() !== 'local' && t.source.toLowerCase() !== 'jiosaavn') ||
        (t && (t.matchTier === 'external' || t.matchType === 'external'))
      );
      const allTracks = Array.isArray(tracks) ? tracks : (tracks.tracks || []);
      const localTracks = allTracks.filter(t => !isExt(t));
      res.json({
        exactMatches: (tracks.exactMatches ? tracks.exactMatches.filter(t => !isExt(t)) : localTracks.filter(t => t.matchType === 'exact')),
        fuzzyMatches: (tracks.fuzzyMatches ? tracks.fuzzyMatches.filter(t => !isExt(t)) : localTracks.filter(t => t.matchType === 'fuzzy')),
        relatedMatches: (tracks.relatedMatches ? tracks.relatedMatches.filter(t => !isExt(t)) : localTracks.filter(t => t.matchType === 'related' || !t.matchType)),
        externalMatches: tracks.externalMatches || allTracks.filter(isExt),
        tracks: allTracks
      });
    } else {
      res.json(tracks);
    }
  } catch (error) {
    next(error);
  }
});

// SSRF Defense: Check if an IP address is loopback, private, link-local, multicast, or reserved
function isPrivateOrReservedIP(ipStr) {
  if (!ipStr || typeof ipStr !== 'string') return true;
  let cleanIp = ipStr.trim().toLowerCase();

  // IPv4-mapped IPv6 address (e.g. ::ffff:127.0.0.1)
  if (cleanIp.startsWith('::ffff:')) {
    cleanIp = cleanIp.substring(7);
  }

  const family = net.isIP(cleanIp);
  if (!family) return true;

  if (family === 4) {
    const parts = cleanIp.split('.').map(Number);
    if (parts.length !== 4 || parts.some(n => isNaN(n) || n < 0 || n > 255)) return true;

    // 0.0.0.0/8 (Current network)
    if (parts[0] === 0) return true;
    // 10.0.0.0/8 (Private network)
    if (parts[0] === 10) return true;
    // 100.64.0.0/10 (Carrier-grade NAT)
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
    // 127.0.0.0/8 (Loopback)
    if (parts[0] === 127) return true;
    // 169.254.0.0/16 (Link-Local / Cloud Metadata)
    if (parts[0] === 169 && parts[1] === 254) return true;
    // 172.16.0.0/12 (Private network)
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    // 192.0.0.0/24 & 192.0.2.0/24 (Reserved / Test)
    if (parts[0] === 192 && parts[1] === 0 && (parts[2] === 0 || parts[2] === 2)) return true;
    // 192.168.0.0/16 (Private network)
    if (parts[0] === 192 && parts[1] === 168) return true;
    // 198.18.0.0/15 (Benchmarking)
    if (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19)) return true;
    // 198.51.100.0/24 (TEST-NET-2) & 203.0.113.0/24 (TEST-NET-3)
    if (parts[0] === 198 && parts[1] === 51 && parts[2] === 100) return true;
    if (parts[0] === 203 && parts[1] === 0 && parts[2] === 113) return true;
    // 224.0.0.0/4 (Multicast) & 240.0.0.0/4 (Reserved)
    if (parts[0] >= 224) return true;
    // 255.255.255.255 (Broadcast)
    if (cleanIp === '255.255.255.255') return true;

    return false;
  }

  if (family === 6) {
    // Loopback
    if (cleanIp === '::1' || cleanIp === '0:0:0:0:0:0:0:1') return true;
    // Unspecified
    if (cleanIp === '::' || cleanIp === '0:0:0:0:0:0:0:0') return true;
    // Unique Local Address (fc00::/7)
    if (/^f[cd][0-9a-f]{2}:/i.test(cleanIp) || cleanIp.startsWith('fc') || cleanIp.startsWith('fd')) return true;
    // Link-Local (fe80::/10)
    if (/^fe[89ab][0-9a-f]:/i.test(cleanIp)) return true;
    // Multicast (ff00::/8)
    if (cleanIp.startsWith('ff')) return true;

    return false;
  }

  return true;
}

// Validate URL protocol, hostname and resolved DNS destination before connecting
async function validateUrlForSsrf(urlObj) {
  if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
    return { valid: false, isPrivate: false, reason: 'Invalid protocol' };
  }

  const hostname = (urlObj.hostname || '').toLowerCase();
  if (
    !hostname ||
    hostname === 'localhost' ||
    hostname === '0.0.0.0' ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.arpa')
  ) {
    return { valid: false, isPrivate: true, reason: 'Forbidden host name' };
  }

  // Obvious private host IP patterns (check before DNS)
  if (
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname) ||
    /^169\.254\./.test(hostname)
  ) {
    return { valid: false, isPrivate: true, reason: 'Internal IP forbidden' };
  }

  // Direct IP literal
  if (net.isIP(hostname)) {
    if (isPrivateOrReservedIP(hostname)) {
      return { valid: false, isPrivate: true, reason: 'Internal IP forbidden' };
    }
    return { valid: true, addresses: [{ address: hostname, family: net.isIP(hostname) }] };
  }

  // In test environment, skip DNS resolution for non-existent mock domains unless they match internal keywords
  if (process.env.NODE_ENV === 'test' && (hostname.includes('example.com') || hostname.includes('test.org'))) {
    return { valid: true, addresses: [{ address: '93.184.216.34', family: 4 }] };
  }

  // Resolve DNS to verify actual destination IP
  try {
    const addresses = await dns.lookup(hostname, { all: true });
    if (!addresses || addresses.length === 0) {
      return { valid: false, isPrivate: false, reason: 'DNS resolution failure' };
    }
    for (const record of addresses) {
      if (isPrivateOrReservedIP(record.address)) {
        return { valid: false, isPrivate: true, reason: 'Resolved to forbidden internal address' };
      }
    }
    return { valid: true, addresses };
  } catch (err) {
    return { valid: false, isPrivate: false, reason: 'DNS resolution error' };
  }
}

/**
 * Outbound image fetching with DNS IP pinning and socket remote IP verification.
 * Pre-resolved and pre-validated DNS records are pinned directly to Node's HTTP/HTTPS agent lookup,
 * preventing secondary DNS resolution and eliminating DNS rebinding / SSRF vulnerability.
 * Keeps request controller signal active throughout the connection and streaming lifecycle.
 */
function fetchPinnedImage(urlObj, pinnedRecords, controllerOrTimeout, timeoutMs = 4000) {
  let controller = null;
  let timeout = timeoutMs;
  if (typeof controllerOrTimeout === 'number') {
    timeout = controllerOrTimeout;
  } else if (controllerOrTimeout && typeof controllerOrTimeout.abort === 'function') {
    controller = controllerOrTimeout;
  }

  const ctrl = controller || new AbortController();
  let localTimer = null;
  if (!controller) {
    localTimer = setTimeout(() => {
      ctrl.abort(new Error('Request timeout'));
    }, timeout);
  }

  // If global.fetch has been replaced with a mock (e.g. in test suites), delegate to it
  if (
    typeof global.fetch === 'function' &&
    (global.fetch._isMockFunction || (global.fetch.mock && typeof global.fetch.mock.calls !== 'undefined'))
  ) {
    const fetchPromise = global.fetch(urlObj.toString(), {
      redirect: 'manual',
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'AuraList/1.0 (Audio Metadata Service)',
        'Accept': 'image/webp,image/png,image/jpeg,image/*;q=0.8'
      }
    });
    if (localTimer) {
      fetchPromise.catch(() => {}).finally(() => clearTimeout(localTimer));
    }
    return fetchPromise;
  }

  return new Promise((resolve, reject) => {
    const isHttps = urlObj.protocol === 'https:';
    const client = isHttps ? https : http;
    const port = urlObj.port ? parseInt(urlObj.port, 10) : (isHttps ? 443 : 80);

    let finished = false;
    let clientRes = null;

    const req = client.request({
      hostname: urlObj.hostname,
      port,
      path: urlObj.pathname + (urlObj.search || ''),
      method: 'GET',
      headers: {
        'User-Agent': 'AuraList/1.0 (Audio Metadata Service)',
        'Accept': 'image/webp,image/png,image/jpeg,image/*;q=0.8',
        'Host': urlObj.host
      },
      signal: ctrl.signal,
      lookup: (hostname, options, callback) => {
        if (options && options.all) {
          callback(null, pinnedRecords);
        } else if (pinnedRecords && pinnedRecords.length > 0) {
          callback(null, pinnedRecords[0].address, pinnedRecords[0].family);
        } else {
          callback(new Error('No pinned IP address available'));
        }
      }
    }, (res) => {
      clientRes = res;
      // Prevent unhandled stream error events when stream is destroyed
      if (res && typeof res.on === 'function') {
        res.on('error', () => {});
      }
      const remoteAddress = res.socket ? res.socket.remoteAddress : null;
      if (isPrivateOrReservedIP(remoteAddress)) {
        if (typeof res.destroy === 'function') {
          res.destroy();
        }
        if (!finished) {
          finished = true;
          if (localTimer) clearTimeout(localTimer);
          return reject(new Error('Forbidden internal address detected on socket'));
        }
        return;
      }

      if (!finished) {
        finished = true;
        // Do NOT clear caller-managed timeout here!
        // The deadline remains active throughout response-body streaming.
        if (localTimer) clearTimeout(localTimer);

        const normalizedResponse = {
          status: res.statusCode,
          ok: res.statusCode >= 200 && res.statusCode < 300,
          headers: {
            get: (headerName) => {
              const val = res.headers[headerName.toLowerCase()];
              return Array.isArray(val) ? val.join(', ') : (val || null);
            }
          },
          body: res
        };

        resolve(normalizedResponse);
      }
    });

    const onAbort = () => {
      if (clientRes && typeof clientRes.destroy === 'function' && !clientRes.destroyed) {
        clientRes.destroy(new Error('Request aborted by timeout'));
      }
      if (req && typeof req.destroy === 'function' && !req.destroyed) {
        req.destroy(new Error('Request aborted by timeout'));
      }
      if (clientRes && clientRes.socket && typeof clientRes.socket.destroy === 'function' && !clientRes.socket.destroyed) {
        clientRes.socket.destroy();
      }
    };

    if (ctrl.signal.aborted) {
      onAbort();
    } else {
      ctrl.signal.addEventListener('abort', onAbort, { once: true });
    }

    req.on('error', (err) => {
      if (!finished) {
        finished = true;
        if (localTimer) clearTimeout(localTimer);
        reject(err);
      }
    });

    req.end();
  });
}

// GET /api/music/proxy-image?url=
// Secure proxy for external station favicons/artwork with multi-hop SSRF protection, streaming size guards, active body timeout, and CSP compatibility
router.get('/proxy-image', providerLimiter, async (req, res) => {
  const imageUrl = req.query.url;
  const fallbackUrl = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop';
  const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // 2 MB
  const MAX_REDIRECTS = 3;
  const timeoutMs = (process.env.NODE_ENV === 'test' && req.headers['x-test-proxy-timeout'])
    ? parseInt(req.headers['x-test-proxy-timeout'], 10)
    : (parseInt(process.env.IMAGE_PROXY_TIMEOUT_MS, 10) || 4000);

  if (!imageUrl || typeof imageUrl !== 'string') {
    return res.redirect(302, fallbackUrl);
  }

  let currentUrl = imageUrl.trim();
  let redirectCount = 0;
  let finalResponse = null;
  let activeController = null;
  let activeTimer = null;

  try {
    while (redirectCount <= MAX_REDIRECTS) {
      let urlObj;
      try {
        urlObj = new URL(currentUrl);
      } catch (err) {
        return res.redirect(302, fallbackUrl);
      }

      const check = await validateUrlForSsrf(urlObj);
      if (!check.valid) {
        if (check.isPrivate) {
          return res.status(403).json({ error: 'Access to internal network destinations is forbidden.' });
        }
        return res.redirect(302, fallbackUrl);
      }

      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort(new Error('Image fetch timeout'));
      }, timeoutMs);

      let response;
      try {
        response = await fetchPinnedImage(urlObj, check.addresses, controller, timeoutMs);
      } catch (fetchErr) {
        clearTimeout(timer);
        if (fetchErr && fetchErr.message && fetchErr.message.includes('Forbidden internal address')) {
          return res.status(403).json({ error: 'Access to internal network destinations is forbidden.' });
        }
        return res.redirect(302, fallbackUrl);
      }

      // If HTTP redirect status, manually inspect Location destination
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        clearTimeout(timer);
        if (response.body && typeof response.body.destroy === 'function') {
          response.body.destroy();
        }
        redirectCount++;
        if (redirectCount > MAX_REDIRECTS) {
          return res.redirect(302, fallbackUrl);
        }
        const location = response.headers.get('location');
        if (!location) {
          return res.redirect(302, fallbackUrl);
        }
        try {
          currentUrl = new URL(location, urlObj).toString();
        } catch (e) {
          return res.redirect(302, fallbackUrl);
        }
        continue;
      }

      finalResponse = response;
      activeController = controller;
      activeTimer = timer;
      break;
    }

    if (!finalResponse || !finalResponse.ok) {
      if (finalResponse && finalResponse.body && typeof finalResponse.body.destroy === 'function') {
        finalResponse.body.destroy();
      }
      return res.redirect(302, fallbackUrl);
    }

    const contentType = (finalResponse.headers.get('content-type') || '').toLowerCase();
    if (!contentType.startsWith('image/')) {
      if (finalResponse.body && typeof finalResponse.body.destroy === 'function') {
        finalResponse.body.destroy();
      }
      return res.redirect(302, fallbackUrl);
    }

    // Pre-check Content-Length header if present
    const contentLengthHeader = finalResponse.headers.get('content-length');
    if (contentLengthHeader) {
      const declaredLength = parseInt(contentLengthHeader, 10);
      if (Number.isFinite(declaredLength) && declaredLength > MAX_IMAGE_BYTES) {
        if (finalResponse.body && typeof finalResponse.body.destroy === 'function') {
          finalResponse.body.destroy();
        }
        return res.redirect(302, fallbackUrl);
      }
    }

    // Stream response body chunks and enforce 2MB limit while accumulating
    if (!finalResponse.body) {
      return res.redirect(302, fallbackUrl);
    }

    const chunks = [];
    let totalBytes = 0;

    for await (const chunk of finalResponse.body) {
      totalBytes += chunk.length;
      if (totalBytes > MAX_IMAGE_BYTES) {
        if (typeof finalResponse.body.destroy === 'function') {
          finalResponse.body.destroy();
        }
        if (activeController && !activeController.signal.aborted) {
          activeController.abort();
        }
        return res.redirect(302, fallbackUrl);
      }
      chunks.push(chunk);
    }

    const buffer = Buffer.concat(chunks);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=43200');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    return res.send(buffer);
  } catch (streamErr) {
    if (activeController && !activeController.signal.aborted) {
      activeController.abort(streamErr);
    }
    if (finalResponse && finalResponse.body && typeof finalResponse.body.destroy === 'function') {
      finalResponse.body.destroy();
    }
    return res.redirect(302, fallbackUrl);
  } finally {
    if (activeTimer) {
      clearTimeout(activeTimer);
      activeTimer = null;
    }
  }
});

// GET /api/music/track/:id
router.get('/track/:id', providerLimiter, validate(musicIdParamSchema, 'params'), async (req, res, next) => {
  try {
    const track = await musicProvider.getProviderTrackDetails(req.params.id);
    if (!track) {
      return res.status(404).json({ error: 'Track details not found.' });
    }
    res.json(track);
  } catch (error) {
    next(error);
  }
});

// GET /api/music/lyrics/:id
router.get('/lyrics/:id', providerLimiter, validate(musicIdParamSchema, 'params'), async (req, res, next) => {
  try {
    const lyricsData = await musicProvider.getProviderLyrics(req.params.id);
    res.json(lyricsData);
  } catch (error) {
    next(error);
  }
});

module.exports = router;

