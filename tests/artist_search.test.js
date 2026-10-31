const request = require('supertest');
const app = require('../server');
const musicProvider = require('../backend/services/musicProvider');

describe('Artist Search Feature Tests', () => {
  describe('Backend Artist Search API (GET /api/music/search)', () => {
    let providerSpy;
    let audiusSpy;
    let jamendoSpy;

    beforeEach(() => {
      // Deterministic unit test execution: mock live provider calls
      providerSpy = jest.spyOn(musicProvider, 'fetchProviderSongs').mockResolvedValue([]);
      audiusSpy = jest.spyOn(musicProvider.audiusProvider, 'searchTracks').mockResolvedValue([]);
      jamendoSpy = jest.spyOn(musicProvider.jamendoProvider, 'searchTracks').mockResolvedValue([]);
      musicProvider.clearCache();
    });

    afterEach(() => {
      if (providerSpy) providerSpy.mockRestore();
      if (audiusSpy) audiusSpy.mockRestore();
      if (jamendoSpy) jamendoSpy.mockRestore();
      musicProvider.clearCache();
    });

    it('1. returns songs by artist when full artist name is queried (case-insensitive)', async () => {
      const res = await request(app).get('/api/music/search?q=Arijit%20Singh&limit=20');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
      // Verify all or primary returned tracks feature Arijit Singh
      const hasArijit = res.body.some(t => t.artist.toLowerCase().includes('arijit singh'));
      expect(hasArijit).toBe(true);

      // Verify required fields: title, artist, album, coverUrl, audioUrl, duration
      const sample = res.body[0];
      expect(sample).toHaveProperty('title');
      expect(sample).toHaveProperty('artist');
      expect(sample).toHaveProperty('album');
      expect(sample).toHaveProperty('coverUrl');
      expect(sample).toHaveProperty('audioUrl');
    });

    it('1b. returns songs by artist even when artist name is NOT in song title', async () => {
      const res = await request(app).get('/api/music/search?q=Arijit%20Singh&limit=30');

      expect(res.status).toBe(200);
      expect(res.body.length).toBeGreaterThan(0);

      // Should find songs by Arijit Singh whose title does not contain the word "Arijit" or "Singh"
      const songsWithoutArtistInTitle = res.body.filter(t => {
        const titleLower = t.title.toLowerCase();
        const artistLower = t.artist.toLowerCase();
        return artistLower.includes('arijit singh') && !titleLower.includes('arijit');
      });
      expect(songsWithoutArtistInTitle.length).toBeGreaterThan(0);
    });

    it('2. works with partial artist names (e.g. "arij" or "kishore")', async () => {
      const resLower = await request(app).get('/api/music/search?q=arij&limit=15');
      const resUpper = await request(app).get('/api/music/search?q=ARIJ&limit=15');

      expect(resLower.status).toBe(200);
      expect(resUpper.status).toBe(200);
      expect(resLower.body.length).toBeGreaterThan(0);
      expect(resLower.body.length).toBe(resUpper.body.length);
      expect(resLower.body[0].id).toBe(resUpper.body[0].id);
      expect(resLower.body.some(t => t.artist.toLowerCase().includes('arijit'))).toBe(true);
    });

    it('3. supports dedicated artist parameter and type=artist', async () => {
      const resParam = await request(app).get('/api/music/search?artist=Diljit&limit=10');
      const resType = await request(app).get('/api/music/search?q=Diljit&type=artist&limit=10');

      expect(resParam.status).toBe(200);
      expect(resType.status).toBe(200);
      expect(resParam.body.length).toBeGreaterThan(0);
      expect(resType.body.length).toBeGreaterThan(0);
      expect(resParam.body.every(t => t.artist.toLowerCase().includes('diljit'))).toBe(true);
      expect(resType.body.every(t => t.artist.toLowerCase().includes('diljit'))).toBe(true);
    });

    it('4. matches multiple artists with similar names (e.g. "kumar")', async () => {
      const res = await request(app).get('/api/music/search?q=kumar&limit=40');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);

      // Extract distinct artists
      const artists = new Set();
      res.body.forEach(t => {
        t.artist.split(/[,&/|]|\bfeat\.?\b|\bft\.?\b/i).forEach(a => {
          if (a.toLowerCase().includes('kumar')) {
            artists.add(a.trim());
          }
        });
      });

      // Should find multiple artists with similar names such as Kishore Kumar, Kumar Sanu, etc.
      expect(artists.size).toBeGreaterThanOrEqual(2);
      expect(Array.from(artists).some(a => a.toLowerCase().includes('kishore kumar'))).toBe(true);
    });

    it('5. returns empty array when no songs are found for unknown artist', async () => {
      const res = await request(app).get('/api/music/search?q=TotallyNonExistentArtistXYZ12345');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(0);
    });

    it('6. preserves existing song-title search functionality alongside artist search', async () => {
      // "Gehra Hua" is a song title
      const res = await request(app).get('/api/music/search?q=Gehra%20Hua&limit=5');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
      expect(res.body.some(t => t.title.toLowerCase().includes('gehra hua'))).toBe(true);
    });

    it('7. proving q=kumar + artist=Kishore Kumar returns the same relevant artist track set as artist-only search', async () => {
      const resArtistOnly = await request(app).get('/api/music/search?artist=Kishore%20Kumar&limit=40');
      const resCombined = await request(app).get('/api/music/search?q=kumar&artist=Kishore%20Kumar&limit=40');

      expect(resArtistOnly.status).toBe(200);
      expect(resCombined.status).toBe(200);
      expect(resArtistOnly.body.length).toBeGreaterThan(0);
      expect(resCombined.body.length).toBe(resArtistOnly.body.length);
      const artistOnlyIds = resArtistOnly.body.map(t => t.id);
      const combinedIds = resCombined.body.map(t => t.id);
      expect(combinedIds).toEqual(artistOnlyIds);
    });

    it('8. combined search (q=Gehra Hua & artist=Arijit Singh) returns songs matching title AND artist', async () => {
      const res = await request(app).get('/api/music/search?q=Gehra%20Hua&artist=Arijit%20Singh&limit=10');

      expect(res.status).toBe(200);
      expect(res.body.length).toBeGreaterThan(0);
      // All returned tracks must match both title "Gehra Hua" and artist "Arijit Singh"
      for (const t of res.body) {
        expect(t.title.toLowerCase()).toContain('gehra hua');
        expect(t.artist.toLowerCase()).toContain('arijit');
      }
    });

    it('9. search results do not contain duplicate track IDs or audio URLs', async () => {
      const res = await request(app).get('/api/music/search?q=Arijit%20Singh&limit=40');

      expect(res.status).toBe(200);
      const seenIds = new Set();
      const seenUrls = new Set();
      for (const t of res.body) {
        expect(seenIds.has(t.id)).toBe(false);
        seenIds.add(t.id);
        if (t.audioUrl) {
          expect(seenUrls.has(t.audioUrl)).toBe(false);
          seenUrls.add(t.audioUrl);
        }
      }
    });
  });

  describe('Frontend Artist Disambiguation & Track Rendering Helpers', () => {
    const fs = require('fs');
    const path = require('path');
    const vm = require('vm');

    let UI;

    beforeAll(() => {
      global.document = {
        createElement: (tag) => {
          const el = {
            tagName: tag.toUpperCase(),
            className: '',
            style: {},
            dataset: {},
            children: [],
            appendChild: (child) => { el.children.push(child); return child; },
            replaceChildren: (...newChildren) => { el.children = newChildren; },
            addEventListener: jest.fn(),
            setAttribute: jest.fn(),
            getAttribute: jest.fn()
          };
          return el;
        },
        createTextNode: (text) => ({ textContent: text })
      };
      UI = require('../public/js/ui');
    });

    it('UI.extractMatchingArtists correctly extracts unique artists with song counts', () => {
      const mockTracks = [
        { id: '1', title: 'Song A', artist: 'Kishore Kumar', album: 'Album 1', coverUrl: 'https://example.com/c1.jpg' },
        { id: '2', title: 'Song B', artist: 'Kishore Kumar, R.D. Burman', album: 'Album 2', coverUrl: 'https://example.com/c2.jpg' },
        { id: '3', title: 'Song C', artist: 'Kumar Sanu, Alka Yagnik', album: 'Album 3', coverUrl: 'https://example.com/c3.jpg' },
        { id: '4', title: 'Song D', artist: 'Amit Kumar', album: 'Album 4', coverUrl: 'https://example.com/c4.jpg' },
        { id: '5', title: 'Song E', artist: 'Arijit Singh', album: 'Album 5', coverUrl: 'https://example.com/c5.jpg' }
      ];

      const artists = UI.extractMatchingArtists(mockTracks, 'kumar');

      expect(Array.isArray(artists)).toBe(true);
      expect(artists.length).toBe(3); // Kishore Kumar, Kumar Sanu, Amit Kumar

      const kishore = artists.find(a => a.name === 'Kishore Kumar');
      expect(kishore).toBeDefined();
      expect(kishore.count).toBe(2);

      const sanu = artists.find(a => a.name === 'Kumar Sanu');
      expect(sanu).toBeDefined();
      expect(sanu.count).toBe(1);

      const amit = artists.find(a => a.name === 'Amit Kumar');
      expect(amit).toBeDefined();
      expect(amit.count).toBe(1);
    });

    it('UI.createTrackCard includes title, artist, album (when available), cover image, and play button', () => {
      const trackWithAlbum = {
        id: 't_card_1',
        title: 'Channa Mereya',
        artist: 'Arijit Singh',
        album: 'Ae Dil Hai Mushkil',
        coverUrl: 'https://example.com/cover.jpg',
        duration: 289
      };

      const card = UI.createTrackCard(trackWithAlbum, 0, 'https://example.com/fallback.jpg');

      expect(card).toBeDefined();
      expect(card.dataset.trackId).toBe('t_card_1');

      // Check structure: cover wrapper + info + actions
      expect(card.children.length).toBeGreaterThanOrEqual(3);

      const coverWrapper = card.children[0];
      const img = coverWrapper.children[0];
      const playOverlay = coverWrapper.children[1];

      // Cover image check
      expect(img.className).toBe('track-cover');
      expect(img.src).toBe('https://example.com/cover.jpg');

      // Play button check
      expect(playOverlay.className).toBe('play-overlay-btn');
      const playCircle = playOverlay.children[0];
      expect(playCircle.className).toBe('play-circle');

      // Info check: title, artist, album
      const info = card.children[1];
      expect(info.className).toBe('track-info');

      const titleEl = info.children.find(c => c.className === 'track-title');
      expect(titleEl).toBeDefined();
      expect(titleEl.textContent).toBe('Channa Mereya');

      const artistEl = info.children.find(c => c.className.includes('track-artist'));
      expect(artistEl).toBeDefined();
      expect(artistEl.textContent).toBe('Arijit Singh');

      const albumEl = info.children.find(c => c.className === 'track-album');
      expect(albumEl).toBeDefined();
      expect(albumEl.textContent).toBe('Ae Dil Hai Mushkil');
    });

    it('UI.renderMatchingArtists renders multiple artist cards with active selection support', () => {
      const mockArtists = [
        { name: 'Kishore Kumar', count: 15, coverUrl: 'https://example.com/k.jpg' },
        { name: 'Kumar Sanu', count: 10, coverUrl: 'https://example.com/s.jpg' }
      ];

      const container = {
        children: [],
        style: {},
        appendChild: function(c) { this.children.push(c); return c; },
        replaceChildren: function(...newChildren) { this.children = newChildren; }
      };

      const onSelect = jest.fn();
      UI.renderMatchingArtists(mockArtists, container, 25, 'Kishore Kumar', onSelect);

      expect(container.style.display).toBe('block');
      expect(container.children.length).toBe(1);

      const section = container.children[0];
      expect(section.className).toBe('matching-artists-container');
    });
  });
});
