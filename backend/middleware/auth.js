const jwt = require('jsonwebtoken');
const { getJwtSecret } = require('../config/env');

function parseCookies(cookieHeader) {
  const list = {};
  if (!cookieHeader || typeof cookieHeader !== 'string') return list;
  cookieHeader.split(';').forEach(cookie => {
    const parts = cookie.split('=');
    const name = parts[0].trim();
    if (name) {
      list[name] = decodeURIComponent((parts.slice(1).join('=') || '').trim());
    }
  });
  return list;
}

function authMiddleware(req, res, next) {
  let token = null;
  let isCookieAuth = false;

  // 1. Check Authorization header first (Bearer token)
  const authHeader = req.headers.authorization;
  if (authHeader && typeof authHeader === 'string') {
    const parts = authHeader.trim().split(/\s+/);
    if (parts.length === 2 && parts[0] === 'Bearer' && parts[1]) {
      token = parts[1];
    } else {
      return res.status(401).json({ error: 'Authentication required.' });
    }
  }

  // 2. Fall back to secure HttpOnly cookie if no Bearer header is present
  if (!token && req.headers.cookie) {
    const cookies = parseCookies(req.headers.cookie);
    if (cookies.auralist_token) {
      token = cookies.auralist_token;
      isCookieAuth = true;
    }
  }

  if (!token) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  // 3. CSRF protection for cookie-authenticated state-changing requests
  if (isCookieAuth && ['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method.toUpperCase())) {
    const customHeader = req.headers['x-requested-with'] || req.headers['x-csrf-token'];
    if (!customHeader) {
      return res.status(403).json({ error: 'CSRF validation failed: missing custom request header.' });
    }
  }

  try {
    // 4. Verify token using strictly configured JWT_SECRET without fallback
    const secret = getJwtSecret();
    const decoded = jwt.verify(token, secret);

    // 5. Attach user payload to request
    req.user = decoded; // { id, email, name }
    next();
  } catch (ex) {
    // 6. Clean error response for invalid or expired tokens
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

function optionalAuthMiddleware(req, res, next) {
  let token = null;
  const authHeader = req.headers.authorization;
  if (authHeader && typeof authHeader === 'string') {
    const parts = authHeader.trim().split(/\s+/);
    if (parts.length === 2 && parts[0] === 'Bearer' && parts[1]) {
      token = parts[1];
    }
  }

  if (!token && req.headers.cookie) {
    const cookies = parseCookies(req.headers.cookie);
    if (cookies.auralist_token) {
      token = cookies.auralist_token;
    }
  }

  if (!token) {
    req.user = null;
    return next();
  }

  try {
    const secret = getJwtSecret();
    const decoded = jwt.verify(token, secret);
    req.user = decoded;
    next();
  } catch (ex) {
    req.user = null;
    next();
  }
}

authMiddleware.optional = optionalAuthMiddleware;
module.exports = authMiddleware;

