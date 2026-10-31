const request = require('supertest');
const app = require('../server');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Like = require('../backend/models/Like');

describe('Likes API (/api/likes)', () => {
  let tokenUserA, tokenUserB;
  const trackA = {
    title: 'Song Alpha',
    artist: 'Artist Alpha',
    coverUrl: 'https://example.com/coverA.jpg',
    audioUrl: 'https://example.com/audioA.mp3',
    duration: 210
  };

  let counter = 0;
  const getUniqueEmail = (prefix) => `${prefix}_${Date.now()}_${++counter}_${Math.random().toString(36).substring(2, 8)}@example.com`;

  beforeEach(async () => {
    const resA = await request(app)
      .post('/api/auth/register')
      .send({ name: 'User A', email: getUniqueEmail('userA_likes'), password: 'Password123!' });
    tokenUserA = resA.body.token;

    const resB = await request(app)
      .post('/api/auth/register')
      .send({ name: 'User B', email: getUniqueEmail('userB_likes'), password: 'Password123!' });
    tokenUserB = resB.body.token;
  });

  describe('POST & DELETE /api/likes/:trackId', () => {
    it('should allow user to like a track', async () => {
      const res = await request(app)
        .post('/api/likes/5001')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send(trackA);

      expect([200, 201]).toContain(res.status);
      expect(res.body.liked).toBe(true);
      expect(res.body.track.jamendoId).toBe('5001');
    });

    it('should handle duplicate likes idempotently or update status cleanly', async () => {
      await request(app)
        .post('/api/likes/5001')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send(trackA);

      const res2 = await request(app)
        .post('/api/likes/5001')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send(trackA);

      expect([200, 201]).toContain(res2.status);
    });

    it('should allow user to unlike a track', async () => {
      await request(app)
        .post('/api/likes/5001')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send(trackA);

      // Toggle off (unlike)
      const delRes = await request(app)
        .post('/api/likes/5001')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send(trackA);

      expect(delRes.status).toBe(200);
      expect(delRes.body.liked).toBe(false);

      const getRes = await request(app)
        .get('/api/likes')
        .set('Authorization', `Bearer ${tokenUserA}`);

      expect(getRes.body).toHaveLength(0);
    });

    it('should reject unauthenticated like request', async () => {
      const res = await request(app)
        .post('/api/likes/5001')
        .send(trackA);

      expect(res.status).toBe(401);
    });

    it('should reject malformed or empty trackId', async () => {
      const res = await request(app)
        .post('/api/likes/%20')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send(trackA);

      expect(res.status).toBe(400);
    });
  });

  describe('User Isolation for Likes', () => {
    it('CRITICAL SECURITY: User A cannot see User B liked tracks', async () => {
      await request(app)
        .post('/api/likes/5001')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send(trackA);

      await request(app)
        .post('/api/likes/9001')
        .set('Authorization', `Bearer ${tokenUserB}`)
        .send({ ...trackA, title: 'Song Beta' });

      const resA = await request(app)
        .get('/api/likes')
        .set('Authorization', `Bearer ${tokenUserA}`);

      expect(resA.status).toBe(200);
      expect(resA.body).toHaveLength(1);
      expect(resA.body[0].jamendoId).toBe('5001');

      const resB = await request(app)
        .get('/api/likes')
        .set('Authorization', `Bearer ${tokenUserB}`);

      expect(resB.status).toBe(200);
      expect(resB.body).toHaveLength(1);
      expect(resB.body[0].jamendoId).toBe('9001');
    });
  });

  describe('Recent Played Song Liking Bug Fix', () => {
    it('creates a like for the specific requested song, not defaulting to another track', async () => {
      const recentSong = {
        title: 'Arz Kiya Hai',
        artist: 'Anuv Jain',
        coverUrl: 'https://images.example.com/arz.jpg',
        audioUrl: 'https://audio.example.com/arz.mp3',
        duration: 294
      };

      const res = await request(app)
        .post('/api/likes/recent_track_001')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send(recentSong);

      expect(res.status).toBe(200);
      expect(res.body.liked).toBe(true);
      expect(res.body.track.jamendoId).toBe('recent_track_001');
      expect(res.body.track.title).toBe('Arz Kiya Hai');
      expect(res.body.track.artist).toBe('Anuv Jain');

      // Verify in DB
      const dbRecord = await Like.findOne({ userId: res.body.track.userId, jamendoId: 'recent_track_001' });
      expect(dbRecord).not.toBeNull();
      expect(dbRecord.title).toBe('Arz Kiya Hai');
    });

    it('falls back to /api/music/stream/:id when audioUrl is omitted or empty', async () => {
      const songWithoutAudio = {
        title: 'Barbaad',
        artist: 'The Rish, Jubin Nautiyal',
        coverUrl: 'https://images.example.com/barbaad.jpg',
        duration: 357
      };

      const res = await request(app)
        .post('/api/likes/recent_track_002')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send(songWithoutAudio);

      expect(res.status).toBe(200);
      expect(res.body.liked).toBe(true);
      expect(res.body.track.audioUrl).toBe('/api/music/stream/recent_track_002');
    });

    it('Frontend AppController: toggleLikeTrack uses explicitTrack and NEVER falls back to player.currentTrack when liking from Recent Played', async () => {
      const postedPayloads = [];
      const mockUI = {
        likedTrackIds: new Set(),
        showToast: jest.fn(),
        updateLikeStatus: jest.fn(),
        renderRecentPlayed: jest.fn(),
        escapeAttr: (str) => String(str).replace(/"/g, '&quot;')
      };

      const mockPlayer = {
        currentTrack: {
          id: 'player_active_999',
          jamendoId: 'player_active_999',
          title: 'Kehdoon Tumhen (From Top 50 Hits)',
          artist: 'Kishore Kumar',
          coverUrl: 'https://example.com/kehdoon.jpg',
          audioUrl: 'https://example.com/kehdoon.mp3',
          duration: 221
        }
      };

      const mockAPI = {
        getToken: () => tokenUserA,
        getUser: () => Promise.resolve(null),
        post: jest.fn().mockImplementation((endpoint, data) => {
          postedPayloads.push({ endpoint, data });
          return Promise.resolve({ liked: true, track: { ...data, jamendoId: endpoint.replace('/likes/', '') } });
        }),
        get: jest.fn().mockImplementation((endpoint) => {
          if (endpoint === '/likes') return Promise.resolve([]);
          if (endpoint.startsWith('/history')) return Promise.resolve([]);
          return Promise.resolve({});
        })
      };

      const appCode = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');
      const fakeElem = {
        innerHTML: '',
        value: '',
        style: {},
        replaceChildren: () => {},
        appendChild: () => {},
        classList: { add: () => {}, remove: () => {}, contains: () => false, toggle: () => false },
        setAttribute: () => {},
        getAttribute: () => null,
        removeAttribute: () => {},
        addEventListener: () => {},
        querySelectorAll: () => [],
        querySelector: () => null
      };

      const sandbox = {
        window: {
          location: { hash: '' },
          addEventListener: () => {},
          removeEventListener: () => {}
        },
        document: {
          documentElement: { setAttribute: () => {} },
          getElementById: () => fakeElem,
          querySelector: () => fakeElem,
          querySelectorAll: () => [],
          addEventListener: () => {},
          removeEventListener: () => {}
        },
        localStorage: { setItem: () => {}, getItem: () => null },
        console,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        UI: mockUI,
        player: mockPlayer,
        API: mockAPI
      };

      const ctx = vm.createContext(sandbox);
      vm.runInContext(appCode + '\n; var testApp = new AppController();', ctx);
      const testApp = sandbox.testApp;
      testApp.loadLikedTracksView = jest.fn();
      testApp.loadRecentPlayed = jest.fn();

      const clickedRecentTrack = {
        id: 'recent_track_777',
        jamendoId: 'recent_track_777',
        title: 'Gehra Hua',
        artist: 'Irshad Kamil, Arijit Singh',
        coverUrl: 'https://example.com/gehra.jpg',
        audioUrl: 'https://example.com/gehra.mp3',
        duration: 362
      };

      // Call toggleLikeTrack with explicitTrack (as passed by renderRecentPlayed)
      await testApp.toggleLikeTrack('recent_track_777', clickedRecentTrack);

      expect(postedPayloads.length).toBe(1);
      expect(postedPayloads[0].endpoint).toBe('/likes/recent_track_777');
      expect(postedPayloads[0].data.title).toBe('Gehra Hua');
      expect(postedPayloads[0].data.artist).toBe('Irshad Kamil, Arijit Singh');
      // Must NOT be the player.currentTrack ("Kehdoon Tumhen")!
      expect(postedPayloads[0].data.title).not.toBe(mockPlayer.currentTrack.title);
      // No distracting toast popups on like toggle (clean UX as requested)
      expect(mockUI.showToast).not.toHaveBeenCalledWith(expect.stringContaining('Saved'));
      expect(mockUI.showToast).not.toHaveBeenCalledWith(expect.stringContaining('Kehdoon Tumhen'));
    });

    it('Frontend AppController: toggleLikeTrack resolves from this.recentTracks when explicitTrack is omitted', async () => {
      const postedPayloads = [];
      const mockUI = {
        likedTrackIds: new Set(),
        showToast: jest.fn(),
        updateLikeStatus: jest.fn(),
        renderRecentPlayed: jest.fn(),
        escapeAttr: (str) => String(str).replace(/"/g, '&quot;')
      };

      const mockPlayer = {
        currentTrack: {
          id: 'player_active_999',
          jamendoId: 'player_active_999',
          title: 'Kehdoon Tumhen (From Top 50 Hits)',
          artist: 'Kishore Kumar',
          coverUrl: 'https://example.com/kehdoon.jpg',
          audioUrl: 'https://example.com/kehdoon.mp3',
          duration: 221
        }
      };

      const mockAPI = {
        getToken: () => tokenUserA,
        getUser: () => Promise.resolve(null),
        post: jest.fn().mockImplementation((endpoint, data) => {
          postedPayloads.push({ endpoint, data });
          return Promise.resolve({ liked: true, track: { ...data, jamendoId: endpoint.replace('/likes/', '') } });
        }),
        get: jest.fn().mockImplementation(() => Promise.resolve({}))
      };

      const appCode = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');
      const fakeElem = {
        innerHTML: '',
        value: '',
        style: {},
        replaceChildren: () => {},
        appendChild: () => {},
        classList: { add: () => {}, remove: () => {}, contains: () => false, toggle: () => false },
        setAttribute: () => {},
        getAttribute: () => null,
        removeAttribute: () => {},
        addEventListener: () => {},
        querySelectorAll: () => [],
        querySelector: () => null
      };

      const sandbox = {
        window: {
          location: { hash: '' },
          addEventListener: () => {},
          removeEventListener: () => {}
        },
        document: {
          documentElement: { setAttribute: () => {} },
          getElementById: () => fakeElem,
          querySelector: () => fakeElem,
          querySelectorAll: () => [],
          addEventListener: () => {},
          removeEventListener: () => {}
        },
        localStorage: { setItem: () => {}, getItem: () => null },
        console,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        UI: mockUI,
        player: mockPlayer,
        API: mockAPI
      };

      const ctx = vm.createContext(sandbox);
      vm.runInContext(appCode + '\n; var testApp = new AppController();', ctx);
      const testApp = sandbox.testApp;
      testApp.loadLikedTracksView = jest.fn();
      testApp.loadRecentPlayed = jest.fn();

      const recentSong = {
        id: 'recent_track_888',
        jamendoId: 'recent_track_888',
        title: 'Ishq de Fanniyar',
        artist: 'Jyotica Tangri',
        coverUrl: 'https://example.com/fanniyar.jpg',
        audioUrl: 'https://example.com/fanniyar.mp3',
        duration: 245
      };

      testApp.recentTracks = [recentSong];
      testApp.registerTracks([recentSong]);

      // Call without explicit track
      await testApp.toggleLikeTrack('recent_track_888');

      expect(postedPayloads.length).toBe(1);
      expect(postedPayloads[0].endpoint).toBe('/likes/recent_track_888');
      expect(postedPayloads[0].data.title).toBe('Ishq de Fanniyar');
      expect(postedPayloads[0].data.artist).toBe('Jyotica Tangri');
      expect(postedPayloads[0].data.title).not.toBe(mockPlayer.currentTrack.title);
    });
  });
});
