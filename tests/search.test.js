const request = require('supertest');
const app = require('../server');
const musicProvider = require('../backend/services/musicProvider');
const {
  normalizeText,
  evaluateTrackRelevance,
  rankAndGroupTracks
} = require('../backend/services/searchRelevance');
const UI = require('../public/js/ui');

describe('Search Experience Tests', () => {
  let providerSpy;
  let audiusSpy;
  let jamendoSpy;

  beforeEach(() => {
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

  describe('1. Search by Artist Name & Partial Song Title', () => {
    it('returns songs by an artist even when the artist name is not in the song title', async () => {
      const res = await request(app).get('/api/music/search?q=Arijit%20Singh&limit=30');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);

      // Verify that songs returned have Arijit Singh as the artist, but the title does not contain "Arijit"
      const songsByArtistWithoutNameInTitle = res.body.filter(track => {
        const titleLower = (track.title || '').toLowerCase();
        const artistLower = (track.artist || '').toLowerCase();
        return artistLower.includes('arijit singh') && !titleLower.includes('arijit');
      });

      expect(songsByArtistWithoutNameInTitle.length).toBeGreaterThan(0);
    });

    it('searches by partial song title successfully', async () => {
      // Partial title search: "tera mera"
      const res = await request(app).get('/api/music/search?q=tera%20mera&limit=10');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);

      const hasPartialMatch = res.body.some(t => t.title.toLowerCase().includes('tera mera'));
      expect(hasPartialMatch).toBe(true);
    });

    it('supports case-insensitive matching and handles extra spaces gracefully', async () => {
      const res1 = await request(app).get('/api/music/search?q=kesariya&limit=5');
      const res2 = await request(app).get('/api/music/search?q=%20%20KESARIYA%20%20%20&limit=5');

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
      expect(res1.body.length).toBeGreaterThan(0);
      expect(res2.body.length).toBe(res1.body.length);
      expect(res1.body[0].id).toBe(res2.body[0].id);
    });
  });

  describe('2. Search Ranking Hierarchy', () => {
    const catalogSubset = [
      { id: 't1', title: 'Arijit', artist: 'Tribute Singer', album: 'Album A' },
      { id: 't2', title: 'Kesariya', artist: 'Arijit', album: 'Brahmastra' },
      { id: 't3', title: 'Arijit Special Melody', artist: 'Various Artists', album: 'Album B' },
      { id: 't4', title: 'Raabta', artist: 'Arijit Singh & Pritam', album: 'Agent Vinod' },
      { id: 't5', title: 'Tum Hi Ho', artist: 'Arijit Singh', album: 'Arijit Best' }
    ];

    it('ranks results by relevance: exact song-title > exact artist > partial song-title > partial artist > album', () => {
      // Query "arijit":
      // 1. Exact song-title: "Arijit" (t1)
      // 2. Exact artist: "Kesariya" (artist: "Arijit") (t2)
      // 3. Partial song-title: "Arijit Special Melody" (t3)
      // 4. Partial artist: "Raabta" (artist: "Arijit Singh & Pritam") (t4)
      // 5. Album match: "Tum Hi Ho" (album: "Arijit Best") (t5)
      const ranked = rankAndGroupTracks(catalogSubset, 'arijit');

      expect(ranked.length).toBe(5);
      expect(ranked[0].id).toBe('t1'); // 1. Exact song-title match
      expect(ranked[1].id).toBe('t2'); // 2. Exact artist-name match
      expect(ranked[2].id).toBe('t3'); // 3. Partial song-title match
      expect(ranked[3].id).toBe('t4'); // 4. Partial artist-name match
      expect(ranked[4].id).toBe('t5'); // 5. Album match
    });

    it('removes duplicates across results', () => {
      const duplicateList = [
        { id: 'd1', title: 'Duplicate Song', artist: 'Singer A', audioUrl: 'https://cdn.example.com/stream1.mp3' },
        { id: 'd1', title: 'Duplicate Song', artist: 'Singer A', audioUrl: 'https://cdn.example.com/stream1.mp3' },
        { id: 'd2', title: 'Another Song', artist: 'Singer B', audioUrl: 'https://cdn.example.com/stream2.mp3' }
      ];

      const deduped = musicProvider.filterAndDeduplicateTracks(duplicateList);
      expect(deduped.length).toBe(2);
      expect(deduped.map(t => t.id)).toEqual(['d1', 'd2']);
    });
  });

  describe('3. Typing Suggestions & Endpoint (/api/music/suggestions)', () => {
    it('GET /api/music/suggestions returns matching suggestions for valid query', async () => {
      const res = await request(app).get('/api/music/suggestions?q=arijit&limit=8');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
      expect(res.body.length).toBeLessThanOrEqual(8);

      // Suggestions include type, text
      const first = res.body[0];
      expect(first).toHaveProperty('type');
      expect(first).toHaveProperty('text');
      expect(['artist', 'track', 'album']).toContain(first.type);
    });

    it('returns empty array when query is less than 2 characters', async () => {
      const res = await request(app).get('/api/music/suggestions?q=a');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(0);
    });

    it('caches repeated suggestions for faster response', async () => {
      const res1 = await request(app).get('/api/music/suggestions?q=kishore');
      expect(res1.status).toBe(200);

      // Check cache directly
      const cached = musicProvider.getCached('suggestions_kishore');
      expect(cached).toBeDefined();
      expect(Array.isArray(cached)).toBe(true);
      expect(cached.length).toBe(res1.body.length);
    });

    it('rejects missing or empty query with validation error', async () => {
      const res = await request(app).get('/api/music/suggestions?q=');
      expect(res.status).toBe(400);
    });
  });

  describe('4. Provider Failure Resilience', () => {
    it('gracefully falls back to local catalog when external provider throws or fails', async () => {
      // Mock safeFetchJson to simulate provider failure
      jest.spyOn(musicProvider, 'safeFetchJson').mockRejectedValue(new Error('Provider network timeout'));

      const res = await request(app).get('/api/music/search?q=kesariya&limit=10');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      // Local catalog still successfully found Kesariya!
      expect(res.body.length).toBeGreaterThan(0);
      expect(res.body.some(t => t.title.toLowerCase().includes('kesariya'))).toBe(true);

      musicProvider.safeFetchJson.mockRestore();
    });

    it('returns 200 with empty array when no local tracks match and provider fails', async () => {
      jest.spyOn(musicProvider, 'safeFetchJson').mockRejectedValue(new Error('Connection failed'));

      const res = await request(app).get('/api/music/search?q=UnmatchedSongTitle12345XYZ');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(0);

      musicProvider.safeFetchJson.mockRestore();
    });
  });

  describe('5. UI Track Card & Playback Experience', () => {
    function createMockElement(tag) {
      const el = {
        tagName: tag.toUpperCase(),
        className: '',
        style: {},
        dataset: {},
        children: [],
        appendChild: (child) => { el.children.push(child); return child; },
        replaceChildren: (...newChildren) => { el.children = newChildren; },
        addEventListener: jest.fn(),
        setAttribute: jest.fn((k, v) => { el[k] = v; }),
        getAttribute: jest.fn((k) => el[k]),
        querySelector: (selector) => {
          const parts = selector.trim().split(/\s+/);
          let current = el;
          for (const part of parts) {
            function search(node) {
              for (const child of node.children || []) {
                if (part.startsWith('.') && child.className && child.className.includes(part.slice(1))) {
                  return child;
                }
                if (part.startsWith('#') && child.id === part.slice(1)) {
                  return child;
                }
                if (child.tagName === part.toUpperCase()) {
                  return child;
                }
                const found = search(child);
                if (found) return found;
              }
              return null;
            }
            current = search(current);
            if (!current) return null;
          }
          return current;
        }
      };
      return el;
    }

    beforeAll(() => {
      global.document = {
        createElement: createMockElement,
        createTextNode: (text) => ({ textContent: text })
      };
    });

    it('creates track card with title, artist, album, duration, and working play button', () => {
      const mockTrack = {
        id: 'track_test_1',
        title: 'Shayad',
        artist: 'Arijit Singh',
        album: 'Love Aaj Kal',
        coverUrl: 'https://example.com/cover.jpg',
        audioUrl: 'https://example.com/audio.mp3',
        duration: 247
      };

      const card = UI.createTrackCard(mockTrack, 0, 'https://example.com/fallback.jpg');

      expect(card).toBeDefined();
      expect(card.dataset.trackId).toBe('track_test_1');

      // Title
      const titleSpan = card.querySelector('.track-title');
      expect(titleSpan).toBeDefined();
      expect(titleSpan.textContent).toBe('Shayad');

      // Artist
      const artistSpan = card.querySelector('.track-artist');
      expect(artistSpan).toBeDefined();
      expect(artistSpan.textContent).toBe('Arijit Singh');

      // Album
      const albumSpan = card.querySelector('.track-album');
      expect(albumSpan).toBeDefined();
      expect(albumSpan.textContent).toBe('Love Aaj Kal');

      // Duration
      const durSpan = card.querySelector('.track-duration');
      expect(durSpan).toBeDefined();
      expect(durSpan.textContent).toBe(UI.formatTime(247));

      // Play button
      const playOverlay = card.querySelector('.play-overlay-btn');
      expect(playOverlay).toBeDefined();
      const playIcon = playOverlay.querySelector('i');
      expect(playIcon.className).toContain('fa-play');
    });

    it('does not show a result as playable when its audio URL is unavailable', () => {
      const unplayableTrack = {
        id: '',
        title: 'Unavailable Song',
        artist: 'Unknown',
        audioUrl: false,
        isUnavailable: true
      };

      const card = UI.createTrackCard(unplayableTrack, 0, 'https://example.com/fallback.jpg');
      expect(card.className).toContain('track-unplayable');
      expect(card.getAttribute('role')).toBe('article');

      const playIcon = card.querySelector('.play-circle i');
      expect(playIcon.className).toContain('fa-ban');
    });

    it('renders separate More music from Audius and Jamendo section for external tracks', () => {
      const container = createMockElement('div');
      const mockTracks = [
        {
          id: 'local_1',
          title: 'Kesariya',
          artist: 'Arijit Singh',
          album: 'Brahmastra',
          audioUrl: 'https://example.com/stream1.mp3',
          matchType: 'exact',
          provider: 'Local'
        },
        {
          id: 'aud_1',
          title: 'Kesariya Electronic Mix',
          artist: 'Audius DJ',
          album: 'Remix EP',
          audioUrl: 'https://audius.co/stream2.mp3',
          matchType: 'exact',
          provider: 'Audius'
        }
      ];

      UI.renderGroupedSearchGrid(mockTracks, container, 'Kesariya');

      const headers = container.children.filter(c => c.className === 'search-group-header');
      expect(headers.length).toBe(2);

      const hasExactHeader = headers.some(h => (h.innerHTML || '').includes('Exact matches'));
      const hasExternalHeader = headers.some(h => (h.innerHTML || '').includes('More music from Audius and Jamendo'));

      expect(hasExactHeader).toBe(true);
      expect(hasExternalHeader).toBe(true);
    });
  });
});
