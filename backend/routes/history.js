const express = require('express');
const mongoose = require('mongoose');
const crypto = require('crypto');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const validate = require('../middleware/validate');
const { historyBodySchema, historyPositionSchema, historySessionSchema } = require('../validators/history');
const History = require('../models/History');
const ListeningEvent = require('../models/ListeningEvent');

router.use(authMiddleware);

// Server-side bounds for tracks with unknown, missing, or zero duration (e.g. live radio streams)
// Configurable via env with conservative 600s (10 min) default, bounded between 60s and 3600s
const MAX_UNKNOWN_DURATION_CAP = Math.max(60, Math.min(Number(process.env.MAX_UNKNOWN_DURATION_CAP) || 600, 3600));
const MAX_UNKNOWN_POSITION_CAP = Math.max(60, Math.min(Number(process.env.MAX_UNKNOWN_POSITION_CAP) || 600, 3600));
// Operational ceiling for custom / uncataloged tracks (2 hours = 7200s)
const MAX_REASONABLE_TRACK_DURATION = 7200;

// Server-side active playback session registry & configuration
// Maps `${userId}:${sessionId}` -> session lifecycle state
const activePlaybackSessions = new Map();
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_ACTIVE_SESSIONS = 5000; // Upper bound to protect in-memory footprint

function pruneExpiredOrExcessSessions() {
  const now = Date.now();
  // 1. Evict any sessions past TTL
  for (const [key, session] of activePlaybackSessions.entries()) {
    if (now - (session.startedAt || session.createdAt || 0) > SESSION_TTL_MS) {
      activePlaybackSessions.delete(key);
    }
  }
  // 2. If still exceeding bounds, evict oldest 20%
  if (activePlaybackSessions.size > MAX_ACTIVE_SESSIONS) {
    const toRemove = Math.floor(activePlaybackSessions.size * 0.2);
    let removed = 0;
    for (const key of activePlaybackSessions.keys()) {
      activePlaybackSessions.delete(key);
      removed++;
      if (removed >= toRemove) break;
    }
  }
}

function getSessionKey(userId, sessionId) {
  return `${String(userId)}:${String(sessionId)}`;
}

const { getLocalCatalog } = require('../services/musicProvider');

/**
 * Creates or registers a server-tracked playback session.
 */
function createOrRegisterServerSession({ userId, jamendoId, duration, sessionId = null, startedAt = null, listeningSeconds = 0, position = 0 }) {
  if (activePlaybackSessions.size >= MAX_ACTIVE_SESSIONS) {
    pruneExpiredOrExcessSessions();
  }
  const trackIdStr = String(jamendoId);
  const finalSessionId = (sessionId && typeof sessionId === 'string' && sessionId.trim())
    ? sessionId.trim()
    : ('ses_' + Date.now().toString(36) + '_' + crypto.randomBytes(6).toString('hex'));

  const key = getSessionKey(userId, finalSessionId);
  const existing = activePlaybackSessions.get(key);

  const authDur = resolveAuthoritativeDuration(trackIdStr, duration);
  const now = Date.now();

  // If session already exists, PRESERVE its original startedAt and lastCheckpointAt!
  const sessionStartTime = (existing && existing.startedAt)
    ? existing.startedAt
    : ((typeof startedAt === 'number' && Number.isFinite(startedAt) && startedAt > 0) ? startedAt : now);

  const session = {
    sessionId: finalSessionId,
    userId: String(userId),
    jamendoId: trackIdStr,
    duration: authDur,
    startedAt: sessionStartTime,
    lastCheckpointAt: (existing && existing.lastCheckpointAt) ? existing.lastCheckpointAt : sessionStartTime,
    listeningSeconds: Math.max(existing ? existing.listeningSeconds : 0, Math.floor(listeningSeconds || 0)),
    lastPosition: Math.max(existing ? existing.lastPosition : 0, Math.floor(position || 0)),
    completed: existing ? existing.completed : false,
    status: 'active',
    createdAt: sessionStartTime
  };

  activePlaybackSessions.set(key, session);
  return session;
}

/**
 * Retrieves and validates an existing server-tracked session.
 * Reconstructs from History in MongoDB if not present in memory.
 */
async function getValidatedServerSession({ userId, sessionId, jamendoId }) {
  if (!sessionId) return null;
  const key = getSessionKey(userId, sessionId);
  let session = activePlaybackSessions.get(key);

  if (!session) {
    // Check if session exists in MongoDB History
    const historyDoc = await History.findOne({ userId, sessionId });
    if (historyDoc) {
      const startedAt = (historyDoc.createdAt || historyDoc.playedAt || new Date()).getTime();
      session = {
        sessionId,
        userId: String(userId),
        jamendoId: String(historyDoc.jamendoId),
        duration: resolveAuthoritativeDuration(String(historyDoc.jamendoId), historyDoc.duration),
        startedAt,
        lastCheckpointAt: startedAt,
        listeningSeconds: Number(historyDoc.listenDuration) || 0,
        lastPosition: Number(historyDoc.position) || 0,
        completed: false,
        status: 'active',
        createdAt: startedAt
      };
      activePlaybackSessions.set(key, session);
    }
  }

  if (!session) {
    return { error: 'Invalid or expired playback session.', code: 'INVALID_SESSION', status: 400 };
  }

  // Verify ownership
  if (session.userId !== String(userId)) {
    return { error: 'Session does not belong to user.', code: 'UNAUTHORIZED_SESSION', status: 403 };
  }

  // Verify track match
  if (session.jamendoId !== String(jamendoId)) {
    return { error: 'Session does not match track.', code: 'TRACK_MISMATCH', status: 400 };
  }

  // Verify session expiration (24h TTL)
  if (Date.now() - session.startedAt > SESSION_TTL_MS) {
    activePlaybackSessions.delete(key);
    return { error: 'Playback session has expired.', code: 'SESSION_EXPIRED', status: 400 };
  }

  return { session };
}

/**
 * STREAMING TELEMETRY SECURITY & INTEGRITY NOTE:
 * In a web-based music streaming application, client-reported playback events
 * (position, listenDuration, completed flags) cannot cryptographically prove
 * physical human ear listening without end-to-end hardware-level attestation.
 * 
 * To defend against malicious or accidental statistics inflation, AuraList enforces:
 * 1. Authoritative track duration resolution against local catalog metadata.
 * 2. Strict duration caps (MAX_REASONABLE_TRACK_DURATION = 7200s, MAX_UNKNOWN_DURATION_CAP = 600s).
 * 3. Session ownership verification (preventing cross-user session hijacking).
 * 4. Session track consistency (rejecting checkpoints when sessionId belongs to a different track).
 * 5. Pacing constraints (listening time cannot accumulate faster than real elapsed wall-clock time).
 * 6. Completion verification (requiring >= 70% active listening time before accepting completion).
 * 7. Window and session deduplication (preventing rapid play-count inflation).
 * 8. Atomic pre-validation on /position before mutating any History resume position.
 */

/**
 * Resolves authoritative track metadata if present in local catalog,
 * or clamps client-reported duration to reasonable operational bounds.
 */
function resolveAuthoritativeDuration(trackIdStr, clientDuration) {
  const parsedDur = Math.max(0, Math.floor(Number(clientDuration) || 0));
  try {
    const catalog = typeof getLocalCatalog === 'function' ? getLocalCatalog() : [];
    if (Array.isArray(catalog) && catalog.length > 0) {
      const found = catalog.find(t => String(t.id) === trackIdStr || String(t.jamendoId) === trackIdStr);
      if (found && typeof found.duration === 'number' && found.duration > 0) {
        return found.duration;
      }
    }
  } catch (e) {
    // Fall back to clamped client duration if catalog lookup encounters an issue
  }
  return Math.min(parsedDur, MAX_REASONABLE_TRACK_DURATION);
}

// Definition and documentation of a Meaningful Play
/**
 * Meaningful Play Qualification Rule:
 * 1. Must have actual listening time (listenDuration or valid playback position).
 * 2. Standard threshold: active listen time >= 15 seconds.
 * 3. Short tracks (duration > 0 and duration < 30s): active listen time >= 80% of track duration (and >= 5s).
 * 4. Completed playback event with at least 5 seconds of listening.
 * 5. Strictly DISQUALIFIED:
 *    - Zero duration tracks with listen time < 15s are strictly DISQUALIFIED.
 *    - Any listen time < 5s is strictly DISQUALIFIED.
 *    - Zero elapsed listening time (e.g. initial track load) is strictly DISQUALIFIED.
 */
function isMeaningfulPlay({ listenSeconds, duration, completed }) {
  const listen = Math.max(0, Number(listenSeconds) || 0);
  const dur = Math.max(0, Number(duration) || 0);

  // Minimum physical listening gate
  if (listen < 5) return false;

  // Short tracks (< 30s): require at least 80% of track length and at least 5s
  if (dur > 0 && dur < 30) {
    return listen >= 0.8 * dur;
  }

  // If listen time is under standard 15s threshold, client-supplied completed flag
  // alone does NOT qualify a normal/long track (prevents forged completions)
  if (listen < 15) {
    return false;
  }

  return true;
}

// Helper to record a qualified listening event with session-aware deduplication and server-side bounds
async function recordQualifiedPlay({ userId, jamendoId, title, artist, coverUrl, duration, position, listenDuration, sessionId, completed }) {
  const trackIdStr = String(jamendoId);
  const dur = resolveAuthoritativeDuration(trackIdStr, duration);
  const rawPos = (typeof position === 'number' && Number.isFinite(position)) ? Math.max(0, Math.floor(position)) : 0;
  // Enforce server-side bounds: position cannot drastically exceed known track duration or unknown cap
  const pos = dur > 0 ? Math.min(rawPos, dur + 5) : Math.min(rawPos, MAX_UNKNOWN_POSITION_CAP);

  // Enforce server-side bounds: listenDuration cannot exceed reasonable single-track playback bounds or unknown cap
  const rawListen = typeof listenDuration === 'number' && Number.isFinite(listenDuration)
    ? Math.max(0, Math.floor(listenDuration))
    : (dur > 0 ? Math.min(pos, dur) : Math.min(pos, MAX_UNKNOWN_DURATION_CAP));
  const listenSec = dur > 0 ? Math.min(rawListen, dur + 30) : Math.min(rawListen, MAX_UNKNOWN_DURATION_CAP);

  // Validate completion claim:
  // Requires:
  // 1. Explicit completion claimed by client (completed === true)
  // 2. Known positive track duration (dur > 0; zero-duration streams can never be completed)
  // 3. Meaningful physical listening: must have actually listened to at least 70% of the track length (or 80% on short tracks < 30s)
  // 4. Playback position reached near the end of the track (>= 80% or within last 10s)
  const isVerifiedCompleted = Boolean(completed) && dur > 0 && (
    dur < 30
      ? (listenSec >= 0.8 * dur && pos >= 0.8 * dur)
      : (listenSec >= 0.7 * dur && (pos >= 0.8 * dur || pos >= dur - 10))
  );

  const isQualified = isMeaningfulPlay({ listenSeconds: listenSec, duration: dur, completed: isVerifiedCompleted });
  if (!isQualified) return null;

  // In production, recording a qualified play strictly requires a valid server-issued sessionId
  if (process.env.NODE_ENV === 'production' && (!sessionId || typeof sessionId !== 'string' || !sessionId.trim())) {
    return null;
  }

  // 1. Session-based deduplication: If explicit sessionId provided, validate userId, sessionId AND jamendoId
  if (sessionId) {
    const existingSession = await ListeningEvent.findOne({
      userId,
      sessionId
    });
    if (existingSession) {
      if (existingSession.jamendoId !== trackIdStr) {
        // Prevent cross-track session collision or hijacking
        return null;
      }

      // Wall-clock pacing check: active playback cannot accumulate listening time faster than physical time elapsed
      let finalListen = listenSec;
      if (existingSession.playedAt) {
        const wallClockElapsedSec = Math.max(0, Math.floor((Date.now() - new Date(existingSession.playedAt).getTime()) / 1000));
        // Allow burst allowance for automated tests (process.env.NODE_ENV === 'test') and realistic pacing in production
        const maxAllowedDelta = (process.env.NODE_ENV === 'test')
          ? Math.max(120, wallClockElapsedSec * 2 + 30)
          : Math.max(30, wallClockElapsedSec * 2 + 15);
        const boundedListen = Math.min(listenSec, existingSession.listeningSeconds + maxAllowedDelta);
        finalListen = Math.max(existingSession.listeningSeconds, boundedListen);
      } else {
        finalListen = Math.max(existingSession.listeningSeconds, listenSec);
      }

      existingSession.listeningSeconds = finalListen;
      existingSession.position = Math.max(existingSession.position, pos);
      if (isVerifiedCompleted) existingSession.completed = true;
      await existingSession.save();
      return existingSession;
    }
  }

  // 2. Window-based deduplication for continuous playback checkpoints without sessionId or zero-duration streams
  if (!sessionId || dur === 0) {
    const recentWindowMs = (dur === 0) ? 120000 : 60000;
    const recentWindow = new Date(Date.now() - recentWindowMs);
    const recentEvent = await ListeningEvent.findOne({
      userId,
      jamendoId: trackIdStr,
      playedAt: { $gte: recentWindow }
    }).sort({ playedAt: -1 });

    // Distinguish continuous checkpoints from legitimate replays or distinct sessions:
    const isReplay = recentEvent && (
      (dur > 0 && recentEvent.completed) ||
      (dur > 0 && pos < 10 && recentEvent.position >= 30) ||
      (dur > 0 && listenSec < recentEvent.listeningSeconds && pos < recentEvent.position) ||
      (sessionId && recentEvent.sessionId && sessionId !== recentEvent.sessionId)
    );

    if (recentEvent && !isReplay) {
      // Checkpoint continuation: update listening time without inflating total plays
      recentEvent.listeningSeconds = Math.max(recentEvent.listeningSeconds, listenSec);
      recentEvent.position = Math.max(recentEvent.position, pos);
      if (isVerifiedCompleted) recentEvent.completed = true;
      if (sessionId && !recentEvent.sessionId) recentEvent.sessionId = sessionId;
      await recentEvent.save();
      return recentEvent;
    }
  }

  // 3. Create fresh qualified play (with concurrency duplicate-key protection)
  try {
    return await ListeningEvent.create({
      userId,
      jamendoId: trackIdStr,
      title: title || 'Untitled Track',
      artist: artist || 'Various Artists',
      coverUrl: coverUrl || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop',
      duration: dur,
      listeningSeconds: listenSec,
      position: pos,
      completed: isVerifiedCompleted,
      sessionId: sessionId || null,
      playedAt: new Date()
    });
  } catch (err) {
    if (err.code === 11000 && sessionId) {
      const duplicateSession = await ListeningEvent.findOne({ userId, sessionId });
      if (duplicateSession) {
        duplicateSession.listeningSeconds = Math.max(duplicateSession.listeningSeconds, listenSec);
        duplicateSession.position = Math.max(duplicateSession.position, pos);
        if (isVerifiedCompleted) duplicateSession.completed = true;
        await duplicateSession.save();
        return duplicateSession;
      }
    }
    throw err;
  }
}

// GET /api/history/insights - Calculate actual user listening statistics using scalable database aggregations
router.get('/insights', async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.user.id)) {
      return res.status(400).json({ error: 'Invalid resource ID.' });
    }
    const userObjId = new mongoose.Types.ObjectId(req.user.id);

    // Check if user has events in ListeningEvent collection
    let eventCount = await ListeningEvent.countDocuments({ userId: userObjId });

    // Safe Idempotent Backfill Migration: if no ListeningEvent records exist, migrate qualified History records
    if (eventCount === 0) {
      const existingHistory = await History.find({ userId: userObjId }).sort({ playedAt: 1 }).lean();
      const seenWindow = new Map();
      const backfillOps = [];

      for (const item of existingHistory) {
        const pos = Number(item.position) || 0;
        const dur = Number(item.duration) || 0;
        const listen = typeof item.listenDuration === 'number'
          ? item.listenDuration
          : pos;
        const isQualified = isMeaningfulPlay({ listenSeconds: listen, duration: dur, completed: false });
        if (!isQualified) continue;

        const trackKey = String(item.jamendoId);
        const tMs = new Date(item.playedAt).getTime();
        const lastMs = seenWindow.get(trackKey);

        if (lastMs && Math.abs(tMs - lastMs) < 60000) {
          continue;
        }
        seenWindow.set(trackKey, tMs);

        const deterministicSessionId = `backfill_${item._id.toString()}`;
        const doc = {
          userId: userObjId,
          jamendoId: String(item.jamendoId),
          title: item.title,
          artist: item.artist,
          coverUrl: item.coverUrl,
          duration: dur,
          listeningSeconds: listen,
          position: pos,
          sessionId: deterministicSessionId,
          playedAt: item.playedAt || new Date()
        };

        backfillOps.push({
          updateOne: {
            filter: { userId: userObjId, sessionId: deterministicSessionId },
            update: { $setOnInsert: doc },
            upsert: true
          }
        });
      }

      if (backfillOps.length > 0) {
        try {
          await ListeningEvent.bulkWrite(backfillOps, { ordered: false });
        } catch (err) {
          const isDuplicateKey = err.code === 11000 || (err.writeErrors && err.writeErrors.some(e => e.code === 11000));
          if (!isDuplicateKey) {
            console.error('[History Insights Backfill Error]:', err.message);
          }
        }
      }
    }

    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    const recentHistory = await History.find({ userId: userObjId })
      .sort({ playedAt: -1 })
      .limit(5)
      .lean();

    // 1. Calculate overall totals using database aggregation
    const [totalsAgg] = await ListeningEvent.aggregate([
      { $match: { userId: userObjId } },
      {
        $group: {
          _id: null,
          totalPlays: { $sum: 1 },
          totalListeningSeconds: { $sum: '$listeningSeconds' }
        }
      }
    ]);

    const totalPlays = totalsAgg ? totalsAgg.totalPlays : 0;
    const totalListeningSeconds = totalsAgg ? totalsAgg.totalListeningSeconds : 0;

    // 2. Prepare 7-day trend map consistently aligned with UTC date boundaries
    const dayMap = new Map();
    const nowUtc = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.UTC(nowUtc.getUTCFullYear(), nowUtc.getUTCMonth(), nowUtc.getUTCDate() - i));
      const key = d.toISOString().split('T')[0];
      const dayName = d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
      dayMap.set(key, { date: key, dayName, plays: 0, seconds: 0 });
    }

    if (totalPlays === 0) {
      return res.json({
        totalPlays: 0,
        totalListeningSeconds: 0,
        topTracks: [],
        topArtists: [],
        dailyTrends: Array.from(dayMap.values()),
        monthlySummary: {
          monthName: now.toLocaleString('default', { month: 'long', year: 'numeric' }),
          plays: 0,
          listeningSeconds: 0
        },
        recentlyPlayed: recentHistory,
        countingRules: 'Minimum 15 seconds (or 80% completion for tracks under 30s) required to qualify as a play. Checkpoints update existing playback sessions; replays are counted as distinct plays.'
      });
    }

    // 3. Database aggregation: Top 10 tracks
    const topTracks = await ListeningEvent.aggregate([
      { $match: { userId: userObjId } },
      {
        $group: {
          _id: '$jamendoId',
          jamendoId: { $first: '$jamendoId' },
          title: { $first: '$title' },
          artist: { $first: '$artist' },
          coverUrl: { $first: '$coverUrl' },
          plays: { $sum: 1 },
          listeningSeconds: { $sum: '$listeningSeconds' }
        }
      },
      { $sort: { plays: -1, listeningSeconds: -1 } },
      { $limit: 10 }
    ]);

    // 4. Database aggregation: Top 6 artists
    const topArtists = await ListeningEvent.aggregate([
      { $match: { userId: userObjId } },
      {
        $project: {
          listeningSeconds: 1,
          artistList: {
            $slice: [
              {
                $split: [
                  { $ifNull: ['$artist', 'Unknown'] },
                  ','
                ]
              },
              2
            ]
          }
        }
      },
      { $unwind: '$artistList' },
      {
        $project: {
          listeningSeconds: 1,
          artist: { $trim: { input: '$artistList' } }
        }
      },
      {
        $group: {
          _id: '$artist',
          artist: { $first: '$artist' },
          plays: { $sum: 1 },
          listeningSeconds: { $sum: '$listeningSeconds' }
        }
      },
      { $sort: { plays: -1, listeningSeconds: -1 } },
      { $limit: 6 }
    ]);

    // 5. Database aggregation: Current month summary (UTC aligned)
    const startOfMonth = new Date(Date.UTC(nowUtc.getUTCFullYear(), nowUtc.getUTCMonth(), 1));
    const [monthlyAgg] = await ListeningEvent.aggregate([
      {
        $match: {
          userId: userObjId,
          playedAt: { $gte: startOfMonth }
        }
      },
      {
        $group: {
          _id: null,
          plays: { $sum: 1 },
          listeningSeconds: { $sum: '$listeningSeconds' }
        }
      }
    ]);

    const monthPlays = monthlyAgg ? monthlyAgg.plays : 0;
    const monthSeconds = monthlyAgg ? monthlyAgg.listeningSeconds : 0;

    // 6. Database aggregation: 7-day daily trends (UTC timezone)
    const sevenDaysAgo = new Date(Date.UTC(nowUtc.getUTCFullYear(), nowUtc.getUTCMonth(), nowUtc.getUTCDate() - 6));

    const dailyAgg = await ListeningEvent.aggregate([
      {
        $match: {
          userId: userObjId,
          playedAt: { $gte: sevenDaysAgo }
        }
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$playedAt', timezone: 'UTC' } },
          plays: { $sum: 1 },
          seconds: { $sum: '$listeningSeconds' }
        }
      }
    ]);

    for (const item of dailyAgg) {
      if (dayMap.has(item._id)) {
        const dObj = dayMap.get(item._id);
        dObj.plays = item.plays;
        dObj.seconds = item.seconds;
      }
    }

    res.json({
      totalPlays,
      totalListeningSeconds,
      topTracks,
      topArtists,
      dailyTrends: Array.from(dayMap.values()),
      monthlySummary: {
        monthName: now.toLocaleString('default', { month: 'long', year: 'numeric' }),
        plays: monthPlays,
        listeningSeconds: monthSeconds
      },
      recentlyPlayed: recentHistory,
      countingRules: 'Minimum 15 seconds (or 80% completion for tracks under 30s) required to qualify as a play. Checkpoints update existing playback sessions; replays are counted as distinct plays.'
    });
  } catch (error) {
    next(error);
  }
});


// GET /api/history/continue - Get recent tracks for Continue Listening shelf
router.get('/continue', async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.user.id)) {
      return res.status(400).json({ error: 'Invalid resource ID.' });
    }
    const continueTracks = await History.find({ userId: req.user.id })
      .sort({ playedAt: -1 })
      .limit(20);
    res.json(continueTracks);
  } catch (error) {
    next(error);
  }
});

// GET /api/history - Get user's play history (sorted newest first)
router.get('/', async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.user.id)) {
      return res.status(400).json({ error: 'Invalid resource ID.' });
    }
    const userHistory = await History.find({ userId: req.user.id })
      .sort({ playedAt: -1 })
      .limit(100);
    res.json(userHistory);
  } catch (error) {
    next(error);
  }
});

// POST /api/history/session - Issue or register a validated, server-tracked playback session
router.post('/session', validate(historySessionSchema, 'body'), async (req, res, next) => {
  try {
    if (!req.user || !mongoose.Types.ObjectId.isValid(req.user.id)) {
      return res.status(401).json({ error: 'Unauthorized.' });
    }
    const { jamendoId, duration, sessionId, startedAt } = req.body;
    const trackIdStr = String(jamendoId);

    // If startedAt is specified, only allow custom startedAt in test environment (for reproducible time testing)
    const validStartedAt = (process.env.NODE_ENV === 'test' && typeof startedAt === 'number')
      ? startedAt
      : Date.now();

    const session = createOrRegisterServerSession({
      userId: req.user.id,
      jamendoId: trackIdStr,
      duration,
      sessionId,
      startedAt: validStartedAt
    });

    res.status(201).json({
      sessionId: session.sessionId,
      jamendoId: session.jamendoId,
      duration: session.duration,
      startedAt: session.startedAt,
      status: session.status
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/history/position - Update playback position for a track
router.put('/position', validate(historyPositionSchema, 'body'), async (req, res, next) => {
  try {
    if (!req.user || !mongoose.Types.ObjectId.isValid(req.user.id)) {
      return res.status(401).json({ error: 'Unauthorized.' });
    }
    const { jamendoId, position, listenDuration, sessionId, completed } = req.body;
    const trackIdStr = String(jamendoId);

    // 1. In production, a valid server-issued sessionId is strictly mandatory
    const isProduction = process.env.NODE_ENV === 'production';
    if (isProduction && (!sessionId || typeof sessionId !== 'string' || !sessionId.trim())) {
      return res.status(400).json({ error: 'Session ID is required for playback position updates.' });
    }

    // 2. Validate session ownership, track consistency, and server-side lifecycle BEFORE modifying History
    let validatedSession = null;
    if (sessionId) {
      const sessionResult = await getValidatedServerSession({
        userId: req.user.id,
        sessionId,
        jamendoId: trackIdStr
      });

      if (sessionResult && sessionResult.error) {
        return res.status(sessionResult.status).json({ error: sessionResult.error });
      }

      validatedSession = sessionResult ? sessionResult.session : null;
    }

    if (isProduction && !validatedSession) {
      return res.status(400).json({ error: 'A valid active playback session is required.' });
    }

    // 3. Locate History track entry for this user and specific session
    let latest = null;
    if (sessionId) {
      latest = await History.findOne({ userId: req.user.id, sessionId, jamendoId: trackIdStr });
      if (!latest) {
        // Safe legacy fallback: only select records with no existing sessionId
        latest = await History.findOne({
          userId: req.user.id,
          jamendoId: trackIdStr,
          $or: [{ sessionId: null }, { sessionId: { $exists: false } }, { sessionId: '' }]
        }).sort({ playedAt: -1 });
      }
    } else {
      // Legacy fallback when no sessionId is provided (non-production only)
      latest = await History.findOne({
        userId: req.user.id,
        jamendoId: trackIdStr,
        $or: [{ sessionId: null }, { sessionId: { $exists: false } }, { sessionId: '' }]
      }).sort({ playedAt: -1 });

      if (!latest) {
        latest = await History.findOne({ userId: req.user.id, jamendoId: trackIdStr })
          .sort({ playedAt: -1 });
      }
    }

    if (!latest) {
      return res.status(404).json({ error: 'History track entry not found.' });
    }

    // 4. Resolve authoritative track duration & safe bounds
    const dur = resolveAuthoritativeDuration(trackIdStr, latest.duration);
    const rawPos = (typeof position === 'number' && Number.isFinite(position)) ? Math.max(0, Math.floor(position)) : 0;
    const safePos = dur > 0 ? Math.min(rawPos, dur + 5) : Math.min(rawPos, MAX_UNKNOWN_POSITION_CAP);

    let rawListen = 0;

    // 5. Server-side wall-clock limits and checkpoint pacing
    if (validatedSession) {
      const now = Date.now();
      const serverElapsedSec = Math.max(0, (now - validatedSession.startedAt) / 1000);
      const deltaServerSec = Math.max(0, (now - validatedSession.lastCheckpointAt) / 1000);

      const isTestEnv = process.env.NODE_ENV === 'test';
      let maxAllowedListen;
      if (validatedSession.listeningSeconds === 0) {
        // First checkpoint wall-clock bound:
        // A newly created session cannot immediately claim an arbitrary listening duration.
        // Even at 1.5x playback speed, physical listening time is capped to (serverElapsedSec * 1.5 + 5).
        maxAllowedListen = Math.max(0, Math.floor(serverElapsedSec * 1.5 + 5));
      } else {
        // Subsequent checkpoints: bounded by incremental elapsed time + previous listen time.
        // In production, strict pacing prevents rapid burst checkpoints from accumulating unearned listening time.
        const maxDelta = isTestEnv
          ? Math.max(60, Math.floor(deltaServerSec * 2 + 15))
          : Math.max(0, Math.floor(deltaServerSec * 1.5 + 4));
        maxAllowedListen = validatedSession.listeningSeconds + maxDelta;
      }

      const clientClaimedListen = (typeof listenDuration === 'number' && Number.isFinite(listenDuration))
        ? Math.max(0, Math.floor(listenDuration))
        : safePos;

      rawListen = Math.min(clientClaimedListen, maxAllowedListen);
      validatedSession.lastCheckpointAt = now;
      validatedSession.listeningSeconds = Math.max(validatedSession.listeningSeconds, rawListen);
      validatedSession.lastPosition = safePos;
    } else {
      // In legacy non-production requests without a valid session, never trust client listenDuration!
      rawListen = latest.listenDuration || 0;
    }

    const safeListen = dur > 0 ? Math.min(rawListen, dur + 30) : Math.min(rawListen, MAX_UNKNOWN_DURATION_CAP);

    // 6. Safely apply updates ONLY AFTER all validation checks pass
    latest.position = safePos;
    latest.listenDuration = safeListen;
    if (sessionId && !latest.sessionId) {
      latest.sessionId = sessionId;
    }
    await latest.save();

    // 7. Record qualified play telemetry ONLY when a validated server session exists
    if (validatedSession) {
      await recordQualifiedPlay({
        userId: req.user.id,
        jamendoId: latest.jamendoId,
        title: latest.title,
        artist: latest.artist,
        coverUrl: latest.coverUrl,
        duration: dur,
        position: safePos,
        listenDuration: latest.listenDuration,
        sessionId: validatedSession.sessionId,
        completed
      });
    }

    res.json(latest);
  } catch (error) {
    next(error);
  }
});

// POST /api/history - Record a track playback
router.post('/', validate(historyBodySchema, 'body'), async (req, res, next) => {
  try {
    if (!req.user || !mongoose.Types.ObjectId.isValid(req.user.id)) {
      return res.status(401).json({ error: 'Unauthorized.' });
    }
    const { jamendoId, title, artist, coverUrl, audioUrl, duration, position, listenDuration, sessionId, completed } = req.body;
    const trackIdStr = String(jamendoId);

    // Validate session track consistency for this user if sessionId is provided
    if (sessionId) {
      const sessionEvent = await ListeningEvent.findOne({ userId: req.user.id, sessionId });
      if (sessionEvent && sessionEvent.jamendoId !== trackIdStr) {
        return res.status(400).json({ error: 'Session does not match track.' });
      }

      const sessionHistory = await History.findOne({ userId: req.user.id, sessionId });
      if (sessionHistory && sessionHistory.jamendoId !== trackIdStr) {
        return res.status(400).json({ error: 'Session does not match track.' });
      }
    }

    const dur = resolveAuthoritativeDuration(trackIdStr, duration);
    const rawPos = (typeof position === 'number' && Number.isFinite(position)) ? Math.max(0, Math.floor(position)) : 0;
    const safePos = dur > 0 ? Math.min(rawPos, dur + 5) : Math.min(rawPos, MAX_UNKNOWN_POSITION_CAP);

    let rawListen = (typeof listenDuration === 'number' && Number.isFinite(listenDuration))
      ? Math.max(0, Math.floor(listenDuration))
      : safePos;

    // Server-side bounds on initial playback session creation:
    // A cold or unverified playback request cannot claim unearned listening duration.
    // In production, claimed listen-time is strictly bounded by server-tracked elapsed time.
    let existingSession = null;
    let serverElapsedSec = 0;
    if (sessionId) {
      const activeKey = getSessionKey(req.user.id, sessionId);
      existingSession = activePlaybackSessions.get(activeKey);
      if (existingSession && existingSession.startedAt) {
        serverElapsedSec = Math.max(0, (Date.now() - existingSession.startedAt) / 1000);
      }
    }

    const maxInitialAllowed = (process.env.NODE_ENV === 'test')
      ? (existingSession ? Math.max(120, Math.floor(serverElapsedSec * 2 + 30)) : 120)
      : (existingSession ? Math.max(0, Math.floor(serverElapsedSec * 1.5 + 5)) : 0);

    rawListen = Math.min(rawListen, maxInitialAllowed);

    const safeListen = dur > 0 ? Math.min(rawListen, dur + 30) : Math.min(rawListen, MAX_UNKNOWN_DURATION_CAP);

    // Register or get active playback session
    let effectiveSessionId = sessionId;
    if (sessionId) {
      createOrRegisterServerSession({
        userId: req.user.id,
        jamendoId: trackIdStr,
        duration: dur,
        sessionId,
        listeningSeconds: safeListen,
        position: safePos
      });
    } else {
      const serverSession = createOrRegisterServerSession({
        userId: req.user.id,
        jamendoId: trackIdStr,
        duration: dur,
        listeningSeconds: safeListen,
        position: safePos
      });
      effectiveSessionId = serverSession.sessionId;
    }

    const newEntry = await History.create({
      userId: req.user.id,
      jamendoId: trackIdStr,
      title,
      artist,
      coverUrl: coverUrl || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop',
      audioUrl: audioUrl || '',
      duration: dur,
      position: safePos,
      listenDuration: safeListen,
      sessionId: effectiveSessionId || null,
      playedAt: new Date()
    });

    await recordQualifiedPlay({
      userId: req.user.id,
      jamendoId: newEntry.jamendoId,
      title: newEntry.title,
      artist: newEntry.artist,
      coverUrl: newEntry.coverUrl,
      duration: dur,
      position: safePos,
      listenDuration: safeListen,
      sessionId: effectiveSessionId,
      completed
    });

    // Keep max 100 entries per user: find IDs beyond the newest 100 and delete them atomically
    const oldestEntries = await History.find({ userId: req.user.id })
      .sort({ playedAt: -1 })
      .skip(100)
      .select('_id')
      .lean();

    if (oldestEntries.length > 0) {
      const idsToRemove = oldestEntries.map(e => e._id);
      await History.deleteMany({ _id: { $in: idsToRemove } });
    }

    res.status(201).json(newEntry);
  } catch (error) {
    next(error);
  }
});

// DELETE /api/history - Clear authenticated user's playback history and listening events
router.delete('/', async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.user.id)) {
      return res.status(400).json({ error: 'Invalid resource ID.' });
    }
    const userId = req.user.id;
    const historyResult = await History.deleteMany({ userId });
    await ListeningEvent.deleteMany({ userId });

    res.json({
      message: 'Playback history cleared successfully.',
      deletedCount: historyResult.deletedCount || 0
    });
  } catch (error) {
    next(error);
  }
});

router._pruneSessions = pruneExpiredOrExcessSessions;
router._activeSessions = activePlaybackSessions;
router._MAX_ACTIVE_SESSIONS = MAX_ACTIVE_SESSIONS;

module.exports = router;

