# 🎵 AuraList — Music Streaming & Discovery Platform

A responsive music streaming web application built with a Node.js/Express backend, MongoDB database, and a vanilla JavaScript single-page application (SPA) frontend. AuraList features a catalog of 3,700+ songs, multi-provider music streaming, an algorithmic relevance search engine, studio DSP audio enhancement, and privacy-focused user telemetry.

---

## 🌟 Key Features

### 🎧 Audio Playback & Studio DSP Engine
- **Web Audio API Equalizer**: 3-band studio parametric EQ (Bass, Mid, Treble) with real-time gain control (-12 dB to +12 dB).
- **Dynamics Processing**: Built-in anti-clipping dynamics compressor and loudness limiter to prevent distortion and normalize volume.
- **HD Audio Streaming**: Automatic resolution and upgrade to 320 kbps HD streams with seamless fallback to standard bitrates.
- **Audio Presets**: Pre-tuned sound profiles (Studio HD, Deep Bass, Vocal Clarity, Dynamic Club, Flat/Bypass).
- **Cross-Origin DSP Safety**: Dynamic CORS detection that applies Web Audio DSP when permitted and falls back cleanly for restricted third-party audio streams.
- **Continue Listening**: Persistent playback state preserving track progress, volume, and playback queue across browser sessions.

### 🔍 Search & Discovery Engine
- **Intent-Based Music Search**: Algorithmic classification and query parsing for moods (*Romantic, Sad, Party, Workout, Relaxing, Devotional*) and eras (*90s Bollywood, Retro*).
- **Typo-Tolerant Ranking**: Deterministic relevance hierarchy powered by Damerau-Levenshtein edit distance and token similarity without heavy cloud AI dependencies.
- **Bilingual Normalization**: Full Unicode-aware text processing supporting Romanized Hindi and native Devanagari script queries.
- **Multi-Provider Architecture**:
  - **Local Catalog**: 3,731 pre-indexed Hindi and Bollywood tracks.
  - **JioSaavn**: Decryption and stream formatting for Indian and international catalog tracks.
  - **Audius**: Decentralized stream discovery with automatic mirror failover and host rotation.
  - **Jamendo**: CC-licensed independent tracks with permission and download checks.
  - **Radio Browser**: Global live radio station streaming with secure proxy support.

### 👤 User Library & Personalization
- **Authentication**: Dual-mode JSON Web Token (JWT) system supporting both `HttpOnly`, `SameSite=Lax` cookies and `Bearer` authorization headers with bcrypt password hashing (work factor 10).
- **Playlists Management**: Create, rename, delete, and manage custom playlists with complete horizontal authorization and atomic duplicate protection.
- **Favorites & Likes**: Single-click track liking across all views (search, catalog, recent history) backed by MongoDB compound indexes for fast sorted reads.
- **Listening History & Anti-Tampering Telemetry**: Server-issued playback sessions (`sessionId`) with server-side elapsed-time pacing and duration bounding to prevent forged qualified plays.
- **Listening Insights Dashboard**: Real-time listening statistics, top played tracks, top artists, and monthly listening minutes computed via MongoDB aggregation pipelines.
- **Synchronized Lyrics**: Built-in LRC parser supporting timestamp-synchronized scrolling lyrics with fallback to formatted typography.
- **Accessibility & Shortcuts**: Global keyboard controls (`Space` to toggle play, `ArrowLeft`/`ArrowRight` to seek, `/` to search, `M` to mute, `N`/`P` for track skipping, `?` for help modal, `Esc` to close overlays).

### ⚡ Performance & Production Readiness
- **Response Compression**: Gzip and Deflate compression for static assets and JSON responses, with dedicated bypass filters for binary audio streams.
- **Memory Memoization**: In-memory pre-indexing and memoized views for albums, artists, and mood collections with automatic cache invalidation on catalog reload.
- **Fine-Grained Static Caching**: Immediate revalidation (`no-cache, must-revalidate`) for HTML shells alongside long-lived caching for immutable static assets.
- **Health Probes**: Independent `/health/live` (liveness) and `/health/ready` (readiness with MongoDB status) probes for Docker, Kubernetes, Render, and Railway deployments.
- **Graceful Shutdown**: Intercepts `SIGTERM` and `SIGINT` to cleanly drain active HTTP connections and close database connections within a 10-second deadline.

---

## 🏗️ Architecture & Tech Stack

```
AuraList/
├── backend/
│   ├── config/          # Environment validation (env.js) & MongoDB connection pool (db.js)
│   ├── middleware/      # Auth verification (auth.js) & Zod schema validation (validate.js)
│   ├── models/          # Mongoose schemas (User, Playlist, Like, History, ListeningEvent)
│   ├── routes/          # REST endpoints (auth, music, playlists, likes, history)
│   ├── services/        # Provider adapters, search relevance, deduplication, URL helper
│   └── validators/      # Zod input schemas for query, param, and body validation
├── public/              # Vanilla JavaScript SPA frontend
│   ├── css/             # Midnight Echoes signature design system (style.css)
│   ├── js/              # Client modules: api.js, app.js, player.js, ui.js, auth.js
│   ├── images/          # Background assets and theme artwork
│   ├── app.html         # Main player application shell
│   ├── index.html       # Landing and login page
│   └── register.html    # User registration page
├── data/
│   └── catalog.json     # Cleaned local music catalog (3,731 songs)
├── scripts/             # Data migration, password audit, and catalog maintenance scripts
├── tests/               # 23 automated unit and integration test suites (440+ tests)
└── server.js            # Express application entry point & lifecycle manager
```

- **Backend**: Node.js, Express.js
- **Database**: MongoDB via Mongoose ODM
- **Frontend**: Vanilla JavaScript (ES6+), CSS3 Variables, HTML5 Audio & Web Audio API
- **Testing**: Jest, Supertest
- **Security & Validation**: Zod, bcryptjs, jsonwebtoken, crypto-js, express-rate-limit

---

## 🚀 Getting Started

### Prerequisites
- **Node.js**: v18.0.0 or higher (tested on Node.js v24)
- **MongoDB**: v6.0 or higher (local instance or MongoDB Atlas cluster)
- **npm**: v9.0.0 or higher

### Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/ashishmaurya12/AuraList-music-app.git
   cd AuraList-music-app
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure environment variables**:
   Copy the example environment configuration:
   ```bash
   cp .env.example .env
   ```
   Open `.env` and configure your settings:
   ```env
   # MongoDB connection string (Required)
   MONGODB_URI=mongodb://127.0.0.1:27017/auralist

   # JWT Secret Key (Required — minimum 32 characters)
   # Generate a strong key: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   JWT_SECRET=your_long_random_jwt_secret_key_minimum_32_characters_here

   # Server Port (Optional — defaults to 3000)
   PORT=3000

   # Environment mode ('development' or 'production')
   NODE_ENV=development

   # Allowed CORS Origins (Optional)
   CORS_ORIGIN=http://localhost:3000

   # Music Provider Keys (Optional)
   JAMENDO_CLIENT_ID=your_jamendo_client_id_here
   AUDIUS_API_KEY=your_audius_api_key_here
   ```

4. **Start the application**:
   - **Production mode**:
     ```bash
     npm start
     ```
   - **Development mode (with file watcher)**:
     ```bash
     npm run dev
     ```

5. **Open in browser**:
   Navigate to `http://localhost:3000`.

---

## 🧪 Testing

AuraList includes an automated test suite comprising 161 unit tests and 282 integration/regression tests (443 total).

```bash
# Run all unit tests (in-memory, no database required)
npm run test:unit

# Run full integration test suite (requires active test database)
npm run test:integration

# Run entire test suite (unit + integration)
npm test

# Generate test coverage report
npm run test:coverage
```

> [!NOTE]
> Integration tests connect to `MONGODB_TEST_URI` (defaults to `mongodb://127.0.0.1:27017/auralist_test`). They are strictly forbidden from running against production databases.

---

## 🔒 Security Architecture

- **Credential Redaction**: MongoDB connection strings and error logs are automatically scrubbed to redact embedded passwords and usernames.
- **SSRF Protection**: Image and favicon proxies strictly reject internal hostnames, loopback addresses (`127.0.0.1`, `localhost`), and cloud metadata endpoints (`169.254.169.254`).
- **Input Validation**: All HTTP route parameters, query strings, and request bodies are validated using strict Zod schemas with type-coercion guards.
- **HTTP Security Headers**: Express responses include `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `X-XSS-Protection: 1; mode=block`, and a restrictive `Content-Security-Policy`.
- **Rate Limiting**: Authentication endpoints (`/api/auth/login`, `/api/auth/register`) are protected by IP-based rate limiting to prevent brute-force attacks.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).

