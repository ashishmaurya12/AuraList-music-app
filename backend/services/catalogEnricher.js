/**
 * backend/services/catalogEnricher.js
 *
 * Grounded Catalog Metadata Enrichment & Intent Classification for AuraList.
 * Classifies tracks by mood, genre, era, and language using strict, verified evidence:
 * 1. Existing provider/track metadata (category, tags, genre, moods).
 * 2. Artist knowledge base (genres, era, and specialized mood like Ghazals/Devotional).
 * 3. Thematic and lexical patterns in titles and albums.
 * Unknown values are left unknown (empty array or null); never invents classifications.
 */

// Grounded Artist Knowledge Base for Era, Genre, and Specialized Focus
const ARTIST_KNOWLEDGE = [
  // Retro Bollywood Legends
  {
    regex: /\b(lata\s+mangeshkar|kishore\s+kumar|mohammed\s+rafi|mohd\s+rafi|asha\s+bhosle|mukesh|manna\s+dey|hemant\s+kumar|talat\s+mahmood|geeta\s+dutt)\b/i,
    genres: ['bollywood', 'classic'],
    era: 'retro',
    language: 'hindi'
  },
  // Ghazal Maestros (Always Soulful / Sad / Relaxing)
  {
    regex: /\b(jagjit\s+singh|chitra\s+singh|ghulam\s+ali|pankaj\s+udhas|mehdi\s+hassan|bhupinder\s+singh)\b/i,
    genres: ['ghazal'],
    moods: ['sad', 'relaxing'],
    era: 'retro',
    language: 'hindi'
  },
  // Sufi & Qawwali Legends (Always Devotional / Spiritual)
  {
    regex: /\b(nusrat\s+fateh\s+ali\s+khan|nusrat\s+khan|rahat\s+fateh\s+ali\s+khan|fateh\s+ali\s+khan|sabri\s+brothers|aziz\s+mian|abida\s+parveen|wadali\s+brothers)\b/i,
    genres: ['qawwali', 'sufi'],
    moods: ['devotional'],
    language: 'urdu'
  },
  // 90s Romance & Melody Icons
  {
    regex: /\b(kumar\s+sanu|udit\s+narayan|alka\s+yagnik|anuradha\s+paudwal|kavita\s+krishnamurthy|sadhana\s+sargam|abhijeet|babul\s+supriyo)\b/i,
    genres: ['bollywood'],
    era: '90s',
    language: 'hindi'
  },
  // Modern Playback Singers
  {
    regex: /\b(arijit\s+singh|atif\s+aslam|mohit\s+chauhan|kk\b|krishnakumar\s+kunnath|shaan|jubin\s+nautiyal|darshan\s+raval|armaan\s+malik|papon|shreya\s+ghoshal)\b/i,
    genres: ['bollywood'],
    language: 'hindi'
  },
  // Punjabi & Party Artists
  {
    regex: /\b(diljit\s+dosanjh|karan\s+aujla|sidhu\s+moose\s*wala|ap\s+dhillon|gurdas\s+maan|mika\s+singh|daler\s+mehndi|sukhbir|honey\s+singh|yo\s+yo\s+honey\s+singh|badshah|raftaar)\b/i,
    genres: ['punjabi'],
    moods: ['party'],
    language: 'punjabi'
  },
  // Devotional Specialists
  {
    regex: /\b(hariharan|anup\s+jalota|narendra\s+chanchal|lakhbir\s+singh\s+lakkha)\b/i,
    genres: ['devotional'],
    moods: ['devotional'],
    language: 'hindi'
  },
  // International / Hollywood Artists
  {
    regex: /\b(michael\s+jackson)\b/i,
    genres: ['pop'],
    moods: ['party', 'dance'],
    era: 'retro',
    language: 'english'
  },
  {
    regex: /\b(taylor\s+swift)\b/i,
    genres: ['pop'],
    language: 'english'
  },
  {
    regex: /\b(billie\s+eilish)\b/i,
    genres: ['pop', 'alternative'],
    moods: ['relaxing', 'sad'],
    language: 'english'
  },
  {
    regex: /\b(dua\s+lipa)\b/i,
    genres: ['pop', 'dance'],
    moods: ['party', 'dance'],
    language: 'english'
  },
  {
    regex: /\b(imagine\s+dragons)\b/i,
    genres: ['rock', 'pop'],
    moods: ['workout'],
    language: 'english'
  },
  {
    regex: /\b(coldplay)\b/i,
    genres: ['rock', 'alternative'],
    moods: ['relaxing'],
    language: 'english'
  },
  {
    regex: /\b(the\s+weeknd|weeknd)\b/i,
    genres: ['pop', 'r&b'],
    moods: ['party', 'dance'],
    language: 'english'
  },
  {
    regex: /\b(drake)\b/i,
    genres: ['hiphop', 'rap'],
    moods: ['workout', 'party'],
    language: 'english'
  },
  {
    regex: /\b(post\s+malone)\b/i,
    genres: ['hiphop', 'pop'],
    language: 'english'
  },
  {
    regex: /\b(ed\s+sheeran)\b/i,
    genres: ['pop'],
    moods: ['relaxing'],
    language: 'english'
  },
  {
    regex: /\b(rihanna)\b/i,
    genres: ['pop', 'r&b'],
    moods: ['party', 'dance'],
    language: 'english'
  }
];

// Grounded Thematic and Lexical Patterns
const THEMATIC_PATTERNS = [
  // 1. Devotional
  {
    regex: /(\b(hanuman|chalisa|bhajan|aarti|arti|krishna|ram|shiva|shiv|devi|ganesh|durga|gayatri|mantra|stotra|bhakti|kavach|sai\s*baba|khwaja|allah|rabba|waheguru|shlok|choupai)\b|श्री|हनुमान|चालीसा|भजन|आरती|कृष्णा|राम|शिव)/i,
    mood: 'devotional',
    genre: 'devotional'
  },
  // 2. Romantic (Strict & specific musical romance cues)
  {
    regex: /(\b(tum\s+hi\s+ho|kesariya|pehla\s+nasha|raabta|gehra\s+hua|ishq|pyaar|pyar|mohabbat|dil\s+ko|dil\s+ka|dil\s+di|humsafar|saathiya|romantic|romance|love\s+mashup|love\s+lounge|love\s+hits|heart\s+touching|aashiqui|awarapan|saiyaara|labon\s+ko|apna\s+bana\s+le|o\s+maahi|tujh\s+mein\s+rab|tere\s+bina|pal\s+ek\s+pal|subhanallah|mast\s+magan|samjhawan|zaalima|hawayein|deewana|sun\s+saathiya|khuda\s+jaane|jeena\s+jeena|tera\s+mera\s+rishta|shayad|dholna|afsana|fakira|aahista)\b|रोमांटिक|प्यार|मोहब्बत|इश्क)/i,
    mood: 'romantic'
  },
  // 3. Sad
  {
    regex: /(\b(sad\s+songs?|dard|judaai|judai|tanha|barbaad|bewafa|alvida|channa\s+mereya|toh\s+phir\s+aao|tadap|gham|bichhad|aansoo|broken\s+heart|tears|dukh)\b|दर्द|जुदाई|बेवफा|उदास)/i,
    mood: 'sad'
  },
  // 4. Heartbreak
  {
    regex: /(\b(heartbreak|broken\s+heart|bewafa|betrayal|dhokha|barbaad|channa\s+mereya)\b|बेवफा|धोखा)/i,
    mood: 'heartbreak'
  },
  // 5. Party
  {
    regex: /(\b(party|dance|club|bhangra|dhol|nach|nacho|nachde|thumka|dhamaka|dj\s+waley|celebration|wedding|hungama|festive|disco|cocktail)\b|पार्टी|नाच)/i,
    mood: 'party'
  },
  // 6. Dance
  {
    regex: /(\b(dance|nach|nacho|nachde|thumka|disco|groove|dhol|bhangra)\b|नाच|डांस)/i,
    mood: 'dance'
  },
  // 7. Workout
  {
    regex: /(\b(workout|gym|fitness|pump|power|energy|beast|running|cardio|push\s+it)\b)/i,
    mood: 'workout'
  },
  // 8. Relaxing
  {
    regex: /(\b(relax|relaxing|chill|peace|calm|soft|soothing|acoustic|lofi|lo-fi|meditation|ambient|deep\s+sleep|sukoon)\b|सुकून|शांत)/i,
    mood: 'relaxing'
  },
  // 9. Happy
  {
    regex: /(\b(happy|happiness|khushi|joy|celebrate|upbeat|masti|muskurahat|smile)\b|खुशी|मस्ती)/i,
    mood: 'happy'
  },
  // Eras
  {
    regex: /(\b(90s|90's|nineties)\b)/i,
    era: '90s'
  },
  {
    regex: /(\b(retro|evergreen|old\s+is\s+gold|classic\s+hits|purane|golden\s+era)\b|पुराने)/i,
    era: 'retro'
  },
  // Genres
  {
    regex: /(\b(bollywood|filmi|hindi\s+cinema)\b|from\s+"[^"]+"|from\s+movie)/i,
    genre: 'bollywood'
  },
  {
    regex: /(\b(punjabi|bhangra)\b)/i,
    genre: 'punjabi'
  },
  {
    regex: /(\b(ghazal|gazal)\b|गज़ल|गजल)/i,
    genre: 'ghazal',
    mood: 'sad'
  }
];

/**
 * Cleanly enrich a track object with moods, genres, era, and language metadata.
 * Non-destructive: preserves existing fields and values.
 */
function enrichTrack(track) {
  if (!track || typeof track !== 'object') return track;

  const moods = new Set(Array.isArray(track.moods) ? track.moods : []);
  if (typeof track.mood === 'string' && track.mood.trim()) {
    moods.add(track.mood.trim().toLowerCase());
  }

  const genres = new Set(Array.isArray(track.genres) ? track.genres : []);
  if (typeof track.genre === 'string' && track.genre.trim()) {
    genres.add(track.genre.trim().toLowerCase());
  }

  let era = track.era || null;
  let language = track.language || null;
  const tags = new Set(Array.isArray(track.tags) ? track.tags : []);

  const title = (track.title || '').trim();
  const artist = (track.artist || '').trim();
  const album = (track.album || '').trim();
  const category = (track.category || '').trim().toLowerCase();

  // 1. Category-based grounded inference
  if (category === 'qawwali') {
    genres.add('qawwali');
    genres.add('sufi');
    moods.add('devotional');
    if (!language) language = 'urdu';
  } else if (category === 'indian') {
    genres.add('bollywood');
    if (!language) language = 'hindi';
  } else if (category === 'hollywood') {
    genres.add('pop');
    if (!language) language = 'english';
  }

  // 2. Artist-based knowledge
  if (artist) {
    for (const rule of ARTIST_KNOWLEDGE) {
      if (rule.regex.test(artist)) {
        if (rule.genres) rule.genres.forEach(g => genres.add(g));
        if (rule.moods) rule.moods.forEach(m => moods.add(m));
        if (rule.era && !era) era = rule.era;
        if (rule.language && !language) language = rule.language;
        break;
      }
    }
  }

  // 3. Thematic and Lexical Patterns in Title & Album
  const combinedText = `${title} ${album}`;
  for (const pattern of THEMATIC_PATTERNS) {
    if (pattern.regex.test(combinedText)) {
      if (pattern.mood) moods.add(pattern.mood);
      if (pattern.genre) genres.add(pattern.genre);
      if (pattern.era && !era) era = pattern.era;
    }
  }

  // Populate tags for fast indexing and query matching
  moods.forEach(m => tags.add(m));
  genres.forEach(g => tags.add(g));
  if (era) tags.add(era);
  if (language) tags.add(language);

  return {
    ...track,
    moods: Array.from(moods),
    genres: Array.from(genres),
    era: era || null,
    language: language || null,
    tags: Array.from(tags)
  };
}

module.exports = {
  ARTIST_KNOWLEDGE,
  THEMATIC_PATTERNS,
  enrichTrack
};
