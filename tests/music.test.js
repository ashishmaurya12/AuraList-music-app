const request = require('supertest');
const app = require('../server');
const musicProvider = require('../backend/services/musicProvider');

describe('Music API & Provider Integration (/api/music)', () => {
  describe('Catalog & Offline API Endpoints', () => {
    it('GET /api/music/catalog should return paginated pre-indexed songs', async () => {
      const res = await request(app).get('/api/music/catalog?page=1&limit=10');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('tracks');
      expect(Array.isArray(res.body.tracks)).toBe(true);
      expect(res.body.tracks.length).toBeLessThanOrEqual(10);
      expect(res.body).toHaveProperty('totalSongs');
    });

    it('GET /api/music/trending should return trending music tracks', async () => {
      // Mock musicProvider.getProviderTrending
      jest.spyOn(musicProvider, 'getProviderTrending').mockResolvedValue([
        {
          id: 't101',
          jamendoId: 't101',
          title: 'Mock Trending Song',
          artist: 'Mock Artist',
          coverUrl: 'https://example.com/cover.jpg',
          audioUrl: 'https://example.com/audio.mp3',
          duration: 200
        }
      ]);

      const res = await request(app).get('/api/music/trending');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(1);
      expect(res.body[0].title).toBe('Mock Trending Song');

      musicProvider.getProviderTrending.mockRestore();
    });

    it('GET /api/music/search should handle search queries safely', async () => {
      jest.spyOn(musicProvider, 'searchProviderTracks').mockResolvedValue([
        {
          id: 's201',
          jamendoId: 's201',
          title: 'Arijit Hit Song',
          artist: 'Arijit Singh',
          coverUrl: 'https://example.com/cover.jpg',
          audioUrl: 'https://example.com/audio.mp3',
          duration: 240
        }
      ]);

      const res = await request(app).get('/api/music/search?q=Arijit&limit=5');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body[0].artist).toBe('Arijit Singh');

      musicProvider.searchProviderTracks.mockRestore();
    });

    it('GET /api/music/track/:id should return single track details', async () => {
      jest.spyOn(musicProvider, 'getProviderTrackDetails').mockResolvedValue({
        id: '9901',
        jamendoId: '9901',
        title: 'Single Track Title',
        artist: 'Single Artist',
        coverUrl: 'https://example.com/cover.jpg',
        audioUrl: 'https://example.com/audio.mp3',
        duration: 180
      });

      const res = await request(app).get('/api/music/track/9901');

      expect(res.status).toBe(200);
      expect(res.body.id).toBe('9901');
      expect(res.body.title).toBe('Single Track Title');

      musicProvider.getProviderTrackDetails.mockRestore();
    });

    it('GET /api/music/lyrics/:id should return track lyrics or default fallback', async () => {
      jest.spyOn(musicProvider, 'getProviderLyrics').mockResolvedValue({
        lyrics: 'Official lyrics text for test song.',
        copyright: 'Test Copyright'
      });

      const res = await request(app).get('/api/music/lyrics/9901');

      expect(res.status).toBe(200);
      expect(res.body.lyrics).toBe('Official lyrics text for test song.');

      musicProvider.getProviderLyrics.mockRestore();
    });
  });

  describe('Music Provider Failure & Resilience Handling', () => {
    it('should return 404 cleanly when provider cannot find track', async () => {
      jest.spyOn(musicProvider, 'getProviderTrackDetails').mockResolvedValue(null);

      const res = await request(app).get('/api/music/track/nonexistent_id');

      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/Track details not found|Track not found/i);

      musicProvider.getProviderTrackDetails.mockRestore();
    });

    it('should return safe empty array when provider search returns empty or fails', async () => {
      jest.spyOn(musicProvider, 'searchProviderTracks').mockResolvedValue([]);

      const res = await request(app).get('/api/music/search?q=FailedQuery');

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);

      musicProvider.searchProviderTracks.mockRestore();
    });

    it('should return default fallback lyrics when provider lyrics request fails', async () => {
      jest.spyOn(musicProvider, 'getProviderLyrics').mockResolvedValue({
        lyrics: 'Lyrics unavailable for this track.',
        copyright: ''
      });

      const res = await request(app).get('/api/music/lyrics/failed_lyrics_id');

      expect(res.status).toBe(200);
      expect(res.body.lyrics).toBe('Lyrics unavailable for this track.');

      musicProvider.getProviderLyrics.mockRestore();
    });
  });

  describe('Feature Enhancements: Recommendations, Moods, and Artist Profiles', () => {
    it('GET /api/music/recommendations returns discovery tracks with recommendation reasons', async () => {
      const res = await request(app).get('/api/music/recommendations?limit=5');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
      expect(res.body[0]).toHaveProperty('recommendationReason');
      expect(typeof res.body[0].recommendationReason).toBe('string');
    });

    it('GET /api/music/moods/:mood returns genuine metadata-matched tracks for chill mood', async () => {
      const res = await request(app).get('/api/music/moods/chill?limit=10');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('mood', 'chill');
      expect(res.body).toHaveProperty('label', 'Chill');
      expect(Array.isArray(res.body.tracks)).toBe(true);
      expect(res.body.tracks.length).toBeGreaterThan(0);
    });

    it('GET /api/music/moods/:mood rejects invalid mood names', async () => {
      const res = await request(app).get('/api/music/moods/invalid-mood-name');

      expect(res.status).toBe(400);
    });

    it('GET /api/music/artist/:artist returns artist profile with songs, albums, and bio fallback', async () => {
      const res = await request(app).get('/api/music/artist/Arijit%20Singh');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('name');
      expect(res.body).toHaveProperty('image');
      expect(res.body).toHaveProperty('bio');
      expect(Array.isArray(res.body.songs)).toBe(true);
      expect(Array.isArray(res.body.albums)).toBe(true);
    });

    it('GET /api/music/artist/:artist returns 404 for unknown artist with 0 tracks', async () => {
      const res = await request(app).get('/api/music/artist/NonExistentArtistQueryXYZ999');

      expect(res.status).toBe(404);
    });
  });

  describe('Deterministic Music Provider Search & Failure Resilience', () => {
    afterEach(() => {
      musicProvider.setProviderHealth({ available: true, error: null });
    });

    it('handles successful provider search with normalized and filtered results', async () => {
      jest.spyOn(musicProvider, 'safeFetchJson').mockResolvedValue({
        results: [
          {
            id: 'mock_1',
            title: 'Mock Hit Song',
            subtitle: 'Mock Singer',
            more_info: {
              media_url: 'https://example.com/mock.mp3',
              duration: 210
            }
          },
          {
            id: 'mock_2',
            title: 'Mock Hit Song (Lo-Fi Flip)',
            subtitle: 'Mock Singer',
            more_info: {
              media_url: 'https://example.com/mock_lofi.mp3',
              duration: 210
            }
          }
        ]
      });

      const res = await request(app).get('/api/music/search?q=Mock%20Hit%20Song&limit=10');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.headers['x-provider-status']).toBe('online');
      expect(res.body.some(t => t.id === 'mock_1')).toBe(true);
      // Unwanted lo-fi cut filtered out by default
      expect(res.body.some(t => t.id === 'mock_2')).toBe(false);

      musicProvider.safeFetchJson.mockRestore();
    });

    it('handles provider empty results ({ results: [] }) cleanly without throwing', async () => {
      jest.spyOn(musicProvider, 'safeFetchJson').mockResolvedValue({ results: [] });

      const res = await request(app).get('/api/music/search?q=DefinitelyNoSuchSongExists12345');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toEqual([]);
      expect(res.headers['x-provider-status']).toBe('online');

      musicProvider.safeFetchJson.mockRestore();
    });

    it('handles malformed provider response safely and marks provider offline', async () => {
      // safeFetchJson returns null on malformed JSON
      jest.spyOn(musicProvider, 'safeFetchJson').mockImplementation(() => {
        musicProvider.setProviderHealth({ available: false, errorCode: 'PROVIDER_BAD_RESPONSE', error: 'Malformed JSON payload from provider' });
        return Promise.resolve(null);
      });

      const res = await request(app).get('/api/music/search?q=MalformedProviderQuery');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.headers['x-provider-status']).toBe('offline');
      expect(res.headers['x-provider-error']).toBe('PROVIDER_BAD_RESPONSE');

      musicProvider.safeFetchJson.mockRestore();
    });

    it('handles provider timeout (AbortError) cleanly and sets offline header', async () => {
      jest.spyOn(musicProvider, 'safeFetchJson').mockImplementation(() => {
        musicProvider.setProviderHealth({ available: false, errorCode: 'PROVIDER_TIMEOUT', error: 'Request timeout (6000ms)' });
        return Promise.resolve(null);
      });

      const res = await request(app).get('/api/music/search?q=SlowProviderQuery');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.headers['x-provider-status']).toBe('offline');
      expect(res.headers['x-provider-error']).toBe('PROVIDER_TIMEOUT');

      musicProvider.safeFetchJson.mockRestore();
    });

    it('handles provider HTTP 500 error gracefully without crashing server', async () => {
      jest.spyOn(musicProvider, 'safeFetchJson').mockImplementation(() => {
        musicProvider.setProviderHealth({ available: false, errorCode: 'PROVIDER_HTTP_ERROR', error: 'HTTP 500' });
        return Promise.resolve(null);
      });

      const res = await request(app).get('/api/music/search?q=Server500Query');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.headers['x-provider-status']).toBe('offline');
      expect(res.headers['x-provider-error']).toBe('PROVIDER_HTTP_ERROR');

      musicProvider.safeFetchJson.mockRestore();
    });

    it('handles network connection refusal safely', async () => {
      jest.spyOn(musicProvider, 'safeFetchJson').mockImplementation(() => {
        musicProvider.setProviderHealth({ available: false, errorCode: 'PROVIDER_UNAVAILABLE', error: 'fetch failed (ECONNREFUSED)' });
        return Promise.resolve(null);
      });

      const res = await request(app).get('/api/music/search?q=ConnRefusedQuery');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.headers['x-provider-status']).toBe('offline');
      expect(res.headers['x-provider-error']).toBe('PROVIDER_UNAVAILABLE');

      musicProvider.safeFetchJson.mockRestore();
    });

    it('GET /api/music/health reports current provider connectivity and health', async () => {
      musicProvider.setProviderHealth({ available: true, error: null });
      const res1 = await request(app).get('/api/music/health');
      expect(res1.status).toBe(200);
      expect(res1.body.status).toBe('healthy');
      expect(res1.body.providerStatus).toBe('healthy');
      expect(res1.body.available).toBe(true);
      expect(res1.body.provider).toBe('JioSaavn');
      expect(res1.body.providerErrorCode).toBeNull();
      expect(res1.body.lastError).toBeUndefined();

      musicProvider.setProviderHealth({ available: false, errorCode: 'PROVIDER_HTTP_ERROR', error: 'HTTP 503 Service Unavailable' });
      const res2 = await request(app).get('/api/music/health');
      expect(res2.status).toBe(200);
      expect(res2.body.status).toBe('degraded');
      expect(res2.body.providerStatus).toBe('degraded');
      expect(res2.body.available).toBe(false);
      expect(res2.body.providerErrorCode).toBe('PROVIDER_HTTP_ERROR');
      expect(res2.body.lastError).toBeUndefined();
    });

    it('real provider live query (optional/guarded integration test)', async () => {
      let liveResponse = null;
      try {
        liveResponse = await musicProvider.fetchProviderSongs('Arijit Singh', 1, 5);
      } catch (err) {
        liveResponse = null;
      }

      if (!liveResponse || liveResponse.length === 0) {
        console.warn('[LIVE PROVIDER SKIPPED / UNAVAILABLE] JioSaavn could not be reached from test environment. Skipping real network assertion.');
        return;
      }

      expect(Array.isArray(liveResponse)).toBe(true);
      expect(liveResponse.length).toBeGreaterThan(0);
      expect(liveResponse[0]).toHaveProperty('title');
      expect(liveResponse[0]).toHaveProperty('audioUrl');
    });
  });
});

