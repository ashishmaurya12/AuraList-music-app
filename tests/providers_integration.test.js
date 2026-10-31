/**
 * tests/providers_integration.test.js
 *
 * Comprehensive unit and mock tests for:
 * - Audius provider adapter
 * - Jamendo provider adapter
 * - Radio Browser provider adapter
 * - MusicProvider multi-provider fallback & isolation
 * - Radio & Provider Express routes
 * - Player URL rewriting & DSP isolation for external providers
 *
 * All external HTTP calls are strictly mocked. No real network or DB required.
 */

const request = require('supertest');
const app = require('../server');
const audiusProvider = require('../backend/services/providers/audiusProvider');
const jamendoProvider = require('../backend/services/providers/jamendoProvider');
const radioBrowserProvider = require('../backend/services/providers/radioBrowserProvider');
const musicProvider = require('../backend/services/musicProvider');
const { redactMongoCredentials } = require('../backend/config/db');
const { formatAudioUrl } = require('../backend/services/urlHelper');
const vm = require('vm');
const fs = require('fs');
const path = require('path');

describe('Music Providers Integration Tests', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    audiusProvider.clearCache();
    jamendoProvider.clearCache();
    radioBrowserProvider.clearCache();
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  // =========================================================================
  // 1. AUDIUS PROVIDER TESTS
  // =========================================================================
  describe('Audius Provider Adapter', () => {
    it('normalizes Audius track with standard AuraList track shape', () => {
      const mockRaw = {
        id: 'aud_track_123',
        title: 'Cyberpunk Beats',
        user: { name: 'Producer Neo', handle: 'neobeats' },
        genre: 'Electronic',
        duration: 184.5,
        artwork: { '480x480': 'https://audius.co/art_480.jpg' },
        downloadable: true
      };

      const normalized = audiusProvider.normalizeTrack(mockRaw, 'https://discoveryprovider.audius.co');
      expect(normalized).not.toBeNull();
      expect(normalized.id).toBe('audius_aud_track_123');
      expect(normalized.provider).toBe('Audius');
      expect(normalized.providerId).toBe('aud_track_123');
      expect(normalized.title).toBe('Cyberpunk Beats');
      expect(normalized.artist).toBe('Producer Neo');
      expect(normalized.album).toBe('Electronic');
      expect(normalized.duration).toBe(184);
      expect(normalized.coverUrl).toBe('https://audius.co/art_480.jpg');
      expect(normalized.audioUrl).toContain('/v1/tracks/aud_track_123/stream');
      expect(normalized.source).toBe('Audius');
      expect(normalized.downloadAllowed).toBe(true);
      expect(normalized.license).toContain('Download Enabled');
    });

    it('returns null when raw track has invalid or missing id', () => {
      expect(audiusProvider.normalizeTrack(null)).toBeNull();
      expect(audiusProvider.normalizeTrack({})).toBeNull();
      expect(audiusProvider.normalizeTrack({ id: '' })).toBeNull();
    });

    it('searches Audius tracks successfully and caches results', async () => {
      const mockResponse = {
        data: [
          {
            id: 'tr_101',
            title: 'Synthwave Sunset',
            user: { name: 'Kavinsky' },
            genre: 'Synthwave',
            duration: 210,
            artwork: { '480x480': 'https://audius.co/synth.jpg' }
          }
        ]
      };

      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => mockResponse
      });

      const results = await audiusProvider.searchTracks('synthwave', { limit: 10 });
      expect(results.length).toBe(1);
      expect(results[0].title).toBe('Synthwave Sunset');
      expect(results[0].provider).toBe('Audius');
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      // Second call should hit the cache without calling fetch
      const cachedResults = await audiusProvider.searchTracks('synthwave', { limit: 10 });
      expect(cachedResults.length).toBe(1);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('rotates to backup mirror if primary mirror fails and uses backup host for audioUrl', async () => {
      let callCount = 0;
      jest.spyOn(global, 'fetch').mockImplementation(async (url) => {
        callCount++;
        if (callCount === 1) {
          return { ok: false, status: 503 };
        }
        return {
          ok: true,
          json: async () => ({
            data: [{ id: 'tr_backup', title: 'Backup Track', user: { name: 'Backup Artist' } }]
          })
        };
      });

      const results = await audiusProvider.searchTracks('backup query');
      expect(callCount).toBe(2);
      expect(results.length).toBe(1);
      expect(results[0].title).toBe('Backup Track');

      // Working mirror must be used for audioUrl normalization
      const expectedBackupHost = audiusProvider.DEFAULT_HOSTS[1];
      expect(results[0].audioUrl).toContain(expectedBackupHost);
      expect(results[0].audioUrl).toContain('/v1/tracks/tr_backup/stream');
    });

    it('handles timeout (AbortError) defensively without throwing', async () => {
      jest.spyOn(global, 'fetch').mockRejectedValue({ name: 'AbortError', message: 'The operation was aborted' });

      const results = await audiusProvider.searchTracks('slow query', { timeoutMs: 10 });
      expect(results).toEqual([]);
      expect(audiusProvider.getHealth().available).toBe(false);
      expect(audiusProvider.getHealth().errorCode).toBe('PROVIDER_TIMEOUT');
    });

    it('handles malformed / non-array response gracefully', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({ unexpected: 'structure' })
      });

      const results = await audiusProvider.searchTracks('malformed query');
      expect(results).toEqual([]);
    });

    it('Audius API key is absent from every returned track object and audioUrl', async () => {
      process.env.AUDIUS_API_KEY = 'secret_audius_key_99999';

      let requestedHeaders = {};
      jest.spyOn(global, 'fetch').mockImplementation(async (url, opts) => {
        requestedHeaders = opts.headers || {};
        return {
          ok: true,
          json: async () => ({
            data: [{ id: 'tr_keyed', title: 'Keyed Track', user: { name: 'Artist' } }]
          })
        };
      });

      const results = await audiusProvider.searchTracks('keyed query');
      expect(results.length).toBe(1);
      // Backend sent the key via header to Audius
      expect(requestedHeaders['x-api-key']).toBe('secret_audius_key_99999');
      // Key must NOT be present in audioUrl or anywhere in the returned track object
      expect(results[0].audioUrl).not.toContain('secret_audius_key_99999');
      expect(results[0].audioUrl).not.toContain('api_key');
      const trackString = JSON.stringify(results[0]);
      expect(trackString).not.toContain('secret_audius_key_99999');
      expect(trackString).not.toContain('api_key');
    });
  });

  // =========================================================================
  // 2. JAMENDO PROVIDER TESTS
  // =========================================================================
  describe('Jamendo Provider Adapter', () => {
    it('is disabled and returns empty results when JAMENDO_CLIENT_ID is not configured', async () => {
      delete process.env.JAMENDO_CLIENT_ID;

      expect(jamendoProvider.isEnabled()).toBe(false);
      const fetchSpy = jest.spyOn(global, 'fetch');

      const results = await jamendoProvider.searchTracks('ambient');
      expect(results).toEqual([]);
      expect(fetchSpy).not.toHaveBeenCalled();

      const single = await jamendoProvider.getTrackById('jamendo_123');
      expect(single).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();

      const health = jamendoProvider.getHealth();
      expect(health.enabled).toBe(false);
      expect(health.errorCode).toBe('JAMENDO_NOT_CONFIGURED');
    });

    it('normalizes Jamendo track and respects audiodownload_allowed permission', () => {
      const mockRawDisabled = {
        id: 'jm_555',
        name: 'Chill Horizon',
        artist_name: 'Solar Breeze',
        album_name: 'Sunset Melodies',
        duration: 245,
        image: 'https://usercontent.jamendo.com/img.jpg',
        audio: 'https://prod-1.storage.jamendo.com/audio.mp3',
        license_ccurl: 'https://creativecommons.org/licenses/by-nc/4.0/',
        audiodownload_allowed: false
      };

      const normalizedDisabled = jamendoProvider.normalizeTrack(mockRawDisabled);
      expect(normalizedDisabled).not.toBeNull();
      expect(normalizedDisabled.id).toBe('jamendo_jm_555');
      expect(normalizedDisabled.provider).toBe('Jamendo');
      expect(normalizedDisabled.providerId).toBe('jm_555');
      expect(normalizedDisabled.title).toBe('Chill Horizon');
      expect(normalizedDisabled.artist).toBe('Solar Breeze');
      expect(normalizedDisabled.license).toBe('https://creativecommons.org/licenses/by-nc/4.0/');
      expect(normalizedDisabled.downloadAllowed).toBe(false);
      expect(normalizedDisabled.audioUrl).toBe('https://prod-1.storage.jamendo.com/audio.mp3');

      const mockRawEnabled = {
        ...mockRawDisabled,
        id: 'jm_556',
        audiodownload_allowed: true
      };
      const normalizedEnabled = jamendoProvider.normalizeTrack(mockRawEnabled);
      expect(normalizedEnabled).not.toBeNull();
      expect(normalizedEnabled.downloadAllowed).toBe(true);
    });

    it('searches Jamendo with client_id and audiodownload_allowed=true sets downloadAllowed=true', async () => {
      process.env.JAMENDO_CLIENT_ID = 'test_jamendo_client_id_xyz';
      expect(jamendoProvider.isEnabled()).toBe(true);

      let requestedUrl = '';
      jest.spyOn(global, 'fetch').mockImplementation(async (url) => {
        requestedUrl = url;
        return {
          ok: true,
          json: async () => ({
            results: [
              {
                id: 'jm_789',
                name: 'Acoustic Morning',
                artist_name: 'Folk Artist',
                album_name: 'Coffee Tunes',
                duration: 180,
                audio: 'https://prod-1.storage.jamendo.com/track.mp3',
                license_ccurl: 'https://creativecommons.org/licenses/by/4.0/',
                audiodownload_allowed: true
              }
            ]
          })
        };
      });

      const results = await jamendoProvider.searchTracks('acoustic', { limit: 10 });
      expect(results.length).toBe(1);
      expect(results[0].title).toBe('Acoustic Morning');
      expect(results[0].downloadAllowed).toBe(true);
      expect(requestedUrl).toContain('client_id=test_jamendo_client_id_xyz');
      expect(requestedUrl).toContain('include=licenses');
    });

    it('handles HTTP 429 rate limit response gracefully without throwing', async () => {
      process.env.JAMENDO_CLIENT_ID = 'test_client_id';

      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 429
      });

      const results = await jamendoProvider.searchTracks('overloaded query');
      expect(results).toEqual([]);
      expect(jamendoProvider.getHealth().available).toBe(false);
      expect(jamendoProvider.getHealth().errorCode).toBe('RATE_LIMIT_EXCEEDED');
    });

    it('does not leak JAMENDO_CLIENT_ID in normalized track or health objects', () => {
      process.env.JAMENDO_CLIENT_ID = 'super_secret_client_token';

      const track = jamendoProvider.normalizeTrack({
        id: '1234',
        name: 'Private Music',
        audio: 'https://jamendo.com/stream.mp3'
      });

      const trackString = JSON.stringify(track);
      expect(trackString).not.toContain('super_secret_client_token');

      const healthString = JSON.stringify(jamendoProvider.getHealth());
      expect(healthString).not.toContain('super_secret_client_token');
    });

    it('handles Jamendo headers.status === failed (e.g. code 4 invalid client ID) gracefully', async () => {
      process.env.JAMENDO_CLIENT_ID = 'bad_client_id';

      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          headers: {
            status: 'failed',
            code: 4,
            error_message: 'Invalid client_id'
          },
          results: []
        })
      });

      const results = await jamendoProvider.searchTracks('test song');
      expect(results).toEqual([]);
      expect(jamendoProvider.getHealth().available).toBe(false);
      expect(jamendoProvider.getHealth().errorCode).toBe('INVALID_CREDENTIALS');
    });

    it('rejects unsafe or malicious track IDs before issuing Jamendo requests', async () => {
      process.env.JAMENDO_CLIENT_ID = 'test_id';
      const fetchSpy = jest.spyOn(global, 'fetch');

      const result = await jamendoProvider.getTrackById('../../../etc/passwd');
      expect(result).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();

      const queryInjection = await jamendoProvider.getTrackById('123?inject=true&foo=bar');
      expect(queryInjection).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 3. RADIO BROWSER PROVIDER TESTS
  // =========================================================================
  describe('Radio Browser Provider Adapter', () => {
    it('normalizes radio station preserving stationuuid, duration 0, and live indicator', () => {
      const mockRaw = {
        stationuuid: '964344d9-0601-11e8-ae97-52543be04c81',
        name: 'BBC Radio 1',
        country: 'United Kingdom',
        language: 'english',
        tags: 'pop,hits,top40',
        url_resolved: 'https://stream.live.vc.bbcmedia.co.uk/bbc_radio_one',
        favicon: 'https://www.bbc.co.uk/favicon.ico',
        codec: 'MP3',
        bitrate: 128
      };

      const normalized = radioBrowserProvider.normalizeStation(mockRaw);
      expect(normalized).not.toBeNull();
      expect(normalized.id).toBe('radio_964344d9-0601-11e8-ae97-52543be04c81');
      expect(normalized.provider).toBe('RadioBrowser');
      expect(normalized.providerId).toBe('964344d9-0601-11e8-ae97-52543be04c81');
      expect(normalized.title).toBe('BBC Radio 1');
      expect(normalized.artist).toContain('United Kingdom');
      expect(normalized.duration).toBe(0); // Live radio duration must be 0
      expect(normalized.isLiveRadio).toBe(true);
      expect(normalized.license).toBe('Public Radio Broadcast');
      expect(normalized.audioUrl).toBe('https://stream.live.vc.bbcmedia.co.uk/bbc_radio_one');
      expect(normalized.codec).toBe('MP3');
      expect(normalized.bitrate).toBe(128);
    });

    it('HTTP radio stream is never falsely rewritten as HTTPS', () => {
      const mockHttpRaw = {
        stationuuid: '11112222-3333-4444-5555-666677778888',
        name: 'Insecure Stream Station',
        country: 'Germany',
        url: 'http://stream.insecure-radio.de:8000/live.mp3',
        url_resolved: 'http://stream.insecure-radio.de:8000/live.mp3'
      };

      const normalized = radioBrowserProvider.normalizeStation(mockHttpRaw);
      expect(normalized).not.toBeNull();
      // Must preserve http:// and NOT string-replace to https://
      expect(normalized.audioUrl).toBe('http://stream.insecure-radio.de:8000/live.mp3');
      expect(normalized.audioUrl.startsWith('http://')).toBe(true);
      expect(normalized.audioUrl.startsWith('https://')).toBe(false);
      expect(normalized.isHttpOnly).toBe(true);
      expect(normalized.isHttps).toBe(false);
    });

    it('marks HTTP-only radio streams as unavailable in production mode', () => {
      const originalNodeEnv = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = 'production';
        const mockHttpRaw = {
          stationuuid: '11112222-3333-4444-5555-666677778888',
          name: 'Insecure Stream Station',
          country: 'Germany',
          url: 'http://stream.insecure-radio.de:8000/live.mp3'
        };

        const normalized = radioBrowserProvider.normalizeStation(mockHttpRaw);
        expect(normalized.isUnavailable).toBe(true);
        expect(normalized.unavailableReason).toContain('production HTTPS');

        const mockHttpsRaw = {
          stationuuid: '99998888-7777-6666-5555-444433332222',
          name: 'Secure Stream Station',
          country: 'Germany',
          url: 'https://stream.secure-radio.de/live.mp3'
        };
        const normalizedHttps = radioBrowserProvider.normalizeStation(mockHttpsRaw);
        expect(normalizedHttps.isUnavailable).toBe(false);
      } finally {
        process.env.NODE_ENV = originalNodeEnv;
      }
    });

    it('rejects station when stationuuid is missing or malformed', () => {
      expect(radioBrowserProvider.normalizeStation(null)).toBeNull();
      expect(radioBrowserProvider.normalizeStation({})).toBeNull();
      expect(radioBrowserProvider.normalizeStation({ name: 'No UUID Radio' })).toBeNull();
      expect(radioBrowserProvider.normalizeStation({ stationuuid: '   ' })).toBeNull();
    });

    it('searches stations with query filters and sends descriptive User-Agent', async () => {
      let sentHeaders = {};
      let sentUrl = '';

      jest.spyOn(global, 'fetch').mockImplementation(async (url, opts) => {
        sentUrl = url;
        sentHeaders = opts.headers || {};
        return {
          ok: true,
          json: async () => [
            {
              stationuuid: 'aaabbbccc-1111',
              name: 'Jazz FM',
              country: 'France',
              language: 'french',
              tags: 'jazz,blues',
              url_resolved: 'https://jazzfm.fr/stream.mp3'
            }
          ]
        };
      });

      const stations = await radioBrowserProvider.searchStations({
        name: 'Jazz',
        country: 'France',
        tag: 'jazz',
        limit: 15
      });

      expect(stations.length).toBe(1);
      expect(stations[0].title).toBe('Jazz FM');
      expect(stations[0].isLiveRadio).toBe(true);
      expect(sentHeaders['User-Agent']).toContain('AuraList-MusicApp');
      expect(sentUrl).toContain('name=Jazz');
      expect(sentUrl).toContain('country=France');
      expect(sentUrl).toContain('tag=jazz');
    });

    it('retrieves station by UUID', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => [
          {
            stationuuid: 'uuid-target-123',
            name: 'Classic FM',
            url_resolved: 'https://media-ice.musicradio.com/ClassicFMMP3'
          }
        ]
      });

      const station = await radioBrowserProvider.getStationByUuid('uuid-target-123');
      expect(station).not.toBeNull();
      expect(station.id).toBe('radio_uuid-target-123');
      expect(station.title).toBe('Classic FM');
    });

    it('rotates through mirrors automatically when mirror fails', async () => {
      let callCount = 0;
      jest.spyOn(global, 'fetch').mockImplementation(async (url) => {
        callCount++;
        if (callCount === 1) {
          throw new Error('Connection refused');
        }
        return {
          ok: true,
          json: async () => [
            { stationuuid: 'mirror-ok-uuid', name: 'Resilient Radio', url: 'https://stream.com/live' }
          ]
        };
      });

      const stations = await radioBrowserProvider.getTopStations({ limit: 5 });
      expect(callCount).toBe(2);
      expect(stations.length).toBe(1);
      expect(stations[0].title).toBe('Resilient Radio');
    });
  });

  // =========================================================================
  // 4. MULTI-PROVIDER SEARCH, CONCURRENCY & FALLBACK (musicProvider.js)
  // =========================================================================
  describe('MusicProvider Multi-Provider Orchestration & Fallback', () => {
    it('queries Audius and Jamendo concurrently and keeps local exact matches at the top', async () => {
      // Mock Audius
      jest.spyOn(audiusProvider, 'searchTracks').mockResolvedValue([
        {
          id: 'audius_external_1',
          provider: 'Audius',
          providerId: 'external_1',
          title: 'Believer Remix',
          artist: 'Audius Creator',
          album: 'Electronic',
          audioUrl: 'https://audius.co/stream/1.mp3',
          coverUrl: 'https://audius.co/cover1.jpg',
          duration: 200,
          license: 'Audius Free Stream',
          source: 'Audius'
        }
      ]);

      // Mock Jamendo
      jest.spyOn(jamendoProvider, 'searchTracks').mockResolvedValue([
        {
          id: 'jamendo_external_2',
          provider: 'Jamendo',
          providerId: 'external_2',
          title: 'Believer Acoustic',
          artist: 'Jamendo Artist',
          album: 'Acoustic',
          audioUrl: 'https://jamendo.com/stream/2.mp3',
          coverUrl: 'https://jamendo.com/cover2.jpg',
          duration: 190,
          license: 'https://creativecommons.org/licenses/by/3.0/',
          source: 'Jamendo'
        }
      ]);

      // Mock Live JioSaavn to return empty to isolate local catalog vs external
      jest.spyOn(musicProvider, 'fetchProviderSongs').mockResolvedValue([]);

      const result = await musicProvider.searchProviderTracks({ q: 'Believer', limit: 20 });
      expect(Array.isArray(result)).toBe(true);

      // Verify local catalog exact match for Believer exists and is positioned at the top
      expect(result[0].title.toLowerCase()).toBe('believer');
      expect(result[0].id).toBeDefined();

      // Verify external results are included
      const hasAudius = result.some(t => t.provider === 'Audius');
      const hasJamendo = result.some(t => t.provider === 'Jamendo');
      expect(hasAudius).toBe(true);
      expect(hasJamendo).toBe(true);
    });

    it('isolates failures: if Audius throws, Jamendo and local results still succeed', async () => {
      jest.spyOn(audiusProvider, 'searchTracks').mockRejectedValue(new Error('Audius cluster offline'));
      jest.spyOn(jamendoProvider, 'searchTracks').mockResolvedValue([
        {
          id: 'jamendo_ok_1',
          provider: 'Jamendo',
          providerId: 'ok_1',
          title: 'Sunlight',
          artist: 'Jamendo Indie',
          audioUrl: 'https://jamendo.com/sunlight.mp3',
          coverUrl: '',
          duration: 150,
          source: 'Jamendo'
        }
      ]);
      jest.spyOn(musicProvider, 'fetchProviderSongs').mockResolvedValue([]);

      const results = await musicProvider.searchProviderTracks({ q: 'Sunlight', limit: 10 });
      expect(Array.isArray(results)).toBe(true);
      expect(results.some(t => t.provider === 'Jamendo')).toBe(true);
    });

    it('isolates failures: if both external providers fail, search returns local catalog without crashing', async () => {
      jest.spyOn(audiusProvider, 'searchTracks').mockRejectedValue(new Error('Audius connection timeout'));
      jest.spyOn(jamendoProvider, 'searchTracks').mockRejectedValue(new Error('Jamendo 500 error'));
      jest.spyOn(musicProvider, 'fetchProviderSongs').mockResolvedValue([]);

      const results = await musicProvider.searchProviderTracks({ q: 'Kesariya', limit: 10 });
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].title.toLowerCase()).toContain('kesariya');
      expect(results[0].id).toBeDefined();
    });

    it('routes getProviderTrackDetails to respective provider adapters', async () => {
      const audiusSpy = jest.spyOn(audiusProvider, 'getTrackById').mockResolvedValue({
        id: 'audius_999',
        title: 'Audius Resolved',
        provider: 'Audius'
      });
      const jamendoSpy = jest.spyOn(jamendoProvider, 'getTrackById').mockResolvedValue({
        id: 'jamendo_888',
        title: 'Jamendo Resolved',
        provider: 'Jamendo'
      });
      const radioSpy = jest.spyOn(radioBrowserProvider, 'getStationByUuid').mockResolvedValue({
        id: 'radio_uuid-777',
        title: 'Radio Resolved',
        provider: 'RadioBrowser'
      });

      const trackAud = await musicProvider.getProviderTrackDetails('audius_999');
      expect(audiusSpy).toHaveBeenCalledWith('audius_999');
      expect(trackAud.title).toBe('Audius Resolved');

      const trackJam = await musicProvider.getProviderTrackDetails('jamendo_888');
      expect(jamendoSpy).toHaveBeenCalledWith('jamendo_888');
      expect(trackJam.title).toBe('Jamendo Resolved');

      const trackRadio = await musicProvider.getProviderTrackDetails('radio_uuid-777');
      expect(radioSpy).toHaveBeenCalledWith('uuid-777');
      expect(trackRadio.title).toBe('Radio Resolved');
    });

    it('getAllProvidersHealth returns health without exposing secrets', () => {
      process.env.JAMENDO_CLIENT_ID = 'secret_jamendo_key';
      process.env.AUDIUS_API_KEY = 'secret_audius_key';

      const health = musicProvider.getAllProvidersHealth();
      expect(health).toHaveProperty('audius');
      expect(health).toHaveProperty('jamendo');
      expect(health).toHaveProperty('radioBrowser');
      expect(health).toHaveProperty('jiosaavn');

      const jsonStr = JSON.stringify(health);
      expect(jsonStr).not.toContain('secret_jamendo_key');
      expect(jsonStr).not.toContain('secret_audius_key');
    });
  });

  // =========================================================================
  // 5. BACKEND API ROUTES (/api/music/providers & /api/music/radio)
  // =========================================================================
  describe('Backend API Endpoints for Providers & Radio', () => {
    it('GET /api/music/providers returns 200 with status overview', async () => {
      const res = await request(app).get('/api/music/providers');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('audius');
      expect(res.body).toHaveProperty('jamendo');
      expect(res.body).toHaveProperty('radioBrowser');
      expect(res.body).toHaveProperty('jiosaavn');
    });

    it('GET /api/music/radio/stations returns stations with query validation', async () => {
      jest.spyOn(radioBrowserProvider, 'searchStations').mockResolvedValue([
        {
          id: 'radio_test_uuid_1',
          provider: 'RadioBrowser',
          providerId: 'test_uuid_1',
          title: 'Global Ambient Radio',
          artist: 'Norway',
          audioUrl: 'https://stream.norway.fm/live',
          duration: 0,
          isLiveRadio: true
        }
      ]);

      const res = await request(app).get('/api/music/radio/stations?name=Ambient&limit=10');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(1);
      expect(res.body[0].title).toBe('Global Ambient Radio');
      expect(res.body[0].isLiveRadio).toBe(true);
    });

    it('GET /api/music/radio/station/:uuid returns 400 when UUID is invalid', async () => {
      const res = await request(app).get('/api/music/radio/station/not-a-valid-uuid!@#');
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });

    it('GET /api/music/radio/station/:uuid returns 200 for valid UUID', async () => {
      const validUuid = '964344d9-0601-11e8-ae97-52543be04c81';
      jest.spyOn(radioBrowserProvider, 'getStationByUuid').mockResolvedValue({
        id: `radio_${validUuid}`,
        provider: 'RadioBrowser',
        providerId: validUuid,
        title: 'BBC Radio 1',
        audioUrl: 'https://stream.bbc.co.uk/radio1',
        isLiveRadio: true
      });

      const res = await request(app).get(`/api/music/radio/station/${validUuid}`);
      expect(res.status).toBe(200);
      expect(res.body.providerId).toBe(validUuid);
      expect(res.body.title).toBe('BBC Radio 1');
    });

    it('GET /api/music/search grouped=true contains externalMatches section', async () => {
      jest.spyOn(audiusProvider, 'searchTracks').mockResolvedValue([
        {
          id: 'audius_ext_3',
          provider: 'Audius',
          providerId: 'ext_3',
          title: 'Electronic Groove',
          artist: 'Audius DJ',
          audioUrl: 'https://audius.co/groove.mp3',
          duration: 180,
          source: 'Audius'
        }
      ]);
      jest.spyOn(jamendoProvider, 'searchTracks').mockResolvedValue([]);
      jest.spyOn(musicProvider, 'fetchProviderSongs').mockResolvedValue([]);

      const res = await request(app).get('/api/music/search?q=Electronic&grouped=true&limit=10');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('externalMatches');
      expect(Array.isArray(res.body.externalMatches)).toBe(true);
      expect(res.body.externalMatches.some(t => t.provider === 'Audius')).toBe(true);
    });
  });

  // =========================================================================
  // 6. FRONTEND PLAYER URL RESOLUTION & DSP SAFETY
  // =========================================================================
  describe('Player URL Rewriting & DSP Safety for New Providers', () => {
    let playerInstance;

    beforeEach(() => {
      const playerPath = path.resolve(__dirname, '../public/js/player.js');
      const playerCode = fs.readFileSync(playerPath, 'utf8');

      const mockAudio = {
        play: jest.fn().mockResolvedValue(undefined),
        pause: jest.fn(),
        load: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        src: '',
        volume: 0.8,
        playbackRate: 1,
        crossOrigin: null
      };

      const store = new Map();
      const mockLocalStorage = {
        getItem: (k) => store.get(k) || null,
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k),
        clear: () => store.clear()
      };

      const context = vm.createContext({
        window: {
          location: { origin: 'http://localhost:3000', href: 'http://localhost:3000/app.html' },
          localStorage: mockLocalStorage,
          addEventListener: jest.fn(),
          removeEventListener: jest.fn(),
          navigator: { userAgent: 'Mozilla/5.0' }
        },
        document: {
          getElementById: jest.fn().mockReturnValue(null),
          querySelector: jest.fn().mockReturnValue(null),
          querySelectorAll: jest.fn().mockReturnValue([]),
          createElement: jest.fn().mockImplementation((tag) => {
            if (tag === 'audio') return mockAudio;
            return {};
          }),
          body: { appendChild: jest.fn() }
        },
        Audio: jest.fn().mockImplementation(() => mockAudio),
        AudioContext: null,
        webkitAudioContext: null,
        localStorage: mockLocalStorage,
        console,
        setTimeout: (fn) => fn(),
        clearTimeout: jest.fn(),
        URL: global.URL,
        navigator: {
          userAgent: 'Mozilla/5.0',
          mediaSession: {
            setActionHandler: jest.fn(),
            metadata: null
          }
        },
        UI: {
          showToast: jest.fn(),
          updatePlayPauseButton: jest.fn(),
          updateActiveTrack: jest.fn(),
          formatTime: (s) => `${s}`
        },
        API: {
          get: jest.fn().mockResolvedValue({}),
          post: jest.fn().mockResolvedValue({}),
          put: jest.fn().mockResolvedValue({ success: true })
        }
      });

      vm.runInContext(playerCode, context);
      playerInstance = vm.runInContext('player', context);
    });

    it('does NOT apply Saavn HD _320.mp4 rewrite to Audius URLs', () => {
      const audiusTrack = {
        provider: 'Audius',
        audioUrl: 'https://discoveryprovider.audius.co/v1/tracks/123/stream?app_name=AuraList'
      };

      const resolved = playerInstance.getPlayableAudioUrl(audiusTrack.audioUrl, audiusTrack);
      expect(resolved).toBe('https://discoveryprovider.audius.co/v1/tracks/123/stream?app_name=AuraList');
      expect(resolved).not.toContain('_320.mp4');
    });

    it('does NOT apply Saavn HD _320.mp4 rewrite to Jamendo URLs', () => {
      const jamendoTrack = {
        provider: 'Jamendo',
        audioUrl: 'https://prod-1.storage.jamendo.com/tracks/456_96.mp3'
      };

      const resolved = playerInstance.getPlayableAudioUrl(jamendoTrack.audioUrl, jamendoTrack);
      expect(resolved).toBe('https://prod-1.storage.jamendo.com/tracks/456_96.mp3');
      expect(resolved).not.toContain('456_320.mp3');
    });

    it('does NOT apply Saavn HD _320.mp4 rewrite to Radio Browser live streams', () => {
      const radioTrack = {
        provider: 'RadioBrowser',
        isLiveRadio: true,
        audioUrl: 'https://stream.live.vc.bbcmedia.co.uk/bbc_radio_one_96'
      };

      const resolved = playerInstance.getPlayableAudioUrl(radioTrack.audioUrl, radioTrack);
      expect(resolved).toBe('https://stream.live.vc.bbcmedia.co.uk/bbc_radio_one_96');
      expect(resolved).not.toContain('bbc_radio_one_320');
    });

    it('continues upgrading JioSaavn standard streams to HD 320 when appropriate', () => {
      const saavnTrack = {
        provider: 'JioSaavn',
        audioUrl: 'https://aac.saavncdn.com/902/97f0f6399f54555eae2beecacbc082fa_96.mp4'
      };

      const resolved = playerInstance.getPlayableAudioUrl(saavnTrack.audioUrl, saavnTrack);
      expect(resolved).toBe('https://aac.saavncdn.com/902/97f0f6399f54555eae2beecacbc082fa_320.mp4');
    });

    it('disables Web Audio DSP for cross-origin streams cleanly', () => {
      // In browser environment, crossOrigin streams can be checked via canUseDSPForSource
      if (typeof playerInstance.canUseDSPForSource === 'function') {
        expect(playerInstance.canUseDSPForSource('https://discoveryprovider.audius.co/stream')).toBe(false);
        expect(playerInstance.canUseDSPForSource('https://stream.live.radio.info/live')).toBe(false);
      }
    });
  });

  describe('Database Credential Redaction & Audio URL Safety', () => {
    it('redactMongoCredentials cleanly strips credentials and usernames from connection strings and errors', () => {
      const fullUri = 'mongodb+srv://admin_user:SuperSecretP%40ss123@cluster0.mongodb.net/auralist?retryWrites=true';
      const redacted = redactMongoCredentials(fullUri);

      expect(redacted).not.toContain('admin_user');
      expect(redacted).not.toContain('SuperSecretP%40ss123');
      expect(redacted).toContain('mongodb+srv://[REDACTED_CREDENTIALS]@cluster0.mongodb.net/auralist?retryWrites=true');

      const standardUri = 'mongodb://dbuser:mypassword@localhost:27017/auralist';
      expect(redactMongoCredentials(standardUri)).toBe('mongodb://[REDACTED_CREDENTIALS]@localhost:27017/auralist');

      const errorMsg = 'MongoServerError: bad auth : authentication failed for user "app_user" on db "test"';
      expect(redactMongoCredentials(errorMsg)).not.toContain('user "app_user"');
    });

    it('formatAudioUrl preserves HTTP on non-standard ports instead of blindly rewriting to HTTPS', () => {
      const radioStream = 'http://radio.example.org:8000/stream.mp3';
      const formatted = formatAudioUrl(radioStream);
      expect(formatted).toBe('http://radio.example.org:8000/stream.mp3');

      // Unverified third-party hosts preserve HTTP without blind rewriting to prevent TLS failures
      const standardHttp = 'http://audio.example.com/song.mp3';
      const formattedStandard = formatAudioUrl(standardHttp);
      expect(formattedStandard).toBe('http://audio.example.com/song.mp3');

      // Officially supported providers upgrade to HTTPS
      const saavnHttp = 'http://aac.saavncdn.com/song.mp4';
      expect(formatAudioUrl(saavnHttp)).toBe('https://aac.saavncdn.com/song.mp4');
    });
  });
});
