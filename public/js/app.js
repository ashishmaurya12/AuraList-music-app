// Auralist Music - YouTube Music Application Controller
class AppController {
  constructor() {
    this.currentView = 'home';
    this.currentTracks = [];
    this.catalogTracks = [];
    this.selectedTrackForPlaylist = null;
    this.searchDebounceTimer = null;
    this.currentGenre = 'all';

    this.init();
  }

  async init() {
    const user = API.getUser();
    if (!API.getToken() || !user) {
      window.location.href = '/login';
      return;
    }

    this.updateUserUI(user);
    this.setupEventListeners();
    
    await Promise.all([
      this.loadUserLikes(),
      this.loadUserPlaylists()
    ]);

    this.handleRoute();
    window.addEventListener('hashchange', () => this.handleRoute());
  }

  updateUserUI(user) {
    const avatar = document.getElementById('userAvatar');
    if (avatar) {
      const initial = (user.name || 'U').charAt(0).toUpperCase();
      avatar.textContent = initial;
    }
  }

  setupEventListeners() {
    // Nav Drawer links
    document.querySelectorAll('.nav-item').forEach(link => {
      link.addEventListener('click', (e) => {
        const view = link.getAttribute('data-view');
        const playlistId = link.getAttribute('data-playlist-id');
        if (playlistId) {
          window.location.hash = `playlist/${playlistId}`;
        } else if (view) {
          window.location.hash = view;
        }
      });
    });

    // Global Search Input
    const searchInput = document.getElementById('globalSearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        clearTimeout(this.searchDebounceTimer);
        this.searchDebounceTimer = setTimeout(() => {
          const query = e.target.value.trim();
          if (query) {
            window.location.hash = `search?q=${encodeURIComponent(query)}`;
          } else if (this.currentView === 'search') {
            this.loadSearchTracks('');
          }
        }, 400);
      });
    }

    // Singer Search Input in Scroll Bar
    const singerBarInput = document.getElementById('singerBarInput');
    if (singerBarInput) {
      singerBarInput.addEventListener('input', (e) => {
        clearTimeout(this.searchDebounceTimer);
        this.searchDebounceTimer = setTimeout(() => {
          const singerName = e.target.value.trim();
          document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
          if (singerName) {
            window.location.hash = `search?q=${encodeURIComponent(singerName)}`;
          } else {
            const allPill = document.querySelector('.filter-pill[data-genre="all"]');
            if (allPill) allPill.classList.add('active');
            window.location.hash = `home`;
          }
        }, 300);
      });
    }

    // Filter Pills Bar & Scroll Arrows
    const genrePills = document.getElementById('genrePills');
    if (genrePills) {
      genrePills.addEventListener('click', (e) => {
        const pill = e.target.closest('.filter-pill');
        if (!pill) return;

        if (singerBarInput) singerBarInput.value = '';
        document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');

        this.currentGenre = pill.getAttribute('data-genre');
        if (this.currentGenre === 'all') {
          window.location.hash = 'home';
        } else {
          window.location.hash = `search?genre=${this.currentGenre}`;
        }
      });
    }

    document.getElementById('scrollPillsLeft')?.addEventListener('click', () => {
      genrePills?.scrollBy({ left: -350, behavior: 'smooth' });
    });

    document.getElementById('scrollPillsRight')?.addEventListener('click', () => {
      genrePills?.scrollBy({ left: 350, behavior: 'smooth' });
    });

    // Player Bar Controls
    document.getElementById('playPauseBtn')?.addEventListener('click', () => player.togglePlay());
    document.getElementById('prevBtn')?.addEventListener('click', () => player.prev());
    document.getElementById('nextBtn')?.addEventListener('click', () => player.next());
    document.getElementById('shuffleBtn')?.addEventListener('click', () => player.toggleShuffle());
    document.getElementById('repeatBtn')?.addEventListener('click', () => player.toggleRepeat());
    document.getElementById('playerLikeBtn')?.addEventListener('click', () => {
      if (player.currentTrack) {
        this.toggleLikeTrack(player.currentTrack.jamendoId || player.currentTrack.id);
      }
    });

    document.getElementById('playerDislikeBtn')?.addEventListener('click', () => {
      if (player.currentTrack) {
        this.toggleDislikeTrack(player.currentTrack.jamendoId || player.currentTrack.id);
      }
    });

    // Seek Bar
    const seekBar = document.getElementById('seekBar');
    if (seekBar) {
      seekBar.addEventListener('input', (e) => {
        if (player.audio.duration) {
          const targetTime = (parseFloat(e.target.value) / 100) * player.audio.duration;
          player.seek(targetTime);
        }
      });
    }

    // Volume Control
    const volumeBar = document.getElementById('volumeBar');
    if (volumeBar) {
      volumeBar.addEventListener('input', (e) => player.setVolume(e.target.value));
    }
    document.getElementById('muteBtn')?.addEventListener('click', () => player.toggleMute());

    // Playlist Modal Triggers
    document.getElementById('createPlaylistNavBtn')?.addEventListener('click', () => this.openCreatePlaylistModal());
    document.querySelectorAll('.closeModalBtn').forEach(btn => {
      btn.addEventListener('click', () => this.closeModals());
    });

    document.getElementById('createPlaylistForm')?.addEventListener('submit', (e) => this.handleCreatePlaylist(e));

    // Logout Button
    document.getElementById('logoutBtn')?.addEventListener('click', () => {
      API.clearAuth();
      window.location.href = '/login';
    });

    // Toggle Sidebar Mobile
    document.getElementById('toggleSidebarBtn')?.addEventListener('click', () => {
      const sidebar = document.getElementById('appSidebar');
      if (sidebar) sidebar.classList.toggle('open');
    });
  }

  // Routing Handler
  handleRoute() {
    const hash = window.location.hash.replace('#', '') || 'home';
    
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));

    if (hash.startsWith('playlist/')) {
      const playlistId = hash.split('/')[1];
      this.currentView = 'playlist';
      this.loadPlaylistView(playlistId);
      const activeNav = document.querySelector(`[data-playlist-id="${playlistId}"]`);
      if (activeNav) activeNav.classList.add('active');
    } else if (hash.startsWith('search')) {
      this.currentView = 'search';
      const activeNav = document.querySelector(`[data-view="search"]`);
      if (activeNav) activeNav.classList.add('active');

      const urlParams = new URLSearchParams(hash.includes('?') ? hash.split('?')[1] : '');
      const query = urlParams.get('q') || '';
      const genre = urlParams.get('genre') || this.currentGenre;
      
      const searchInput = document.getElementById('globalSearchInput');
      if (searchInput && query) searchInput.value = query;

      this.loadSearchTracks(query, genre);
    } else {
      this.currentView = hash;
      const activeNav = document.querySelector(`[data-view="${hash}"]`);
      if (activeNav) activeNav.classList.add('active');

      switch (hash) {
        case 'home':
          this.loadHomeView();
          break;
        case 'explore':
          this.loadExploreView();
          break;
        case 'library':
          this.loadLibraryView();
          break;
        case 'catalog':
          this.loadCatalogView();
          break;
        case 'liked':
          this.loadLikedTracksView();
          break;
        case 'history':
          this.loadHistoryView();
          break;
        default:
          this.loadHomeView();
          break;
      }
    }
  }

  // YouTube Music View Loader: HOME PAGE
  async loadHomeView() {
    const container = document.getElementById('mainView');
    container.innerHTML = `
      <div id="quickPicksBox"></div>
      <div id="shelfTrending"></div>
      <div id="shelfBollywood"></div>
      <div id="shelfHollywood"></div>
      <div id="shelfPunjabi"></div>
      <div id="shelfRomantic"></div>
    `;

    try {
      // 1. Fetch trending tracks for Quick Picks & Shelf 1
      const trendingTracks = await API.get('/music/trending');
      this.currentTracks = trendingTracks;

      UI.renderQuickPicks(trendingTracks, document.getElementById('quickPicksBox'));
      UI.renderShelfCarousel('🔥 TRENDING CHARTS', trendingTracks.slice(0, 15), document.getElementById('shelfTrending'), 'carouselTrending');

      // 2. Fetch category shelves
      const [bollywood, hollywood, punjabi, romantic] = await Promise.all([
        API.get('/music/search?genre=bollywood&limit=15'),
        API.get('/music/search?genre=hollywood&limit=15'),
        API.get('/music/search?genre=punjabi&limit=15'),
        API.get('/music/search?genre=romantic&limit=15')
      ]);

      UI.renderShelfCarousel('🎬 BOLLYWOOD BLOCKBUSTERS', bollywood, document.getElementById('shelfBollywood'), 'carouselBollywood');
      UI.renderShelfCarousel('🌟 HOLLYWOOD & GLOBAL POP', hollywood, document.getElementById('shelfHollywood'), 'carouselHollywood');
      UI.renderShelfCarousel('⚡ PUNJABI BEATS', punjabi, document.getElementById('shelfPunjabi'), 'carouselPunjabi');
      UI.renderShelfCarousel('💖 ROMANTIC VIBES', romantic, document.getElementById('shelfRomantic'), 'carouselRomantic');
    } catch (err) {
      UI.showToast('Failed to load YouTube Music Home', 'error');
    }
  }

  // YouTube Music View Loader: EXPLORE PAGE
  async loadExploreView() {
    const container = document.getElementById('mainView');
    container.innerHTML = `
      <div class="view-header">
        <div>
          <h2 class="view-title"><i class="fa-solid fa-compass"></i> Explore Music</h2>
          <p class="view-description">Discover new releases, top charts, and curated genres</p>
        </div>
      </div>
      <div id="exploreShelf1"></div>
      <div id="exploreShelf2"></div>
      <div id="exploreShelf3"></div>
    `;

    try {
      const [newReleases, hiphop, lofi] = await Promise.all([
        API.get('/music/search?q=New%20Release&limit=15'),
        API.get('/music/search?genre=hiphop&limit=15'),
        API.get('/music/search?genre=lofi&limit=15')
      ]);

      UI.renderShelfCarousel('✨ NEW RELEASES & SINGLE DROPS', newReleases, document.getElementById('exploreShelf1'), 'carouselNewReleases');
      UI.renderShelfCarousel('🎹 DESI HIP-HOP & RAP', hiphop, document.getElementById('exploreShelf2'), 'carouselHipHop');
      UI.renderShelfCarousel('🌙 CHILL & LO-FI VIBES', lofi, document.getElementById('exploreShelf3'), 'carouselLoFi');
    } catch (err) {
      UI.showToast('Failed to load Explore view', 'error');
    }
  }

  // View Loader: LIBRARY PAGE
  async loadLibraryView() {
    const container = document.getElementById('mainView');
    container.innerHTML = `
      <div class="view-header">
        <div>
          <h2 class="view-title"><i class="fa-solid fa-lines-leaning"></i> Music Library</h2>
          <p class="view-description">Your saved songs, playback history, and personal playlists</p>
        </div>
      </div>
      <div id="libraryLikedShelf"></div>
      <div id="libraryHistoryShelf"></div>
    `;

    try {
      const [likes, history] = await Promise.all([
        API.get('/likes'),
        API.get('/history')
      ]);

      if (likes.length > 0) {
        UI.renderShelfCarousel('👍 LIKED SONGS', likes, document.getElementById('libraryLikedShelf'), 'carouselLikedLib');
      } else {
        document.getElementById('libraryLikedShelf').innerHTML = `<p style="color:var(--text-muted); margin-bottom:24px;">No liked songs yet. Click the thumbs-up button on any song to save it!</p>`;
      }

      if (history.length > 0) {
        UI.renderShelfCarousel('🕒 RECENTLY PLAYED', history, document.getElementById('libraryHistoryShelf'), 'carouselHistoryLib');
      }
    } catch (err) {
      UI.showToast('Failed to load Library view', 'error');
    }
  }

  // View Loader: 2000+ CATALOG VIEW
  async loadCatalogView() {
    this.catalogPage = 1;
    this.isFetchingCatalog = false;

    const container = document.getElementById('mainView');
    container.innerHTML = `
      <div class="view-header">
        <div>
          <h2 class="view-title"><i class="fa-solid fa-compact-disc"></i> 2,000+ Song Catalog</h2>
          <p class="view-description">Pre-indexed collection of 1,000+ Indian & 1,000+ Hollywood English full-length songs</p>
        </div>
        <button id="playAllCatalogBtn" class="hero-btn" onclick="app.playAllCurrent()" style="padding:8px 18px; font-size:13px;">
          <i class="fa-solid fa-play"></i> Play Catalog
        </button>
      </div>
      <div id="catalogGrid" class="track-grid">
        <div style="grid-column:1/-1; text-align:center; padding:40px;"><i class="fa-solid fa-spinner fa-spin fa-2x" style="color:var(--accent-yt-red)"></i></div>
      </div>
      <div id="loadMoreCatalogContainer" style="text-align:center; margin-top:32px;">
        <button id="loadMoreCatalogBtn" class="btn-primary" onclick="app.loadMoreCatalogTracks()" style="padding:10px 24px; font-size:14px; width:auto;">
          <i class="fa-solid fa-angles-down"></i> Load Next Page (53 Total Pages)
        </button>
      </div>
    `;

    try {
      const data = await API.get('/music/catalog?page=1&limit=40');
      this.currentTracks = data.tracks || [];
      UI.renderTrackGrid(this.currentTracks, document.getElementById('catalogGrid'));
      UI.showToast(`Catalog Ready: ${data.totalSongs || 2103} songs available!`);
    } catch (err) {
      UI.showToast('Failed to load catalog view', 'error');
    }
  }

  async loadMoreCatalogTracks() {
    if (this.isFetchingCatalog) return;
    this.isFetchingCatalog = true;
    const btn = document.getElementById('loadMoreCatalogBtn');
    if (btn) btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Loading Songs...`;

    try {
      this.catalogPage = (this.catalogPage || 1) + 1;
      const data = await API.get(`/music/catalog?page=${this.catalogPage}&limit=40`);
      const newTracks = data.tracks || [];

      if (newTracks.length > 0) {
        const startIdx = this.currentTracks.length;
        this.currentTracks.push(...newTracks);
        UI.appendTrackGrid(newTracks, document.getElementById('catalogGrid'), startIdx);
        UI.showToast(`Showing ${this.currentTracks.length} of ${data.totalSongs || 2103} songs`);
      } else {
        UI.showToast('End of catalog reached');
        if (btn) btn.style.display = 'none';
      }
    } catch (e) {
      UI.showToast('Failed to load more catalog songs', 'error');
    } finally {
      this.isFetchingCatalog = false;
      if (btn) btn.innerHTML = `<i class="fa-solid fa-angles-down"></i> Load Next Page (53 Total Pages)`;
    }
  }

  // View Loader: SEARCH VIEW
  async loadSearchTracks(query = '', genre = 'all') {
    this.searchPage = 1;
    this.activeQuery = query;
    this.activeGenre = genre;
    this.isFetchingMore = false;

    // Sync active pill state in Singer Scroll Bar
    const singerBarInput = document.getElementById('singerBarInput');
    document.querySelectorAll('.filter-pill').forEach(p => {
      const pGenre = p.getAttribute('data-genre');
      if (pGenre === genre && genre !== 'all' && !query) {
        p.classList.add('active');
        if (singerBarInput) singerBarInput.value = '';
      } else if (!query && genre === 'all' && pGenre === 'all') {
        p.classList.add('active');
      } else {
        p.classList.remove('active');
      }
    });

    if (query && singerBarInput && document.activeElement !== singerBarInput) {
      singerBarInput.value = query;
    }

    const titleText = query 
      ? `Songs by "${query}"` 
      : genre !== 'all' 
        ? `Songs by ${genre.charAt(0).toUpperCase() + genre.slice(1)}` 
        : 'Browse Music';

    const container = document.getElementById('mainView');
    container.innerHTML = `
      <div class="view-header">
        <div>
          <h2 class="view-title"><i class="fa-solid fa-microphone" style="color:var(--accent-yt-red);"></i> ${titleText}</h2>
          <p class="view-description">${query ? `Showing search results for singer/track "${query}"` : `Filtered songs collection`}</p>
        </div>
        <button id="playAllSearchBtn" class="hero-btn" onclick="app.playAllCurrent()" style="padding:8px 18px; font-size:13px; display:none;">
          <i class="fa-solid fa-play"></i> Play Songs
        </button>
      </div>
      <div id="searchGrid" class="track-grid">
        <div style="grid-column:1/-1; text-align:center; padding:40px;"><i class="fa-solid fa-spinner fa-spin fa-2x" style="color:var(--accent-yt-red)"></i></div>
      </div>
      <div id="loadMoreContainer" style="text-align:center; margin-top:32px; display:none;">
        <button id="loadMoreBtn" class="btn-primary" onclick="app.loadMoreSearchTracks()" style="padding:10px 24px; font-size:14px; width:auto;">
          <i class="fa-solid fa-angles-down"></i> Load More Songs
        </button>
      </div>
    `;

    try {
      let endpoint = `/music/search?limit=40&page=1`;
      if (query) endpoint += `&q=${encodeURIComponent(query)}`;
      if (genre && genre !== 'all') endpoint += `&genre=${encodeURIComponent(genre)}`;

      const tracks = await API.get(endpoint);
      this.currentTracks = tracks;
      UI.renderTrackGrid(tracks, document.getElementById('searchGrid'));

      if (tracks.length > 0) {
        const playBtn = document.getElementById('playAllSearchBtn');
        if (playBtn) playBtn.style.display = 'inline-flex';
      }

      if (tracks.length >= 15) {
        const loadMoreBox = document.getElementById('loadMoreContainer');
        if (loadMoreBox) loadMoreBox.style.display = 'block';
      }
    } catch (err) {
      UI.showToast('Failed to search tracks', 'error');
    }
  }

  async loadMoreSearchTracks() {
    if (this.isFetchingMore) return;
    this.isFetchingMore = true;
    const btn = document.getElementById('loadMoreBtn');
    if (btn) btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Loading...`;

    try {
      this.searchPage++;
      let endpoint = `/music/search?limit=40&page=${this.searchPage}`;
      if (this.activeQuery) endpoint += `&q=${encodeURIComponent(this.activeQuery)}`;
      if (this.activeGenre && this.activeGenre !== 'all') endpoint += `&genre=${encodeURIComponent(this.activeGenre)}`;

      const newTracks = await API.get(endpoint);
      if (newTracks && newTracks.length > 0) {
        const startIdx = this.currentTracks.length;
        this.currentTracks.push(...newTracks);
        UI.appendTrackGrid(newTracks, document.getElementById('searchGrid'), startIdx);
        UI.showToast(`Loaded ${newTracks.length} more songs!`);
      } else {
        UI.showToast('No more songs found for this query.');
        if (btn) btn.style.display = 'none';
      }
    } catch (e) {
      UI.showToast('Failed to load more songs', 'error');
    } finally {
      this.isFetchingMore = false;
      if (btn) btn.innerHTML = `<i class="fa-solid fa-angles-down"></i> Load More Songs`;
    }
  }

  // View Loader: LIKED SONGS
  async loadLikedTracksView() {
    const container = document.getElementById('mainView');
    container.innerHTML = `
      <div class="view-header">
        <div>
          <h2 class="view-title"><i class="fa-solid fa-thumbs-up" style="color:var(--accent-yt-red);"></i> Liked Songs</h2>
          <p class="view-description">Your collection of thumbs-up tracks</p>
        </div>
        <button class="hero-btn" onclick="app.playAllCurrent()" style="padding:8px 18px; font-size:13px;">
          <i class="fa-solid fa-play"></i> Play Liked
        </button>
      </div>
      <div id="likedTrackList" class="track-list">
        <div style="text-align:center; padding:40px;"><i class="fa-solid fa-spinner fa-spin fa-2x" style="color:var(--accent-yt-red)"></i></div>
      </div>
    `;

    try {
      const likes = await API.get('/likes');
      this.currentTracks = likes;
      UI.likedTrackIds = new Set(likes.map(l => String(l.jamendoId)));
      UI.renderTrackList(likes, document.getElementById('likedTrackList'));
    } catch (err) {
      UI.showToast('Failed to load liked songs', 'error');
    }
  }

  // View Loader: HISTORY VIEW
  async loadHistoryView() {
    const container = document.getElementById('mainView');
    container.innerHTML = `
      <div class="view-header">
        <div>
          <h2 class="view-title"><i class="fa-solid fa-clock-rotate-left"></i> Playback History</h2>
          <p class="view-description">Recently played tracks on your account</p>
        </div>
      </div>
      <div id="historyTrackList" class="track-list">
        <div style="text-align:center; padding:40px;"><i class="fa-solid fa-spinner fa-spin fa-2x" style="color:var(--accent-yt-red)"></i></div>
      </div>
    `;

    try {
      const history = await API.get('/history');
      this.currentTracks = history;
      UI.renderTrackList(history, document.getElementById('historyTrackList'));
    } catch (err) {
      UI.showToast('Failed to load playback history', 'error');
    }
  }

  // View Loader: PLAYLIST DETAIL
  async loadPlaylistView(playlistId) {
    const container = document.getElementById('mainView');
    container.innerHTML = `<div style="text-align:center; padding:40px;"><i class="fa-solid fa-spinner fa-spin fa-2x" style="color:var(--accent-yt-red)"></i></div>`;

    try {
      const playlists = await API.get('/playlists');
      const playlist = playlists.find(p => p.id === playlistId);
      if (!playlist) {
        container.innerHTML = `<div style="text-align:center; padding:60px 20px;"><h2>Playlist Not Found</h2></div>`;
        return;
      }

      this.currentTracks = playlist.tracks || [];

      container.innerHTML = `
        <div class="view-header">
          <div>
            <h2 class="view-title"><i class="fa-solid fa-list-check"></i> ${playlist.name}</h2>
            <p class="view-description">${playlist.tracks.length} tracks • Created ${new Date(playlist.createdAt).toLocaleDateString()}</p>
          </div>
          <div style="display:flex; gap:10px;">
            <button class="btn-primary" onclick="app.playAllCurrent()" style="width:auto; padding:8px 18px; font-size:13px;">
              <i class="fa-solid fa-play"></i> Play Playlist
            </button>
            <button class="control-btn" onclick="app.deletePlaylist('${playlist.id}')" title="Delete Playlist" style="color:var(--accent-yt-red);">
              <i class="fa-solid fa-trash-can"></i>
            </button>
          </div>
        </div>
        <div id="playlistTracksContainer"></div>
      `;

      UI.renderTrackList(playlist.tracks, document.getElementById('playlistTracksContainer'), playlist.id);
    } catch (err) {
      UI.showToast('Failed to load playlist', 'error');
    }
  }

  // Play track handlers
  playTrackFromList(index) {
    if (this.currentTracks[index]) {
      player.playTrack(this.currentTracks[index], this.currentTracks, index);
    }
  }

  async playTrackObject(trackId) {
    let track = this.currentTracks.find(t => String(t.id) === String(trackId) || String(t.jamendoId) === String(trackId));
    if (!track) {
      try {
        track = await API.get(`/music/track/${trackId}`);
      } catch (e) {}
    }
    if (track) {
      player.playTrack(track, [track], 0);
    }
  }

  playAllCurrent() {
    if (this.currentTracks && this.currentTracks.length > 0) {
      player.playTrack(this.currentTracks[0], this.currentTracks, 0);
    } else {
      UI.showToast('No tracks available to play', 'error');
    }
  }

  // YouTube Music Fullscreen Player Drawer & Lyrics Toggle
  toggleFullscreenPlayer(open = null) {
    const drawer = document.getElementById('fullscreenPlayerDrawer');
    if (!drawer) return;
    const isOpen = open !== null ? open : !drawer.classList.contains('open');
    drawer.classList.toggle('open', isOpen);
    if (isOpen) {
      this.switchDrawerTab('queue');
    }
  }

  openFullscreenPlayer(tabName = 'queue') {
    this.toggleFullscreenPlayer(true);
    this.switchDrawerTab(tabName);
  }

  switchDrawerTab(tabName) {
    document.querySelectorAll('.drawer-tab').forEach(t => {
      t.classList.toggle('active', t.getAttribute('data-tab') === tabName);
    });

    const queueBox = document.getElementById('drawerTabContentQueue');
    const lyricsBox = document.getElementById('drawerTabContentLyrics');
    const relatedBox = document.getElementById('drawerTabContentRelated');

    if (queueBox) queueBox.style.display = tabName === 'queue' ? 'block' : 'none';
    if (lyricsBox) lyricsBox.style.display = tabName === 'lyrics' ? 'block' : 'none';
    if (relatedBox) relatedBox.style.display = tabName === 'related' ? 'block' : 'none';

    if (tabName === 'queue') {
      UI.renderQueue();
    } else if (tabName === 'lyrics' && player.currentTrack) {
      player.fetchLyrics(player.currentTrack.id || player.currentTrack.jamendoId);
    } else if (tabName === 'related' && this.currentTracks.length > 0) {
      UI.renderTrackList(this.currentTracks.slice(0, 10), document.getElementById('relatedTracksList'));
    }
  }

  // Likes & Dislikes Management
  async loadUserLikes() {
    try {
      const likes = await API.get('/likes');
      UI.likedTrackIds = new Set(likes.map(l => String(l.jamendoId)));
    } catch (e) {}
  }

  async toggleLikeTrack(jamendoId) {
    const track = this.currentTracks.find(t => String(t.jamendoId) === String(jamendoId) || String(t.id) === String(jamendoId)) || player.currentTrack;
    if (!track) return;

    try {
      const res = await API.post(`/likes/${jamendoId}`, {
        title: track.title,
        artist: track.artist,
        coverUrl: track.coverUrl,
        audioUrl: track.audioUrl,
        duration: track.duration
      });

      if (res.liked) {
        UI.likedTrackIds.add(String(jamendoId));
        UI.dislikedTrackIds.delete(String(jamendoId));
        UI.showToast(`Saved "${track.title}" to Liked Songs`);
      } else {
        UI.likedTrackIds.delete(String(jamendoId));
        UI.showToast(`Removed from Liked Songs`);
      }

      UI.updateLikeStatus(jamendoId);
      if (this.currentView === 'liked') this.loadLikedTracksView();
    } catch (err) {
      UI.showToast('Failed to update likes', 'error');
    }
  }

  toggleDislikeTrack(jamendoId) {
    if (UI.dislikedTrackIds.has(String(jamendoId))) {
      UI.dislikedTrackIds.delete(String(jamendoId));
      UI.showToast('Dislike removed');
    } else {
      UI.dislikedTrackIds.add(String(jamendoId));
      UI.likedTrackIds.delete(String(jamendoId));
      UI.showToast('Got it! We will recommend fewer tracks like this.');
      if (player.currentTrack && (String(player.currentTrack.id) === String(jamendoId) || String(player.currentTrack.jamendoId) === String(jamendoId))) {
        player.next();
      }
    }
    UI.updateLikeStatus(jamendoId);
  }

  // Playlists Management
  async loadUserPlaylists() {
    try {
      const playlists = await API.get('/playlists');
      UI.renderPlaylistNav(playlists);
    } catch (e) {}
  }

  openCreatePlaylistModal() {
    document.getElementById('createPlaylistModal')?.classList.add('open');
    document.getElementById('playlistNameInput')?.focus();
  }

  closeModals() {
    document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('open'));
  }

  async handleCreatePlaylist(e) {
    e.preventDefault();
    const input = document.getElementById('playlistNameInput');
    const name = input.value.trim();
    if (!name) return;

    try {
      const newPlaylist = await API.post('/playlists', { name });
      input.value = '';
      this.closeModals();
      UI.showToast(`Playlist "${newPlaylist.name}" created!`);
      await this.loadUserPlaylists();
      window.location.hash = `playlist/${newPlaylist.id}`;
    } catch (err) {
      UI.showToast(err.message || 'Failed to create playlist', 'error');
    }
  }

  async deletePlaylist(playlistId) {
    if (!confirm('Delete this playlist?')) return;
    try {
      await API.delete(`/playlists/${playlistId}`);
      UI.showToast('Playlist deleted');
      await this.loadUserPlaylists();
      window.location.hash = 'home';
    } catch (err) {
      UI.showToast('Failed to delete playlist', 'error');
    }
  }

  async openAddToPlaylistModal(jamendoId) {
    this.selectedTrackForPlaylist = this.currentTracks.find(t => String(t.jamendoId) === String(jamendoId) || String(t.id) === String(jamendoId));
    if (!this.selectedTrackForPlaylist) return;

    const modal = document.getElementById('addToPlaylistModal');
    const container = document.getElementById('playlistSelectList');

    const playlists = UI.userPlaylists;
    if (!playlists || playlists.length === 0) {
      container.innerHTML = `
        <p style="font-size:13px; color:var(--text-muted); padding:10px;">No playlists found. Create one first!</p>
        <button class="btn-primary" onclick="app.closeModals(); app.openCreatePlaylistModal();" style="margin-top:10px;">
          Create Playlist
        </button>
      `;
    } else {
      container.innerHTML = playlists.map(p => `
        <button class="nav-item" style="justify-content:space-between; width:100%; border:1px solid var(--border-color);" onclick="app.addTrackToPlaylist('${p.id}')">
          <span style="font-weight:600;"><i class="fa-solid fa-list-check" style="margin-right:10px;"></i>${p.name}</span>
          <span style="font-size:12px; color:var(--text-muted);">${p.tracks.length} tracks</span>
        </button>
      `).join('');
    }

    modal.classList.add('open');
  }

  async addTrackToPlaylist(playlistId) {
    if (!this.selectedTrackForPlaylist) return;
    const track = this.selectedTrackForPlaylist;

    try {
      await API.post(`/playlists/${playlistId}/tracks`, {
        jamendoId: track.jamendoId || track.id,
        title: track.title,
        artist: track.artist,
        coverUrl: track.coverUrl,
        audioUrl: track.audioUrl,
        duration: track.duration
      });

      this.closeModals();
      UI.showToast(`Added "${track.title}" to Playlist!`);
      await this.loadUserPlaylists();
      if (this.currentView === 'playlist') {
        this.loadPlaylistView(playlistId);
      }
    } catch (err) {
      UI.showToast(err.message || 'Failed to add track to playlist', 'error');
    }
  }

  async removeTrackFromPlaylist(playlistId, jamendoId) {
    try {
      await API.delete(`/playlists/${playlistId}/tracks/${jamendoId}`);
      UI.showToast('Track removed from playlist');
      await this.loadUserPlaylists();
      this.loadPlaylistView(playlistId);
    } catch (err) {
      UI.showToast('Failed to remove track', 'error');
    }
  }
}

const app = new AppController();
