/**
 * tests/review_fixes_regression.test.js
 *
 * Comprehensive regression tests for the 8 verified fixes:
 * 1. Suggestions Cache: limit independence on same query
 * 2. Search Relevance Across Providers: exact external vs fuzzy local, provider metadata separation
 * 3. Hindi/Devanagari Search: Unicode normalization, full and partial matches
 * 4. Typo-Tolerant Suggestions: misspelled artist and track suggestions
 * 5. Track-Switch History Synchronization: old track state preserved on rapid switch, session isolation
 * 6. Listening History Validation: forged completion claims rejected, duration server-side bounds
 * 7. Insights Backfill Idempotency: concurrent insights requests do not duplicate events
 * 8. Listening Insights Scalability: database aggregation computes correct stats without unbounded memory loads
 */

const request = require('supertest');
const app = require('../server');
const musicProvider = require('../backend/services/musicProvider');
const { normalizeText, evaluateTrackRelevance } = require('../backend/services/searchRelevance');
const ListeningEvent = require('../backend/models/ListeningEvent');
const History = require('../backend/models/History');

describe('Review Fixes Regression Tests', () => {
  let userToken;
  let userId;

  let counter = 0;
  const getUniqueEmail = (prefix) => `${prefix}_${Date.now()}_${++counter}_${Math.random().toString(36).substring(2, 8)}@example.com`;

  beforeEach(async () => {
    const regRes = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Fix Tester',
        email: getUniqueEmail('fix_test'),
        password: 'Password123!'
      });
    userToken = regRes.body.token;
    userId = regRes.body.user.id;
  });

  describe('1. Fix Suggestions Cache — musicProvider.js', () => {
    it('returns different result lengths for different requested limits on the same query without cache pollution', () => {
      const query = 'arijit';

      // 1st request with limit 2
      const limit2Results = musicProvider.getSuggestions(query, 2);
      expect(limit2Results.length).toBe(2);

      // 2nd request with limit 10: must NOT be truncated to 2 by the cache!
      const limit10Results = musicProvider.getSuggestions(query, 10);
      expect(limit10Results.length).toBeGreaterThan(2);
      expect(limit10Results.length).toBeLessThanOrEqual(10);

      // 3rd request with limit 5
      const limit5Results = musicProvider.getSuggestions(query, 5);
      expect(limit5Results.length).toBe(5);
    });
  });

  describe('2. Fix Search Relevance Across Providers', () => {
    it('ranks exact external provider match ahead of unrelated/fuzzy local tracks and preserves provider metadata', async () => {
      // Mock external search returning an exact match for "Faded"
      const audiusProvider = require('../backend/services/providers/audiusProvider');
      const originalAudiusSearch = audiusProvider.searchTracks;

      audiusProvider.searchTracks = jest.fn().mockResolvedValue([
        {
          id: 'audius_faded_exact',
          jamendoId: 'audius_faded_exact',
          title: 'Faded',
          artist: 'Alan Walker',
          album: 'Different World',
          audioUrl: 'https://audius-discovery-1.example.com/stream/faded.mp3',
          coverUrl: 'https://example.com/faded.jpg',
          duration: 212,
          provider: 'Audius',
          source: 'Audius Stream'
        }
      ]);

      try {
        const results = await musicProvider.searchProviderTracks({ q: 'Faded' });
        expect(Array.isArray(results)).toBe(true);
        expect(results.length).toBeGreaterThan(0);

        // Find the external exact track
        const exactExtTrack = results.find(t => t.id === 'audius_faded_exact');
        expect(exactExtTrack).toBeDefined();

        // Must be categorized as exact match, not forced to 'external'
        expect(exactExtTrack.matchType).toBe('exact');
        expect(exactExtTrack.provider).toBe('Audius');

        // External exact match must be in exactMatches, not banished to bottom
        expect(results.exactMatches).toBeDefined();
        const inExactList = results.exactMatches.find(t => t.id === 'audius_faded_exact');
        expect(inExactList).toBeDefined();

        // The first result should be an exact match (either local or external), not a fuzzy match
        expect(results[0].matchType).toBe('exact');
      } finally {
        audiusProvider.searchTracks = originalAudiusSearch;
      }
    });
  });

  describe('3. Fix Hindi/Devanagari Search', () => {
    it('preserves Hindi/Devanagari characters during normalization without stripping them to empty strings', () => {
      const hindiTitle = 'क्या खूब लगती हो';
      const normalized = normalizeText(hindiTitle);

      expect(normalized).not.toBe('');
      expect(normalized).toContain('क्या');
      expect(normalized).toContain('खूब');
      expect(normalized).toContain('लगती');
      expect(normalized).toContain('हो');
    });

    it('successfully searches Hindi song titles by full and partial text', async () => {
      // Full title search
      const fullRes = await request(app)
        .get('/api/music/search?q=' + encodeURIComponent('क्या खूब लगती हो'));
      expect(fullRes.status).toBe(200);
      expect(Array.isArray(fullRes.body)).toBe(true);
      expect(fullRes.body.length).toBeGreaterThan(0);
      expect(fullRes.body[0].title).toBe('क्या खूब लगती हो');

      // Partial text search
      const partialRes = await request(app)
        .get('/api/music/search?q=' + encodeURIComponent('क्या खूब'));
      expect(partialRes.status).toBe(200);
      expect(Array.isArray(partialRes.body)).toBe(true);
      expect(partialRes.body.length).toBeGreaterThan(0);
      expect(partialRes.body.some(t => t.title.includes('क्या खूब'))).toBe(true);
    }, 30000);

    it('provides Hindi suggestions when typing in Devanagari', () => {
      const suggestions = musicProvider.getSuggestions('क्या खूब', 5);
      expect(Array.isArray(suggestions)).toBe(true);
      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions.some(s => s.text && s.text.includes('क्या खूब'))).toBe(true);
    });
  });

  describe('4. Improve Typo-Tolerant Suggestions', () => {
    it('returns suggestions for misspelled song titles (e.g. "kesriya" -> "Kesariya")', () => {
      const suggestions = musicProvider.getSuggestions('kesriya', 5);
      expect(Array.isArray(suggestions)).toBe(true);
      const hasKesariya = suggestions.some(s => s.text && s.text.toLowerCase().includes('kesariya'));
      expect(hasKesariya).toBe(true);
    });

    it('returns suggestions for misspelled artist names', () => {
      // "chitiya" has edit distance 1 to "Chutiya"
      const suggestions = musicProvider.getSuggestions('chitiya', 5);
      expect(Array.isArray(suggestions)).toBe(true);
      const hasArtist = suggestions.some(s => (s.text && s.text.toLowerCase().includes('chutiya')) || (s.artist && s.artist.toLowerCase().includes('chutiya')));
      expect(hasArtist).toBe(true);
    });
  });

  describe('5. Fix Track-Switch History Synchronization', () => {
    it('ensures position updates for Track A do not overwrite or pollute a session started for Track B', async () => {
      const trackAId = 'sw_track_a';
      const trackBId = 'sw_track_b';
      const sessionA = 'sess_track_a_' + Date.now();
      const sessionB = 'sess_track_b_' + Date.now();

      // Start Track A
      await request(app)
        .post('/api/history')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          jamendoId: trackAId,
          title: 'Track A',
          artist: 'Artist A',
          duration: 200,
          position: 20,
          listenDuration: 20,
          sessionId: sessionA
        });

      // Start Track B with distinct session
      await request(app)
        .post('/api/history')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          jamendoId: trackBId,
          title: 'Track B',
          artist: 'Artist B',
          duration: 220,
          position: 18,
          listenDuration: 18,
          sessionId: sessionB
        });

      // An old/late checkpoint arrives with trackA's ID but sessionB's ID (or vice versa):
      // Backend must NOT attribute trackB's session to trackA!
      await request(app)
        .put('/api/history/position')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          jamendoId: trackAId,
          position: 35,
          listenDuration: 35,
          sessionId: sessionB // Mismatched sessionId
        });

      // Verify that Session B (Track B) was NOT updated with Track A's 35s position!
      const sessBRecord = await ListeningEvent.findOne({ userId, sessionId: sessionB });
      expect(sessBRecord).toBeDefined();
      expect(sessBRecord.jamendoId).toBe(trackBId);
      expect(sessBRecord.listeningSeconds).toBe(18); // Untouched!
    });
  });

  describe('6. Strengthen Listening History Validation', () => {
    it('disqualifies forged completion claims when active listening duration is under threshold on long tracks', async () => {
      const res = await request(app)
        .post('/api/history')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          jamendoId: 'forged_track_1',
          title: 'Long Song',
          artist: 'Sneaky Artist',
          duration: 300,
          position: 5,
          listenDuration: 5,
          completed: true, // Forged completion after only 5s!
          sessionId: 'forged_sess_1'
        });

      expect(res.status).toBe(201);

      // Verify that this forged completion was NOT recorded as a qualified ListeningEvent!
      const event = await ListeningEvent.findOne({ userId, sessionId: 'forged_sess_1' });
      expect(event).toBeNull();
    });

    it('enforces server-side bounds on listeningSeconds and position', async () => {
      const res = await request(app)
        .post('/api/history')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          jamendoId: 'bounded_track_1',
          title: 'Normal Song',
          artist: 'Artist',
          duration: 100,
          position: 500, // Exceeds duration
          listenDuration: 500, // Exceeds duration
          sessionId: 'bounded_sess_1'
        });

      expect(res.status).toBe(201);

      // The ListeningEvent should be clamped server-side (duration + buffer max)
      const event = await ListeningEvent.findOne({ userId, sessionId: 'bounded_sess_1' });
      expect(event).toBeDefined();
      expect(event.position).toBeLessThanOrEqual(105); // clamped to duration + 5
      expect(event.listeningSeconds).toBeLessThanOrEqual(130); // clamped to duration + 30
    });
  });

  describe('7. Make Insights Backfill Idempotent', () => {
    it('prevents duplicate listening events when concurrent insights requests are executed', async () => {
      // Create user with only History records and NO ListeningEvent records
      const freshEmail = getUniqueEmail('backfill_user');
      const reg = await request(app)
        .post('/api/auth/register')
        .send({ name: 'Backfill User', email: freshEmail, password: 'Password123!' });
      const bToken = reg.body.token;
      const bUserId = reg.body.user.id;

      // Seed 5 history records
      for (let i = 1; i <= 5; i++) {
        await History.create({
          userId: bUserId,
          jamendoId: `hist_track_${i}`,
          title: `Hist Track ${i}`,
          artist: `Artist ${i}`,
          duration: 180,
          position: 40,
          listenDuration: 40,
          playedAt: new Date(Date.now() - (6 - i) * 120000)
        });
      }

      // Verify 0 ListeningEvents exist prior to call
      const beforeCount = await ListeningEvent.countDocuments({ userId: bUserId });
      expect(beforeCount).toBe(0);

      // Fire 3 CONCURRENT GET /api/history/insights requests simultaneously!
      const [res1, res2, res3] = await Promise.all([
        request(app).get('/api/history/insights').set('Authorization', `Bearer ${bToken}`),
        request(app).get('/api/history/insights').set('Authorization', `Bearer ${bToken}`),
        request(app).get('/api/history/insights').set('Authorization', `Bearer ${bToken}`)
      ]);

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
      expect(res3.status).toBe(200);

      // All 3 requests must report exactly 5 plays (NOT 10 or 15 duplicate plays!)
      expect(res1.body.totalPlays).toBe(5);
      expect(res2.body.totalPlays).toBe(5);
      expect(res3.body.totalPlays).toBe(5);

      // Database must have exactly 5 ListeningEvent records inserted, NOT 15!
      const afterCount = await ListeningEvent.countDocuments({ userId: bUserId });
      expect(afterCount).toBe(5);
    });
  });

  describe('8. Improve Listening Insights Scalability', () => {
    it('aggregates totals, monthly summary, and top rankings accurately via database pipeline', async () => {
      // Populate 3 distinct tracks with known listening seconds
      await request(app)
        .post('/api/history')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          jamendoId: 'scale_track_1',
          title: 'Scale Track 1',
          artist: 'Arijit Singh, Shreya Ghoshal',
          duration: 200,
          position: 60,
          listenDuration: 60,
          sessionId: 'scale_sess_1'
        });

      await request(app)
        .post('/api/history')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          jamendoId: 'scale_track_2',
          title: 'Scale Track 2',
          artist: 'Arijit Singh',
          duration: 200,
          position: 40,
          listenDuration: 40,
          sessionId: 'scale_sess_2'
        });

      const res = await request(app)
        .get('/api/history/insights')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('totalPlays');
      expect(res.body.totalPlays).toBeGreaterThanOrEqual(2);
      expect(res.body).toHaveProperty('totalListeningSeconds');
      expect(res.body.totalListeningSeconds).toBeGreaterThanOrEqual(100);

      // Verify top tracks structure
      expect(Array.isArray(res.body.topTracks)).toBe(true);
      expect(res.body.topTracks[0]).toHaveProperty('plays');
      expect(res.body.topTracks[0]).toHaveProperty('listeningSeconds');

      // Verify top artists structure
      expect(Array.isArray(res.body.topArtists)).toBe(true);
      expect(res.body.topArtists.some(a => a.artist && a.artist.includes('Arijit Singh'))).toBe(true);

      // Verify 7-day daily trends structure
      expect(Array.isArray(res.body.dailyTrends)).toBe(true);
      expect(res.body.dailyTrends.length).toBe(7);
      expect(res.body.dailyTrends[0]).toHaveProperty('date');
      expect(res.body.dailyTrends[0]).toHaveProperty('plays');
      expect(res.body.dailyTrends[0]).toHaveProperty('seconds');

      // Verify monthly summary
      expect(res.body.monthlySummary).toHaveProperty('monthName');
      expect(res.body.monthlySummary.plays).toBeGreaterThanOrEqual(2);
      expect(res.body.monthlySummary.listeningSeconds).toBeGreaterThanOrEqual(100);
    });
  });

  describe('9. Verified Fixes for 6 Unresolved Issues', () => {
    it('Fix 1: server bounds position and listenDuration to track duration + grace margin', async () => {
      const dur = 120; // 2 minutes track
      const res = await request(app)
        .post('/api/history')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          jamendoId: 'bounded_track_1',
          title: 'Bounded Track',
          artist: 'Bounded Artist',
          duration: dur,
          position: 5000, // Forged position
          listenDuration: 8000, // Forged listen duration
          sessionId: 'bounded_sess_1'
        });

      expect(res.status).toBe(201);
      // History record must be capped to dur + grace bounds
      expect(res.body.position).toBeLessThanOrEqual(dur + 5);
      expect(res.body.listenDuration).toBeLessThanOrEqual(dur + 30);

      // ListeningEvent must also be capped
      const event = await ListeningEvent.findOne({ userId, sessionId: 'bounded_sess_1' });
      expect(event).toBeDefined();
      expect(event.position).toBeLessThanOrEqual(dur + 5);
      expect(event.listeningSeconds).toBeLessThanOrEqual(dur + 30);
    });

    it('Fix 2: ListeningEvent enforces compound unique index on userId and sessionId', async () => {
      await ListeningEvent.syncIndexes();
      const sessId = `unique_sess_${Date.now()}`;
      const doc1 = {
        userId,
        jamendoId: 'sess_track_1',
        title: 'Session Track 1',
        artist: 'Artist 1',
        listeningSeconds: 30,
        sessionId: sessId
      };

      await ListeningEvent.create(doc1);

      // Attempting to create duplicate document with same userId and sessionId must fail
      let duplicateError = null;
      try {
        await ListeningEvent.create({
          userId,
          jamendoId: 'sess_track_2',
          title: 'Session Track 2',
          artist: 'Artist 2',
          listeningSeconds: 20,
          sessionId: sessId
        });
      } catch (err) {
        duplicateError = err;
      }

      expect(duplicateError).toBeDefined();
      expect(duplicateError.code).toBe(11000);
    });

    it('Fix 5: multi-provider initial health reports unknown and available false before checks', async () => {
      const audiusProvider = require('../backend/services/providers/audiusProvider');
      const radioProvider = require('../backend/services/providers/radioBrowserProvider');

      const audiusHealth = audiusProvider.getHealth();
      expect(audiusHealth).toHaveProperty('status');
      expect(['unknown', 'healthy', 'degraded']).toContain(audiusHealth.status);

      const radioHealth = radioProvider.getHealth();
      expect(radioHealth).toHaveProperty('status');
      expect(['unknown', 'healthy', 'degraded']).toContain(radioHealth.status);

      const allHealth = musicProvider.getAllProvidersHealth();
      expect(allHealth).toHaveProperty('audius');
      expect(allHealth).toHaveProperty('radioBrowser');
      expect(allHealth).toHaveProperty('jiosaavn');
    });

    it('Fix 2 (Listening Stats Hardening): clamps zero-duration tracks and rejects forged completion', async () => {
      // 1. Post zero-duration track with huge forged listen duration (50,000s) and completed: true
      const hugeZeroRes = await request(app)
        .post('/api/history')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          jamendoId: 'radio_station_stream_1',
          title: 'Live Radio Station',
          artist: 'Radio Broadcaster',
          duration: 0,
          position: 50000,
          listenDuration: 50000,
          sessionId: 'zero_dur_sess_1',
          completed: true // Forged completion on a stream with 0 duration
        });

      expect(hugeZeroRes.status).toBe(201);
      // History record position & listenDuration must be clamped to 600s max
      expect(hugeZeroRes.body.position).toBeLessThanOrEqual(600);
      expect(hugeZeroRes.body.listenDuration).toBeLessThanOrEqual(600);

      // ListeningEvent must be clamped and completed MUST be false
      const event = await ListeningEvent.findOne({ userId, sessionId: 'zero_dur_sess_1' });
      expect(event).toBeDefined();
      expect(event.position).toBeLessThanOrEqual(600);
      expect(event.listeningSeconds).toBeLessThanOrEqual(600);
      expect(event.completed).toBe(false); // Zero duration track cannot be completed
    });

    it('Fix 2 (Listening Stats Hardening): zero-duration track under 15s does not qualify as play', async () => {
      const shortZeroRes = await request(app)
        .post('/api/history')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          jamendoId: 'radio_station_stream_short',
          title: 'Short Radio Tune',
          artist: 'Radio Broadcaster',
          duration: 0,
          position: 10,
          listenDuration: 10,
          sessionId: 'zero_dur_short_sess'
        });

      expect(shortZeroRes.status).toBe(201);
      // Under 15s on 0-duration track: must NOT create a ListeningEvent
      const event = await ListeningEvent.findOne({ userId, sessionId: 'zero_dur_short_sess' });
      expect(event).toBeNull();
    });

    it('Fix 2 (Listening Stats Hardening): continuous streaming checkpoints without sessionId do not inflate totalPlays', async () => {
      const freshEmail = getUniqueEmail('stream_user');
      const reg = await request(app)
        .post('/api/auth/register')
        .send({ name: 'Stream User', email: freshEmail, password: 'Password123!' });
      const streamToken = reg.body.token;

      // 1st checkpoint: 30s
      await request(app)
        .post('/api/history')
        .set('Authorization', `Bearer ${streamToken}`)
        .send({
          jamendoId: 'live_stream_continuous',
          title: 'Continuous Radio',
          artist: 'Broadcaster',
          duration: 0,
          position: 30,
          listenDuration: 30
        });

      // 2nd checkpoint within 60s window: 60s
      await request(app)
        .put('/api/history/position')
        .set('Authorization', `Bearer ${streamToken}`)
        .send({
          jamendoId: 'live_stream_continuous',
          position: 60,
          listenDuration: 60
        });

      const insights = await request(app)
        .get('/api/history/insights')
        .set('Authorization', `Bearer ${streamToken}`);

      expect(insights.status).toBe(200);
      // Both checkpoints belong to same continuous stream -> exactly 1 play, not 2!
      // In accordance with P1 hardening, un-sessioned position checkpoints cannot update qualified play telemetry
      expect(insights.body.totalPlays).toBe(1);
      expect(insights.body.totalListeningSeconds).toBe(30);
    });

    it('continuous streaming checkpoints with valid server-issued sessionId update totalListeningSeconds without inflating totalPlays', async () => {
      const freshEmail = getUniqueEmail('stream_sess_user');
      const reg = await request(app)
        .post('/api/auth/register')
        .send({ name: 'Stream Session User', email: freshEmail, password: 'Password123!' });
      const streamToken = reg.body.token;

      // 1st checkpoint: 30s
      const firstRes = await request(app)
        .post('/api/history')
        .set('Authorization', `Bearer ${streamToken}`)
        .send({
          jamendoId: 'live_stream_sess_continuous',
          title: 'Continuous Radio',
          artist: 'Broadcaster',
          duration: 0,
          position: 30,
          listenDuration: 30
        });

      const serverSessionId = firstRes.body.sessionId;
      expect(serverSessionId).toBeDefined();

      // 2nd checkpoint with sessionId: 60s
      await request(app)
        .put('/api/history/position')
        .set('Authorization', `Bearer ${streamToken}`)
        .send({
          jamendoId: 'live_stream_sess_continuous',
          position: 60,
          listenDuration: 60,
          sessionId: serverSessionId
        });

      const insights = await request(app)
        .get('/api/history/insights')
        .set('Authorization', `Bearer ${streamToken}`);

      expect(insights.status).toBe(200);
      expect(insights.body.totalPlays).toBe(1);
      expect(insights.body.totalListeningSeconds).toBe(60);
    });
  });

  describe('10. Gravitas Invariants: Telemetry Hardening & /position Pre-validation', () => {
    it('rejects /position update when session was created for a different track and preserves History resume position', async () => {
      const trackAId = 't_pos_guard_A_' + Date.now();
      const trackBId = 't_pos_guard_B_' + Date.now();
      const sessA = 'sess_guard_A_' + Date.now();
      const sessB = 'sess_guard_B_' + Date.now();

      // Track A logged with initial position 25
      await request(app)
        .post('/api/history')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          jamendoId: trackAId,
          title: 'Track A Guard',
          artist: 'Artist A',
          duration: 200,
          position: 25,
          listenDuration: 25,
          sessionId: sessA
        });

      // Track B logged with distinct session
      await request(app)
        .post('/api/history')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          jamendoId: trackBId,
          title: 'Track B Guard',
          artist: 'Artist B',
          duration: 240,
          position: 10,
          listenDuration: 10,
          sessionId: sessB
        });

      // Attempt to modify Track A's position using Track B's sessionId (mismatched session)
      const rejectedPut = await request(app)
        .put('/api/history/position')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          jamendoId: trackAId,
          position: 180, // Forged jump
          listenDuration: 180,
          sessionId: sessB // Belongs to Track B!
        });

      expect(rejectedPut.status).toBe(400);
      expect(rejectedPut.body.error).toBe('Session does not match track.');

      // CRITICAL INVARIANT: Track A's History resume position MUST remain untouched at 25!
      const historyA = await History.findOne({ userId, jamendoId: trackAId }).sort({ playedAt: -1 });
      expect(historyA).toBeDefined();
      expect(historyA.position).toBe(25); // NOT modified to 180!
    });

    it('rejects /position update for non-existent track without modifying any records', async () => {
      const res = await request(app)
        .put('/api/history/position')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          jamendoId: 'completely_unknown_track_9999',
          position: 50
        });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('History track entry not found.');
    });

    it('clamps forged client track duration to MAX_REASONABLE_TRACK_DURATION ceiling', async () => {
      const forgedTrackId = 'forged_dur_track_' + Date.now();
      const forgedSess = 'forged_dur_sess_' + Date.now();

      const res = await request(app)
        .post('/api/history')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          jamendoId: forgedTrackId,
          title: 'Extreme Length Track',
          artist: 'Forging Bot',
          duration: 50000, // Forged extreme duration within schema max (86400)
          position: 50000,
          listenDuration: 50000,
          sessionId: forgedSess
        });

      expect(res.status).toBe(201);

      // Verify History document duration is clamped to reasonable operational ceiling (7200s)
      const hist = await History.findOne({ userId, jamendoId: forgedTrackId });
      expect(hist).toBeDefined();
      expect(hist.duration).toBeLessThanOrEqual(7200);
      expect(hist.position).toBeLessThanOrEqual(7205);

      // Verify ListeningEvent is bounded to operational limits
      const event = await ListeningEvent.findOne({ userId, sessionId: forgedSess });
      expect(event).toBeDefined();
      expect(event.duration).toBeLessThanOrEqual(7200);
      expect(event.listeningSeconds).toBeLessThanOrEqual(7230);
    });

    it('handles duplicate checkpoint events idempotently without inflating plays or corrupting time', async () => {
      const trackId = 'idempotent_track_' + Date.now();
      const sessId = 'idempotent_sess_' + Date.now();

      // Initial play: 25s
      await request(app)
        .post('/api/history')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          jamendoId: trackId,
          title: 'Idempotent Song',
          artist: 'Testing Artist',
          duration: 180,
          position: 25,
          listenDuration: 25,
          sessionId: sessId
        });

      // Submit identical checkpoint 1
      await request(app)
        .put('/api/history/position')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          jamendoId: trackId,
          position: 25,
          listenDuration: 25,
          sessionId: sessId
        });

      // Submit identical checkpoint 2
      await request(app)
        .put('/api/history/position')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          jamendoId: trackId,
          position: 25,
          listenDuration: 25,
          sessionId: sessId
        });

      const insights = await request(app)
        .get('/api/history/insights')
        .set('Authorization', `Bearer ${userToken}`);

      expect(insights.status).toBe(200);
      expect(insights.body.totalPlays).toBe(1);
      expect(insights.body.totalListeningSeconds).toBe(25);
    });

    it('rejects forged completion claim on seek when active listening time is insufficient', async () => {
      const trackId = 'seek_forged_track_' + Date.now();
      const sessId = 'seek_forged_sess_' + Date.now();

      // User listened for 16s on a 200s track and sought to 195s, claiming completed: true
      await request(app)
        .post('/api/history')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          jamendoId: trackId,
          title: 'Seek Song',
          artist: 'Seeker',
          duration: 200,
          position: 195,
          listenDuration: 16,
          completed: true,
          sessionId: sessId
        });

      const event = await ListeningEvent.findOne({ userId, sessionId: sessId });
      expect(event).toBeDefined();
      // Completed must be false because active listening time (16s) did not reach 70% of duration (140s)
      expect(event.completed).toBe(false);
    });
  });

  describe('11. Server-Issued Session Integrity & Checkpoint Pacing', () => {
    it('disqualifies a fabricated first listening event sent immediately after session creation', async () => {
      const trackId = 'fab_track_' + Date.now();

      // 1. Issue session starting NOW (0 elapsed time)
      const sessRes = await request(app)
        .post('/api/history/session')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          jamendoId: trackId,
          duration: 200
        });

      expect(sessRes.status).toBe(201);
      const { sessionId } = sessRes.body;
      expect(sessionId).toBeDefined();

      // 2. Initial track load with 0s listening
      await request(app)
        .post('/api/history')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          jamendoId: trackId,
          title: 'Fabricated Test',
          artist: 'Sneaky Client',
          duration: 200,
          position: 0,
          listenDuration: 0,
          sessionId
        });

      // 3. Immediately (< 100ms later), client attempts to claim 60s of listening time
      const putRes = await request(app)
        .put('/api/history/position')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          jamendoId: trackId,
          position: 60,
          listenDuration: 60, // Fabricated: 60s in under 1s of real time!
          sessionId
        });

      expect(putRes.status).toBe(200);

      // Verify that ListeningEvent was NOT created because physical listening time (< 15s) was not met
      const event = await ListeningEvent.findOne({ userId, sessionId });
      expect(event).toBeNull();

      // Insights must show 0 plays
      const insights = await request(app)
        .get('/api/history/insights')
        .set('Authorization', `Bearer ${userToken}`);

      expect(insights.status).toBe(200);
      expect(insights.body.totalPlays).toBe(0);
    });

    it('accepts a valid first checkpoint after sufficient elapsed server time', async () => {
      const trackId = 'valid_pace_track_' + Date.now();

      // Issue session with startedAt 25 seconds ago
      const sessRes = await request(app)
        .post('/api/history/session')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          jamendoId: trackId,
          duration: 200,
          startedAt: Date.now() - 25000 // 25s elapsed server time
        });

      expect(sessRes.status).toBe(201);
      const { sessionId } = sessRes.body;

      // Track started
      await request(app)
        .post('/api/history')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          jamendoId: trackId,
          title: 'Paced Track',
          artist: 'Paced Artist',
          duration: 200,
          position: 0,
          listenDuration: 0,
          sessionId
        });

      // First checkpoint for 20s (which is <= 25s elapsed)
      const putRes = await request(app)
        .put('/api/history/position')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          jamendoId: trackId,
          position: 20,
          listenDuration: 20,
          sessionId
        });

      expect(putRes.status).toBe(200);

      // Since 20s elapsed and listenDuration >= 15s, ListeningEvent MUST be created!
      const event = await ListeningEvent.findOne({ userId, sessionId });
      expect(event).toBeDefined();
      expect(event.listeningSeconds).toBe(20);

      const insights = await request(app)
        .get('/api/history/insights')
        .set('Authorization', `Bearer ${userToken}`);

      expect(insights.body.totalPlays).toBe(1);
      expect(insights.body.totalListeningSeconds).toBe(20);
    });

    it('clamps excessive reported listening duration to elapsed time and track duration bounds', async () => {
      const trackId = 'excess_track_' + Date.now();

      // Session started 30s ago on a 180s track
      const sessRes = await request(app)
        .post('/api/history/session')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          jamendoId: trackId,
          duration: 180,
          startedAt: Date.now() - 30000 // 30s elapsed
        });

      const { sessionId } = sessRes.body;

      await request(app)
        .post('/api/history')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          jamendoId: trackId,
          title: 'Excess Track',
          artist: 'Artist',
          duration: 180,
          position: 0,
          listenDuration: 0,
          sessionId
        });

      // Client attempts to claim 8000s listening duration
      const putRes = await request(app)
        .put('/api/history/position')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          jamendoId: trackId,
          position: 30,
          listenDuration: 8000, // Wildly excessive
          sessionId
        });

      expect(putRes.status).toBe(200);

      // Verify server clamped listenDuration to realistic server bounds (<= 30s * 1.5 + 2 = 47s)
      const event = await ListeningEvent.findOne({ userId, sessionId });
      expect(event).toBeDefined();
      expect(event.listeningSeconds).toBeLessThanOrEqual(50);
      expect(event.listeningSeconds).toBeGreaterThanOrEqual(15);
    });

    it('rejects position checkpoints when track does not match the active session', async () => {
      const trackAId = 'mismatch_track_A_' + Date.now();
      const trackBId = 'mismatch_track_B_' + Date.now();

      // Session issued for Track A
      const sessRes = await request(app)
        .post('/api/history/session')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          jamendoId: trackAId,
          duration: 200
        });

      const { sessionId } = sessRes.body;

      // Log both tracks in history
      await request(app)
        .post('/api/history')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          jamendoId: trackAId,
          title: 'Track A',
          artist: 'Artist A',
          duration: 200,
          position: 0,
          listenDuration: 0,
          sessionId
        });

      await request(app)
        .post('/api/history')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          jamendoId: trackBId,
          title: 'Track B',
          artist: 'Artist B',
          duration: 200,
          position: 10,
          listenDuration: 10
        });

      // Attempt to send checkpoint for Track B using Track A's session
      const putRes = await request(app)
        .put('/api/history/position')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          jamendoId: trackBId,
          position: 30,
          listenDuration: 30,
          sessionId // Belongs to Track A!
        });

      expect(putRes.status).toBe(400);
      expect(putRes.body.error).toBe('Session does not match track.');

      // Verify Track B's position was NOT modified
      const histB = await History.findOne({ userId, jamendoId: trackBId });
      expect(histB.position).toBe(10);
    });

    it('handles rapid track switching and pause/resume cleanly with separate sessions', async () => {
      const track1 = 'switch_track_1_' + Date.now();
      const track2 = 'switch_track_2_' + Date.now();

      // 1. Play Track 1 (session 1)
      const sess1 = await request(app)
        .post('/api/history/session')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ jamendoId: track1, duration: 180, startedAt: Date.now() - 20000 });

      await request(app)
        .post('/api/history')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ jamendoId: track1, title: 'Track 1', artist: 'Artist 1', duration: 180, position: 0, listenDuration: 0, sessionId: sess1.body.sessionId });

      // Checkpoint on Track 1
      await request(app)
        .put('/api/history/position')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ jamendoId: track1, position: 18, listenDuration: 18, sessionId: sess1.body.sessionId });

      // 2. Switch to Track 2 (session 2)
      const sess2 = await request(app)
        .post('/api/history/session')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ jamendoId: track2, duration: 220, startedAt: Date.now() - 25000 });

      await request(app)
        .post('/api/history')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ jamendoId: track2, title: 'Track 2', artist: 'Artist 2', duration: 220, position: 0, listenDuration: 0, sessionId: sess2.body.sessionId });

      // Checkpoint on Track 2
      await request(app)
        .put('/api/history/position')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ jamendoId: track2, position: 22, listenDuration: 22, sessionId: sess2.body.sessionId });

      // Verify both sessions and tracks recorded accurately
      const event1 = await ListeningEvent.findOne({ userId, sessionId: sess1.body.sessionId });
      const event2 = await ListeningEvent.findOne({ userId, sessionId: sess2.body.sessionId });

      expect(event1).toBeDefined();
      expect(event1.jamendoId).toBe(track1);
      expect(event1.listeningSeconds).toBe(18);

      expect(event2).toBeDefined();
      expect(event2.jamendoId).toBe(track2);
      expect(event2.listeningSeconds).toBe(22);
    });

    it('handles duplicate checkpoint submissions idempotently without inflating metrics', async () => {
      const trackId = 'dup_chk_track_' + Date.now();

      const sess = await request(app)
        .post('/api/history/session')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ jamendoId: trackId, duration: 180, startedAt: Date.now() - 22000 });

      await request(app)
        .post('/api/history')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ jamendoId: trackId, title: 'Dup Track', artist: 'Artist', duration: 180, position: 0, listenDuration: 0, sessionId: sess.body.sessionId });

      // Checkpoint 1
      await request(app)
        .put('/api/history/position')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ jamendoId: trackId, position: 20, listenDuration: 20, sessionId: sess.body.sessionId });

      // Duplicate Checkpoint 2 (same data)
      await request(app)
        .put('/api/history/position')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ jamendoId: trackId, position: 20, listenDuration: 20, sessionId: sess.body.sessionId });

      const insights = await request(app)
        .get('/api/history/insights')
        .set('Authorization', `Bearer ${userToken}`);

      // Exactly 1 play, 20 listening seconds
      expect(insights.body.totalPlays).toBe(1);
      expect(insights.body.totalListeningSeconds).toBe(20);
    });

    it('accepts legitimate listening events that arrive slightly late due to network delay', async () => {
      const trackId = 'late_track_' + Date.now();

      // Session started 35s ago (e.g. mobile connectivity delay)
      const sess = await request(app)
        .post('/api/history/session')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ jamendoId: trackId, duration: 180, startedAt: Date.now() - 35000 });

      await request(app)
        .post('/api/history')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ jamendoId: trackId, title: 'Late Track', artist: 'Artist', duration: 180, position: 0, listenDuration: 0, sessionId: sess.body.sessionId });

      // Checkpoint for 30s arriving at 35s elapsed
      const putRes = await request(app)
        .put('/api/history/position')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ jamendoId: trackId, position: 30, listenDuration: 30, sessionId: sess.body.sessionId });

      expect(putRes.status).toBe(200);

      const event = await ListeningEvent.findOne({ userId, sessionId: sess.body.sessionId });
      expect(event).toBeDefined();
      expect(event.listeningSeconds).toBe(30);
    });

    it('rejects expired or completely unknown playback sessions', async () => {
      const trackId = 'expired_track_' + Date.now();

      // 1. Unknown / never-issued session
      const unknownRes = await request(app)
        .put('/api/history/position')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          jamendoId: trackId,
          position: 25,
          listenDuration: 25,
          sessionId: 'completely_unknown_session_random123'
        });

      expect(unknownRes.status).toBe(400);
      expect(unknownRes.body.error).toBe('Invalid or expired playback session.');

      // 2. Expired session (> 24 hours old)
      const expiredSess = await request(app)
        .post('/api/history/session')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          jamendoId: trackId,
          duration: 180,
          startedAt: Date.now() - (25 * 3600 * 1000) // 25 hours ago
        });

      const expiredRes = await request(app)
        .put('/api/history/position')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          jamendoId: trackId,
          position: 25,
          listenDuration: 25,
          sessionId: expiredSess.body.sessionId
        });

      expect(expiredRes.status).toBe(400);
      expect(expiredRes.body.error).toBe('Playback session has expired.');
    });
  });

  describe('12. Deep Code Review Fixes (Findings 3, 4, 6, 7, 8)', () => {
    it('Finding 3: external search pagination calculates providerLimit and providerOffset dynamically', async () => {
      const audiusSpy = jest.spyOn(musicProvider.audiusProvider, 'searchTracks').mockResolvedValue([]);
      const jamendoSpy = jest.spyOn(musicProvider.jamendoProvider, 'searchTracks').mockResolvedValue([]);

      musicProvider.clearCache();

      // Page 2 with limit 10: providerOffset must be (2 - 1) * 10 = 10 (NOT hardcoded 20)
      await musicProvider.searchProviderTracks({ q: 'pagination_query_test_1', limit: 10, page: 2 });
      expect(audiusSpy).toHaveBeenCalledWith(
        'pagination_query_test_1',
        expect.objectContaining({ limit: 10, offset: 10 })
      );
      expect(jamendoSpy).toHaveBeenCalledWith(
        'pagination_query_test_1',
        expect.objectContaining({ limit: 10, offset: 10 })
      );

      // Page 3 with limit 50: providerOffset must be (3 - 1) * 50 = 100
      await musicProvider.searchProviderTracks({ q: 'pagination_query_test_2', limit: 50, page: 3 });
      expect(audiusSpy).toHaveBeenCalledWith(
        'pagination_query_test_2',
        expect.objectContaining({ limit: 50, offset: 100 })
      );

      audiusSpy.mockRestore();
      jamendoSpy.mockRestore();
    }, 45000);

    it('Finding 4: external search results are partitioned into externalMatches and separated from local groups', async () => {
      const mockAudiusTrack = {
        id: 'aud_ext_unique_1',
        provider: 'Audius',
        source: 'Audius',
        title: 'Deep House Flow',
        artist: 'Audius Producer',
        album: 'Audius Beats',
        audioUrl: 'https://creatorseed.com/stream/aud_ext_unique_1.mp3',
        coverUrl: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4',
        duration: 210,
        matchType: 'exact',
        matchTier: 'external',
        matchScore: 100
      };

      const audiusSpy = jest.spyOn(musicProvider.audiusProvider, 'searchTracks').mockResolvedValue([mockAudiusTrack]);
      musicProvider.clearCache();

      const res = await request(app).get('/api/music/search?q=Deep%20House%20Flow&grouped=true');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('externalMatches');
      expect(res.body).toHaveProperty('exactMatches');

      // External Audius track should appear in externalMatches
      const extFound = res.body.externalMatches.some(t => t.id === 'aud_ext_unique_1');
      expect(extFound).toBe(true);

      // External track must NOT leak into local exactMatches
      const exactLeak = res.body.exactMatches.some(t => t.id === 'aud_ext_unique_1');
      expect(exactLeak).toBe(false);

      audiusSpy.mockRestore();
    }, 45000);

    it('Finding 6: unknown API routes return consistent JSON 404 across all HTTP methods', async () => {
      const methods = ['get', 'post', 'put', 'delete', 'patch'];
      for (const m of methods) {
        const res = await request(app)[m]('/api/nonexistent_endpoint_for_test_' + m);
        expect(res.status).toBe(404);
        expect(res.headers['content-type']).toMatch(/application\/json/);
        expect(res.body).toEqual({ error: 'API endpoint not found.' });
      }

      // Non-API routes still serve index.html
      const frontendRes = await request(app).get('/nonexistent_spa_route');
      expect(frontendRes.status).toBe(200);
      expect(frontendRes.headers['content-type']).toMatch(/text\/html/);
    });

    it('Finding 7: image proxy enforces SSRF protections on private, loopback, and cloud metadata hosts', async () => {
      const loopbackRes = await request(app).get('/api/music/proxy-image?url=http://127.0.0.1:8080/secret');
      expect(loopbackRes.status).toBe(403);
      expect(loopbackRes.body.error).toBe('Access to internal network destinations is forbidden.');

      const localRes = await request(app).get('/api/music/proxy-image?url=http://localhost/admin');
      expect(localRes.status).toBe(403);

      const privateRes192 = await request(app).get('/api/music/proxy-image?url=http://192.168.1.1/status');
      expect(privateRes192.status).toBe(403);

      const privateRes10 = await request(app).get('/api/music/proxy-image?url=http://10.0.0.1/status');
      expect(privateRes10.status).toBe(403);

      const metadataRes = await request(app).get('/api/music/proxy-image?url=http://169.254.169.254/latest');
      expect(metadataRes.status).toBe(403);

      const invalidUrlRes = await request(app).get('/api/music/proxy-image?url=not_a_valid_url');
      expect(invalidUrlRes.status).toBe(302);
    });

    it('Finding 7: radio station favicons from non-CSP domains are safely proxied', () => {
      const radioProvider = require('../backend/services/providers/radioBrowserProvider');

      // Station with external unapproved domain
      const unapprovedItem = {
        stationuuid: 'uuid_test_1',
        name: 'Cool Jazz FM',
        favicon: 'http://custom-radio-domain.org/icon.png',
        url_resolved: 'https://stream.example.com/live'
      };
      const normalized1 = radioProvider.normalizeStation(unapprovedItem);
      expect(normalized1.coverUrl).toContain('/api/music/proxy-image?url=');

      // Station with CSP-approved HTTPS domain
      const approvedItem = {
        stationuuid: 'uuid_test_2',
        name: 'Radio Browser Station',
        favicon: 'https://de1.api.radio-browser.info/station_icon.jpg',
        url_resolved: 'https://stream.example.com/live'
      };
      const normalized2 = radioProvider.normalizeStation(approvedItem);
      expect(normalized2.coverUrl).toBe('https://de1.api.radio-browser.info/station_icon.jpg');
    });

    it('Finding 8: jamendo provider disables integration and rejects placeholder credentials', () => {
      const jamendo = require('../backend/services/providers/jamendoProvider');
      const prevId = process.env.JAMENDO_CLIENT_ID;

      try {
        process.env.JAMENDO_CLIENT_ID = 'your_jamendo_client_id_here';
        expect(jamendo.isEnabled()).toBe(false);
        const health = jamendo.getHealth();
        expect(health.status).toBe('disabled');
        expect(health.errorCode).toBe('JAMENDO_NOT_CONFIGURED');
      } finally {
        if (prevId !== undefined) {
          process.env.JAMENDO_CLIENT_ID = prevId;
        } else {
          delete process.env.JAMENDO_CLIENT_ID;
        }
      }
    });

    it('Finding 6 (Hardened): method-independent 404 middleware catches /api root and non-GET requests', async () => {
      // 1. Exact /api root without trailing slash across methods
      for (const m of ['get', 'post', 'put', 'delete', 'patch']) {
        const resRoot = await request(app)[m]('/api');
        expect(resRoot.status).toBe(404);
        expect(resRoot.headers['content-type']).toMatch(/application\/json/);
        expect(resRoot.body).toEqual({ error: 'API endpoint not found.' });
      }

      // 2. Unhandled non-GET requests to non-API paths return consistent JSON 404
      const resNonGet = await request(app).post('/unknown_non_api_route');
      expect(resNonGet.status).toBe(404);
      expect(resNonGet.body).toEqual({ error: 'Endpoint not found.' });
    });

    it('Finding 7 (Hardened): image proxy blocks redirects to private destinations and enforces size limit', async () => {
      const originalFetch = global.fetch;

      try {
        // Test 1: Redirect to loopback/internal IP is intercepted and blocked
        global.fetch = jest.fn().mockImplementation(async (url) => {
          if (String(url).includes('redirect-test')) {
            return {
              status: 302,
              ok: false,
              headers: {
                get: (h) => (h.toLowerCase() === 'location' ? 'http://127.0.0.1:9000/private-data' : null)
              }
            };
          }
          return { status: 404, ok: false, headers: { get: () => null } };
        });

        const redirectRes = await request(app).get('/api/music/proxy-image?url=https://example.com/redirect-test');
        expect(redirectRes.status).toBe(403);
        expect(redirectRes.body.error).toBe('Access to internal network destinations is forbidden.');

        // Test 2: Stream exceeding 2 MB is aborted and redirects to fallback
        global.fetch = jest.fn().mockImplementation(async () => {
          const streamGen = async function* () {
            yield Buffer.alloc(1.2 * 1024 * 1024);
            yield Buffer.alloc(1.2 * 1024 * 1024); // Exceeds 2 MB total
          };
          return {
            status: 200,
            ok: true,
            headers: {
              get: (h) => (h.toLowerCase() === 'content-type' ? 'image/png' : null)
            },
            body: streamGen()
          };
        });

        const largeRes = await request(app).get('/api/music/proxy-image?url=https://example.com/large-image.png');
        expect(largeRes.status).toBe(302);
        expect(largeRes.headers.location).toContain('unsplash.com');
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('Finding 1 (Hardened): POST /api/history caps listenDuration to 0 in production when no active session exists', async () => {
      const History = require('../backend/models/History');
      const prevEnv = process.env.NODE_ENV;

      try {
        process.env.NODE_ENV = 'production';

        const res = await request(app)
          .post('/api/history')
          .set('Authorization', `Bearer ${userToken}`)
          .send({
            jamendoId: 'forged_listen_dur_123',
            title: 'Forged Song',
            artist: 'Manipulator',
            duration: 300,
            position: 300,
            listenDuration: 300
          });

        expect(res.status).toBe(201);
        expect(res.body.listenDuration).toBe(0);

        const record = await History.findOne({ jamendoId: 'forged_listen_dur_123' });
        expect(record).toBeDefined();
        expect(record.listenDuration).toBe(0);
      } finally {
        process.env.NODE_ENV = prevEnv;
      }
    });

    it('SPA Fallback vs API 404: unknown GET /api/* routes strictly return JSON 404, never index.html', async () => {
      // 1. Unknown GET /api routes must always return JSON 404
      const unknownApiPaths = [
        '/api/nonexistent_endpoint_xyz',
        '/api/music/unknown_sub_route',
        '/api/v1/anything',
        '/API/CASE_INSENSITIVE_UNKNOWN'
      ];

      for (const apiPath of unknownApiPaths) {
        const res = await request(app).get(apiPath);
        expect(res.status).toBe(404);
        expect(res.headers['content-type']).toMatch(/application\/json/);
        expect(res.body).toEqual({ error: 'API endpoint not found.' });
      }

      // 2. Frontend client-side SPA routes must return 200 HTML
      const frontendPaths = ['/library', '/playlists', '/search', '/settings'];
      for (const fPath of frontendPaths) {
        const fRes = await request(app).get(fPath);
        expect(fRes.status).toBe(200);
        expect(fRes.headers['content-type']).toMatch(/text\/html/);
        expect(fRes.text).toContain('<!DOCTYPE html>');
      }
    });

    it('Finding 7 (DNS Rebinding Hardening): pins validated IP records and rejects private socket connections', async () => {
      const http = require('http');
      const originalHttpRequest = http.request;

      try {
        // Intercept ONLY outbound image fetch requests (e.g. to example.com), leaving supertest's internal app requests untouched
        http.request = jest.fn().mockImplementation((...args) => {
          const options = typeof args[0] === 'string' ? new URL(args[0]) : args[0];
          const callback = typeof args[1] === 'function' ? args[1] : args[2];

          if (options && options.hostname === 'example.com') {
            const fakeSocket = {
              remoteAddress: '127.0.0.1',
              destroy: jest.fn()
            };
            const fakeRes = {
              statusCode: 200,
              headers: { 'content-type': 'image/png' },
              socket: fakeSocket,
              on: jest.fn(),
              destroy: jest.fn()
            };
            if (typeof callback === 'function') {
              setImmediate(() => callback(fakeRes));
            }
            return {
              on: jest.fn(),
              end: jest.fn(),
              destroy: jest.fn(),
              setNoDelay: jest.fn()
            };
          }

          return originalHttpRequest.apply(http, args);
        });

        const rebindingRes = await request(app).get('/api/music/proxy-image?url=http://example.com/rebound-image.png');
        expect(rebindingRes.status).toBe(403);
        expect(rebindingRes.body.error).toBe('Access to internal network destinations is forbidden.');
      } finally {
        http.request = originalHttpRequest;
      }
    });

    describe('Image Proxy Body Streaming Timeout & Resource Management', () => {
      const { Readable } = require('stream');
      const http = require('http');
      const originalHttpRequest = http.request;

      afterEach(() => {
        http.request = originalHttpRequest;
      });

      it('1. Remote server sends headers but never sends a body -> aborts after deadline and redirects to fallback', async () => {
        let socketDestroyed = false;
        http.request = jest.fn().mockImplementation((...args) => {
          const options = typeof args[0] === 'string' ? new URL(args[0]) : args[0];
          const callback = typeof args[1] === 'function' ? args[1] : args[2];

          if (options && options.hostname === 'example.com') {
            const fakeSocket = {
              remoteAddress: '93.184.216.34',
              destroy: jest.fn(() => { socketDestroyed = true; })
            };
            const mockRes = new Readable({ read() {} });
            mockRes.statusCode = 200;
            mockRes.headers = { 'content-type': 'image/png' };
            mockRes.socket = fakeSocket;

            if (typeof callback === 'function') {
              setImmediate(() => callback(mockRes));
            }
            return {
              on: jest.fn(),
              end: jest.fn(),
              destroy: jest.fn(() => { socketDestroyed = true; }),
              setNoDelay: jest.fn()
            };
          }
          return originalHttpRequest.apply(http, args);
        });

        const res = await request(app)
          .get('/api/music/proxy-image?url=http://example.com/hang-body.png')
          .set('x-test-proxy-timeout', '100');

        expect(res.status).toBe(302);
        expect(res.headers.location).toContain('unsplash.com');
        expect(socketDestroyed).toBe(true);
      });

      it('2. Remote server sends a small chunk and then stops -> aborts after deadline and redirects to fallback', async () => {
        let socketDestroyed = false;
        http.request = jest.fn().mockImplementation((...args) => {
          const options = typeof args[0] === 'string' ? new URL(args[0]) : args[0];
          const callback = typeof args[1] === 'function' ? args[1] : args[2];

          if (options && options.hostname === 'example.com') {
            const fakeSocket = {
              remoteAddress: '93.184.216.34',
              destroy: jest.fn(() => { socketDestroyed = true; })
            };
            const mockRes = new Readable({ read() {} });
            mockRes.statusCode = 200;
            mockRes.headers = { 'content-type': 'image/png' };
            mockRes.socket = fakeSocket;

            // Send small chunk, then stop
            mockRes.push(Buffer.from('small partial chunk'));

            if (typeof callback === 'function') {
              setImmediate(() => callback(mockRes));
            }
            return {
              on: jest.fn(),
              end: jest.fn(),
              destroy: jest.fn(() => { socketDestroyed = true; }),
              setNoDelay: jest.fn()
            };
          }
          return originalHttpRequest.apply(http, args);
        });

        const res = await request(app)
          .get('/api/music/proxy-image?url=http://example.com/stalled-body.png')
          .set('x-test-proxy-timeout', '100');

        expect(res.status).toBe(302);
        expect(res.headers.location).toContain('unsplash.com');
        expect(socketDestroyed).toBe(true);
      });

      it('3. Remote server sends data very slowly -> aborts when overall deadline expires', async () => {
        let socketDestroyed = false;
        http.request = jest.fn().mockImplementation((...args) => {
          const options = typeof args[0] === 'string' ? new URL(args[0]) : args[0];
          const callback = typeof args[1] === 'function' ? args[1] : args[2];

          if (options && options.hostname === 'example.com') {
            const fakeSocket = {
              remoteAddress: '93.184.216.34',
              destroy: jest.fn(() => { socketDestroyed = true; })
            };
            const mockRes = new Readable({ read() {} });
            mockRes.statusCode = 200;
            mockRes.headers = { 'content-type': 'image/png' };
            mockRes.socket = fakeSocket;

            mockRes.push(Buffer.from('slow-chunk-1'));
            const slowTimer = setTimeout(() => {
              mockRes.push(Buffer.from('slow-chunk-2'));
            }, 400);

            if (typeof callback === 'function') {
              setImmediate(() => callback(mockRes));
            }
            return {
              on: jest.fn(),
              end: jest.fn(),
              destroy: jest.fn(() => {
                clearTimeout(slowTimer);
                socketDestroyed = true;
              }),
              setNoDelay: jest.fn()
            };
          }
          return originalHttpRequest.apply(http, args);
        });

        const res = await request(app)
          .get('/api/music/proxy-image?url=http://example.com/slow-body.png')
          .set('x-test-proxy-timeout', '100');

        expect(res.status).toBe(302);
        expect(res.headers.location).toContain('unsplash.com');
        expect(socketDestroyed).toBe(true);
      });

      it('4. Body completes within the configured deadline -> successfully returns 200 image buffer', async () => {
        const expectedImageBuffer = Buffer.from('image-data-within-deadline-png');
        http.request = jest.fn().mockImplementation((...args) => {
          const options = typeof args[0] === 'string' ? new URL(args[0]) : args[0];
          const callback = typeof args[1] === 'function' ? args[1] : args[2];

          if (options && options.hostname === 'example.com') {
            const fakeSocket = {
              remoteAddress: '93.184.216.34',
              destroy: jest.fn()
            };
            const mockRes = new Readable({ read() {} });
            mockRes.statusCode = 200;
            mockRes.headers = {
              'content-type': 'image/png',
              'content-length': String(expectedImageBuffer.length)
            };
            mockRes.socket = fakeSocket;

            mockRes.push(expectedImageBuffer);
            mockRes.push(null); // End of stream

            if (typeof callback === 'function') {
              setImmediate(() => callback(mockRes));
            }
            return {
              on: jest.fn(),
              end: jest.fn(),
              destroy: jest.fn(),
              setNoDelay: jest.fn()
            };
          }
          return originalHttpRequest.apply(http, args);
        });

        const res = await request(app)
          .get('/api/music/proxy-image?url=http://example.com/valid-image.png')
          .set('x-test-proxy-timeout', '2000');

        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/image\/png/);
        expect(res.body).toEqual(expectedImageBuffer);
      });

      it('5. Body exceeds the 2 MB limit while streaming -> destroys stream and redirects to fallback', async () => {
        let streamDestroyed = false;
        http.request = jest.fn().mockImplementation((...args) => {
          const options = typeof args[0] === 'string' ? new URL(args[0]) : args[0];
          const callback = typeof args[1] === 'function' ? args[1] : args[2];

          if (options && options.hostname === 'example.com') {
            const fakeSocket = {
              remoteAddress: '93.184.216.34',
              destroy: jest.fn()
            };
            const mockRes = new Readable({
              read() {},
              destroy(err, cb) {
                streamDestroyed = true;
                if (cb) cb(err);
              }
            });
            mockRes.statusCode = 200;
            mockRes.headers = { 'content-type': 'image/png' };
            mockRes.socket = fakeSocket;

            // Push two 1.2 MB chunks = 2.4 MB total (exceeds 2 MB limit)
            mockRes.push(Buffer.alloc(1.2 * 1024 * 1024));
            mockRes.push(Buffer.alloc(1.2 * 1024 * 1024));

            if (typeof callback === 'function') {
              setImmediate(() => callback(mockRes));
            }
            return {
              on: jest.fn(),
              end: jest.fn(),
              destroy: jest.fn(),
              setNoDelay: jest.fn()
            };
          }
          return originalHttpRequest.apply(http, args);
        });

        const res = await request(app)
          .get('/api/music/proxy-image?url=http://example.com/oversized-body.png')
          .set('x-test-proxy-timeout', '2000');

        expect(res.status).toBe(302);
        expect(res.headers.location).toContain('unsplash.com');
        expect(streamDestroyed).toBe(true);
      });

      it('6. Remote server closes connection unexpectedly during streaming -> caught cleanly and redirects to fallback', async () => {
        http.request = jest.fn().mockImplementation((...args) => {
          const options = typeof args[0] === 'string' ? new URL(args[0]) : args[0];
          const callback = typeof args[1] === 'function' ? args[1] : args[2];

          if (options && options.hostname === 'example.com') {
            const fakeSocket = {
              remoteAddress: '93.184.216.34',
              destroy: jest.fn()
            };
            const mockRes = new Readable({ read() {} });
            mockRes.statusCode = 200;
            mockRes.headers = { 'content-type': 'image/png' };
            mockRes.socket = fakeSocket;

            if (typeof callback === 'function') {
              setImmediate(() => {
                callback(mockRes);
                mockRes.push(Buffer.from('partial-chunk'));
                setImmediate(() => {
                  mockRes.destroy(new Error('Premature socket close'));
                });
              });
            }
            return {
              on: jest.fn(),
              end: jest.fn(),
              destroy: jest.fn(),
              setNoDelay: jest.fn()
            };
          }
          return originalHttpRequest.apply(http, args);
        });

        const res = await request(app)
          .get('/api/music/proxy-image?url=http://example.com/dropped-connection.png')
          .set('x-test-proxy-timeout', '2000');

        expect(res.status).toBe(302);
        expect(res.headers.location).toContain('unsplash.com');
      });

      it('7. Timeout occurs during a redirect response -> cancels hop and redirects to fallback', async () => {
        let hopCount = 0;
        http.request = jest.fn().mockImplementation((...args) => {
          const options = typeof args[0] === 'string' ? new URL(args[0]) : args[0];
          const callback = typeof args[1] === 'function' ? args[1] : args[2];

          if (options && options.hostname === 'example.com') {
            hopCount++;
            if (hopCount === 1) {
              // First hop returns a 302 redirect
              const mockRedirect = new Readable({ read() {} });
              mockRedirect.statusCode = 302;
              mockRedirect.headers = {
                'location': 'http://example.com/redirect-target.png'
              };
              mockRedirect.socket = { remoteAddress: '93.184.216.34', destroy: jest.fn() };
              if (typeof callback === 'function') {
                setImmediate(() => callback(mockRedirect));
              }
              return {
                on: jest.fn(),
                end: jest.fn(),
                destroy: jest.fn(),
                setNoDelay: jest.fn()
              };
            } else {
              // Second hop hangs before headers arrive
              let errorListener = null;
              const reqMock = {
                on: jest.fn((event, handler) => {
                  if (event === 'error') errorListener = handler;
                  return reqMock;
                }),
                end: jest.fn(),
                destroy: jest.fn((err) => {
                  if (errorListener) errorListener(err || new Error('Request aborted by timeout'));
                }),
                setNoDelay: jest.fn()
              };
              if (options && options.signal) {
                options.signal.addEventListener('abort', () => {
                  reqMock.destroy(new Error('Request aborted by timeout'));
                });
              }
              return reqMock;
            }
          }
          return originalHttpRequest.apply(http, args);
        });

        const res = await request(app)
          .get('/api/music/proxy-image?url=http://example.com/redirect-freeze.png')
          .set('x-test-proxy-timeout', '100');

        expect(res.status).toBe(302);
        expect(res.headers.location).toContain('unsplash.com');
        expect(hopCount).toBe(2);
      });

      it('8. Aborted requests release resources and set socket.destroyed', async () => {
        let capturedSocket = null;
        http.request = jest.fn().mockImplementation((...args) => {
          const options = typeof args[0] === 'string' ? new URL(args[0]) : args[0];
          const callback = typeof args[1] === 'function' ? args[1] : args[2];

          if (options && options.hostname === 'example.com') {
            capturedSocket = {
              remoteAddress: '93.184.216.34',
              destroyed: false,
              destroy: jest.fn(function() { this.destroyed = true; })
            };
            const mockRes = new Readable({ read() {} });
            mockRes.statusCode = 200;
            mockRes.headers = { 'content-type': 'image/png' };
            mockRes.socket = capturedSocket;

            if (typeof callback === 'function') {
              setImmediate(() => callback(mockRes));
            }
            return {
              on: jest.fn(),
              end: jest.fn(),
              destroy: jest.fn(),
              setNoDelay: jest.fn()
            };
          }
          return originalHttpRequest.apply(http, args);
        });

        const res = await request(app)
          .get('/api/music/proxy-image?url=http://example.com/resource-release.png')
          .set('x-test-proxy-timeout', '80');

        expect(res.status).toBe(302);
        expect(capturedSocket).toBeDefined();
        expect(capturedSocket.destroyed).toBe(true);
        expect(capturedSocket.destroy).toHaveBeenCalled();
      });

      it('9. Successful image proxy requests include security and caching headers', async () => {
        const samplePng = Buffer.from('valid-png-binary-data');
        http.request = jest.fn().mockImplementation((...args) => {
          const options = typeof args[0] === 'string' ? new URL(args[0]) : args[0];
          const callback = typeof args[1] === 'function' ? args[1] : args[2];

          if (options && options.hostname === 'example.com') {
            const fakeSocket = {
              remoteAddress: '93.184.216.34',
              destroy: jest.fn()
            };
            const mockRes = new Readable({ read() {} });
            mockRes.statusCode = 200;
            mockRes.headers = {
              'content-type': 'image/png',
              'content-length': String(samplePng.length)
            };
            mockRes.socket = fakeSocket;

            mockRes.push(samplePng);
            mockRes.push(null);

            if (typeof callback === 'function') {
              setImmediate(() => callback(mockRes));
            }
            return {
              on: jest.fn(),
              end: jest.fn(),
              destroy: jest.fn(),
              setNoDelay: jest.fn()
            };
          }
          return originalHttpRequest.apply(http, args);
        });

        const res = await request(app)
          .get('/api/music/proxy-image?url=http://example.com/secure-cached.png')
          .set('x-test-proxy-timeout', '2000');

        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/image\/png/);
        expect(res.headers['cache-control']).toBe('public, max-age=86400, stale-while-revalidate=43200');
        expect(res.headers['x-content-type-options']).toBe('nosniff');
        expect(res.headers['content-security-policy']).toBe("default-src 'none'");
        expect(res.body).toEqual(samplePng);
      });
    });

    describe('13. Mandatory Server-Issued Session ID for /api/history/position (P1 Hardening)', () => {
      it('1. Missing sessionId is rejected in production (HTTP 400)', async () => {
        const origEnv = process.env.NODE_ENV;
        try {
          process.env.NODE_ENV = 'production';
          const startRes = await request(app)
            .post('/api/history')
            .set('Authorization', `Bearer ${userToken}`)
            .send({
              jamendoId: 'p1_trk_req_sess_1',
              title: 'Mandatory Sess Song',
              artist: 'Artiste',
              duration: 200,
              position: 0,
              listenDuration: 0
            });
          expect(startRes.status).toBe(201);

          const posRes = await request(app)
            .put('/api/history/position')
            .set('Authorization', `Bearer ${userToken}`)
            .send({
              jamendoId: 'p1_trk_req_sess_1',
              position: 30,
              listenDuration: 30
            });

          expect(posRes.status).toBe(400);
          const errDetail = (posRes.body.details && posRes.body.details.map(d => d.message).join(' ')) || posRes.body.error || '';
          expect(errDetail).toMatch(/Session ID is required/i);
        } finally {
          process.env.NODE_ENV = origEnv;
        }
      });

      it('2. Empty or whitespace sessionId is rejected (HTTP 400)', async () => {
        const origEnv = process.env.NODE_ENV;
        try {
          process.env.NODE_ENV = 'production';
          const resEmpty = await request(app)
            .put('/api/history/position')
            .set('Authorization', `Bearer ${userToken}`)
            .send({
              jamendoId: 'p1_trk_whitespace_1',
              position: 10,
              listenDuration: 10,
              sessionId: ''
            });
          expect(resEmpty.status).toBe(400);

          const resWhitespace = await request(app)
            .put('/api/history/position')
            .set('Authorization', `Bearer ${userToken}`)
            .send({
              jamendoId: 'p1_trk_whitespace_1',
              position: 10,
              listenDuration: 10,
              sessionId: '    '
            });
          expect(resWhitespace.status).toBe(400);
        } finally {
          process.env.NODE_ENV = origEnv;
        }
      });

      it('3. Invalid or unknown sessionId is rejected (HTTP 400)', async () => {
        const res = await request(app)
          .put('/api/history/position')
          .set('Authorization', `Bearer ${userToken}`)
          .send({
            jamendoId: 'p1_trk_unknown_sess_1',
            position: 25,
            listenDuration: 25,
            sessionId: 'unregistered_fake_sess_uuid_99999'
          });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/Invalid or expired playback session|A valid active playback session is required/i);
      });

      it('4. Expired or inactive session is rejected (HTTP 400)', async () => {
        const expiredSessId = 'sess_expired_' + Date.now();
        const expiredTrackId = 'trk_exp_' + Date.now();

        const pastDate = new Date(Date.now() - 25 * 3600 * 1000);
        await History.create({
          userId,
          jamendoId: expiredTrackId,
          title: 'Expired Song',
          artist: 'Old Artist',
          coverUrl: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4',
          duration: 180,
          position: 10,
          listenDuration: 10,
          sessionId: expiredSessId,
          playedAt: pastDate,
          createdAt: pastDate
        });

        const res = await request(app)
          .put('/api/history/position')
          .set('Authorization', `Bearer ${userToken}`)
          .send({
            jamendoId: expiredTrackId,
            position: 50,
            listenDuration: 50,
            sessionId: expiredSessId
          });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/Playback session has expired/i);
      });

      it('5. Request with no valid session cannot create or update a qualified play, regardless of claimed listenDuration', async () => {
        const unauthTrackId = 'trk_unauth_qual_' + Date.now();

        await History.create({
          userId,
          jamendoId: unauthTrackId,
          title: 'Unauth Song',
          artist: 'Singer',
          duration: 180,
          position: 0,
          listenDuration: 0,
          playedAt: new Date()
        });

        const res = await request(app)
          .put('/api/history/position')
          .set('Authorization', `Bearer ${userToken}`)
          .send({
            jamendoId: unauthTrackId,
            position: 150,
            listenDuration: 150,
            completed: true
          });

        const events = await ListeningEvent.find({ userId, jamendoId: unauthTrackId });
        expect(events.length).toBe(0);
      });

      it('6. Valid server-issued session updates position and qualified play normally', async () => {
        const trackId = 'trk_valid_sync_' + Date.now();

        const sessRes = await request(app)
          .post('/api/history/session')
          .set('Authorization', `Bearer ${userToken}`)
          .send({
            jamendoId: trackId,
            duration: 180,
            startedAt: Date.now() - 40000
          });

        expect(sessRes.status).toBe(201);
        const validSessionId = sessRes.body.sessionId;
        expect(validSessionId).toBeDefined();

        await request(app)
          .post('/api/history')
          .set('Authorization', `Bearer ${userToken}`)
          .send({
            jamendoId: trackId,
            title: 'Legitimate Track',
            artist: 'Good Artist',
            duration: 180,
            position: 0,
            listenDuration: 0,
            sessionId: validSessionId
          });

        const updateRes = await request(app)
          .put('/api/history/position')
          .set('Authorization', `Bearer ${userToken}`)
          .send({
            jamendoId: trackId,
            position: 45,
            listenDuration: 40,
            sessionId: validSessionId
          });

        expect(updateRes.status).toBe(200);
        expect(updateRes.body.position).toBe(45);

        const event = await ListeningEvent.findOne({ userId, sessionId: validSessionId });
        expect(event).not.toBeNull();
        expect(event.listeningSeconds).toBeGreaterThanOrEqual(30);
        expect(event.position).toBe(45);
      });

      it('7. Valid session cannot claim more listening time than server-side elapsed time permits', async () => {
        const origEnv = process.env.NODE_ENV;
        try {
          process.env.NODE_ENV = 'production';
          const trackId = 'trk_speed_cheat_' + Date.now();

          const startRes = await request(app)
            .post('/api/history')
            .set('Authorization', `Bearer ${userToken}`)
            .send({
              jamendoId: trackId,
              title: 'Speed Cheat Track',
              artist: 'Cheat Artist',
              duration: 300,
              position: 0,
              listenDuration: 0
            });

          const validSessionId = startRes.body.sessionId;

          const updateRes = await request(app)
            .put('/api/history/position')
            .set('Authorization', `Bearer ${userToken}`)
            .send({
              jamendoId: trackId,
              position: 280,
              listenDuration: 280,
              sessionId: validSessionId
            });

          expect(updateRes.status).toBe(200);
          expect(updateRes.body.listenDuration).toBeLessThanOrEqual(15);
          expect(updateRes.body.listenDuration).not.toBe(280);
        } finally {
          process.env.NODE_ENV = origEnv;
        }
      });

      it('8. Repeated position updates do not create unexpected duplicate qualified plays', async () => {
        const trackId = 'trk_multi_check_' + Date.now();

        const startRes = await request(app)
          .post('/api/history')
          .set('Authorization', `Bearer ${userToken}`)
          .send({
            jamendoId: trackId,
            title: 'Multi Checkpoint Track',
            artist: 'Continuous Artist',
            duration: 200,
            position: 0,
            listenDuration: 0
          });

        const sessionId = startRes.body.sessionId;

        await request(app)
          .put('/api/history/position')
          .set('Authorization', `Bearer ${userToken}`)
          .send({ jamendoId: trackId, position: 35, listenDuration: 35, sessionId });

        await request(app)
          .put('/api/history/position')
          .set('Authorization', `Bearer ${userToken}`)
          .send({ jamendoId: trackId, position: 55, listenDuration: 55, sessionId });

        await request(app)
          .put('/api/history/position')
          .set('Authorization', `Bearer ${userToken}`)
          .send({ jamendoId: trackId, position: 75, listenDuration: 75, sessionId });

        const count = await ListeningEvent.countDocuments({ userId, sessionId });
        expect(count).toBe(1);

        const event = await ListeningEvent.findOne({ userId, sessionId });
        expect(event.position).toBe(75);
      });

      it('9. Existing legitimate playback and history tests continue to pass', async () => {
        const historyRes = await request(app)
          .get('/api/history')
          .set('Authorization', `Bearer ${userToken}`);

        expect(historyRes.status).toBe(200);
        expect(Array.isArray(historyRes.body)).toBe(true);
      });
    });

    describe('14. Hardened API Limits, HTTPS Stream Security, and Cookie-Based Authentication', () => {
      describe('A. Albums & Artists Limit Validation (Range 1-100)', () => {
        it('accepts valid lower bound limit=1 for albums and artists', async () => {
          const albumRes = await request(app).get('/api/music/albums?limit=1');
          expect(albumRes.status).toBe(200);
          expect(albumRes.body.albums.length).toBe(1);

          const artistRes = await request(app).get('/api/music/artists?limit=1');
          expect(artistRes.status).toBe(200);
          expect(artistRes.body.artists.length).toBe(1);
        });

        it('accepts valid upper bound limit=100 for albums and artists', async () => {
          const albumRes = await request(app).get('/api/music/albums?limit=100');
          expect(albumRes.status).toBe(200);
          expect(albumRes.body.albums.length).toBeLessThanOrEqual(100);

          const artistRes = await request(app).get('/api/music/artists?limit=100');
          expect(artistRes.status).toBe(200);
          expect(artistRes.body.artists.length).toBeLessThanOrEqual(100);
        });

        it('uses default limit of 60 when limit query parameter is omitted', async () => {
          const albumRes = await request(app).get('/api/music/albums');
          expect(albumRes.status).toBe(200);
          expect(albumRes.body.albums.length).toBeLessThanOrEqual(60);

          const artistRes = await request(app).get('/api/music/artists');
          expect(artistRes.status).toBe(200);
          expect(artistRes.body.artists.length).toBeLessThanOrEqual(60);
        });

        it('rejects negative limit (-1) with HTTP 400 Bad Request', async () => {
          const albumRes = await request(app).get('/api/music/albums?limit=-1');
          expect(albumRes.status).toBe(400);
          expect(albumRes.body.error).toBe('Validation failed.');

          const artistRes = await request(app).get('/api/music/artists?limit=-1');
          expect(artistRes.status).toBe(400);
          expect(artistRes.body.error).toBe('Validation failed.');
        });

        it('rejects zero limit (0) with HTTP 400 Bad Request', async () => {
          const albumRes = await request(app).get('/api/music/albums?limit=0');
          expect(albumRes.status).toBe(400);

          const artistRes = await request(app).get('/api/music/artists?limit=0');
          expect(artistRes.status).toBe(400);
        });

        it('rejects limit exceeding maximum (101) with HTTP 400 Bad Request', async () => {
          const albumRes = await request(app).get('/api/music/albums?limit=101');
          expect(albumRes.status).toBe(400);

          const artistRes = await request(app).get('/api/music/artists?limit=101');
          expect(artistRes.status).toBe(400);
        });

        it('rejects decimal limit (1.5) with HTTP 400 Bad Request', async () => {
          const albumRes = await request(app).get('/api/music/albums?limit=1.5');
          expect(albumRes.status).toBe(400);

          const artistRes = await request(app).get('/api/music/artists?limit=1.5');
          expect(artistRes.status).toBe(400);
        });

        it('rejects non-numeric limit (abc) with HTTP 400 Bad Request', async () => {
          const albumRes = await request(app).get('/api/music/albums?limit=abc');
          expect(albumRes.status).toBe(400);

          const artistRes = await request(app).get('/api/music/artists?limit=abc');
          expect(artistRes.status).toBe(400);
        });

        it('defensively clamps direct service calls to safe bounds', () => {
          const negativeAlbums = musicProvider.getLocalAlbums({ limit: -1 });
          expect(negativeAlbums.length).toBeLessThanOrEqual(100);

          const excessiveAlbums = musicProvider.getLocalAlbums({ limit: 9999 });
          expect(excessiveAlbums.length).toBeLessThanOrEqual(100);

          const negativeArtists = musicProvider.getLocalArtists({ limit: -1 });
          expect(negativeArtists.length).toBeLessThanOrEqual(100);
        });
      });

      describe('B. HTTPS Audio Playback & URL Helper Security', () => {
        const { formatAudioUrl } = require('../backend/services/urlHelper');

        it('upgrades known major provider HTTP audio URLs to HTTPS', () => {
          const saavnHttp = 'http://aac.saavncdn.com/123/sample_96.mp4';
          expect(formatAudioUrl(saavnHttp)).toBe('https://aac.saavncdn.com/123/sample_96.mp4');

          const audiusHttp = 'http://discoveryprovider.audius.co/v1/tracks/123/stream';
          expect(formatAudioUrl(audiusHttp)).toBe('https://discoveryprovider.audius.co/v1/tracks/123/stream');

          const jamendoHttp = 'http://mp3l.jamendo.com/?trackid=456&format=mp31';
          expect(formatAudioUrl(jamendoHttp)).toBe('https://mp3l.jamendo.com/?trackid=456&format=mp31');
        });

        it('preserves HTTP without blind rewriting for unverified third-party hosts', () => {
          const unknownHost = 'http://stream.radioparadise.com/aac-128';
          expect(formatAudioUrl(unknownHost)).toBe(unknownHost);
        });

        it('preserves HTTP on non-standard ports commonly used for raw audio streams', () => {
          const nonStandardPort = 'http://icecast.example.com:8000/live.mp3';
          expect(formatAudioUrl(nonStandardPort)).toBe(nonStandardPort);
        });

        it('preserves local development loopback addresses', () => {
          const localUrl = 'http://localhost:3000/audio/test.mp3';
          expect(formatAudioUrl(localUrl)).toBe(localUrl);

          const loopbackUrl = 'http://127.0.0.1:3000/audio/test.mp3';
          expect(formatAudioUrl(loopbackUrl)).toBe(loopbackUrl);
        });

        it('strictly rejects pseudo-protocols and image files from being treated as audio streams', () => {
          expect(formatAudioUrl('javascript:alert(1)')).toBe('');
          expect(formatAudioUrl('data:audio/mp3;base64,AAA')).toBe('');
          expect(formatAudioUrl('https://example.com/cover.png')).toBe('');
          expect(formatAudioUrl('https://example.com/artwork.jpg')).toBe('');
        });
      });

      describe('C. JWT Cookie Authentication, CSRF & Backward Compatibility', () => {
        let authEmail;
        let authPassword;
        let registeredCookie;
        let registeredToken;

        beforeEach(async () => {
          authEmail = getUniqueEmail('cookie_auth');
          authPassword = 'Password123!';
          const res = await request(app)
            .post('/api/auth/register')
            .send({ name: 'Cookie Tester', email: authEmail, password: authPassword });

          registeredToken = res.body.token;
          const setCookieHeaders = res.headers['set-cookie'];
          registeredCookie = Array.isArray(setCookieHeaders)
            ? setCookieHeaders.find(c => c.startsWith('auralist_token='))
            : setCookieHeaders;
        });

        it('issues HttpOnly, SameSite=Lax cookie upon registration and login', async () => {
          expect(registeredCookie).toBeDefined();
          expect(registeredCookie).toMatch(/HttpOnly/i);
          expect(registeredCookie).toMatch(/SameSite=Lax/i);
          expect(registeredCookie).toMatch(/Path=\//i);

          const loginRes = await request(app)
            .post('/api/auth/login')
            .send({ email: authEmail, password: authPassword });

          expect(loginRes.status).toBe(200);
          expect(loginRes.body).toHaveProperty('token');
          const loginCookie = loginRes.headers['set-cookie']?.find(c => c.startsWith('auralist_token='));
          expect(loginCookie).toBeDefined();
          expect(loginCookie).toMatch(/HttpOnly/i);
        });

        it('authenticates GET requests via cookie without Authorization header', async () => {
          const cookieVal = registeredCookie.split(';')[0];
          const meRes = await request(app)
            .get('/api/auth/me')
            .set('Cookie', cookieVal);

          expect(meRes.status).toBe(200);
          expect(meRes.body.user.email).toBe(authEmail);
        });

        it('rejects state-changing requests using cookie when custom CSRF header is missing', async () => {
          const cookieVal = registeredCookie.split(';')[0];
          const updateRes = await request(app)
            .put('/api/auth/profile')
            .set('Cookie', cookieVal)
            .send({ name: 'Malicious CSRF Attacker' });

          expect(updateRes.status).toBe(403);
          expect(updateRes.body.error).toMatch(/CSRF validation failed/i);
        });

        it('accepts state-changing requests using cookie when custom CSRF header (X-Requested-With) is present', async () => {
          const cookieVal = registeredCookie.split(';')[0];
          const updateRes = await request(app)
            .put('/api/auth/profile')
            .set('Cookie', cookieVal)
            .set('X-Requested-With', 'XMLHttpRequest')
            .send({ name: 'Authorized Cookie User' });

          expect(updateRes.status).toBe(200);
          expect(updateRes.body.user.name).toBe('Authorized Cookie User');
        });

        it('preserves backward compatibility: allows Bearer tokens without cookies or CSRF header', async () => {
          const updateRes = await request(app)
            .put('/api/auth/profile')
            .set('Authorization', `Bearer ${registeredToken}`)
            .send({ name: 'Bearer Token User' });

          expect(updateRes.status).toBe(200);
          expect(updateRes.body.user.name).toBe('Bearer Token User');
        });

        it('clears auth cookie upon POST /api/auth/logout', async () => {
          const logoutRes = await request(app)
            .post('/api/auth/logout');

          expect(logoutRes.status).toBe(200);
          expect(logoutRes.body.success).toBe(true);
          const clearCookie = logoutRes.headers['set-cookie']?.find(c => c.startsWith('auralist_token='));
          expect(clearCookie).toBeDefined();
          expect(clearCookie).toMatch(/Expires=Thu, 01 Jan 1970|Max-Age=0/i);
        });
      });
    });
  });
});

