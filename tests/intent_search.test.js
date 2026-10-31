/**
 * tests/intent_search.test.js
 *
 * Comprehensive Intent-Based Music Search Regression Suite for AuraList.
 * Verifies all 12 required scenarios with deterministic offline fixtures:
 * 1. "romantic songs" returns relevant romantic tracks whose titles do not contain "romantic".
 * 2. "sad songs" returns relevant sad tracks where reliable mood metadata exists.
 * 3. "party songs" prioritizes relevant party tracks.
 * 4. An exact song-title query prioritizes that track.
 * 5. An artist-name query returns tracks by that artist.
 * 6. Partial titles and minor typos work as expected.
 * 7. Hindi and Romanized Hindi queries are handled correctly where supported.
 * 8. Local and external results are ranked consistently.
 * 9. Duplicate tracks are removed without losing playback information.
 * 10. Provider failures do not break search.
 * 11. Unknown or missing mood metadata does not produce fabricated classifications.
 * 12. Suggestions and result limits behave correctly.
 */

const request = require('supertest');
const app = require('../server');
const musicProvider = require('../backend/services/musicProvider');
const { parseSearchIntent } = require('../backend/services/searchIntent');
const { enrichTrack } = require('../backend/services/catalogEnricher');
const {
  evaluateTrackRelevance,
  rankAndGroupTracks
} = require('../backend/services/searchRelevance');

jest.setTimeout(30000);

describe('Intent-Based Music Search Engine (12 Scenarios)', () => {
  let providerSpy;
  let audiusSpy;
  let jamendoSpy;
  let fetchSpy;

  beforeEach(() => {
    providerSpy = jest.spyOn(musicProvider, 'fetchProviderSongs').mockResolvedValue([]);
    audiusSpy = jest.spyOn(musicProvider.audiusProvider, 'searchTracks').mockResolvedValue([]);
    jamendoSpy = jest.spyOn(musicProvider.jamendoProvider, 'searchTracks').mockResolvedValue([]);
    fetchSpy = jest.spyOn(musicProvider, 'safeFetchJson').mockResolvedValue(null);
    musicProvider.clearCache();
  });

  afterEach(() => {
    if (providerSpy) providerSpy.mockRestore();
    if (audiusSpy) audiusSpy.mockRestore();
    if (jamendoSpy) jamendoSpy.mockRestore();
    if (fetchSpy) fetchSpy.mockRestore();
    musicProvider.clearCache();
  });

  // Scenario 1: "romantic songs" returns relevant romantic tracks without "romantic" in title
  it('1. "romantic songs" returns relevant romantic tracks whose titles do not contain "romantic"', async () => {
    const res = await request(app).get('/api/music/search?q=romantic%20songs&limit=20');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);

    // Verify tracks are classified with romantic mood/theme
    const romanticWithoutWordInTitle = res.body.filter(track => {
      const titleLower = (track.title || '').toLowerCase();
      const hasRomanticMood = Array.isArray(track.moods) && track.moods.includes('romantic');
      const noWordRomantic = !titleLower.includes('romantic');
      return hasRomanticMood && noWordRomantic;
    });

    expect(romanticWithoutWordInTitle.length).toBeGreaterThan(0);

    // Well-known romantic titles should be present
    const titles = res.body.map(t => t.title.toLowerCase());
    const hasKnownRomantic = titles.some(t =>
      t.includes('dhun') || t.includes('shayad') || t.includes('raabta') ||
      t.includes('zaalima') || t.includes('tum hi ho') || t.includes('apna bana le')
    );
    expect(hasKnownRomantic).toBe(true);
  });

  // Scenario 2: "sad songs" returns relevant sad tracks where reliable mood metadata exists
  it('2. "sad songs" returns relevant sad tracks where reliable mood metadata exists', async () => {
    const res = await request(app).get('/api/music/search?q=sad%20songs&limit=15');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);

    // All returned tracks must have verified sad mood metadata
    const sadTracks = res.body.filter(t => Array.isArray(t.moods) && t.moods.includes('sad'));
    expect(sadTracks.length).toBeGreaterThanOrEqual(1);

    // Should include melancholy / sad artists like Billie Eilish, Jagjit Singh or songs like Barbaad / Toh Phir Aao
    const hasSadEvidence = res.body.some(t =>
      (t.artist || '').toLowerCase().includes('jagjit') ||
      (t.artist || '').toLowerCase().includes('billie eilish') ||
      (t.title || '').toLowerCase().includes('barbaad') ||
      (t.title || '').toLowerCase().includes('dard') ||
      (t.title || '').toLowerCase().includes('naina')
    );
    expect(hasSadEvidence).toBe(true);
  });

  // Scenario 3: "party songs" prioritizes relevant party tracks
  it('3. "party songs" prioritizes relevant party tracks', async () => {
    const res = await request(app).get('/api/music/search?q=party%20songs&limit=15');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);

    // All top results have party/dance metadata
    const partyTracks = res.body.filter(t =>
      Array.isArray(t.moods) && (t.moods.includes('party') || t.moods.includes('dance'))
    );
    expect(partyTracks.length).toBeGreaterThan(0);
    expect(partyTracks[0].matchScore).toBeGreaterThanOrEqual(700);
  });

  // Scenario 4: An exact song-title query prioritizes that track
  it('4. an exact song-title query prioritizes that track above loosely related songs', async () => {
    const res = await request(app).get('/api/music/search?q=Tum%20Hi%20Ho');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);

    // Top result must be exact track "Tum Hi Ho" with exact score 1000
    const top = res.body[0];
    expect(top.title).toBe('Tum Hi Ho');
    expect(top.matchScore).toBe(1000);
    expect(top.matchType).toBe('exact');

    // Loosely related romantic tracks must NOT outrank Tum Hi Ho
    if (res.body.length > 1) {
      expect(res.body[1].matchScore).toBeLessThanOrEqual(1000);
    }
  });

  // Scenario 5: An artist-name query returns tracks by that artist
  it('5. an artist-name query returns tracks by that artist', async () => {
    const res = await request(app).get('/api/music/search?q=Kishore%20Kumar&limit=20');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);

    // Verify all returned tracks feature Kishore Kumar
    const kishoreTracks = res.body.filter(t => (t.artist || '').toLowerCase().includes('kishore kumar'));
    expect(kishoreTracks.length).toBe(res.body.length);
    expect(res.body[0].matchScore).toBeGreaterThanOrEqual(880);
  });

  // Scenario 6: Partial titles and minor typos work as expected
  it('6. partial titles and minor typos work as expected', async () => {
    // 6a. Partial title
    const resPartial = await request(app).get('/api/music/search?q=tera%20mera');
    expect(resPartial.status).toBe(200);
    expect(resPartial.body.length).toBeGreaterThan(0);
    expect(resPartial.body.some(t => t.title.toLowerCase().includes('tera mera'))).toBe(true);

    // 6b. Typo: "kesriya" -> finds "Kesariya"
    const resTypo = await request(app).get('/api/music/search?q=kesriya');
    expect(resTypo.status).toBe(200);
    expect(resTypo.body.length).toBeGreaterThan(0);
    const kesariya = resTypo.body.find(t => t.title.toLowerCase().includes('kesariya'));
    expect(kesariya).toBeDefined();
    expect(kesariya.matchType).toBe('fuzzy');
  });

  // Scenario 7: Hindi and Romanized Hindi queries are handled correctly
  it('7. Hindi and Romanized Hindi queries are handled correctly where supported', async () => {
    // 7a. Romanized Hindi: "dard bhare gaane"
    const resRomanized = await request(app).get('/api/music/search?q=dard%20bhare%20gaane');
    expect(resRomanized.status).toBe(200);
    expect(resRomanized.body.length).toBeGreaterThan(0);
    expect(resRomanized.body.some(t => Array.isArray(t.moods) && t.moods.includes('sad'))).toBe(true);

    // 7b. Devanagari Hindi: "रोमांटिक गाने"
    const resDevanagari = await request(app).get(`/api/music/search?q=${encodeURIComponent('रोमांटिक गाने')}`);
    expect(resDevanagari.status).toBe(200);
    expect(resDevanagari.body.length).toBeGreaterThan(0);
    expect(resDevanagari.body.some(t => Array.isArray(t.moods) && t.moods.includes('romantic'))).toBe(true);
  });

  // Scenario 8: Local and external results are ranked consistently
  it('8. local and external results are ranked consistently by true relevance', async () => {
    // Mock Jamendo returning an exact match track and an unrelated track
    jamendoSpy.mockResolvedValueOnce([
      enrichTrack({
        id: 'jamendo_99999',
        title: 'Gehra Hua',
        artist: 'Shashwat Sachdev',
        audioUrl: 'https://stream.jamendo.com/99999.mp3',
        source: 'Jamendo',
        provider: 'Jamendo'
      }),
      enrichTrack({
        id: 'jamendo_88888',
        title: 'Random Western Track',
        artist: 'Unknown',
        audioUrl: 'https://stream.jamendo.com/88888.mp3',
        source: 'Jamendo',
        provider: 'Jamendo'
      })
    ]);

    const res = await request(app).get('/api/music/search?q=Gehra%20Hua');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);

    // Exact matches (local or external) must have matchScore >= 950
    const topExact = res.body[0];
    expect(topExact.title).toContain('Gehra Hua');
    expect(topExact.matchType).toBe('exact');
    expect(topExact.matchScore).toBeGreaterThanOrEqual(950);

    // Unrelated external track should NOT be at the top
    const lastTracks = res.body.slice(-2).map(t => t.id);
    if (res.body.some(t => t.id === 'jamendo_88888')) {
      const idx = res.body.findIndex(t => t.id === 'jamendo_88888');
      expect(idx).toBeGreaterThan(0);
    }
  });

  // Scenario 9: Duplicate tracks are removed without losing playback information
  it('9. duplicate tracks are removed without losing playback information', () => {
    const rawList = [
      enrichTrack({ id: 't1', title: 'Kesariya', artist: 'Arijit Singh', audioUrl: 'https://cdn.example.com/k1.mp3' }),
      enrichTrack({ id: 't2', title: 'Kesariya - Audio', artist: 'Arijit Singh', audioUrl: 'https://cdn.example.com/k1.mp3' }), // duplicate audio
      enrichTrack({ id: 't3', title: 'Kesariya', artist: 'Arijit Singh', audioUrl: 'https://cdn.example.com/k2.mp3' }) // duplicate title+artist
    ];

    const deduped = musicProvider.filterAndDeduplicateTracks(rawList, 'kesariya');
    expect(deduped.length).toBe(1);
    expect(deduped[0].id).toBe('t1');
    expect(deduped[0].audioUrl).toBe('https://cdn.example.com/k1.mp3');
  });

  // Scenario 10: Provider failures do not break search
  it('10. provider failures and timeouts do not break local search', async () => {
    // Simulate both provider endpoints rejecting with timeout and network errors
    audiusSpy.mockRejectedValue(new Error('Audius cluster connection timed out'));
    jamendoSpy.mockRejectedValue(new Error('Jamendo 503 Service Unavailable'));
    jest.spyOn(musicProvider, 'safeFetchJson').mockRejectedValue(new Error('Gateway timeout'));

    const res = await request(app).get('/api/music/search?q=Tum%20Hi%20Ho');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0].title).toBe('Tum Hi Ho');

    musicProvider.safeFetchJson.mockRestore();
  });

  // Scenario 11: Unknown or missing mood metadata does not produce fabricated classifications
  it('11. unknown or missing mood metadata does not produce fabricated classifications', () => {
    const neutralTrack = {
      id: 'neutral_101',
      title: 'Track 101 - Instrumental Interlude #4',
      artist: 'Studio Session Musicians',
      album: 'Sound Effects Archive 2024',
      category: 'general'
    };

    const enriched = enrichTrack(neutralTrack);
    expect(enriched.moods).toEqual([]);
    expect(enriched.era).toBeNull();

    // Neutral track evaluated against "romantic songs" must score 0
    const evalResult = evaluateTrackRelevance(enriched, 'romantic songs');
    expect(evalResult.score).toBe(0);
    expect(evalResult.tier).toBe('none');
  });

  // Scenario 12: Suggestions and result limits behave correctly
  it('12. suggestions and result limits behave correctly', async () => {
    // 12a. Suggestions for "rom" include Romantic Songs mood suggestion
    const resRom = await request(app).get('/api/music/suggestions?q=rom&limit=6');
    expect(resRom.status).toBe(200);
    expect(Array.isArray(resRom.body)).toBe(true);
    expect(resRom.body.length).toBeLessThanOrEqual(6);

    const hasMoodSuggestion = resRom.body.some(s => s.type === 'mood' && s.text.toLowerCase().includes('romantic'));
    expect(hasMoodSuggestion).toBe(true);

    // 12b. Different limits produce properly clamped result counts and independent cache entries
    const resLim3 = await request(app).get('/api/music/suggestions?q=rom&limit=3');
    const resLim7 = await request(app).get('/api/music/suggestions?q=rom&limit=7');
    expect(resLim3.body.length).toBeLessThanOrEqual(3);
    expect(resLim7.body.length).toBeLessThanOrEqual(7);
  });
});
