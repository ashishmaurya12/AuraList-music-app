const request = require('supertest');
const app = require('../server');
const User = require('../backend/models/User');

describe('Security Hardening & Privilege Escalation Tests', () => {
  describe('Mass Assignment & Property Pollution Protection', () => {
    it('should reject registration attempts containing extra fields (e.g. role: admin, isAdmin: true)', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'Attacker User',
          email: 'attacker@example.com',
          password: 'Password123!',
          role: 'admin',
          isAdmin: true
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();

      const userInDb = await User.findOne({ email: 'attacker@example.com' });
      expect(userInDb).toBeNull();
    });

    it('should reject unknown extra parameters in playlist creation', async () => {
      const authRes = await request(app)
        .post('/api/auth/register')
        .send({ name: 'User Sec', email: 'usersec@example.com', password: 'Password123!' });

      const res = await request(app)
        .post('/api/playlists')
        .set('Authorization', `Bearer ${authRes.body.token}`)
        .send({
          name: 'Security Test Playlist',
          isSystemPlaylist: true,
          owner: '507f1f77bcf86cd799439099'
        });

      expect(res.status).toBe(400);
    });
  });

  describe('CORS Policy Origin Enforcement', () => {
    it('should allow configured origin (http://localhost:3000)', async () => {
      const res = await request(app)
        .get('/api/music/catalog')
        .set('Origin', 'http://localhost:3000');

      expect(res.status).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    });

    it('should allow supported fallback ports (http://localhost:3001, http://127.0.0.1:3005)', async () => {
      const res3001 = await request(app)
        .get('/api/music/catalog')
        .set('Origin', 'http://localhost:3001');

      expect(res3001.status).toBe(200);
      expect(res3001.headers['access-control-allow-origin']).toBe('http://localhost:3001');

      const res127 = await request(app)
        .get('/api/music/catalog')
        .set('Origin', 'http://127.0.0.1:3005');

      expect(res127.status).toBe(200);
      expect(res127.headers['access-control-allow-origin']).toBe('http://127.0.0.1:3005');
    });

    it('should reject arbitrary localhost ports outside fallback range (http://localhost:9999)', async () => {
      const res = await request(app)
        .get('/api/music/catalog')
        .set('Origin', 'http://localhost:9999');

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/CORS policy/i);
    });

    it('should reject unauthorized origin with HTTP 403', async () => {
      const res = await request(app)
        .get('/api/music/catalog')
        .set('Origin', 'https://malicious-hacker-domain.com');

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/CORS policy/i);
    });
  });

  describe('Content-Security-Policy & Security Headers', () => {
    it('should include Content-Security-Policy with appropriate directives for media and fonts', async () => {
      const res = await request(app).get('/api/music/catalog');
      expect(res.headers).toHaveProperty('content-security-policy');
      const csp = res.headers['content-security-policy'];
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("script-src 'self'");
      expect(csp).toContain("style-src 'self' 'unsafe-inline'");
      expect(csp).toContain("img-src 'self'");
      expect(csp).toContain("media-src 'self'");
      expect(csp).toContain("connect-src 'self'");
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBe('DENY');
    });

    it('login and registration pages contain no inline scripts and load external auth.js cleanly under script-src self', async () => {
      const loginRes = await request(app).get('/login');
      expect(loginRes.status).toBe(200);
      expect(loginRes.headers).toHaveProperty('content-security-policy');
      expect(loginRes.headers['content-security-policy']).toContain("script-src 'self'");
      // Must not contain inline <script> tags without src
      const loginInlineScriptMatches = loginRes.text.match(/<script(?![^>]*\bsrc\b)[^>]*>([\s\S]*?)<\/script>/gi);
      expect(loginInlineScriptMatches).toBeNull();
      expect(loginRes.text).toContain('<script src="/js/auth.js"></script>');

      const regRes = await request(app).get('/register');
      expect(regRes.status).toBe(200);
      expect(regRes.headers).toHaveProperty('content-security-policy');
      expect(regRes.headers['content-security-policy']).toContain("script-src 'self'");
      const regInlineScriptMatches = regRes.text.match(/<script(?![^>]*\bsrc\b)[^>]*>([\s\S]*?)<\/script>/gi);
      expect(regInlineScriptMatches).toBeNull();
      expect(regRes.text).toContain('<script src="/js/auth.js"></script>');

      // Verify that /js/auth.js is served with application/javascript
      const jsRes = await request(app).get('/js/auth.js');
      expect(jsRes.status).toBe(200);
      expect(jsRes.headers['content-type']).toMatch(/javascript/i);
      expect(jsRes.text).toContain('loginForm');
      expect(jsRes.text).toContain('registerForm');
    });
  });

  describe('Request Body Size Limits', () => {
    it('should reject oversized JSON payloads (>1MB) with HTTP 413 or 400', async () => {
      const largePayload = {
        name: 'Oversized User',
        email: 'oversized@example.com',
        password: 'Password123!',
        data: 'x'.repeat(1024 * 1024 * 2) // 2MB string
      };

      const res = await request(app)
        .post('/api/auth/register')
        .send(largePayload);

      expect([400, 413]).toContain(res.status);
    });
  });

  describe('Error Response Information Leak Protection', () => {
    it('should return safe JSON error without exposing stack traces, JWT secrets, or DB credentials', async () => {
      const res = await request(app)
        .get('/api/playlists/invalid-object-id-string')
        .set('Authorization', 'Bearer invalid_token_123');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('error');
      expect(res.body.stack).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toContain('stack');
      expect(JSON.stringify(res.body)).not.toContain('MONGODB_URI');
      expect(JSON.stringify(res.body)).not.toContain(process.env.JWT_SECRET);
    });
  });

  describe('Distributable Archive Protection & Credential Exclusion', () => {
    const { isSafeForArchive } = require('../scripts/create_clean_archive');

    it('strictly forbids sensitive environment files and .git from being packaged', () => {
      expect(isSafeForArchive('.env')).toBe(false);
      expect(isSafeForArchive('.env.local')).toBe(false);
      expect(isSafeForArchive('.env.production')).toBe(false);
      expect(isSafeForArchive('.git')).toBe(false);
      expect(isSafeForArchive('.git/config')).toBe(false);
      expect(isSafeForArchive('.git/HEAD')).toBe(false);
      expect(isSafeForArchive('node_modules/express/index.js')).toBe(false);
      expect(isSafeForArchive('coverage/lcov.info')).toBe(false);
      expect(isSafeForArchive('app.log')).toBe(false);
      expect(isSafeForArchive('dist/bundle.zip')).toBe(false);
      expect(isSafeForArchive('data/users.json')).toBe(false);
      expect(isSafeForArchive('certs/server.key')).toBe(false);
      expect(isSafeForArchive('certs/server.pem')).toBe(false);
    });

    it('permits clean distribution files including safe templates', () => {
      expect(isSafeForArchive('.env.example')).toBe(true);
      expect(isSafeForArchive('server.js')).toBe(true);
      expect(isSafeForArchive('public/index.html')).toBe(true);
      expect(isSafeForArchive('backend/routes/music.js')).toBe(true);
      expect(isSafeForArchive('data/catalog.json')).toBe(true);
    });
  });
});
