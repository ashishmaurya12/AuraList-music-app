const request = require('supertest');
const app = require('../server');

describe('Zod Input Validation Edge Cases (/api/*)', () => {
  let token;

  beforeEach(async () => {
    const nonce = `${Date.now()}_${Math.floor(Math.random() * 1000000)}`;
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Valid User', email: `valid_val_${nonce}@example.com`, password: 'Password123!' });
    token = res.body.token;
  });

  describe('Query Parameters Validation (/api/music/search & /api/music/catalog)', () => {
    it('should reject string integer injection: ?limit=20abc', async () => {
      const res = await request(app).get('/api/music/search?limit=20abc');
      expect(res.status).toBe(400);
      expect(res.body.error).toBeTruthy();
    });

    it('should reject decimal floating point limit: ?limit=1.5', async () => {
      const res = await request(app).get('/api/music/search?limit=1.5');
      expect(res.status).toBe(400);
    });

    it('should reject negative limit: ?limit=-1', async () => {
      const res = await request(app).get('/api/music/search?limit=-1');
      expect(res.status).toBe(400);
    });

    it('should reject zero limit: ?limit=0', async () => {
      const res = await request(app).get('/api/music/search?limit=0');
      expect(res.status).toBe(400);
    });

    it('should reject excessive limit: ?limit=999999', async () => {
      const res = await request(app).get('/api/music/search?limit=999999');
      expect(res.status).toBe(400);
    });

    it('should reject invalid offset floating point: ?offset=1.5', async () => {
      const res = await request(app).get('/api/music/search?offset=1.5');
      expect(res.status).toBe(400);
    });

    it('should reject invalid page string: ?page=abc', async () => {
      const res = await request(app).get('/api/music/catalog?page=abc');
      expect(res.status).toBe(400);
    });

    it('should accept valid integers: ?limit=20&page=2', async () => {
      const res = await request(app).get('/api/music/search?limit=20&page=2');
      expect(res.status).toBe(200);
    });
  });

  describe('Route Parameters Validation', () => {
    it('should reject malformed Mongo ObjectId in playlist route', async () => {
      const res = await request(app)
        .get('/api/playlists/20abc')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toBeTruthy();
    });

    it('should reject empty spaces in track ID parameter', async () => {
      const res = await request(app).get('/api/music/track/%20%20');
      expect(res.status).toBe(400);
    });
  });

  describe('Request Body Validation', () => {
    it('should reject null payload body on registration', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send(null);

      expect(res.status).toBe(400);
    });

    it('should reject empty object body on registration', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({});

      expect(res.status).toBe(400);
    });

    it('should reject array payload where object is expected', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send([{ name: 'Test' }]);

      expect(res.status).toBe(400);
    });

    it('should reject unexpected field types (e.g. number for email)', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'Test',
          email: 12345,
          password: 'Password123!'
        });

      expect(res.status).toBe(400);
    });
  });
});
