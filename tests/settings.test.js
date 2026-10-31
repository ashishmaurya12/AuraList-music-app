const request = require('supertest');
const app = require('../server');
const User = require('../backend/models/User');
const History = require('../backend/models/History');
const ListeningEvent = require('../backend/models/ListeningEvent');

describe('AuraList Settings & Profile Management Tests', () => {
  let userToken;
  let userId;
  let userBToken;
  let userBId;
  let counter = 0;

  const createTestUser = async (name = 'Test User') => {
    const email = `settings_${Date.now()}_${++counter}_${Math.random().toString(36).substring(2, 6)}@example.com`;
    const password = 'Password123!';
    const regRes = await request(app)
      .post('/api/auth/register')
      .send({ name, email, password });
    return {
      token: regRes.body.token,
      user: regRes.body.user,
      password,
      email
    };
  };

  beforeAll(async () => {
    const u1 = await createTestUser('Alice Settings');
    userToken = u1.token;
    userId = u1.user.id;

    const u2 = await createTestUser('Bob Settings');
    userBToken = u2.token;
    userBId = u2.user.id;
  });

  describe('1. PUT /api/auth/profile (Update Display Name)', () => {
    it('allows authenticated user to update their display name', async () => {
      const res = await request(app)
        .put('/api/auth/profile')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ name: 'Alice Renamed' });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Profile updated successfully');
      expect(res.body.user.name).toBe('Alice Renamed');
      expect(res.body.token).toBeDefined();

      const dbUser = await User.findById(userId);
      expect(dbUser.name).toBe('Alice Renamed');
    });

    it('rejects name shorter than 2 characters or blank name', async () => {
      const res = await request(app)
        .put('/api/auth/profile')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ name: 'A' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    it('rejects unauthenticated profile update request', async () => {
      const res = await request(app)
        .put('/api/auth/profile')
        .send({ name: 'Hacker Name' });

      expect(res.status).toBe(401);
    });

    it('strictly forbids updating email or injecting unexpected fields', async () => {
      const res = await request(app)
        .put('/api/auth/profile')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ name: 'Alice Safe', email: 'hacked@example.com', role: 'admin' });

      expect(res.status).toBe(400);
    });
  });

  describe('2. PUT /api/auth/password (Secure Password Change)', () => {
    it('updates password when valid current password and new password are provided', async () => {
      const u = await createTestUser('Charlie Pass');
      const res = await request(app)
        .put('/api/auth/password')
        .set('Authorization', `Bearer ${u.token}`)
        .send({
          currentPassword: 'Password123!',
          newPassword: 'BrandNewPassword456!'
        });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Password updated successfully');

      // Verify login works with new password
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({
          email: u.email,
          password: 'BrandNewPassword456!'
        });

      expect(loginRes.status).toBe(200);
      expect(loginRes.body.token).toBeDefined();

      // Verify old password no longer works
      const oldLoginRes = await request(app)
        .post('/api/auth/login')
        .send({
          email: u.email,
          password: 'Password123!'
        });

      expect(oldLoginRes.status).toBe(401);
    });

    it('rejects password update when current password is wrong', async () => {
      const u = await createTestUser('Wrong Pass');
      const res = await request(app)
        .put('/api/auth/password')
        .set('Authorization', `Bearer ${u.token}`)
        .send({
          currentPassword: 'IncorrectPassword!',
          newPassword: 'BrandNewPassword456!'
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Current password is incorrect');
    });

    it('rejects new password under 8 characters', async () => {
      const u = await createTestUser('Short Pass');
      const res = await request(app)
        .put('/api/auth/password')
        .set('Authorization', `Bearer ${u.token}`)
        .send({
          currentPassword: 'Password123!',
          newPassword: 'short'
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    it('rejects unauthenticated password update request', async () => {
      const res = await request(app)
        .put('/api/auth/password')
        .send({
          currentPassword: 'Password123!',
          newPassword: 'BrandNewPassword456!'
        });

      expect(res.status).toBe(401);
    });
  });

  describe('3. DELETE /api/history (Clear Playback History)', () => {
    it('clears listening history for authenticated user while isolating User B', async () => {
      // Create history entries for User A and User B
      await History.create({
        userId,
        jamendoId: '1001',
        title: 'Song User A',
        artist: 'Artist A',
        duration: 200,
        position: 100,
        listeningSeconds: 50
      });

      await History.create({
        userId: userBId,
        jamendoId: '1002',
        title: 'Song User B',
        artist: 'Artist B',
        duration: 180,
        position: 90,
        listeningSeconds: 45
      });

      const res = await request(app)
        .delete('/api/history')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('Playback history cleared');

      // Verify User A history is cleared
      const userAHistory = await History.find({ userId });
      expect(userAHistory.length).toBe(0);

      // Verify User B history is completely intact
      const userBHistory = await History.find({ userId: userBId });
      expect(userBHistory.length).toBe(1);
      expect(userBHistory[0].title).toBe('Song User B');
    });

    it('rejects unauthenticated history clear request', async () => {
      const res = await request(app)
        .delete('/api/history');

      expect(res.status).toBe(401);
    });
  });
});

