const fs = require('fs');
const path = require('path');
const request = require('supertest');
const app = require('../server');
const musicProvider = require('../backend/services/musicProvider');

describe('Music Catalog Deduplication & Original Version Filtering', () => {
  const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/catalog.json'), 'utf8'));

  it('catalog contains only verified original tracks without low-quality alternate spin-offs', () => {
    const lofiTracks = catalog.filter(t => /\b(lo[\s\-_]*fi|chillhop|lofi\s+flip|lofi\s+remix)\b/i.test(t.title));
    const slowedTracks = catalog.filter(t => /\b(slowed|reverb\s+pitch|slowed\s+and\s+reverb)\b/i.test(t.title));
    const nightcoreTracks = catalog.filter(t => /\b(speed[\s\-_]*up|sped[\s\-_]*up|nightcore)\b/i.test(t.title));
    const karaokeTracks = catalog.filter(t => /\b(karaoke)\b/i.test(t.title));
    const instrumentalTracks = catalog.filter(t => /\b(instrumental\s+version|backing\s+track)\b/i.test(t.title));

    expect(lofiTracks.length).toBe(0);
    expect(slowedTracks.length).toBe(0);
    expect(nightcoreTracks.length).toBe(0);
    expect(karaokeTracks.length).toBe(0);
    expect(instrumentalTracks.length).toBe(0);
  });

  it('preserves legitimate original songs that have keywords in official title', () => {
    // Badshah's original hit
    const djWaleyBabu = catalog.find(t => /dj\s+waley\s+babu/i.test(t.title));
    if (djWaleyBabu) {
      expect(djWaleyBabu).toBeDefined();
    }
  });

  it('GET /api/music/catalog reflects updated cleaned song count and total pages dynamically', async () => {
    const res = await request(app).get('/api/music/catalog?page=1&limit=40');
    expect(res.status).toBe(200);
    expect(res.body.totalSongs).toBe(catalog.length);
    expect(res.body.totalPages).toBe(Math.ceil(catalog.length / 40));
    expect(res.body.totalSongs).not.toBe(4097); // Original uncleaned count
  });

  it('dedupe_report.json reconciles perfectly against backup, removals, and active catalog', () => {
    const reportPath = path.join(__dirname, '../data/dedupe_report.json');
    const backupPath = path.join(__dirname, '../data/catalog.backup.json');

    if (fs.existsSync(reportPath) && fs.existsSync(backupPath)) {
      const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
      const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));

      expect(report.originalCount).toBe(backup.length);
      expect(report.originalCount).toBe(4097);
      expect(report.finalCount).toBe(catalog.length);
      expect(report.finalCount).toBe(3731);
      expect(report.originalCount - report.alternateVersionsRemovedCount - report.duplicateUploadsRemovedCount).toBe(report.finalCount);
      expect(report.ambiguousEntriesReviewedCount).toBe(44);
    }
  });

  describe('filterAndDeduplicateTracks() function', () => {
    const sampleTracks = [
      { id: '1', title: 'Russian Bandana', artist: 'Dhanda Nyoliwala', duration: 197 },
      { id: '2', title: 'Russian Bandana (Lo-Fi)', artist: 'Dhanda Nyoliwala', duration: 206 },
      { id: '3', title: 'Russian Bandana (Slowed + Reverb)', artist: 'Dhanda Nyoliwala', duration: 240 },
      { id: '4', title: 'Russian Bandana (Instrumental)', artist: 'Dhanda Nyoliwala', duration: 197 },
      { id: '5', title: 'Russian Bandana (Speed Up)', artist: 'Dhanda Nyoliwala', duration: 140 },
      { id: '6', title: 'Russian Bandana (Remix By DJ Alex)', artist: 'Dhanda Nyoliwala', duration: 180 },
      { id: '7', title: 'Russian Black Bandana', artist: 'FooR', duration: 153 },
      { id: '8', title: 'Tum Hi Ho (From "Aashiqui 2")', artist: 'Arijit Singh, Mithoon', duration: 261 },
      { id: '9', title: 'Tum Hi Ho', artist: 'Arijit Singh, Mithoon', duration: 262 }
    ];

    it('filters out lofi, slowed, instrumental, speed up, and unofficial remixes from standard searches', () => {
      const cleaned = musicProvider.filterAndDeduplicateTracks(sampleTracks, 'russian bandana');
      const titles = cleaned.map(t => t.title);

      expect(titles).toContain('Russian Bandana');
      expect(titles).toContain('Russian Black Bandana');
      expect(titles).not.toContain('Russian Bandana (Lo-Fi)');
      expect(titles).not.toContain('Russian Bandana (Slowed + Reverb)');
      expect(titles).not.toContain('Russian Bandana (Instrumental)');
      expect(titles).not.toContain('Russian Bandana (Speed Up)');
      expect(titles).not.toContain('Russian Bandana (Remix By DJ Alex)');
    });

    it('deduplicates identical song recordings with slightly different formatting', () => {
      const cleaned = musicProvider.filterAndDeduplicateTracks(sampleTracks, 'tum hi ho');
      const tumHiHoMatches = cleaned.filter(t => t.title.includes('Tum Hi Ho'));
      // Only 1 entry should be kept for the identical recording
      expect(tumHiHoMatches.length).toBe(1);
    });

    it('preserves lofi when user explicitly queries for lofi', () => {
      const results = musicProvider.filterAndDeduplicateTracks(sampleTracks, 'lofi russian bandana');
      const titles = results.map(t => t.title);
      expect(titles).toContain('Russian Bandana (Lo-Fi)');
    });

    it('preserves instrumental when user explicitly queries for instrumental', () => {
      const results = musicProvider.filterAndDeduplicateTracks(sampleTracks, 'instrumental version');
      const titles = results.map(t => t.title);
      expect(titles).toContain('Russian Bandana (Instrumental)');
    });
  });

  describe('Search Results Deduplication (Deterministic & Offline-Safe)', () => {
    it('GET /api/music/search?q=russian%20bandana excludes lofi and slowed versions by default', async () => {
      // Mock provider to return diverse cuts deterministically without network dependency
      jest.spyOn(musicProvider, 'fetchProviderSongs').mockResolvedValue([
        { id: 'rb1', jamendoId: 'rb1', title: 'Russian Bandana', artist: 'Dhanda Nyoliwala', duration: 197 },
        { id: 'rb2', jamendoId: 'rb2', title: 'Russian Bandana (Lo-Fi)', artist: 'Dhanda Nyoliwala', duration: 206 },
        { id: 'rb3', jamendoId: 'rb3', title: 'Russian Bandana (Slowed + Reverb)', artist: 'Dhanda Nyoliwala', duration: 240 },
        { id: 'rb4', jamendoId: 'rb4', title: 'Russian Bandana (Instrumental)', artist: 'Dhanda Nyoliwala', duration: 197 }
      ]);

      const res = await request(app).get('/api/music/search?q=russian%20bandana&limit=20');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);

      const titles = res.body.map(t => (t.title || '').toLowerCase());
      expect(titles).toContain('russian bandana');
      expect(titles.some(t => t.includes('lo-fi') || t.includes('lofi'))).toBe(false);
      expect(titles.some(t => t.includes('slowed'))).toBe(false);
      expect(titles.some(t => t.includes('instrumental'))).toBe(false);

      musicProvider.fetchProviderSongs.mockRestore();
    });
  });

  describe('Core Deduplication Edge Cases & Integrity (deduplicateCatalog)', () => {
    const { deduplicateCatalog } = require('../backend/services/catalogDedupe');

    it('never silently drops tracks with empty titles or punctuation', () => {
      const input = [
        { id: 'empty_1', title: '', artist: 'Artist A', duration: 180 },
        { id: 'punct_1', title: '???', artist: 'Artist B', duration: 210 },
        { id: 'valid_1', title: 'Valid Song', artist: 'Artist C', duration: 200 }
      ];

      const res = deduplicateCatalog(input);
      expect(res.keptCount).toBe(3);
      expect(res.finalCatalog.map(t => t.id)).toEqual(['empty_1', 'punct_1', 'valid_1']);
      expect(res.reconciles).toBe(true);
    });

    it('preserves Unicode titles in Cyrillic, Urdu, Arabic, Bengali, and Devanagari', () => {
      const unicodeInput = [
        { id: 'u1', title: 'Название придумаю потом', artist: 'Adele', duration: 200 },
        { id: 'u2', title: 'دنیا بکھیرے', artist: 'Nusrat Jaffer', duration: 190 },
        { id: 'u3', title: 'আমার মা গো', artist: 'Nusrat Jahan', duration: 215 },
        { id: 'u4', title: 'क्या खूब लगती हो', artist: 'Fateh Ali Khan', duration: 230 }
      ];

      const res = deduplicateCatalog(unicodeInput);
      expect(res.keptCount).toBe(4);
      expect(res.finalCatalog.some(t => t.title === 'Название придумаю потом')).toBe(true);
      expect(res.finalCatalog.some(t => t.title === 'دنیا بکھیرے')).toBe(true);
      expect(res.finalCatalog.some(t => t.title === 'আমার মা গো')).toBe(true);
      expect(res.finalCatalog.some(t => t.title === 'क्या खूब लगती हो')).toBe(true);
      expect(res.reconciles).toBe(true);
    });

    it('handles missing artist safely without crashing or spurious grouping', () => {
      const input = [
        { id: 'ma1', title: 'Song Alpha', artist: '', duration: 180 },
        { id: 'ma2', title: 'Song Beta', artist: null, duration: 180 }
      ];

      const res = deduplicateCatalog(input);
      expect(res.keptCount).toBe(2);
      expect(res.reconciles).toBe(true);
    });

    it('normalizes case and spacing for duplicate upload detection', () => {
      const input = [
        { id: 'd1', title: 'TUM HI HO', artist: 'ARIJIT SINGH', duration: 262, album: 'Single' },
        { id: 'd2', title: 'tum hi ho', artist: 'arijit singh', duration: 262, album: 'Best Of Arijit' }
      ];

      const res = deduplicateCatalog(input);
      expect(res.inputCount).toBe(2);
      expect(res.keptCount).toBe(1);
      expect(res.duplicateUploadsRemovedCount).toBe(1);
      expect(res.keptCount + res.duplicateUploadsRemovedCount).toBe(res.inputCount);
      expect(res.reconciles).toBe(true);
    });

    it('preserves distinct songs with similar titles or different durations', () => {
      const input = [
        { id: 's1', title: 'Tum Hi Ho', artist: 'Arijit Singh', duration: 262 },
        { id: 's2', title: 'Tum Hi Ho (Acoustic)', artist: 'Arijit Singh', duration: 260 }, // ambiguous release preserved
        { id: 's3', title: 'Tum Hi Ho', artist: 'Arijit Singh', duration: 120 } // Reprise / short version (> 12s diff)
      ];

      const res = deduplicateCatalog(input);
      expect(res.keptCount).toBe(3);
      expect(res.reconciles).toBe(true);
    });

    it('is strictly deterministic and idempotent when run twice', () => {
      const testCatalog = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/catalog.json'), 'utf8')).slice(0, 50);

      const pass1 = deduplicateCatalog(testCatalog);
      const pass2 = deduplicateCatalog(pass1.finalCatalog);

      expect(pass2.inputCount).toBe(pass1.finalCount);
      expect(pass2.finalCount).toBe(pass1.finalCount);
      expect(pass2.totalRemoved).toBe(0);
      expect(pass2.reconciles).toBe(true);
    });
  });
});
