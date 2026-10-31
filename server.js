const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const compression = require('compression');

const { validateEnv } = require('./backend/config/env');
const connectDB = require('./backend/config/db');

// 1. Validate environment configuration before initializing server
validateEnv();

// Import routes
const authRoutes = require('./backend/routes/auth');
const musicRoutes = require('./backend/routes/music');
const playlistRoutes = require('./backend/routes/playlists');
const likeRoutes = require('./backend/routes/likes');
const historyRoutes = require('./backend/routes/history');

const app = express();
const PORT = process.env.PORT || 3000;

// 1b. Deployment-safe reverse proxy trust configuration:
// Only configure 'trust proxy' when explicitly supplied in the environment.
// Unset by default so direct local development uses standard socket/remoteAddress client IP behavior.
if (process.env.TRUST_PROXY !== undefined && process.env.TRUST_PROXY.trim() !== '') {
  const rawProxy = process.env.TRUST_PROXY.trim();
  let proxySetting;
  if (/^\d+$/.test(rawProxy)) {
    proxySetting = parseInt(rawProxy, 10);
  } else if (rawProxy.toLowerCase() === 'true') {
    proxySetting = true;
  } else if (rawProxy.toLowerCase() === 'false') {
    proxySetting = false;
  } else {
    proxySetting = rawProxy;
  }
  app.set('trust proxy', proxySetting);
}

// 2. Environment-based CORS configuration (origin validation supporting comma-separated origins and local fallback ports)
const explicitOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(o => o.trim()).filter(Boolean)
  : null;

function isAllowedOrigin(origin) {
  // Allow requests with no origin (e.g. mobile apps, same-origin, curl, local static frontend files)
  if (!origin) return true;

  // Check explicit exact match first
  if (explicitOrigins && explicitOrigins.includes(origin)) {
    return true;
  }

  // If origin is localhost / loopback, support base PORT and bounded fallback range (PORT to PORT + 10)
  try {
    const url = new URL(origin);
    const host = url.hostname;
    const port = Number(url.port) || (url.protocol === 'https:' ? 443 : 80);
    const isLocalhost = (host === 'localhost' || host === '127.0.0.1' || host === '::1');

    if (isLocalhost) {
      const basePort = Number(process.env.PORT) || 3000;
      const maxPort = basePort + 10;
      // Permitted if no explicit CORS_ORIGIN is set OR if configured origins explicitly include localhost
      const permitsLocalhost = !explicitOrigins || explicitOrigins.some(o => {
        try {
          const u = new URL(o);
          return (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '::1');
        } catch (e) {
          return false;
        }
      });

      if (permitsLocalhost && port >= basePort && port <= maxPort) {
        return true;
      }
    }
  } catch (e) {
    return false;
  }

  return false;
}

const corsOptions = {
  origin: (origin, callback) => {
    if (isAllowedOrigin(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true
};
app.use(cors(corsOptions));

// 2b. Security HTTP headers (no extra dependency required)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

  // Content-Security-Policy header
  const cspDirectives = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://fonts.googleapis.com",
    "font-src 'self' https://cdnjs.cloudflare.com https://fonts.gstatic.com",
    "img-src 'self' data: blob: https://images.unsplash.com https://*.saavncdn.com https://*.audius.co https://*.jamendo.com https://*.radioline.co https://*.radio-browser.info https://c.saavncdn.com",
    "media-src 'self' blob: data: https://*.saavncdn.com https://*.audius.co https://*.jamendo.com https://*.radio-browser.info http://*.radio-browser.info https: http:",
    "connect-src 'self' https://*.audius.co https://*.jamendo.com https://*.radio-browser.info https://api.audius.co https://discoveryprovider.audius.co"
  ];
  res.setHeader('Content-Security-Policy', cspDirectives.join('; '));

  next();
});

// 2c. Response compression (gzip/deflate for JSON & static text, bypassing raw audio/binary streams)
app.use(compression({
  filter: (req, res) => {
    if (req.path.startsWith('/api/music/stream') || req.path.startsWith('/api/music/proxy-image')) {
      return false;
    }
    return compression.filter(req, res);
  }
}));

// 3. Request body parsing limits (1mb maximum JSON payload)
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Serve static frontend files with fine-grained cache headers
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    const isHtml = filePath.endsWith('.html');
    const isImageOrFont = /\.(jpe?g|png|webp|gif|svg|ico|woff2?|ttf|eot)$/i.test(filePath);

    if (isHtml) {
      // HTML documents must always revalidate to prevent stale shell apps after deployment
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    } else if (isImageOrFont) {
      // Binary images and fonts can safely be cached for 1 day
      res.setHeader('Cache-Control', 'public, max-age=86400');
    } else {
      // Non-versioned CSS and JS files: revalidate or short cache
      res.setHeader('Cache-Control', process.env.NODE_ENV === 'production'
        ? 'public, max-age=3600, must-revalidate'
        : 'no-cache');
    }
  }
}));

// Production health check endpoints for container orchestrators (Render, Railway, Kubernetes, Docker)
// Liveness probe: verifies process event-loop responsiveness
const livenessHandler = (req, res) => {
  const mongoose = require('mongoose');
  const isDbConnected = mongoose.connection.readyState === 1;
  res.status(200).json({
    status: 'ok',
    uptime: Math.round(process.uptime()),
    timestamp: Date.now(),
    database: isDbConnected ? 'connected' : 'disconnected'
  });
};

// Readiness probe: verifies DB connectivity before accepting user traffic
const readinessHandler = (req, res) => {
  const mongoose = require('mongoose');
  const isDbConnected = mongoose.connection.readyState === 1;
  const status = isDbConnected ? 'ready' : 'not_ready';
  res.status(isDbConnected ? 200 : 503).json({
    status,
    uptime: Math.round(process.uptime()),
    timestamp: Date.now(),
    database: isDbConnected ? 'connected' : 'disconnected'
  });
};

app.get('/health', livenessHandler);
app.get('/health/live', livenessHandler);
app.get('/api/health', livenessHandler);
app.get('/api/health/live', livenessHandler);
app.get('/health/ready', readinessHandler);
app.get('/api/health/ready', readinessHandler);

// Mount API Routes
app.use('/api/auth', authRoutes);
app.use('/api/music', musicRoutes);
app.use('/api/playlists', playlistRoutes);
app.use('/api/likes', likeRoutes);
app.use('/api/history', historyRoutes);

// Method-independent API 404 middleware: returns consistent JSON 404 for any unhandled /api route across all HTTP methods
app.all(/^\/api(\/.*)?$/i, (req, res) => {
  res.status(404).json({ error: 'API endpoint not found.' });
});

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'API endpoint not found.' });
});

// Helper to send HTML pages with strict revalidation to avoid stale app shells
const sendHtmlNoCache = (res, filename) => {
  res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  res.sendFile(path.join(__dirname, 'public', filename));
};

// SPA Fallback routes for navigation
app.get('/login', (req, res) => {
  sendHtmlNoCache(res, 'index.html');
});

app.get('/register', (req, res) => {
  sendHtmlNoCache(res, 'register.html');
});

app.get('/app', (req, res) => {
  sendHtmlNoCache(res, 'app.html');
});

// Fallback to index.html for root or unknown static GET requests (strictly non-API paths only)
app.get('*', (req, res) => {
  const p = (req.path || '').toLowerCase();
  const rawUrl = (req.originalUrl || '').toLowerCase();
  if (p.startsWith('/api') || rawUrl.startsWith('/api')) {
    return res.status(404).json({ error: 'API endpoint not found.' });
  }
  sendHtmlNoCache(res, 'index.html');
});

// Method-independent 404 fallback for any unhandled non-GET requests
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found.' });
});

// Global Express Error Handler Middleware
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large' || err.status === 413 || err.statusCode === 413) {
    return res.status(413).json({ error: 'Request entity too large.' });
  }
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ error: 'CORS policy does not allow access from this origin.' });
  }
  if (err.name === 'CastError') {
    return res.status(400).json({ error: 'Invalid resource ID.' });
  }
  if (err.name === 'ValidationError') {
    return res.status(400).json({ error: err.message });
  }
  if (err.code === 11000) {
    return res.status(400).json({ error: 'Duplicate entry detected.' });
  }
  console.error('[Server Error]:', err);
  res.status(500).json({ error: 'An unexpected database or server error occurred.' });
});

// Active server reference and singleton shutdown registration
let activeServer = null;
let shutdownHandlersRegistered = false;
let isShuttingDown = false;

const gracefulShutdown = (signal) => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\n[Server] Received ${signal}. Initiating graceful shutdown...`);

  const serverToClose = activeServer;
  if (!serverToClose) {
    process.exit(0);
    return;
  }

  serverToClose.close(async () => {
    console.log('[Server] HTTP connections drained.');
    try {
      const mongoose = require('mongoose');
      if (mongoose.connection && mongoose.connection.readyState !== 0) {
        await mongoose.connection.close(false);
        console.log('[DB] MongoDB connection closed cleanly.');
      }
    } catch (dbErr) {
      console.error('[DB] Error during disconnection:', dbErr.message);
    }
    process.exit(0);
  });

  // Enforce shutdown timeout of 10s if active sockets stall
  setTimeout(() => {
    console.error('[Server] Graceful shutdown deadline exceeded (10s). Forcing termination.');
    process.exit(1);
  }, 10000).unref();
};

function registerShutdownHandlersOnce() {
  if (shutdownHandlersRegistered) return;
  shutdownHandlersRegistered = true;
  process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.once('SIGINT', () => gracefulShutdown('SIGINT'));
}

// Function to start server on PORT with bounded automatic fallback if port is in use
const MAX_PORT_ATTEMPTS = 10;
function startServer(portToUse, attempt = 1) {
  if (attempt > MAX_PORT_ATTEMPTS) {
    console.error(`[Server] Configuration error: Could not bind server after ${MAX_PORT_ATTEMPTS} port attempts starting at port ${PORT}.`);
    process.exit(1);
  }

  const server = app.listen(portToUse, () => {
    activeServer = server;
    registerShutdownHandlersOnce();
    console.log(`=================================================`);
    console.log(`  🎵 Auralist Server running at http://localhost:${portToUse}`);
    console.log(`=================================================`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[Server] Port ${portToUse} is in use. Trying port ${portToUse + 1} (attempt ${attempt + 1}/${MAX_PORT_ATTEMPTS})...`);
      startServer(portToUse + 1, attempt + 1);
    } else {
      console.error('[Server] Startup error:', err);
    }
  });
}

app.startServer = startServer;
app.getActiveServer = () => activeServer;
app.gracefulShutdown = gracefulShutdown;

module.exports = app;

// Connect to MongoDB and start server if executed directly
if (require.main === module) {
  connectDB().then(() => {
    startServer(Number(PORT));
  }).catch(err => {
    console.error('[Server] Database connection failure. Terminating server startup.', err);
    process.exit(1);
  });
}
