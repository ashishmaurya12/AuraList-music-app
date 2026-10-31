/**
 * backend/services/searchIntent.js
 *
 * Query Intent Parser & Music Query Understanding for AuraList.
 * Distinguishes user intents (mood, genre, era, language, theme) from
 * specific entity queries (artist, title, album), and strips generic
 * music stopwords ("songs", "gaana", "tracks") safely.
 * Unicode-aware: supports English, Romanized Hindi, and Devanagari.
 */

// Unicode-aware text normalization (supports Latin, Devanagari/Hindi, etc.)
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

// Generic music noise words to strip when isolating specific titles/artists or intents
const MUSIC_STOPWORDS = new Set([
  'song', 'songs', 'gaana', 'gaane', 'gana', 'gane',
  'track', 'tracks', 'music', 'audio', 'hits', 'hit',
  'geet', 'sangeet', 'dhun', 'tarana',
  'गीत', 'गाने', 'गाना', 'संगीत', 'धुन'
]);

// Common Hindi/Urdu connective and adjectival words used in song queries
const HINDI_CONNECTIVES = new Set([
  'bhare', 'bhara', 'bhari', 'ke', 'ki', 'ka',
  'wale', 'wali', 'wala', 'se', 'me', 'mein', 'ko',
  'भरे', 'भरा', 'भरी', 'के', 'की', 'का', 'वाले', 'वाली'
]);

// Mood Intent Definitions
const MOOD_INTENTS = {
  romantic: {
    key: 'romantic',
    label: 'Romantic',
    keywords: [
      'romantic', 'romance', 'love', 'ishq', 'pyaar', 'pyar', 'mohabbat', 'dil',
      'valentine', 'humsafar', 'saathiya', 'deewana', 'aashiqui',
      'रोमांटिक', 'प्यार', 'इश्क', 'मोहब्बत', 'दिल'
    ]
  },
  sad: {
    key: 'sad',
    label: 'Sad',
    keywords: [
      'sad', 'dard', 'gam', 'gham', 'judaai', 'judai', 'tanha', 'alone',
      'broken', 'tears', 'alvida', 'tadap', 'bichhad', 'aansoo', 'dukhi',
      'दर्द', 'उदास', 'जुदाई', 'गम', 'तन्हा'
    ]
  },
  heartbreak: {
    key: 'heartbreak',
    label: 'Heartbreak',
    keywords: [
      'heartbreak', 'broken heart', 'bewafa', 'betrayal', 'dhokha',
      'बेवफा', 'धोखा'
    ]
  },
  party: {
    key: 'party',
    label: 'Party',
    keywords: [
      'party', 'club', 'bhangra', 'dhol', 'celebration', 'wedding', 'hungama',
      'dhamaka', 'dj', 'festive', 'masti',
      'पार्टी', 'धमाका', 'मस्ती'
    ]
  },
  dance: {
    key: 'dance',
    label: 'Dance',
    keywords: [
      'dance', 'nach', 'nacho', 'nachde', 'thumka', 'disco', 'groove',
      'नाच', 'डांस'
    ]
  },
  workout: {
    key: 'workout',
    label: 'Workout',
    keywords: [
      'workout', 'gym', 'fitness', 'pump', 'power', 'energy', 'energetic',
      'beast', 'cardio', 'running', 'exercise', 'motivation'
    ]
  },
  relaxing: {
    key: 'relaxing',
    label: 'Relaxing',
    keywords: [
      'relax', 'relaxing', 'chill', 'peace', 'peaceful', 'calm', 'soft',
      'soothing', 'acoustic', 'lofi', 'lo fi', 'lo-fi', 'meditation',
      'ambient', 'sleep', 'shanti', 'sukoon',
      'सुकून', 'शांत'
    ]
  },
  devotional: {
    key: 'devotional',
    label: 'Devotional',
    keywords: [
      'devotional', 'bhajan', 'aarti', 'arti', 'chalisa', 'spiritual',
      'bhakti', 'puja', 'pooja', 'stotra', 'mantra', 'shloka', 'kavach',
      'qawwali', 'sufi', 'naat', 'khwaja',
      'भजन', 'आरती', 'चालीसा', 'भक्ति', 'कव्वाली'
    ]
  },
  happy: {
    key: 'happy',
    label: 'Happy',
    keywords: [
      'happy', 'happiness', 'khushi', 'joy', 'upbeat', 'cheerful',
      'muskurahat', 'smile',
      'खुशी', 'मुस्कुराहट'
    ]
  }
};

// Genre Intent Definitions
const GENRE_INTENTS = {
  bollywood: {
    key: 'bollywood',
    label: 'Bollywood',
    keywords: ['bollywood', 'filmi', 'hindi cinema', 'बॉलीवुड']
  },
  punjabi: {
    key: 'punjabi',
    label: 'Punjabi',
    keywords: ['punjabi', 'पंजाबी']
  },
  qawwali: {
    key: 'qawwali',
    label: 'Qawwali',
    keywords: ['qawwali', 'sufi', 'कव्वाली']
  },
  ghazal: {
    key: 'ghazal',
    label: 'Ghazal',
    keywords: ['ghazal', 'gazal', 'गज़ल', 'गजल']
  },
  pop: {
    key: 'pop',
    label: 'Pop',
    keywords: ['pop']
  },
  rock: {
    key: 'rock',
    label: 'Rock',
    keywords: ['rock']
  },
  hiphop: {
    key: 'hiphop',
    label: 'Hip Hop',
    keywords: ['hiphop', 'hip hop', 'rap', 'desi hip hop', 'rapper']
  },
  lofi: {
    key: 'lofi',
    label: 'Lofi',
    keywords: ['lofi', 'lo fi', 'lo-fi', 'chillhop']
  },
  classical: {
    key: 'classical',
    label: 'Classical',
    keywords: ['classical', 'shastriya', 'राग', 'शास्त्रीय']
  }
};

// Era Intent Definitions
const ERA_INTENTS = {
  '90s': {
    key: '90s',
    label: '90s',
    keywords: ['90s', '90 s', '90th', 'nineties']
  },
  '80s': {
    key: '80s',
    label: '80s',
    keywords: ['80s', '80 s', 'eighties']
  },
  '70s': {
    key: '70s',
    label: '70s',
    keywords: ['70s', '70 s', 'seventies']
  },
  'retro': {
    key: 'retro',
    label: 'Old / Retro',
    keywords: ['retro', 'old', 'purane', 'purana', 'evergreen', 'classic', 'golden era', 'पुराने', 'पुराना']
  },
  'latest': {
    key: 'latest',
    label: 'Latest / New',
    keywords: ['latest', 'new', 'naya', 'naye', 'recent', 'नए', 'नया']
  }
};

// Language Intent Definitions
const LANGUAGE_INTENTS = {
  hindi: {
    key: 'hindi',
    label: 'Hindi',
    keywords: ['hindi', 'हिंदी', 'हिन्दी']
  },
  punjabi: {
    key: 'punjabi',
    label: 'Punjabi',
    keywords: ['punjabi', 'पंजाबी']
  },
  english: {
    key: 'english',
    label: 'English',
    keywords: ['english', 'hollywood', 'अंग्रेजी']
  },
  urdu: {
    key: 'urdu',
    label: 'Urdu',
    keywords: ['urdu', 'उर्दू']
  },
  tamil: {
    key: 'tamil',
    label: 'Tamil',
    keywords: ['tamil', 'तमिल']
  },
  telugu: {
    key: 'telugu',
    label: 'Telugu',
    keywords: ['telugu', 'तेलुगु']
  }
};

/**
 * Parse a raw user query to discover intents and clean entities.
 */
function parseSearchIntent(rawQuery) {
  if (!rawQuery || typeof rawQuery !== 'string') {
    return {
      rawQuery: '',
      normalized: '',
      cleanedQuery: '',
      detectedMoods: [],
      detectedGenres: [],
      detectedEras: [],
      detectedLanguages: [],
      hasIntent: false,
      isPureIntent: false
    };
  }

  const normalized = normalizeText(rawQuery);
  if (!normalized) {
    return {
      rawQuery,
      normalized: '',
      cleanedQuery: '',
      detectedMoods: [],
      detectedGenres: [],
      detectedEras: [],
      detectedLanguages: [],
      hasIntent: false,
      isPureIntent: false
    };
  }

  const tokens = normalized.split(' ').filter(Boolean);
  const detectedMoods = new Set();
  const detectedGenres = new Set();
  const detectedEras = new Set();
  const detectedLanguages = new Set();

  // Matched token positions to determine if anything besides intent + stopwords remains
  const intentMatchedTokens = new Set();

  function checkIntentGroup(intentMap, targetSet) {
    for (const [intentKey, def] of Object.entries(intentMap)) {
      for (const kw of def.keywords) {
        const kwNorm = normalizeText(kw);
        const kwTokens = kwNorm.split(' ').filter(Boolean);
        if (kwTokens.length === 1) {
          tokens.forEach((tok, idx) => {
            if (tok === kwNorm) {
              targetSet.add(def.key);
              intentMatchedTokens.add(idx);
            }
          });
        } else if (kwTokens.length > 1) {
          // Phrase match
          if (normalized.includes(kwNorm)) {
            targetSet.add(def.key);
            // Mark constituent token indices
            const startIdx = normalized.indexOf(kwNorm);
            const beforeWords = normalized.slice(0, startIdx).trim().split(' ').filter(Boolean).length;
            for (let i = 0; i < kwTokens.length; i++) {
              intentMatchedTokens.add(beforeWords + i);
            }
          }
        }
      }
    }
  }

  checkIntentGroup(MOOD_INTENTS, detectedMoods);
  checkIntentGroup(GENRE_INTENTS, detectedGenres);
  checkIntentGroup(ERA_INTENTS, detectedEras);
  checkIntentGroup(LANGUAGE_INTENTS, detectedLanguages);

  // Identify music stopwords
  const stopwordIndices = new Set();
  tokens.forEach((tok, idx) => {
    if (MUSIC_STOPWORDS.has(tok)) {
      stopwordIndices.add(idx);
    }
  });

  // Tokens that are neither intent keywords nor stopwords nor connectives
  const remainingTokens = tokens.filter((tok, idx) => {
    return !intentMatchedTokens.has(idx) && !stopwordIndices.has(idx) && !HINDI_CONNECTIVES.has(tok);
  });

  // Tokens without stopwords or connectives
  const meaningfulTokens = tokens.filter((tok, idx) => !stopwordIndices.has(idx) && !HINDI_CONNECTIVES.has(tok));
  const tokensWithoutStopwords = tokens.filter((tok, idx) => !stopwordIndices.has(idx));
  const cleanedQuery = tokensWithoutStopwords.length > 0 ? tokensWithoutStopwords.join(' ') : normalized;

  const hasIntent = (
    detectedMoods.size > 0 ||
    detectedGenres.size > 0 ||
    detectedEras.size > 0 ||
    detectedLanguages.size > 0
  );

  // Pure intent query: e.g. "romantic songs", "sad songs", "90s bollywood songs", "old hindi songs"
  // where NO specific title or artist tokens exist outside the intent and stopwords
  const isPureIntent = hasIntent && remainingTokens.length === 0;

  return {
    rawQuery,
    normalized,
    cleanedQuery,
    specificEntityQuery: remainingTokens.join(' '),
    detectedMoods: Array.from(detectedMoods),
    detectedGenres: Array.from(detectedGenres),
    detectedEras: Array.from(detectedEras),
    detectedLanguages: Array.from(detectedLanguages),
    hasIntent,
    isPureIntent
  };
}

module.exports = {
  MUSIC_STOPWORDS,
  MOOD_INTENTS,
  GENRE_INTENTS,
  ERA_INTENTS,
  LANGUAGE_INTENTS,
  parseSearchIntent
};
