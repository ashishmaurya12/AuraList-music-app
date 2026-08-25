const CryptoJS = require('crypto-js');
const fs = require('fs');
const path = require('path');

function decodeHTMLEntities(str) {
  if (!str) return '';
  return str
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

function decryptJioSaavnUrl(encryptedMediaUrl) {
  if (!encryptedMediaUrl) return '';
  try {
    const key = CryptoJS.enc.Utf8.parse('38346591');
    const decrypted = CryptoJS.DES.decrypt(
      { ciphertext: CryptoJS.enc.Base64.parse(encryptedMediaUrl) },
      key,
      { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.Pkcs7 }
    );
    const url = decrypted.toString(CryptoJS.enc.Utf8);
    if (!url) return '';
    return url.replace('_96.mp4', '_320.mp4').replace('_160.mp4', '_320.mp4');
  } catch (e) {
    return '';
  }
}

function formatImageUrl(url) {
  if (!url) return 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop';
  return url.replace('150x150', '500x500').replace('50x50', '500x500').replace('http://', 'https://');
}

function formatJioSaavnTrack(item, genreTag = 'general') {
  const moreInfo = item.more_info || {};
  const encryptedUrl = moreInfo.encrypted_media_url || item.encrypted_media_url;
  const audioUrl = decryptJioSaavnUrl(encryptedUrl);

  let artistName = item.subtitle || '';
  if (moreInfo.artistMap?.primary_artists && moreInfo.artistMap.primary_artists.length > 0) {
    artistName = moreInfo.artistMap.primary_artists.map(a => a.name).join(', ');
  } else if (moreInfo.singers) {
    artistName = moreInfo.singers;
  } else if (moreInfo.music) {
    artistName = moreInfo.music;
  }

  const titleClean = decodeHTMLEntities(item.title || item.song || 'Untitled Track');
  const artistClean = decodeHTMLEntities(artistName || 'Various Artists');
  const albumClean = decodeHTMLEntities(moreInfo.album || item.album || 'Single');
  const durationSec = parseInt(moreInfo.duration || item.duration || '240', 10);
  const trackId = String(item.id || item.song_id || Math.random().toString(36).substring(7));

  return {
    id: trackId,
    jamendoId: trackId,
    title: titleClean,
    artist: artistClean,
    album: albumClean,
    coverUrl: formatImageUrl(item.image),
    audioUrl: audioUrl,
    duration: durationSec,
    license: 'Full-Length Original Stream',
    source: 'JioSaavn Official Catalog',
    category: genreTag
  };
}

async function fetchQuery(query, page = 1, limit = 40, category = 'general') {
  const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' };
  const url = `https://www.jiosaavn.com/api.php?__call=search.getResults&_format=json&_marker=0&api_version=4&ctx=web6dot0&q=${encodeURIComponent(query)}&p=${page}&n=${limit}`;
  try {
    const res = await fetch(url, { headers });
    const data = await res.json();
    if (data && data.results && data.results.length > 0) {
      return data.results.map(item => formatJioSaavnTrack(item, category)).filter(t => t.audioUrl && t.audioUrl.length > 0);
    }
  } catch(e) {}
  return [];
}

async function build2000Catalog() {
  console.log('Building 2000+ song catalog (1000 Indian + 1000 Hollywood English)...');

  const indianQueries = [
    'Hindi Hits', 'Bollywood Top 50', 'Arijit Singh', 'Punjabi Hits',
    'Hindi Romantic', 'A.R. Rahman', 'Telugu Hits', 'Tamil Hits',
    'Desi Hip Hop', 'Hindi Lofi', 'Atif Aslam', 'Shreya Ghoshal',
    'Pritam', 'Karan Aujla', 'Sidhu Moosewala', 'Diljit Dosanjh',
    '90s Hindi Hits', '2000s Bollywood', 'Sonu Nigam', 'Kumar Sanu',
    'Alka Yagnik', 'Badshah', 'Divine', 'Yo Yo Honey Singh',
    'Neha Kakkar', 'Jubin Nautiyal', 'Anuv Jain', 'Ritviz',
    'Sanam', 'Sachet Tandon', 'B Praak', 'Guru Randhawa', 'Hardy Sandhu'
  ];

  const hollywoodQueries = [
    'Hollywood Hits', 'Billboard Top 100', 'English Pop Hits', 'Taylor Swift Hits',
    'Ed Sheeran Hits', 'The Weeknd Hits', 'Drake Hits', 'Bruno Mars Hits',
    'Coldplay Hits', 'Imagine Dragons Hits', 'Eminem Hits', 'Beyonce Hits',
    'Rihanna Hits', 'Dua Lipa Hits', 'Post Malone Hits', 'Billie Eilish Hits',
    'Maroon 5 Hits', 'Adele Hits', 'Michael Jackson Hits', 'Queen Hits',
    'Sia Hits', 'Katy Perry Hits', 'Justin Bieber Hits', 'Selena Gomez Hits',
    'Shawn Mendes Hits', 'Harry Styles Hits', 'Charlie Puth Hits', 'Olivia Rodrigo Hits',
    'Lady Gaga Hits', 'Britney Spears Hits', 'Avicii Hits', 'David Guetta Hits',
    'Marshmello Hits', 'Alan Walker Hits', 'The Chainsmokers Hits', 'One Direction Hits',
    'Linkin Park Hits', 'Twenty One Pilots Hits', 'Global English Top Hits', 'US Top 50'
  ];

  const seenIds = new Set();
  const catalog = [];

  // 1. Fetch Indian catalog (Target 1,000+)
  console.log('--- 1. Fetching Indian Collection ---');
  let indianCount = 0;
  for (const q of indianQueries) {
    for (let page = 1; page <= 2; page++) {
      const tracks = await fetchQuery(q, page, 40, 'indian');
      let added = 0;
      for (const t of tracks) {
        if (!seenIds.has(t.id) && !seenIds.has(t.title.toLowerCase())) {
          seenIds.add(t.id);
          seenIds.add(t.title.toLowerCase());
          catalog.push(t);
          indianCount++;
          added++;
        }
      }
      console.log(`[Indian] Query: "${q}", Page: ${page}, Added: ${added}, Indian Total: ${indianCount}`);
      if (indianCount >= 1050) break;
    }
    if (indianCount >= 1050) break;
  }

  // 2. Fetch Hollywood English catalog (Target 1,000+)
  console.log('--- 2. Fetching Hollywood English Collection ---');
  let hollywoodCount = 0;
  for (const q of hollywoodQueries) {
    for (let page = 1; page <= 2; page++) {
      const tracks = await fetchQuery(q, page, 40, 'hollywood');
      let added = 0;
      for (const t of tracks) {
        if (!seenIds.has(t.id) && !seenIds.has(t.title.toLowerCase())) {
          seenIds.add(t.id);
          seenIds.add(t.title.toLowerCase());
          catalog.push(t);
          hollywoodCount++;
          added++;
        }
      }
      console.log(`[Hollywood] Query: "${q}", Page: ${page}, Added: ${added}, Hollywood Total: ${hollywoodCount}`);
      if (hollywoodCount >= 1050) break;
    }
    if (hollywoodCount >= 1050) break;
  }

  console.log(`\nFinal catalog count: ${catalog.length} (Indian: ${indianCount}, Hollywood English: ${hollywoodCount})`);
  const dataDir = path.join(__dirname, '../data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  fs.writeFileSync(path.join(dataDir, 'catalog.json'), JSON.stringify(catalog, null, 2));
  console.log('Successfully saved expanded catalog to data/catalog.json');
}

build2000Catalog();
