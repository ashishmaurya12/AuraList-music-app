/**
 * Catalog Deduplication & Integrity Service
 * 
 * Provides robust, deterministic, and Unicode-safe deduplication rules for
 * AuraList catalog tracks. Ensures zero tracks are ever silently dropped.
 * 
 * Reconciliation Guarantee:
 *   inputCount === keptCount + alternateVersionsRemovedCount + duplicateUploadsRemovedCount + invalidEntriesRemovedCount
 */

// Definite alternate version rules
const ALTERNATE_RULES = [
  { name: 'lofi', regex: /\b(lo[\s\-_]*fi|chillhop|lofi\s+flip|lofi\s+mix|lofi\s+remix)\b/i },
  { name: 'slowed_reverb', regex: /\b(slowed(\s*[\+&]\s*reverb)?|reverb\s+pitch\s+down|slowed\s+and\s+reverb)\b/i },
  { name: 'sped_up', regex: /\b(speed[\s\-_]*up|sped[\s\-_]*up|speeded|nightcore|fast\s+version)\b/i },
  { name: 'reversed', regex: /\b(reversed?(\s+audio)?|reverse\s+version)\b/i },
  { name: 'instrumental', regex: /\b(instrumental(\s+version)?|backing\s+track)\b/i },
  { name: 'karaoke', regex: /\b(karaoke(\s+version)?|melody\s+karaoke)\b/i },
  { name: 'remix_mashup', regex: /\b(unofficial\s+remix|club\s+mix|extended\s+mix|dance\s+mix|mashup\b|mash\s+up|dj\s+[a-z0-9]+\s+remix|remix\s+by)\b/i },
  { name: 'effects', regex: /\b(8d\s+audio|bass\s+boosted|ringtone)\b/i }
];

// Exceptions: titles containing keywords that are legitimate original songs
const TITLE_ALLOWLIST = [
  /dj\s+waley\s+babu/i,
  /dj\s+bravo/i
];

function classifyTrack(track) {
  if (!track || typeof track !== 'object') {
    return { isInvalid: true, reason: 'Track entry is not a valid object' };
  }

  const rawId = track.id || track.jamendoId;
  if (!rawId) {
    return { isInvalid: true, reason: 'Track is missing an identifier (id / jamendoId)' };
  }

  const title = (track.title || '').trim();

  for (const allow of TITLE_ALLOWLIST) {
    if (allow.test(title)) return { isAlternate: false };
  }

  for (const rule of ALTERNATE_RULES) {
    if (rule.regex.test(title)) {
      return { isAlternate: true, type: rule.name, reason: `Matches ${rule.name} pattern: "${title}"` };
    }
  }

  if (/\b(remix)\b/i.test(title) && !/\bdj\s+waley\s+babu\b/i.test(title)) {
    return { isAlternate: true, type: 'remix', reason: `Matches remix pattern: "${title}"` };
  }

  return { isAlternate: false };
}

// Unicode-safe title normalization preserving all language letters (\p{L}) and numbers (\p{N})
function normalizeTitle(title, trackId = '') {
  if (!title || typeof title !== 'string') {
    return trackId ? `__untitled_${trackId}` : '__untitled_anonymous';
  }

  let t = title.toLowerCase();
  // Strip movie/film annotations: (From "Movie"), [From Movie], (From Movie)
  t = t.replace(/[\(\[]\s*from\s+.*?[\)\]]/gi, '');
  // Strip release qualifiers: "- New Version", "- Single", "- Original"
  t = t.replace(/[\-\–]\s*(new version|single|audio|original motion picture soundtrack|soundtrack)\s*/gi, '');
  // Strip feat / ft inside parentheses
  t = t.replace(/[\(\[]\s*(feat|ft)\.?\s+.*?[\)\]]/gi, '');
  // Normalize punctuation while preserving all Unicode letters and numbers
  t = t.replace(/[^\p{L}\p{N}]/gu, ' ');
  t = t.replace(/\s+/g, ' ').trim();

  // If title was only punctuation (e.g. "???"), fallback to raw trimmed lowercase title
  if (!t) {
    const rawTrimmed = title.trim().toLowerCase();
    if (rawTrimmed) return rawTrimmed;
    return trackId ? `__untitled_${trackId}` : '__untitled_anonymous';
  }

  return t;
}

function normalizeArtists(artist) {
  if (!artist || typeof artist !== 'string') return 'unknown_artist';
  const list = artist.toLowerCase()
    .split(/[,&]|\band\b|\bfeat\b|\bft\b/i)
    .map(s => s.replace(/[^\p{L}\p{N}]/gu, '').trim())
    .filter(Boolean);

  if (list.length === 0) return 'unknown_artist';
  return list.slice(0, 2).sort().join('_');
}

function scorePreference(track) {
  let score = 0;
  const title = track.title || '';
  const album = track.album || '';

  // Penalize generic compilation albums over original film / studio albums
  if (/best\s+of|top\s+hits|compilation|greatest\s+hits|world\s+music\s+day|hits\s+of|vol\s*\d+/i.test(album)) {
    score -= 10;
  }
  // Penalize title with cluttered film attribution if a cleaner title exists
  if (/[\(\[]\s*from\s+.*?[\)\]]/i.test(title)) {
    score -= 2;
  }
  // Reward title that matches album name (standard for singles or eponymous studio albums)
  if (album && title.toLowerCase().includes(album.toLowerCase())) {
    score += 5;
  }
  // Prefer entries with valid duration
  if (track.duration > 0) {
    score += 1;
  }
  return score;
}

function sanitizeTrackMetadata(track) {
  return {
    ...track,
    provider: 'JioSaavn',
    versionInfo: 'Standard',
    licensingStatus: 'Third-Party Stream (Unverified)',
    license: 'Third-Party Stream (Unverified)',
    source: 'JioSaavn Provider Stream'
  };
}

/**
 * Deduplicate an array of tracks deterministically with full mathematical reconciliation.
 */
function deduplicateCatalog(catalog) {
  if (!Array.isArray(catalog)) {
    throw new TypeError('Catalog input must be an array');
  }

  const initialCount = catalog.length;
  const alternateRemovals = [];
  const invalidRemovals = [];
  const cleanPool = [];
  const ambiguousEntries = [];

  catalog.forEach((track, index) => {
    const classification = classifyTrack(track);

    if (classification.isInvalid) {
      invalidRemovals.push({ track, reason: classification.reason, originalIndex: index });
    } else if (classification.isAlternate) {
      alternateRemovals.push({ track, type: classification.type, reason: classification.reason, originalIndex: index });
    } else {
      if (/\b(acoustic|unplugged|tribute)\b/i.test(track.title || '')) {
        ambiguousEntries.push({ track, reason: 'Acoustic / Tribute release (preserved as distinct)' });
      }
      cleanPool.push({ track, originalIndex: index });
    }
  });

  // Group for duplicate upload detection
  const groups = new Map();
  cleanPool.forEach(item => {
    const trackId = item.track.id || item.track.jamendoId || String(item.originalIndex);
    const normT = normalizeTitle(item.track.title, trackId);
    const normA = normalizeArtists(item.track.artist);
    const isAmbiguousRelease = /\b(acoustic|unplugged|tribute)\b/i.test(item.track.title || '');
    const versionTag = isAmbiguousRelease ? `ambiguous_${trackId}` : 'standard';
    const key = `${normT} ::: ${normA} ::: ${versionTag}`;

    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });

  const duplicateRemovals = [];
  const keptOriginals = [];
  const idRedirectMap = new Map(); // dupeId -> keptId

  for (const [key, items] of groups.entries()) {
    if (items.length === 1) {
      keptOriginals.push(items[0]);
    } else {
      // Check duration similarity (within 12 seconds)
      const durations = items.map(i => Number(i.track.duration) || 0);
      const minDur = Math.min(...durations);
      const maxDur = Math.max(...durations);

      if (maxDur - minDur <= 12) {
        // Confirmed duplicate upload of identical recording
        items.sort((a, b) => scorePreference(b.track) - scorePreference(a.track));
        const best = items[0];
        keptOriginals.push(best);

        const bestId = best.track.id || best.track.jamendoId;
        for (let i = 1; i < items.length; i++) {
          const dupe = items[i];
          duplicateRemovals.push({
            dupeTrack: dupe.track,
            keptTrack: best.track,
            key
          });
          const dupeId = dupe.track.id || dupe.track.jamendoId;
          if (dupeId && bestId) {
            idRedirectMap.set(dupeId, bestId);
          }
        }
      } else {
        // Different durations (e.g. reprise, part 2, extended studio cut): preserve both safely
        items.forEach(i => keptOriginals.push(i));
      }
    }
  }

  // Preserve original catalog order
  keptOriginals.sort((a, b) => a.originalIndex - b.originalIndex);
  const finalCatalog = keptOriginals.map(k => sanitizeTrackMetadata(k.track));
  const finalCount = finalCatalog.length;

  const totalExplicitlyRemoved = alternateRemovals.length + duplicateRemovals.length + invalidRemovals.length;
  const reconciles = (initialCount === finalCount + totalExplicitlyRemoved);

  return {
    inputCount: initialCount,
    finalCount,
    keptCount: finalCount,
    alternateVersionsRemovedCount: alternateRemovals.length,
    duplicateUploadsRemovedCount: duplicateRemovals.length,
    invalidEntriesRemovedCount: invalidRemovals.length,
    ambiguousEntriesReviewedCount: ambiguousEntries.length,
    totalRemoved: totalExplicitlyRemoved,
    reconciles,
    alternateRemovals,
    duplicateRemovals,
    invalidRemovals,
    ambiguousEntries,
    finalCatalog,
    idRedirectMap
  };
}

module.exports = {
  classifyTrack,
  normalizeTitle,
  normalizeArtists,
  scorePreference,
  sanitizeTrackMetadata,
  deduplicateCatalog
};
