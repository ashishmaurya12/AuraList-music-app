/**
 * backend/services/searchRelevance.js
 *
 * Deterministic Relevance Ranking & Typo-Tolerant Search Pipeline for AuraList.
 * Pure algorithmic implementation without LLM, cloud AI API, or embedding dependencies.
 */

const { parseSearchIntent } = require('./searchIntent');

// 1. Text Normalization (Unicode-aware: supports Latin, Devanagari/Hindi, etc.)
function normalizeText(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // remove Latin combining diacritics
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ') // Unicode-aware: preserves letters, matras/combining marks, digits
    .replace(/\s+/g, ' ') // collapse multiple spaces
    .trim();
}

// 2. Tokenizer
function tokenize(str) {
  const norm = normalizeText(str);
  return norm ? norm.split(' ').filter(Boolean) : [];
}

// 3. Base Clean Title (strips version / movie / feature tags)
function getBaseTitle(title) {
  if (!title) return '';
  return title
    .replace(/\s*[-–—]\s*(new version|remix|acoustic|reprise|original|live|audio|video|slowed|lofi).*/i, '')
    .replace(/\s*\((from|feat\.?|ft\.?|with|album|movie|soundtrack).*\)/i, '')
    .replace(/\s*\[.*\]/i, '')
    .trim();
}

// 4. Damerau-Levenshtein distance (insertions, deletions, substitutions, adjacent transpositions)
function damerauLevenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const la = a.length;
  const lb = b.length;

  if (Math.abs(la - lb) > 3) return Math.max(la, lb);

  const d = [];
  for (let i = 0; i <= la; i++) {
    d[i] = [i];
  }
  for (let j = 0; j <= lb; j++) {
    d[0][j] = j;
  }

  for (let i = 1; i <= la; i++) {
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1,       // deletion
        d[i][j - 1] + 1,       // insertion
        d[i - 1][j - 1] + cost // substitution
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1); // transposition
      }
    }
  }

  return d[la][lb];
}

// 5. Token Similarity Score [0.0 - 1.0]
function tokenSimilarity(a, b) {
  if (a === b) return 1.0;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1.0;
  if (maxLen <= 2) return a === b ? 1.0 : 0.0;

  const dist = damerauLevenshtein(a, b);
  const maxAllowedDist = maxLen <= 4 ? 1 : (maxLen <= 7 ? 2 : 2);
  if (dist > maxAllowedDist) return 0.0;

  const similarity = 1 - (dist / maxLen);
  return similarity >= 0.65 ? similarity : 0.0;
}

// Helper: evaluate match between query tokens and target token list (exact + fuzzy)
function evaluateTokenMatching(qTokens, targetTokens) {
  if (!qTokens.length || !targetTokens.length) {
    return { allMatched: false, exactCount: 0, fuzzyCount: 0, totalMatched: 0, avgSim: 0 };
  }

  let exactCount = 0;
  let fuzzyCount = 0;
  let totalSim = 0;

  for (const qTok of qTokens) {
    if (targetTokens.includes(qTok)) {
      exactCount++;
      totalSim += 1.0;
      continue;
    }
    let bestSim = 0;
    for (const tTok of targetTokens) {
      const sim = tokenSimilarity(qTok, tTok);
      if (sim > bestSim) bestSim = sim;
    }
    if (bestSim >= 0.65) {
      fuzzyCount++;
      totalSim += bestSim;
    }
  }

  const totalMatched = exactCount + fuzzyCount;
  const avgSim = totalMatched > 0 ? totalSim / totalMatched : 0;
  const allMatched = totalMatched === qTokens.length && avgSim >= 0.75;

  return {
    allMatched,
    exactCount,
    fuzzyCount,
    totalMatched,
    avgSim
  };
}

// 6. Evaluate Track Relevance against Query
function evaluateTrackRelevance(track, query, isArtistSearch = false) {
  if (!track || !query) return { score: 0, matchType: null, tier: 'none' };

  const qNorm = normalizeText(query);
  if (!qNorm) return { score: 0, matchType: null, tier: 'none' };

  const qTokens = tokenize(query);

  const tTitle = normalizeText(track.title);
  const tBaseTitle = normalizeText(getBaseTitle(track.title));
  const tArtist = normalizeText(track.artist);
  const tAlbum = normalizeText(track.album);

  const titleTokens = tokenize(track.title);
  const baseTitleTokens = tokenize(getBaseTitle(track.title));
  const combinedTitleTokens = Array.from(new Set([...titleTokens, ...baseTitleTokens]));
  const artistTokens = tokenize(track.artist);
  const albumTokens = tokenize(track.album);

  // If explicit artist search: artist matching is authoritative
  if (isArtistSearch) {
    if (tArtist === qNorm) {
      return { score: 1000, matchType: 'exact', tier: 'exact_artist' };
    }
    if (tArtist.split(/[,&/|]/).some(a => normalizeText(a) === qNorm)) {
      return { score: 950, matchType: 'exact', tier: 'primary_artist_exact' };
    }
    if (artistTokens.includes(qNorm)) {
      return { score: 850, matchType: 'exact', tier: 'artist_word_match' };
    }
    if (tArtist.startsWith(qNorm)) {
      return { score: 800, matchType: 'exact', tier: 'prefix_artist' };
    }
    if (tArtist.includes(qNorm)) {
      return { score: 700, matchType: 'exact', tier: 'phrase_artist' };
    }
    if (qTokens.every(tok => artistTokens.includes(tok))) {
      return { score: 600, matchType: 'related', tier: 'tokens_artist' };
    }
    // Fuzzy artist match
    const artistMatch = evaluateTokenMatching(qTokens, artistTokens);
    if (artistMatch.allMatched) {
      return { score: 500 * artistMatch.avgSim, matchType: 'fuzzy', tier: 'fuzzy_artist' };
    }
    return { score: 0, matchType: null, tier: 'none' };
  }

  // --- GENERAL SEARCH ---

  // 1. Authoritative check: If track is an EXACT song-title or artist match for the query,
  // it MUST always be preserved and prioritized, even if the query word resembles a mood or genre keyword!
  if (tTitle === qNorm || tBaseTitle === qNorm) {
    return { score: 1000, matchType: 'exact', tier: 'exact_title' };
  }
  if (tArtist === qNorm) {
    return { score: 950, matchType: 'exact', tier: 'exact_artist' };
  }
  if (tArtist.split(/[,&/|]/).some(a => normalizeText(a) === qNorm)) {
    return { score: 900, matchType: 'exact', tier: 'primary_artist_exact' };
  }

  const intent = parseSearchIntent(query);
  const trackMoods = Array.isArray(track.moods) ? track.moods.map(m => normalizeText(m)) : (track.mood ? [normalizeText(track.mood)] : []);
  const trackGenres = Array.isArray(track.genres) ? track.genres.map(g => normalizeText(g)) : (track.genre ? [normalizeText(track.genre)] : []);
  const trackEra = track.era ? normalizeText(track.era) : null;
  const trackLanguage = track.language ? normalizeText(track.language) : null;
  const trackTags = Array.isArray(track.tags) ? track.tags.map(t => normalizeText(t)) : [];

  // A. Pure Intent Queries (e.g. "romantic songs", "sad songs", "party songs", "old hindi songs", "90s bollywood songs")
  if (intent.isPureIntent) {
    // 1. Mood match
    if (intent.detectedMoods.length > 0) {
      const hasMood = intent.detectedMoods.some(m => trackMoods.includes(m) || trackTags.includes(m));
      if (hasMood) {
        let score = 750;
        if (intent.detectedLanguages.length > 0 && trackLanguage && intent.detectedLanguages.includes(trackLanguage)) score += 40;
        if (intent.detectedEras.length > 0 && trackEra && intent.detectedEras.includes(trackEra)) score += 40;
        if (intent.detectedGenres.length > 0 && trackGenres.some(g => intent.detectedGenres.includes(g))) score += 30;
        return { score, matchType: 'exact', tier: 'intent_mood' };
      }
    }

    // 2. Genre match
    if (intent.detectedGenres.length > 0) {
      const hasGenre = intent.detectedGenres.some(g => trackGenres.includes(g) || trackTags.includes(g));
      if (hasGenre) {
        let score = 720;
        if (intent.detectedLanguages.length > 0 && trackLanguage && intent.detectedLanguages.includes(trackLanguage)) score += 40;
        if (intent.detectedEras.length > 0 && trackEra && intent.detectedEras.includes(trackEra)) score += 40;
        return { score, matchType: 'exact', tier: 'intent_genre' };
      }
    }

    // 3. Era match (e.g. "old hindi songs", "purane gaane", "90s songs")
    if (intent.detectedEras.length > 0) {
      const hasEra = intent.detectedEras.some(e => trackEra === e || trackTags.includes(e));
      if (hasEra) {
        let score = 700;
        if (intent.detectedLanguages.length > 0 && trackLanguage && intent.detectedLanguages.includes(trackLanguage)) score += 50;
        return { score, matchType: 'exact', tier: 'intent_era' };
      }
    }

    // In a pure intent query, tracks without matching intent metadata do not qualify
    return { score: 0, matchType: null, tier: 'none' };
  }

  // B. Specific Direct Matching (against qNorm and cleanedQuery)
  const cNorm = (intent.cleanedQuery && intent.cleanedQuery !== qNorm) ? intent.cleanedQuery : '';
  let directResult = null;

  // Helper to evaluate direct lexical match
  function evaluateLexicalMatch(targetQuery, isCleaned = false) {
    const curTokens = tokenize(targetQuery);
    if (!curTokens.length) return null;

    // Tier 1: Exact Song-Title Match
    if (tTitle === targetQuery) {
      return { score: isCleaned ? 980 : 1000, matchType: 'exact', tier: 'exact_title' };
    }
    if (tBaseTitle && tBaseTitle === targetQuery) {
      return { score: isCleaned ? 940 : 950, matchType: 'exact', tier: 'exact_base_title' };
    }

    // Tier 2: Exact Artist-Name Match
    if (tArtist === targetQuery) {
      return { score: isCleaned ? 890 : 900, matchType: 'exact', tier: 'exact_artist' };
    }
    if (tArtist.split(/[,&/|]/).some(a => normalizeText(a) === targetQuery)) {
      return { score: isCleaned ? 870 : 880, matchType: 'exact', tier: 'primary_artist_exact' };
    }

    // Tier 3: Partial Song-Title Match
    if (tTitle.startsWith(targetQuery + ' ') || tBaseTitle.startsWith(targetQuery + ' ')) {
      const brevityBonus = Math.max(0, 20 - (tTitle.length - targetQuery.length));
      return { score: 830 + brevityBonus, matchType: 'exact', tier: 'title_prefix' };
    }
    if (tTitle.startsWith(targetQuery)) {
      const brevityBonus = Math.max(0, 15 - (tTitle.length - targetQuery.length));
      return { score: 800 + brevityBonus, matchType: 'exact', tier: 'title_prefix_partial' };
    }

    const escaped = targetQuery.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    const phraseRegex = new RegExp(`(^|\\s)${escaped}(\\s|$)`);
    if (phraseRegex.test(tTitle) || phraseRegex.test(tBaseTitle)) {
      const brevityBonus = Math.max(0, 20 - (tTitle.length - targetQuery.length));
      return { score: 720 + brevityBonus, matchType: 'exact', tier: 'title_phrase_boundary' };
    }
    if (tTitle.includes(targetQuery) || tBaseTitle.includes(targetQuery)) {
      const brevityBonus = Math.max(0, 20 - (tTitle.length - targetQuery.length));
      return { score: 650 + brevityBonus, matchType: 'exact', tier: 'title_phrase_substring' };
    }

    if (curTokens.length > 1 && curTokens.every(tok => combinedTitleTokens.includes(tok))) {
      const brevityBonus = Math.max(0, 20 - (combinedTitleTokens.length - curTokens.length) * 2);
      return { score: 580 + brevityBonus, matchType: 'related', tier: 'all_query_tokens_in_title' };
    }

    const titleTokenMatch = evaluateTokenMatching(curTokens, combinedTitleTokens);
    if (titleTokenMatch.allMatched && titleTokenMatch.fuzzyCount > 0) {
      const score = Math.round(540 * titleTokenMatch.avgSim);
      return { score, matchType: 'fuzzy', tier: 'fuzzy_title_all_tokens' };
    }

    if (curTokens.length === 1 && combinedTitleTokens.includes(curTokens[0])) {
      const brevityBonus = Math.max(0, 20 - combinedTitleTokens.length);
      return { score: 500 + brevityBonus, matchType: 'related', tier: 'single_token_in_title' };
    }

    // Tier 4: Partial Artist-Name Match
    if (artistTokens.includes(targetQuery)) {
      return { score: 470, matchType: 'related', tier: 'artist_word_match' };
    }
    if (tArtist.startsWith(targetQuery)) {
      return { score: 450, matchType: 'related', tier: 'prefix_artist' };
    }
    if (targetQuery.length >= 3 && tArtist.includes(targetQuery)) {
      return { score: 430, matchType: 'related', tier: 'phrase_artist' };
    }
    if (curTokens.length > 1 && curTokens.every(tok => artistTokens.includes(tok))) {
      return { score: 410, matchType: 'related', tier: 'all_tokens_artist' };
    }
    const artistTokenMatch = evaluateTokenMatching(curTokens, artistTokens);
    if (artistTokenMatch.allMatched) {
      const score = Math.round(390 * artistTokenMatch.avgSim);
      return { score, matchType: 'fuzzy', tier: 'fuzzy_artist' };
    }

    // Tier 5: Album and Other Relevant Matches
    if (tAlbum === targetQuery) {
      return { score: 300, matchType: 'related', tier: 'exact_album' };
    }
    if (tAlbum && tAlbum.includes(targetQuery)) {
      return { score: 260, matchType: 'related', tier: 'album_match' };
    }

    const exactMatchedCount = curTokens.filter(tok => combinedTitleTokens.includes(tok)).length;
    if (curTokens.length > 1 && exactMatchedCount >= Math.ceil(curTokens.length * 0.5) && exactMatchedCount > 0) {
      const ratio = exactMatchedCount / curTokens.length;
      return { score: 220 + Math.round(ratio * 50), matchType: 'related', tier: 'partial_tokens_in_title' };
    }

    const albumTokenMatch = evaluateTokenMatching(curTokens, albumTokens);
    if (albumTokenMatch.allMatched) {
      const score = Math.round(200 * albumTokenMatch.avgSim);
      return { score, matchType: 'fuzzy', tier: 'fuzzy_album' };
    }

    return null;
  }

  // 1. Evaluate against full query
  directResult = evaluateLexicalMatch(qNorm, false);

  // 2. If cleaned query is available and direct match is weaker, evaluate against cleaned query
  if (cNorm) {
    const cleanedResult = evaluateLexicalMatch(cNorm, true);
    if (cleanedResult && (!directResult || cleanedResult.score > directResult.score)) {
      directResult = cleanedResult;
    }
  }

  if (!directResult) {
    return { score: 0, matchType: null, tier: 'none' };
  }

  // C. Mixed Intent Bonus: if query had intent signals, grant bonus to tracks matching intent
  if (intent.hasIntent) {
    let intentBonus = 0;
    if (intent.detectedMoods.some(m => trackMoods.includes(m) || trackTags.includes(m))) {
      intentBonus += 80;
    }
    if (intent.detectedGenres.some(g => trackGenres.includes(g) || trackTags.includes(g))) {
      intentBonus += 40;
    }
    if (intent.detectedEras.some(e => trackEra === e || trackTags.includes(e))) {
      intentBonus += 40;
    }
    directResult.score += intentBonus;
  }

  return directResult;
}

// 7. Rank and Group Tracks
function rankAndGroupTracks(tracks, query, isArtistSearch = false) {
  if (!Array.isArray(tracks) || tracks.length === 0) {
    const empty = [];
    empty.exactMatches = [];
    empty.fuzzyMatches = [];
    empty.relatedMatches = [];
    return empty;
  }

  if (!query || !query.trim()) {
    const res = [...tracks];
    res.exactMatches = [];
    res.fuzzyMatches = [];
    res.relatedMatches = [...tracks];
    return res;
  }

  const scoredTracks = [];
  for (const track of tracks) {
    const { score, matchType, tier } = evaluateTrackRelevance(track, query, isArtistSearch);
    if (score > 0) {
      scoredTracks.push({
        ...track,
        matchScore: score,
        matchType: matchType || 'related',
        matchTier: tier
      });
    }
  }

  // Sort: higher score first; on tie, shorter title first; then id
  scoredTracks.sort((a, b) => {
    if (b.matchScore !== a.matchScore) {
      return b.matchScore - a.matchScore;
    }
    const lenA = (a.title || '').length;
    const lenB = (b.title || '').length;
    if (lenA !== lenB) return lenA - lenB;
    return String(a.id || '').localeCompare(String(b.id || ''));
  });

  const exactMatches = scoredTracks.filter(t => t.matchType === 'exact');
  const relatedMatches = scoredTracks.filter(t => t.matchType === 'related');
  const fuzzyMatches = scoredTracks.filter(t => t.matchType === 'fuzzy');

  // Ordered list: exact matches first, then related matches, then fuzzy matches
  const orderedList = [...exactMatches, ...relatedMatches, ...fuzzyMatches];
  orderedList.exactMatches = exactMatches;
  orderedList.fuzzyMatches = fuzzyMatches;
  orderedList.relatedMatches = relatedMatches;

  return orderedList;
}

module.exports = {
  normalizeText,
  tokenize,
  getBaseTitle,
  damerauLevenshtein,
  tokenSimilarity,
  evaluateTokenMatching,
  evaluateTrackRelevance,
  rankAndGroupTracks
};
