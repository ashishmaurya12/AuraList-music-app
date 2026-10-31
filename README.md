# 🎵 AuraList — Music Streaming Platform

A responsive music streaming web application built with a Node.js/Express backend, MongoDB database, and a vanilla JavaScript single-page application (SPA) frontend. AuraList features a catalog of 3,000+ songs, multi-provider music streaming, an algorithmic relevance search engine, studio DSP audio enhancement, and privacy-focused user telemetry.

---

## 🌟 Key Features

### 🎧 Audio Playback & Equalizer
- 3-Band Equalizer: Bass, Mid and Treble controls.
- Audio Enhancement: Built-in dynamics compressor and loudness limiter.
- HD Streaming: Supports up to 320 kbps streaming with fallback.
- Audio Presets: Studio HD, Deep Bass, Vocal Clarity, Dynamic Club and Flat.
- Playback Continuity: Remembers playback progress, volume and queue across browser sessions.

### 🔍 Search & Discovery

- **Intent-Based Search:** Search songs by mood (Romantic, Sad, Party, Workout, Relaxing, Devotional) and era (90s Bollywood, Retro).
- **Typo-Tolerant Search:** Finds relevant songs even when search queries contain spelling mistakes.
- **Bilingual Search:** Supports Romanized Hindi and Devanagari text.
- **Multi-Provider Music Streaming:**
  - **Local Catalog:** 3,000+ pre-indexed Hindi and Bollywood tracks.
  - **JioSaavn:** Music search, artist discovery and stream URL handling.
  - **Audius:** Decentralized music streaming with provider failover.
  - **Jamendo:** Independent music discovery and streaming.
  - **Radio Browser:** Live radio station discovery and streaming.

### 👤 User Library & Personalization

- **User Authentication:** Secure login and registration using JWT authentication and bcrypt password hashing.
- **Playlist Management:** Create, rename, delete and organize personal playlists.
- **Favorites & Likes:** Like and manage favorite songs from search results, catalog and listening history.
- **Listening History:** Automatically tracks listening activity with server-side playback session validation.
- **Listening Insights:** View listening statistics, most-played tracks, top artists and monthly listening time.
- **Synchronized Lyrics:** Displays timestamp-based lyrics synchronized with music playback.
- **Keyboard Shortcuts:** Control playback, seek tracks, mute audio, skip songs, open search and close overlays using keyboard shortcuts.

### ⚡ Performance & Reliability

- **Response Compression:** Uses Gzip and Deflate to reduce response sizes while keeping audio streams unaffected.
- **Caching & Optimization:** Uses in-memory caching and pre-indexing to improve song, album and artist loading speed.
- **Static Asset Caching:** Optimized caching for HTML pages and static files.
- **Health Monitoring:** Separate health endpoints to check server status and MongoDB connectivity.
- **Graceful Shutdown:** Safely closes server connections and database connections during shutdown.

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

## 🔒 Security

- **Credential Protection:** Sensitive information such as database credentials is redacted from error logs.
- **SSRF Protection:** Image and favicon proxies block requests to internal and restricted network addresses.
- **Input Validation:** Validates API inputs to help prevent invalid or unsafe requests.
- **HTTP Security Headers:** Uses security headers and Content Security Policy (CSP) to improve browser-side protection.
- **Rate Limiting:** Protects login and registration endpoints against excessive requests and brute-force attempts.
## 📄 License

This project is licensed under the [MIT License](LICENSE).

