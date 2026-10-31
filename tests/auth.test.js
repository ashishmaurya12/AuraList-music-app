const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../server');
const User = require('../backend/models/User');

describe('Authentication & User Management API (/api/auth)', () => {
  let counter = 0;
  const getUniquePayload = () => ({
    name: 'Alice Tester',
    email: `alice_${Date.now()}_${++counter}_${Math.random().toString(36).substring(2, 8)}@example.com`,
    password: 'Password123!'
  });

  describe('POST /api/auth/register', () => {
    it('should successfully register a new user with valid input', async () => {
      const payload = getUniquePayload();
      const res = await request(app)
        .post('/api/auth/register')
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('token');
      expect(res.body).toHaveProperty('user');
      expect(res.body.user.email).toBe(payload.email);
      expect(res.body.user.name).toBe(payload.name);
      expect(res.body.user.password).toBeUndefined();

      // Verify DB state
      const dbUser = await User.findOne({ email: payload.email });
      expect(dbUser).not.toBeNull();
      expect(dbUser.password).not.toBe(payload.password);
    });

    it('should reject registration with a duplicate email', async () => {
      const payload = getUniquePayload();
      await request(app).post('/api/auth/register').send(payload);

      const res = await request(app)
        .post('/api/auth/register')
        .send(payload);

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/An account with this email already exists|Email already registered/i);
    });

    it('should reject registration with an invalid email format', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          ...getUniquePayload(),
          email: 'invalid-email-format'
        });

      expect(res.status).toBe(400);
    });

    it('should reject registration with a password shorter than 8 characters', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          ...getUniquePayload(),
          password: 'Pass123' // 7 characters
        });

      expect(res.status).toBe(400);
      const msg = res.body.error === 'Validation failed.'
        ? res.body.details?.find(d => d.field === 'password')?.message
        : res.body.error;
      expect(msg).toMatch(/at least 8 characters/i);
    });

    it('should reject registration with a password longer than 128 characters', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          ...getUniquePayload(),
          password: 'a'.repeat(129)
        });

      expect(res.status).toBe(400);
    });

    it('should reject registration with missing required fields', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'missingname@example.com',
          password: 'Password123!'
        });

      expect(res.status).toBe(400);
    });

    it('should reject registration when extra unknown fields are submitted', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          ...getUniquePayload(),
          role: 'admin',
          isAdmin: true
        });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/auth/login', () => {
    let userPayload;

    beforeEach(async () => {
      userPayload = getUniquePayload();
      await request(app)
        .post('/api/auth/register')
        .send(userPayload);
    });

    it('should authenticate user and return token with valid credentials', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: userPayload.email,
          password: userPayload.password
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('token');
      expect(res.body).toHaveProperty('user');
      expect(res.body.user.email).toBe(userPayload.email);
      expect(res.body.user.password).toBeUndefined();
    });

    it('should reject login with incorrect password', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: userPayload.email,
          password: 'WrongPassword999!'
        });

      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/Invalid email or password/i);
    });

    it('should reject login with non-existent email', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'nonexistent@example.com',
          password: userPayload.password
        });

      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/Invalid email or password/i);
    });

    it('should reject login with malformed request body', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'not-an-email'
        });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/auth/me & JWT Verification', () => {
    let token;
    let userId;
    let userPayload;

    beforeEach(async () => {
      userPayload = getUniquePayload();
      const regRes = await request(app)
        .post('/api/auth/register')
        .send(userPayload);
      token = regRes.body.token;
      userId = regRes.body.user.id;
    });

    it('should return authenticated user profile without password', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.user.id).toBe(userId);
      expect(res.body.user.email).toBe(userPayload.email);
      expect(res.body.user.password).toBeUndefined();
    });

    it('should reject request with missing Authorization header', async () => {
      const res = await request(app).get('/api/auth/me');
      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/Authentication required/i);
    });

    it('should reject request with malformed Bearer token format', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Basic 123456');

      expect(res.status).toBe(401);
    });

    it('should reject request with expired JWT token', async () => {
      const expiredToken = jwt.sign(
        { id: userId, email: userPayload.email, name: userPayload.name },
        process.env.JWT_SECRET,
        { expiresIn: '-1s' }
      );

      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${expiredToken}`);

      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/Invalid or expired token/i);
    });

    it('should reject request with token signed using an invalid secret', async () => {
      const forgedToken = jwt.sign(
        { id: userId, email: userPayload.email, name: userPayload.name },
        'WRONG_JWT_SECRET_99999',
        { expiresIn: '1h' }
      );

      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${forgedToken}`);

      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/Invalid or expired token/i);
    });
  });
});
