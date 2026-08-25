const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('crypto'); // or custom generator
const { readData, writeData } = require('../services/db');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Please provide name, email, and password.' });
    }

    const cleanEmail = email.toLowerCase().trim();
    const users = await readData('users');

    // Check if user exists
    const existing = users.find(u => u.email === cleanEmail);
    if (existing) {
      return res.status(400).json({ error: 'An account with this email already exists.' });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const newUser = {
      id: generateId(),
      name: name.trim(),
      email: cleanEmail,
      password: hashedPassword,
      createdAt: new Date().toISOString()
    };

    users.push(newUser);
    await writeData('users', users);

    // Create JWT
    const secret = process.env.JWT_SECRET || 'auralist_jwt_super_secret_key_2026_safe';
    const token = jwt.sign(
      { id: newUser.id, name: newUser.name, email: newUser.email },
      secret,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      message: 'Registration successful',
      token,
      user: { id: newUser.id, name: newUser.name, email: newUser.email }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Server error during registration.' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Please provide email and password.' });
    }

    const cleanEmail = email.toLowerCase().trim();
    const users = await readData('users');

    const user = users.find(u => u.email === cleanEmail);
    if (!user) {
      return res.status(400).json({ error: 'Invalid email or password.' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: 'Invalid email or password.' });
    }

    // Create JWT
    const secret = process.env.JWT_SECRET || 'auralist_jwt_super_secret_key_2026_safe';
    const token = jwt.sign(
      { id: user.id, name: user.name, email: user.email },
      secret,
      { expiresIn: '7d' }
    );

    res.json({
      message: 'Login successful',
      token,
      user: { id: user.id, name: user.name, email: user.email }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error during login.' });
  }
});

// GET /api/auth/me
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const users = await readData('users');
    const user = users.find(u => u.id === req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    res.json({
      user: { id: user.id, name: user.name, email: user.email }
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error fetching profile.' });
  }
});

module.exports = router;
