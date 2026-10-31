/**
 * Regression Tests — fixes applied in the code audit
 *
 * Covers:
 *  1. Catalog API returns correct totalSongs + totalPages (no hardcoded 2103 / 53)
 *  2. Security HTTP headers are present in every API response
 *  3. Unknown /api/* paths return 404 JSON (not HTML)
 *  4. History trimming stays at ≤ 100 per user (atomic behaviour)
 *  5. Like toggle is idempotent (second POST unlikes cleanly)
 *  6. Playlist jamendoId identifier consistency
 */
const request = require('supertest');
const app = require('../server');

// ─── helpers ────────────────────────────────────────────────────────────────
let _counter = 0;
const uniqueEmail = (prefix = 'reg') =>
  `${prefix}_${Date.now()}_${++_counter}_${Math.random().toString(36).slice(2, 8)}@example.com`;

async function registerUser(name = 'Reg User', prefix = 'reg') {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ name, email: uniqueEmail(prefix), password: 'Password123!' });
  return { token: res.body.token, user: res.body.user };
}

// ─── 1. Catalog pagination correctness ──────────────────────────────────────
describe('Regression — Catalog pagination (no hardcoded counts)', () => {
  it('GET /api/music/catalog returns numeric totalSongs > 0', async () => {
    const res = await request(app).get('/api/music/catalog?page=1&limit=40');
    expect(res.status).toBe(200);
    expect(typeof res.body.totalSongs).toBe('number');
    expect(res.body.totalSongs).toBeGreaterThan(0);
  });

  it('GET /api/music/catalog returns correct totalPages matching Math.ceil(totalSongs/limit)', async () => {
    const res = await request(app).get('/api/music/catalog?page=1&limit=40');
    expect(res.status).toBe(200);
    const { totalSongs, totalPages, limit } = res.body;
    const expectedPages = Math.ceil(totalSongs / limit);
    expect(totalPages).toBe(expectedPages);
  });

  it('should NOT report 2103 as totalSongs (stale hardcoded value)', async () => {
    const res = await request(app).get('/api/music/catalog?page=1&limit=40');
    expect(res.status).toBe(200);
    expect(res.body.totalSongs).not.toBe(2103);
  });

  it('GET /api/music/catalog page 2 returns a different batch than page 1', async () => {
    const page1 = await request(app).get('/api/music/catalog?page=1&limit=10');
    const page2 = await request(app).get('/api/music/catalog?page=2&limit=10');
    expect(page1.status).toBe(200);
    expect(page2.status).toBe(200);
    if (page1.body.totalSongs > 10) {
      const ids1 = page1.body.tracks.map(t => t.id);
      const ids2 = page2.body.tracks.map(t => t.id);
      expect(ids1).not.toEqual(ids2);
    }
  });

  it('GET /api/music/catalog beyond last page returns empty tracks array', async () => {
    // Page 200 is within the validator max (1000) but beyond the catalog's 103 pages,
    // so the API should return 200 with an empty tracks array.
    const res = await request(app).get('/api/music/catalog?page=200&limit=40');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.tracks)).toBe(true);
    expect(res.body.tracks.length).toBe(0);
  });
});

// ─── 2. Security headers ─────────────────────────────────────────────────────
describe('Regression — Security HTTP headers present on API responses', () => {
  it('X-Content-Type-Options: nosniff is set', async () => {
    const res = await request(app).get('/api/music/catalog');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('X-Frame-Options: DENY is set', async () => {
    const res = await request(app).get('/api/music/catalog');
    expect(res.headers['x-frame-options']).toBe('DENY');
  });

  it('X-XSS-Protection is set', async () => {
    const res = await request(app).get('/api/music/catalog');
    expect(res.headers['x-xss-protection']).toBeDefined();
  });

  it('Referrer-Policy is set', async () => {
    const res = await request(app).get('/api/music/catalog');
    expect(res.headers['referrer-policy']).toBeDefined();
  });
});

// ─── 3. Unknown /api/* paths return 404 JSON (not HTML) ──────────────────────
describe('Regression — Unknown API paths return JSON 404', () => {
  it('GET /api/nonexistent returns 404 JSON', async () => {
    const res = await request(app).get('/api/nonexistent_endpoint_xyz');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/json/);
    expect(res.body).toHaveProperty('error');
  });
});

// ─── 4. History trim — stays at <= 100 entries per user ───────────────────────
describe('Regression — History trim stays <=100 entries (atomic fix)', () => {
  it('history never exceeds 100 entries after many inserts', async () => {
    const { token } = await registerUser('Hist User', 'hist_trim');

    for (let i = 1; i <= 105; i++) {
      await request(app)
        .post('/api/history')
        .set('Authorization', `Bearer ${token}`)
        .send({
          jamendoId: String(i),
          title: `Track ${i}`,
          artist: 'Artist',
          duration: 180
        });
    }

    const res = await request(app)
      .get('/api/history')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.length).toBeLessThanOrEqual(100);
  }, 30000);
});

// ─── 5. Like toggle idempotency ───────────────────────────────────────────────
describe('Regression — Like toggle idempotency', () => {
  it('double-toggle results in unliked state with empty liked list', async () => {
    const { token } = await registerUser('Like Reg User', 'like_reg');
    const trackBody = {
      title: 'Reg Song',
      artist: 'Reg Artist',
      audioUrl: 'https://example.com/reg.mp3',
      duration: 200
    };

    const res1 = await request(app)
      .post('/api/likes/reg_track_001')
      .set('Authorization', `Bearer ${token}`)
      .send(trackBody);
    expect(res1.body.liked).toBe(true);

    const res2 = await request(app)
      .post('/api/likes/reg_track_001')
      .set('Authorization', `Bearer ${token}`)
      .send(trackBody);
    expect(res2.body.liked).toBe(false);

    const res3 = await request(app)
      .get('/api/likes')
      .set('Authorization', `Bearer ${token}`);
    expect(res3.body.length).toBe(0);
  });
});

// ─── 6. Playlist track identifier consistency ─────────────────────────────────
describe('Regression — Playlist tracks use jamendoId consistently', () => {
  let token, playlistId;

  beforeEach(async () => {
    const { token: t } = await registerUser('PL Id User', 'pl_id');
    token = t;
    const res = await request(app)
      .post('/api/playlists')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'ID Consistency Test' });
    playlistId = res.body.id;
  });

  it('track added with jamendoId can be removed by that same jamendoId', async () => {
    const track = {
      jamendoId: 'jiosaavn_abc123',
      title: 'ID Test Song',
      artist: 'ID Artist',
      audioUrl: 'https://example.com/id_test.mp3',
      duration: 180
    };

    const addRes = await request(app)
      .post(`/api/playlists/${playlistId}/tracks`)
      .set('Authorization', `Bearer ${token}`)
      .send(track);

    expect([200, 201]).toContain(addRes.status);
    expect(addRes.body.tracks[0].jamendoId).toBe('jiosaavn_abc123');

    const delRes = await request(app)
      .delete(`/api/playlists/${playlistId}/tracks/jiosaavn_abc123`)
      .set('Authorization', `Bearer ${token}`);

    expect(delRes.status).toBe(200);
    expect(delRes.body.tracks.length).toBe(0);
  });

  it('adding duplicate jamendoId to playlist is rejected with 400', async () => {
    const track = {
      jamendoId: 'dupe_id_999',
      title: 'Dupe Song',
      artist: 'Dupe Artist',
      audioUrl: 'https://example.com/dupe.mp3',
      duration: 180
    };

    await request(app)
      .post(`/api/playlists/${playlistId}/tracks`)
      .set('Authorization', `Bearer ${token}`)
      .send(track);

    const res2 = await request(app)
      .post(`/api/playlists/${playlistId}/tracks`)
      .set('Authorization', `Bearer ${token}`)
      .send(track);

    expect(res2.status).toBe(400);
    expect(res2.body.error).toMatch(/already in this playlist/i);
  });
});

// ─── 7. Playlist Rename & Isolation ──────────────────────────────────────────
describe('Regression — Playlist Rename (PUT /api/playlists/:id)', () => {
  let userA, userB, playlistId;

  beforeEach(async () => {
    userA = await registerUser('Owner User', 'owner');
    userB = await registerUser('Other User', 'other');

    const plRes = await request(app)
      .post('/api/playlists')
      .set('Authorization', `Bearer ${userA.token}`)
      .send({ name: 'Initial Playlist Name' });
    playlistId = plRes.body.id;
  });

  it('allows owner to rename playlist with valid name', async () => {
    const res = await request(app)
      .put(`/api/playlists/${playlistId}`)
      .set('Authorization', `Bearer ${userA.token}`)
      .send({ name: 'Updated Aesthetic Vibes' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Updated Aesthetic Vibes');
    expect(res.body.id).toBe(playlistId);
  });

  it('rejects empty or whitespace-only playlist name', async () => {
    const res = await request(app)
      .put(`/api/playlists/${playlistId}`)
      .set('Authorization', `Bearer ${userA.token}`)
      .send({ name: '   ' });

    expect(res.status).toBe(400);
  });

  it('CRITICAL SECURITY: User B cannot rename User A playlist', async () => {
    const res = await request(app)
      .put(`/api/playlists/${playlistId}`)
      .set('Authorization', `Bearer ${userB.token}`)
      .send({ name: 'Hacked Name' });

    expect(res.status).toBe(404);
  });
});

// ─── 8. Music Provider Genre Mapping (Workout & Relax) ───────────────────────
describe('Regression — Music Provider Genre Search (workout & relax)', () => {
  it('GET /api/music/search?genre=workout returns tracks array', async () => {
    const res = await request(app).get('/api/music/search?genre=workout&limit=10');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET /api/music/search?genre=relax returns tracks array', async () => {
    const res = await request(app).get('/api/music/search?genre=relax&limit=10');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

// ─── 9. Production Readiness (Health Checks & Gzip Compression) ───────────────
describe('Production Readiness — Health Check & Response Compression', () => {
  it('GET /health returns 200 with uptime and database status', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(typeof res.body.uptime).toBe('number');
    expect(typeof res.body.timestamp).toBe('number');
    expect(['connected', 'disconnected']).toContain(res.body.database);
  });

  it('GET /api/health returns 200 consistent with container orchestrator probes', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('GET /health/live and /health/ready provide independent liveness and readiness', async () => {
    const live = await request(app).get('/health/live');
    expect(live.status).toBe(200);
    expect(live.body.status).toBe('ok');

    const ready = await request(app).get('/health/ready');
    // In this test file, setup.js connected to the test database
    expect(ready.status).toBe(200);
    expect(ready.body.status).toBe('ready');
    expect(ready.body.database).toBe('connected');
  });

  it('serves HTML pages with strict no-cache revalidation headers', async () => {
    const res = await request(app).get('/app');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-cache, must-revalidate');
  });

  it('serves static assets with gzip compression when requested', async () => {
    const res = await request(app)
      .get('/css/style.css')
      .set('Accept-Encoding', 'gzip');
    expect(res.status).toBe(200);
    expect(res.headers['content-encoding']).toBe('gzip');
  });

  it('port fallback cleanly updates activeServer reference when initial port is in use', async () => {
    const http = require('http');
    const testPort = 3982;
    const blocker = http.createServer((req, res) => res.end('blocked'));

    await new Promise((resolve) => blocker.listen(testPort, resolve));

    try {
      app.startServer(testPort);

      // Wait briefly for port collision resolution
      await new Promise((resolve) => setTimeout(resolve, 250));

      const active = app.getActiveServer();
      expect(active).not.toBeNull();
      expect(active.address().port).toBe(testPort + 1);

      // Cleanly close active server
      await new Promise((resolve) => active.close(resolve));
    } finally {
      await new Promise((resolve) => blocker.close(resolve));
    }
  });
});

