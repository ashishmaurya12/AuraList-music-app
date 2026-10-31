const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const rateLimit = require('express-rate-limit');

const User = require('../models/User');
const authMiddleware = require('../middleware/auth');
const validate = require('../middleware/validate');
const { registerSchema, loginSchema, updateProfileSchema, updatePasswordSchema } = require('../validators/auth');
const { getJwtSecret } = require('../config/env');

const router = express.Router();

function setAuthCookie(res, token) {
  const isProd = process.env.NODE_ENV === 'production';
  res.cookie('auralist_token', token, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  });
}

// Configure rate limiter specifically for authentication endpoints (20 attempts per 15 minutes)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // 20 attempts per 15 minutes per IP
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  message: { error: 'Too many authentication attempts. Please try again after 15 minutes.' }
});

// POST /api/auth/register
router.post('/register', authLimiter, validate(registerSchema, 'body'), async (req, res, next) => {
  try {
    const { name, email, password } = req.body;

    const cleanEmail = email.toLowerCase().trim();

    // Check if user exists
    const existing = await User.findOne({ email: cleanEmail });
    if (existing) {
      return res.status(400).json({ error: 'An account with this email already exists.' });
    }

    // Hash password (bcrypt work factor 10)
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const newUser = await User.create({
      name: name.trim(),
      email: cleanEmail,
      password: hashedPassword
    });

    const userIdStr = newUser._id.toString();

    // Create JWT using strictly validated JWT_SECRET
    const secret = getJwtSecret();
    const token = jwt.sign(
      { id: userIdStr, name: newUser.name, email: newUser.email },
      secret,
      { expiresIn: '7d' }
    );

    setAuthCookie(res, token);

    res.status(201).json({
      message: 'Registration successful',
      token,
      user: { id: userIdStr, name: newUser.name, email: newUser.email }
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ error: 'An account with this email already exists.' });
    }
    next(error);
  }
});

// POST /api/auth/login
router.post('/login', authLimiter, validate(loginSchema, 'body'), async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const cleanEmail = email.toLowerCase().trim();

    const user = await User.findOne({ email: cleanEmail });
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const userIdStr = user._id.toString();

    // Create JWT using strictly validated JWT_SECRET
    const secret = getJwtSecret();
    const token = jwt.sign(
      { id: userIdStr, name: user.name, email: user.email },
      secret,
      { expiresIn: '7d' }
    );

    setAuthCookie(res, token);

    res.json({
      message: 'Login successful',
      token,
      user: { id: userIdStr, name: user.name, email: user.email }
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/auth/me
router.get('/me', authMiddleware, async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.user.id)) {
      return res.status(400).json({ error: 'Invalid resource ID.' });
    }

    const user = await User.findById(req.user.id).select('-password');
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    res.json({
      user: { id: user._id.toString(), name: user.name, email: user.email }
    });
  } catch (error) {
    next(error);
  }
});

// PUT /api/auth/profile
router.put('/profile', authMiddleware, validate(updateProfileSchema, 'body'), async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.user.id)) {
      return res.status(400).json({ error: 'Invalid resource ID.' });
    }

    const { name } = req.body;
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    user.name = name.trim();
    await user.save();

    const userIdStr = user._id.toString();
    const secret = getJwtSecret();
    const token = jwt.sign(
      { id: userIdStr, name: user.name, email: user.email },
      secret,
      { expiresIn: '7d' }
    );

    setAuthCookie(res, token);

    res.json({
      message: 'Profile updated successfully',
      token,
      user: { id: userIdStr, name: user.name, email: user.email }
    });
  } catch (error) {
    next(error);
  }
});

// PUT /api/auth/password
router.put('/password', authMiddleware, validate(updatePasswordSchema, 'body'), async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.user.id)) {
      return res.status(400).json({ error: 'Invalid resource ID.' });
    }

    const { currentPassword, newPassword } = req.body;
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: 'Current password is incorrect.' });
    }

    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);
    await user.save();

    res.json({
      message: 'Password updated successfully'
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.clearCookie('auralist_token', {
    httpOnly: true,
    path: '/'
  });
  res.json({ success: true, message: 'Logged out successfully.' });
});

module.exports = router;

