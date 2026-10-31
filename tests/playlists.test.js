const request = require('supertest');
const app = require('../server');

describe('Playlist Management & Isolation API (/api/playlists)', () => {
  let tokenUserA, tokenUserB;
  let userA, userB;
  const trackSample = {
    jamendoId: '1001',
    title: 'Test Song',
    artist: 'Test Artist',
    coverUrl: 'https://example.com/cover.jpg',
    audioUrl: 'https://example.com/audio.mp3',
    duration: 180
  };

  let counter = 0;
  const getUniqueEmail = (prefix) => `${prefix}_${Date.now()}_${++counter}_${Math.random().toString(36).substring(2, 8)}@example.com`;

  beforeEach(async () => {
    const resA = await request(app)
      .post('/api/auth/register')
      .send({ name: 'User A', email: getUniqueEmail('userA_play'), password: 'Password123!' });
    tokenUserA = resA.body.token;
    userA = resA.body.user;

    const resB = await request(app)
      .post('/api/auth/register')
      .send({ name: 'User B', email: getUniqueEmail('userB_play'), password: 'Password123!' });
    tokenUserB = resB.body.token;
    userB = resB.body.user;
  });

  describe('POST /api/playlists', () => {
    it('should allow an authenticated user to create a playlist', async () => {
      const res = await request(app)
        .post('/api/playlists')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({ name: 'My Workout Mix' });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('id');
      expect(res.body.name).toBe('My Workout Mix');
      expect(res.body.tracks).toEqual([]);
    });

    it('should reject creation without authentication', async () => {
      const res = await request(app)
        .post('/api/playlists')
        .send({ name: 'Unauthenticated Playlist' });

      expect(res.status).toBe(401);
    });

    it('should reject playlist with an empty or whitespace name', async () => {
      const res = await request(app)
        .post('/api/playlists')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({ name: '   ' });

      expect(res.status).toBe(400);
    });

    it('should reject playlist name exceeding 100 characters', async () => {
      const res = await request(app)
        .post('/api/playlists')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({ name: 'A'.repeat(101) });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/playlists', () => {
    it('should return only playlists owned by the authenticated user', async () => {
      await request(app)
        .post('/api/playlists')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({ name: 'User A Playlist 1' });

      await request(app)
        .post('/api/playlists')
        .set('Authorization', `Bearer ${tokenUserB}`)
        .send({ name: 'User B Playlist 1' });

      const resA = await request(app)
        .get('/api/playlists')
        .set('Authorization', `Bearer ${tokenUserA}`);

      expect(resA.status).toBe(200);
      expect(resA.body).toHaveLength(1);
      expect(resA.body[0].name).toBe('User A Playlist 1');

      const resB = await request(app)
        .get('/api/playlists')
        .set('Authorization', `Bearer ${tokenUserB}`);

      expect(resB.status).toBe(200);
      expect(resB.body).toHaveLength(1);
      expect(resB.body[0].name).toBe('User B Playlist 1');
    });
  });

  describe('Tracks Management & Horizontal Authorization', () => {
    let playlistA;

    beforeEach(async () => {
      const createRes = await request(app)
        .post('/api/playlists')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({ name: 'User A Chill Hits' });

      playlistA = createRes.body;
    });

    it('should allow User A to add a track to their playlist', async () => {
      const res = await request(app)
        .post(`/api/playlists/${playlistA.id}/tracks`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send(trackSample);

      expect([200, 201]).toContain(res.status);
      expect(res.body.tracks).toHaveLength(1);
      expect(res.body.tracks[0].title).toBe('Test Song');
    });

    it('atomically prevents duplicate playlist tracks under concurrent add requests', async () => {
      // Fire 5 simultaneous requests to add the exact same track
      const concurrentRequests = Array.from({ length: 5 }, () =>
        request(app)
          .post(`/api/playlists/${playlistA.id}/tracks`)
          .set('Authorization', `Bearer ${tokenUserA}`)
          .send(trackSample)
      );

      const responses = await Promise.all(concurrentRequests);

      // Exactly one request must succeed (201), the rest must be rejected with 400
      const successes = responses.filter(r => r.status === 201 || r.status === 200);
      const duplicateRejections = responses.filter(r => r.status === 400);

      expect(successes).toHaveLength(1);
      expect(duplicateRejections).toHaveLength(4);

      // Final playlist tracks array MUST contain exactly 1 copy of the track
      const getRes = await request(app)
        .get(`/api/playlists/${playlistA.id}`)
        .set('Authorization', `Bearer ${tokenUserA}`);
      expect(getRes.status).toBe(200);
      expect(getRes.body.tracks).toHaveLength(1);
      expect(getRes.body.tracks[0].jamendoId).toBe(trackSample.jamendoId);
    });

    it('should allow User A to remove a track from their playlist', async () => {
      await request(app)
        .post(`/api/playlists/${playlistA.id}/tracks`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send(trackSample);

      const delRes = await request(app)
        .delete(`/api/playlists/${playlistA.id}/tracks/${trackSample.jamendoId}`)
        .set('Authorization', `Bearer ${tokenUserA}`);

      expect(delRes.status).toBe(200);
      expect(delRes.body.tracks).toHaveLength(0);
    });

    it('should reject invalid Mongo ObjectId format for playlist operations', async () => {
      const res = await request(app)
        .get('/api/playlists/invalid-id-123')
        .set('Authorization', `Bearer ${tokenUserA}`);

      expect(res.status).toBe(400);
    });

    it('should return 404 for non-existent playlist ID', async () => {
      const res = await request(app)
        .get('/api/playlists/507f1f77bcf86cd799439011')
        .set('Authorization', `Bearer ${tokenUserA}`);

      expect(res.status).toBe(404);
    });

    it('CRITICAL SECURITY: User B MUST NOT be able to read User A playlist', async () => {
      const res = await request(app)
        .get(`/api/playlists/${playlistA.id}`)
        .set('Authorization', `Bearer ${tokenUserB}`);

      expect([403, 404]).toContain(res.status);
    });

    it('CRITICAL SECURITY: User B MUST NOT be able to update User A playlist', async () => {
      const res = await request(app)
        .put(`/api/playlists/${playlistA.id}`)
        .set('Authorization', `Bearer ${tokenUserB}`)
        .send({ name: 'Hacked Name' });

      expect([403, 404]).toContain(res.status);

      // Verify User A playlist was untouched
      const checkRes = await request(app)
        .get(`/api/playlists/${playlistA.id}`)
        .set('Authorization', `Bearer ${tokenUserA}`);
      expect(checkRes.body.name).toBe('User A Chill Hits');
    });

    it('CRITICAL SECURITY: User B MUST NOT be able to delete User A playlist', async () => {
      const res = await request(app)
        .delete(`/api/playlists/${playlistA.id}`)
        .set('Authorization', `Bearer ${tokenUserB}`);

      expect([403, 404]).toContain(res.status);

      const checkRes = await request(app)
        .get(`/api/playlists/${playlistA.id}`)
        .set('Authorization', `Bearer ${tokenUserA}`);
      expect(checkRes.status).toBe(200);
    });

    it('CRITICAL SECURITY: User B MUST NOT be able to add track to User A playlist', async () => {
      const res = await request(app)
        .post(`/api/playlists/${playlistA.id}/tracks`)
        .set('Authorization', `Bearer ${tokenUserB}`)
        .send(trackSample);

      expect([403, 404]).toContain(res.status);
    });
  });
});
