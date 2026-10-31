const request = require('supertest');
const app = require('../server');

describe('Playback History API (/api/history)', () => {
  let tokenUserA, tokenUserB;
  const historyTrack = {
    jamendoId: '7001',
    title: 'History Track 1',
    artist: 'History Artist',
    coverUrl: 'https://example.com/cover.jpg',
    audioUrl: 'https://example.com/audio.mp3',
    duration: 195
  };

  let counter = 0;
  const getUniqueEmail = (prefix) => `${prefix}_${Date.now()}_${++counter}_${Math.random().toString(36).substring(2, 8)}@example.com`;

  beforeEach(async () => {
    const resA = await request(app)
      .post('/api/auth/register')
      .send({ name: 'User A', email: getUniqueEmail('userA_hist'), password: 'Password123!' });
    tokenUserA = resA.body.token;

    const resB = await request(app)
      .post('/api/auth/register')
      .send({ name: 'User B', email: getUniqueEmail('userB_hist'), password: 'Password123!' });
    tokenUserB = resB.body.token;
  });

  describe('POST /api/history', () => {
    it('should log a valid history entry for an authenticated user', async () => {
      const beforeTime = new Date().getTime();
      const res = await request(app)
        .post('/api/history')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send(historyTrack);

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('id');
      expect(res.body.jamendoId).toBe('7001');

      // Verify server-side playedAt generation
      const playedAtTime = new Date(res.body.playedAt).getTime();
      expect(playedAtTime).toBeGreaterThanOrEqual(beforeTime - 1000);
    });

    it('should reject unexpected client-supplied fields (e.g. playedAt override)', async () => {
      const fakePastTime = new Date('2000-01-01T00:00:00Z').toISOString();
      const res = await request(app)
        .post('/api/history')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({
          ...historyTrack,
          playedAt: fakePastTime
        });

      expect(res.status).toBe(400);
    });

    it('should reject history entry with negative duration', async () => {
      const res = await request(app)
        .post('/api/history')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({
          ...historyTrack,
          duration: -10
        });

      expect(res.status).toBe(400);
    });

    it('should reject unauthenticated request', async () => {
      const res = await request(app)
        .post('/api/history')
        .send(historyTrack);

      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/history & User Isolation', () => {
    it('CRITICAL SECURITY: User A cannot view User B playback history', async () => {
      await request(app)
        .post('/api/history')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({ ...historyTrack, jamendoId: '101' });

      await request(app)
        .post('/api/history')
        .set('Authorization', `Bearer ${tokenUserB}`)
        .send({ ...historyTrack, jamendoId: '202' });

      const resA = await request(app)
        .get('/api/history')
        .set('Authorization', `Bearer ${tokenUserA}`);

      expect(resA.status).toBe(200);
      expect(resA.body).toHaveLength(1);
      expect(resA.body[0].jamendoId).toBe('101');

      const resB = await request(app)
        .get('/api/history')
        .set('Authorization', `Bearer ${tokenUserB}`);

      expect(resB.status).toBe(200);
      expect(resB.body).toHaveLength(1);
      expect(resB.body[0].jamendoId).toBe('202');
    });
  });

  describe('Continue Listening & Playback Position Persistence', () => {
    it('should record playback position with POST /api/history', async () => {
      const res = await request(app)
        .post('/api/history')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({ ...historyTrack, jamendoId: 'pos_track_1', position: 42 });

      expect(res.status).toBe(201);
      expect(res.body.position).toBe(42);
    });

    it('should update position on existing history entry via PUT /api/history/position', async () => {
      await request(app)
        .post('/api/history')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({ ...historyTrack, jamendoId: 'pos_track_2', position: 10 });

      const updateRes = await request(app)
        .put('/api/history/position')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({ jamendoId: 'pos_track_2', position: 95 });

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.position).toBe(95);

      const getRes = await request(app)
        .get('/api/history')
        .set('Authorization', `Bearer ${tokenUserA}`);

      const entry = getRes.body.find(e => e.jamendoId === 'pos_track_2');
      expect(entry).toBeDefined();
      expect(entry.position).toBe(95);
    });

    it('should reject invalid or negative position in PUT /api/history/position', async () => {
      const res = await request(app)
        .put('/api/history/position')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({ jamendoId: 'pos_track_3', position: -5 });

      expect(res.status).toBe(400);
    });

    it('GET /api/history/continue returns recent tracks with position', async () => {
      await request(app)
        .post('/api/history')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({ ...historyTrack, jamendoId: 'cont_track_1', position: 120 });

      const res = await request(app)
        .get('/api/history/continue')
        .set('Authorization', `Bearer ${tokenUserA}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
      expect(res.body[0].jamendoId).toBe('cont_track_1');
      expect(res.body[0].position).toBe(120);
    });
  });

  describe('Listening Insights Calculation (/api/history/insights)', () => {
    it('returns empty stats for a new user without listening history', async () => {
      const res = await request(app)
        .get('/api/history/insights')
        .set('Authorization', `Bearer ${tokenUserB}`);

      expect(res.status).toBe(200);
      expect(res.body.totalPlays).toBe(0);
      expect(res.body.totalListeningSeconds).toBe(0);
      expect(res.body.topTracks).toEqual([]);
      expect(res.body.topArtists).toEqual([]);
      expect(res.body.dailyTrends).toBeDefined();
    });

    it('calculates top tracks, top artists, and listening time based on qualified plays', async () => {
      // 1. Qualified play 1: 45s
      await request(app)
        .post('/api/history')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({ ...historyTrack, jamendoId: 'ins_song_1', title: 'Song One', artist: 'Artist One', duration: 200, position: 45 });

      // 2. Disqualified skip: only 5s (< 15s threshold)
      await request(app)
        .post('/api/history')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({ ...historyTrack, jamendoId: 'ins_song_skip', title: 'Skipped Song', artist: 'Skip Artist', duration: 200, position: 5 });

      // 3. Qualified play 2: 90s
      await request(app)
        .post('/api/history')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({ ...historyTrack, jamendoId: 'ins_song_2', title: 'Song Two', artist: 'Artist One', duration: 220, position: 90 });

      const res = await request(app)
        .get('/api/history/insights')
        .set('Authorization', `Bearer ${tokenUserA}`);

      expect(res.status).toBe(200);
      expect(res.body.totalPlays).toBeGreaterThanOrEqual(2);
      expect(res.body.topArtists.some(a => a.artist === 'Artist One')).toBe(true);
      expect(res.body.topTracks.some(t => t.jamendoId === 'ins_song_1')).toBe(true);
      // Disqualified skip should not be in top tracks
      expect(res.body.topTracks.some(t => t.jamendoId === 'ins_song_skip')).toBe(false);
    });

    it('CRITICAL SECURITY: User B cannot view User A listening insights', async () => {
      const res = await request(app)
        .get('/api/history/insights')
        .set('Authorization', `Bearer ${tokenUserB}`);

      expect(res.status).toBe(200);
      expect(res.body.topTracks.some(t => t.jamendoId === 'ins_song_1')).toBe(false);
    });

    it('does not count zero-duration events with 0 or short listen time as meaningful', async () => {
      // Zero duration, zero position/listenDuration -> strictly disqualified
      await request(app)
        .post('/api/history')
        .set('Authorization', `Bearer ${tokenUserB}`)
        .send({ ...historyTrack, jamendoId: 'zero_dur_0', duration: 0, position: 0 });

      // Zero duration, 8s listenDuration (< 15s threshold) -> strictly disqualified
      await request(app)
        .post('/api/history')
        .set('Authorization', `Bearer ${tokenUserB}`)
        .send({ ...historyTrack, jamendoId: 'zero_dur_8', duration: 0, position: 8, listenDuration: 8 });

      const res = await request(app)
        .get('/api/history/insights')
        .set('Authorization', `Bearer ${tokenUserB}`);

      expect(res.status).toBe(200);
      expect(res.body.totalPlays).toBe(0);
      expect(res.body.totalListeningSeconds).toBe(0);
      expect(res.body.topTracks).toHaveLength(0);
    });

    it('qualifies short tracks (< 30s) played through to completion', async () => {
      // 20s track listened for 18s (> 80% duration)
      await request(app)
        .post('/api/history')
        .set('Authorization', `Bearer ${tokenUserB}`)
        .send({
          ...historyTrack,
          jamendoId: 'short_track_1',
          duration: 20,
          position: 18,
          listenDuration: 18,
          completed: true,
          sessionId: 'short_sess_1'
        });

      const res = await request(app)
        .get('/api/history/insights')
        .set('Authorization', `Bearer ${tokenUserB}`);

      expect(res.status).toBe(200);
      expect(res.body.totalPlays).toBe(1);
      expect(res.body.totalListeningSeconds).toBe(18);
    });

    it('does not inflate listening time when user seeks through a track', async () => {
      // User seeks to second 180 of a 200s song, but only listened for 8s
      await request(app)
        .post('/api/history')
        .set('Authorization', `Bearer ${tokenUserB}`)
        .send({
          ...historyTrack,
          jamendoId: 'seek_track_1',
          duration: 200,
          position: 180,
          listenDuration: 8, // Real elapsed listening time
          sessionId: 'seek_sess_1'
        });

      const res = await request(app)
        .get('/api/history/insights')
        .set('Authorization', `Bearer ${tokenUserB}`);

      expect(res.status).toBe(200);
      // Disqualified because listenDuration is 8s (< 15s threshold) despite position being 180
      const seekTrack = res.body.topTracks.find(t => t.jamendoId === 'seek_track_1');
      expect(seekTrack).toBeUndefined();
    });

    it('updates session checkpoints without inflating totalPlays', async () => {
      const sessId = 'chk_session_123';

      // Checkpoint 1 at 15s
      await request(app)
        .post('/api/history')
        .set('Authorization', `Bearer ${tokenUserB}`)
        .send({
          ...historyTrack,
          jamendoId: 'chk_track_1',
          duration: 200,
          position: 15,
          listenDuration: 15,
          sessionId: sessId
        });

      // Checkpoint 2 at 30s
      await request(app)
        .put('/api/history/position')
        .set('Authorization', `Bearer ${tokenUserB}`)
        .send({
          jamendoId: 'chk_track_1',
          position: 30,
          listenDuration: 30,
          sessionId: sessId
        });

      // Checkpoint 3 at 45s
      await request(app)
        .put('/api/history/position')
        .set('Authorization', `Bearer ${tokenUserB}`)
        .send({
          jamendoId: 'chk_track_1',
          position: 45,
          listenDuration: 45,
          sessionId: sessId
        });

      const res = await request(app)
        .get('/api/history/insights')
        .set('Authorization', `Bearer ${tokenUserB}`);

      expect(res.status).toBe(200);
      // Must be 1 play, not 3 plays!
      const trackEntry = res.body.topTracks.find(t => t.jamendoId === 'chk_track_1');
      expect(trackEntry).toBeDefined();
      expect(trackEntry.plays).toBe(1);
      expect(trackEntry.listeningSeconds).toBe(45);
    });

    it('records legitimate repeated plays as distinct plays', async () => {
      // First play: 30s
      await request(app)
        .post('/api/history')
        .set('Authorization', `Bearer ${tokenUserB}`)
        .send({
          ...historyTrack,
          jamendoId: 'replay_track_1',
          duration: 180,
          position: 30,
          listenDuration: 30,
          completed: true,
          sessionId: 'replay_sess_1'
        });

      // Second play (replay of same track): 35s with new session
      await request(app)
        .post('/api/history')
        .set('Authorization', `Bearer ${tokenUserB}`)
        .send({
          ...historyTrack,
          jamendoId: 'replay_track_1',
          duration: 180,
          position: 35,
          listenDuration: 35,
          sessionId: 'replay_sess_2'
        });

      const res = await request(app)
        .get('/api/history/insights')
        .set('Authorization', `Bearer ${tokenUserB}`);

      expect(res.status).toBe(200);
      const trackEntry = res.body.topTracks.find(t => t.jamendoId === 'replay_track_1');
      expect(trackEntry).toBeDefined();
      expect(trackEntry.plays).toBe(2);
      expect(trackEntry.listeningSeconds).toBe(65);
    });

    it('keeps GET /api/history pagination limit separate from insights aggregation on large histories', async () => {
      const resC = await request(app)
        .post('/api/auth/register')
        .send({ name: 'User C', email: getUniqueEmail('userC_large'), password: 'Password123!' });
      const tokenUserC = resC.body.token;

      // Create 110 history entries
      for (let i = 1; i <= 110; i++) {
        await request(app)
          .post('/api/history')
          .set('Authorization', `Bearer ${tokenUserC}`)
          .send({
            ...historyTrack,
            jamendoId: `large_track_${i}`,
            title: `Large Track ${i}`,
            duration: 100,
            position: 20,
            listenDuration: 20,
            sessionId: `sess_large_${i}`
          });
      }

      // GET /api/history should be capped at 100 entries
      const histRes = await request(app)
        .get('/api/history')
        .set('Authorization', `Bearer ${tokenUserC}`);
      expect(histRes.status).toBe(200);
      expect(histRes.body.length).toBe(100);

      // GET /api/history/insights aggregates all 110 qualified plays
      const insRes = await request(app)
        .get('/api/history/insights')
        .set('Authorization', `Bearer ${tokenUserC}`);
      expect(insRes.status).toBe(200);
      expect(insRes.body.totalPlays).toBe(110);
      expect(insRes.body.totalListeningSeconds).toBe(110 * 20);

      // Verify dailyTrends has 7 days with consistent UTC date keys and day names
      expect(insRes.body.dailyTrends).toHaveLength(7);
      for (const d of insRes.body.dailyTrends) {
        expect(d.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(typeof d.dayName).toBe('string');
        expect(d.dayName.length).toBeGreaterThan(0);
      }
    });

    it('handles replay detection on zero-duration live stream when distinct session is provided', async () => {
      const liveTrack = {
        jamendoId: 'live_stream_station_1',
        title: 'Radio Mirchi 98.3 FM',
        artist: 'Radio Mirchi',
        duration: 0,
        position: 30,
        listenDuration: 30
      };

      // Session 1: Listen to live stream for 30s
      await request(app)
        .post('/api/history')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({ ...liveTrack, sessionId: 'live_sess_1' });

      // Session 2: User stops, then re-tunes to live stream with a new session
      await request(app)
        .post('/api/history')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({ ...liveTrack, sessionId: 'live_sess_2', listenDuration: 25, position: 25 });

      const insights = await request(app)
        .get('/api/history/insights')
        .set('Authorization', `Bearer ${tokenUserA}`);

      const liveEntry = insights.body.topTracks.find(t => t.jamendoId === 'live_stream_station_1');
      expect(liveEntry).toBeDefined();
      expect(liveEntry.plays).toBe(2);
      expect(liveEntry.listeningSeconds).toBe(55);
    });

    it('prunes expired or excess in-memory sessions to protect memory bounds', () => {
      const historyRouter = require('../backend/routes/history');
      expect(typeof historyRouter._pruneSessions).toBe('function');
      const map = historyRouter._activeSessions;

      // Insert dummy expired session (> 24 hours old)
      const oldTime = Date.now() - (25 * 60 * 60 * 1000);
      map.set('u_test:ses_old', {
        sessionId: 'ses_old',
        startedAt: oldTime,
        createdAt: oldTime
      });

      // Insert recent session
      map.set('u_test:ses_new', {
        sessionId: 'ses_new',
        startedAt: Date.now(),
        createdAt: Date.now()
      });

      historyRouter._pruneSessions();

      expect(map.has('u_test:ses_old')).toBe(false);
      expect(map.has('u_test:ses_new')).toBe(true);

      // Clean up test entry
      map.delete('u_test:ses_new');
    });

    it('REGRESSION FINDING 2: updates the exact session history record and never overwrites concurrent sessions of the same track', async () => {
      const History = require('../backend/models/History');
      const trackId = 'concurrent_track_999';

      // User A starts playing trackId in Session A (e.g. Tab 1)
      const resA = await request(app)
        .post('/api/history')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({
          ...historyTrack,
          jamendoId: trackId,
          duration: 240,
          position: 10,
          listenDuration: 10,
          sessionId: 'session_tab_A'
        });
      expect(resA.status).toBe(201);

      // User A later starts playing same trackId in Session B (e.g. Tab 2 or next day)
      const resB = await request(app)
        .post('/api/history')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({
          ...historyTrack,
          jamendoId: trackId,
          duration: 240,
          position: 5,
          listenDuration: 5,
          sessionId: 'session_tab_B'
        });
      expect(resB.status).toBe(201);

      // Now Tab 1 sends a checkpoint for session_tab_A at position 50, listenDuration 50
      const putRes = await request(app)
        .put('/api/history/position')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({
          jamendoId: trackId,
          position: 50,
          listenDuration: 50,
          sessionId: 'session_tab_A'
        });

      expect(putRes.status).toBe(200);
      expect(putRes.body.sessionId).toBe('session_tab_A');
      expect(putRes.body.position).toBe(50);

      // Verify Session A history record was updated
      const entryA = await History.findOne({ sessionId: 'session_tab_A' });
      expect(entryA).toBeDefined();
      expect(entryA.position).toBe(50);
      expect(entryA.listenDuration).toBe(50);

      // Verify Session B history record was NOT overwritten by Session A's checkpoint!
      const entryB = await History.findOne({ sessionId: 'session_tab_B' });
      expect(entryB).toBeDefined();
      expect(entryB.position).toBe(5);
      expect(entryB.listenDuration).toBe(5);
    });

    it('REGRESSION FINDING 2: handles legacy entries without sessionId safely without colliding with active sessions', async () => {
      const History = require('../backend/models/History');
      const trackId = 'legacy_track_888';

      // 1. Create an active session entry with sessionId
      await request(app)
        .post('/api/history')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({
          ...historyTrack,
          jamendoId: trackId,
          duration: 200,
          position: 15,
          listenDuration: 15,
          sessionId: 'active_session_xyz'
        });

      // 2. Insert an older legacy history record without sessionId
      const legacyEntry = await History.create({
        userId: (await History.findOne({ sessionId: 'active_session_xyz' })).userId,
        jamendoId: trackId,
        title: historyTrack.title,
        artist: historyTrack.artist,
        coverUrl: historyTrack.coverUrl,
        audioUrl: historyTrack.audioUrl,
        duration: 200,
        position: 5,
        listenDuration: 5,
        sessionId: null,
        playedAt: new Date(Date.now() - 60000)
      });

      // 3. A legacy checkpoint without sessionId arrives
      const putRes = await request(app)
        .put('/api/history/position')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({
          jamendoId: trackId,
          position: 40,
          listenDuration: 40
        });

      expect(putRes.status).toBe(200);

      // Verify the legacy entry was updated
      const updatedLegacy = await History.findById(legacyEntry._id);
      expect(updatedLegacy.position).toBe(40);

      // Verify active_session_xyz was NOT overwritten by legacy checkpoint
      const activeEntry = await History.findOne({ sessionId: 'active_session_xyz' });
      expect(activeEntry.position).toBe(15);
    });
  });
});

