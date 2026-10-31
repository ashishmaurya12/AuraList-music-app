const request = require('supertest');
const app = require('../server');
const musicProvider = require('../backend/services/musicProvider');
const {
  normalizeText,
  tokenize,
  damerauLevenshtein,
  tokenSimilarity,
  evaluateTrackRelevance,
  rankAndGroupTracks
} = require('../backend/services/searchRelevance');

describe('Deterministic Relevance Ranking & Typo-Tolerant Search', () => {
  let providerSpy;

  beforeEach(() => {
    // Ensure all unit tests run strictly offline without network/provider calls
    providerSpy = jest.spyOn(musicProvider, 'fetchProviderSongs').mockResolvedValue([]);
  });

  afterEach(() => {
    if (providerSpy) {
      providerSpy.mockRestore();
    }
  });

  describe('1. Normalization & Token Similarity Pipeline', () => {
    it('normalizes punctuation, repeated whitespace, and diacritics', () => {
      expect(normalizeText('  Tera   Mera-Rishta!  ')).toBe('tera mera rishta');
      expect(normalizeText('Gehra Hua (From "Dhurandhar")')).toBe('gehra hua from dhurandhar');
      expect(normalizeText('Café & Música')).toBe('cafe musica');
      expect(tokenize('  tera - mera  rishta ')).toEqual(['tera', 'mera', 'rishta']);
    });

    it('computes accurate Damerau-Levenshtein edit distances', () => {
      // Transposition
      expect(damerauLevenshtein('tehn', 'then')).toBe(1);
      // Single insertion/deletion
      expect(damerauLevenshtein('rista', 'rishta')).toBe(1);
      expect(damerauLevenshtein('kesriya', 'kesariya')).toBe(1);
      expect(damerauLevenshtein('sing', 'singh')).toBe(1);
      // Equal strings
      expect(damerauLevenshtein('rishta', 'rishta')).toBe(0);
    });

    it('computes conservative token similarity without false positives on unrelated words', () => {
      expect(tokenSimilarity('rista', 'rishta')).toBeGreaterThanOrEqual(0.8);
      expect(tokenSimilarity('kesriya', 'kesariya')).toBeGreaterThanOrEqual(0.85);
      expect(tokenSimilarity('sing', 'singh')).toBeGreaterThanOrEqual(0.8);

      // Unrelated words must yield 0
      expect(tokenSimilarity('dog', 'cat')).toBe(0);
      expect(tokenSimilarity('bandana', 'rishta')).toBe(0);
      expect(tokenSimilarity('pritam', 'kumar')).toBe(0);
    });
  });

  describe('2. Relevance Ranking Hierarchy (Pure Logic)', () => {
    const testCatalog = [
      { id: '1', title: 'Rishta Anokha', artist: 'Artist One', album: 'Album A' },
      { id: '2', title: 'Tera Mera Rishta - New Version', artist: 'Mithoon, Pritam', album: 'Awarapan 2' },
      { id: '3', title: 'Rishta', artist: 'Artist Two', album: 'Album B' },
      { id: '4', title: 'Kesariya', artist: 'Arijit Singh, Pritam', album: 'Brahmastra' },
      { id: '5', title: 'Channa Mereya', artist: 'Arijit Singh', album: 'Ae Dil Hai Mushkil' },
      { id: '6', title: 'Tum Hi Ho', artist: 'Arijit Singh', album: 'Aashiqui 2' }
    ];

    it('ranks exact title match above phrase/prefix match for "rishta"', () => {
      const ranked = rankAndGroupTracks(testCatalog, 'rishta');
      expect(ranked[0].id).toBe('3'); // Exact title "Rishta"
      expect(ranked[0].matchType).toBe('exact');

      // "Tera Mera Rishta" and "Rishta Anokha" should follow
      const otherTitles = ranked.slice(1).map(t => t.title);
      expect(otherTitles).toContain('Tera Mera Rishta - New Version');
      expect(otherTitles).toContain('Rishta Anokha');
    });

    it('"mera rishta" ranks "Tera Mera Rishta" above unrelated "Rishta" songs', () => {
      const ranked = rankAndGroupTracks(testCatalog, 'mera rishta');

      // "Tera Mera Rishta" matches the exact phrase "mera rishta" -> exact match
      expect(ranked[0].title).toBe('Tera Mera Rishta - New Version');
      expect(ranked[0].matchType).toBe('exact');

      // "Rishta Anokha" and "Rishta" only match the single token "rishta" -> related match
      const second = ranked[1];
      expect(second.matchType).toBe('related');
      expect(ranked[0].matchScore).toBeGreaterThan(second.matchScore);
    });

    it('handles reversed and partial query tokens correctly', () => {
      // Reversed: "rishta tera"
      const reversedRanked = rankAndGroupTracks(testCatalog, 'rishta tera');
      expect(reversedRanked.length).toBeGreaterThan(0);
      expect(reversedRanked[0].title).toBe('Tera Mera Rishta - New Version');
      expect(reversedRanked[0].matchType).toBe('related');

      // Partial: "tera rishta"
      const partialRanked = rankAndGroupTracks(testCatalog, 'tera rishta');
      expect(partialRanked.length).toBeGreaterThan(0);
      expect(partialRanked[0].title).toBe('Tera Mera Rishta - New Version');
    });

    it('finds tracks with minor spelling mistakes (typo tolerance)', () => {
      // Typo 1: "tera mera rista" -> finds "Tera Mera Rishta"
      const ristaRanked = rankAndGroupTracks(testCatalog, 'tera mera rista');
      expect(ristaRanked.length).toBeGreaterThan(0);
      expect(ristaRanked[0].title).toBe('Tera Mera Rishta - New Version');
      expect(ristaRanked[0].matchType).toBe('fuzzy');

      // Typo 2: "mera rista" -> finds "Tera Mera Rishta"
      const meraRista = rankAndGroupTracks(testCatalog, 'mera rista');
      expect(meraRista.length).toBeGreaterThan(0);
      expect(meraRista[0].title).toBe('Tera Mera Rishta - New Version');
      expect(meraRista[0].matchType).toBe('fuzzy');

      // Typo 3: "kesriya" -> finds "Kesariya"
      const kesriyaRanked = rankAndGroupTracks(testCatalog, 'kesriya');
      expect(kesriyaRanked.length).toBeGreaterThan(0);
      expect(kesriyaRanked[0].title).toBe('Kesariya');
      expect(kesriyaRanked[0].matchType).toBe('fuzzy');

      // Typo 4: "arijt singh" -> finds Arijit Singh tracks as fuzzy
      const arijitTypo = rankAndGroupTracks(testCatalog, 'arijt singh');
      expect(arijitTypo.length).toBeGreaterThan(0);
      expect(arijitTypo.every(t => t.artist.includes('Arijit Singh'))).toBe(true);
      expect(arijitTypo[0].matchType).toBe('fuzzy');
    });
  });

  describe('3. HTTP API Integration (GET /api/music/search)', () => {
    it('returns exact match first for "mera rishta" against catalog', async () => {
      const res = await request(app).get('/api/music/search?q=mera%20rishta');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);

      // Top result must be Tera Mera Rishta
      expect(res.body[0].title.toLowerCase()).toContain('tera mera rishta');
      expect(res.body[0].matchType).toBe('exact');
    });

    it('returns results for typo query "tera mera rista" with fuzzy categorization', async () => {
      const res = await request(app).get('/api/music/search?q=tera%20mera%20rista');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);

      const found = res.body.find(t => t.title.toLowerCase().includes('tera mera rishta'));
      expect(found).toBeDefined();
      expect(found.matchType).toBe('fuzzy');
    });

    it('returns results for typo query "kesriya" finding "Kesariya"', async () => {
      const res = await request(app).get('/api/music/search?q=kesriya');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);

      const found = res.body.find(t => t.title.toLowerCase().includes('kesariya'));
      expect(found).toBeDefined();
      expect(found.matchType).toBe('fuzzy');
    });

    it('returns grouped structure when grouped=true query parameter is supplied', async () => {
      const res = await request(app).get('/api/music/search?q=tera%20mera%20rishta&grouped=true');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('exactMatches');
      expect(res.body).toHaveProperty('fuzzyMatches');
      expect(res.body).toHaveProperty('relatedMatches');
      expect(res.body).toHaveProperty('tracks');

      expect(Array.isArray(res.body.exactMatches)).toBe(true);
      expect(Array.isArray(res.body.fuzzyMatches)).toBe(true);
      expect(Array.isArray(res.body.relatedMatches)).toBe(true);
      expect(Array.isArray(res.body.tracks)).toBe(true);

      // Verify no duplicates across exact, fuzzy, and related buckets
      const exactIds = new Set(res.body.exactMatches.map(t => t.id));
      const fuzzyIds = new Set(res.body.fuzzyMatches.map(t => t.id));
      const relatedIds = new Set(res.body.relatedMatches.map(t => t.id));

      for (const id of exactIds) {
        expect(fuzzyIds.has(id)).toBe(false);
        expect(relatedIds.has(id)).toBe(false);
      }
      for (const id of fuzzyIds) {
        expect(exactIds.has(id)).toBe(false);
        expect(relatedIds.has(id)).toBe(false);
      }
    });

    it('preserves authoritative artist search: q=kumar&artist=Kishore Kumar gives same result set as artist-only search', async () => {
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
  });

  describe('4. Frontend UI Grouping & Rendering Helper (UI.renderGroupedSearchGrid)', () => {
    const fs = require('fs');
    const path = require('path');
    const vm = require('vm');

    let UI;

    beforeAll(() => {
      const mockDocument = {
        createElement: (tag) => {
          const el = {
            tagName: tag.toUpperCase(),
            className: '',
            style: {},
            dataset: {},
            children: [],
            innerHTML: '',
            appendChild: (child) => { el.children.push(child); return child; },
            replaceChildren: () => { el.children = []; },
            querySelectorAll: () => [],
            addEventListener: jest.fn(),
            setAttribute: jest.fn(),
            getAttribute: jest.fn(),
            removeAttribute: jest.fn()
          };
          return el;
        },
        createTextNode: (text) => ({ textContent: text })
      };

      const uiCode = fs.readFileSync(path.join(__dirname, '../public/js/ui.js'), 'utf8');
      const context = vm.createContext({
        document: mockDocument,
        window: {},
        console,
        setTimeout: (fn) => fn(),
        clearTimeout: () => {},
        location: { hash: '' }
      });

      vm.runInContext(uiCode, context);
      UI = vm.runInContext('UI', context);
    });

    it('renders exact and fuzzy sections without duplicating track cards', () => {
      const mockContainer = {
        className: '',
        children: [],
        replaceChildren: function() { this.children = []; },
        appendChild: function(c) { this.children.push(c); return c; }
      };

      const tracks = [
        { id: '1', title: 'Tera Mera Rishta', artist: 'Pritam', matchType: 'exact' },
        { id: '2', title: 'Rista Anokha', artist: 'Artist B', matchType: 'fuzzy' },
        { id: '3', title: 'Other Song', artist: 'Pritam', matchType: 'related' }
      ];

      UI.renderGroupedSearchGrid(tracks, mockContainer, 'tera mera');

      // Should have section headers and cards
      const headers = mockContainer.children.filter(c => c.className === 'search-group-header');
      expect(headers.length).toBe(3); // Exact, Fuzzy, and Related headers

      const cards = mockContainer.children.filter(c => c.className && c.className.includes('track-card'));
      expect(cards.length).toBe(3); // Exactly 3 cards, zero duplicates
    });
  });
});
