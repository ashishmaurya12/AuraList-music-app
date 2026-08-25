// UI Rendering & YouTube Music Component Helpers
const UI = {
  likedTrackIds: new Set(),
  dislikedTrackIds: new Set(),
  userPlaylists: [],

  formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  },

  showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast';
    
    const icon = type === 'error' 
      ? '<i class="fa-solid fa-circle-exclamation" style="color:var(--accent-yt-red);"></i>'
      : '<i class="fa-solid fa-circle-check" style="color:#10b981;"></i>';

    toast.innerHTML = `${icon} <span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(30px)';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  },

  // YouTube Music Quick Picks (2x3 Grid)
  renderQuickPicks(tracks, container) {
    if (!container) return;
    if (!tracks || tracks.length === 0) {
      container.innerHTML = '';
      return;
    }

    const picks = tracks.slice(0, 6);
    container.innerHTML = `
      <div class="quick-picks-section">
        <div class="section-title-row">
          <h2 class="section-title">START RADIO / QUICK PICKS</h2>
        </div>
        <div class="quick-picks-grid">
          ${picks.map((track, idx) => `
            <div class="quick-pick-card" onclick="app.playTrackFromList(${idx})">
              <img class="quick-pick-cover" src="${track.coverUrl}" alt="${track.title}">
              <div class="quick-pick-info">
                <span class="quick-pick-title">${track.title}</span>
                <span class="quick-pick-artist">${track.artist}</span>
              </div>
              <div class="quick-pick-play-btn">
                <i class="fa-solid fa-play"></i>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  },

  // YouTube Music Horizontal Shelf / Carousel
  renderShelfCarousel(sectionTitle, tracks, container, carouselId) {
    if (!container || !tracks || tracks.length === 0) return;

    const sectionHtml = `
      <div class="shelf-section">
        <div class="section-title-row">
          <h2 class="section-title">${sectionTitle}</h2>
        </div>
        <div class="shelf-carousel-wrapper">
          <button class="carousel-nav-btn prev-btn" onclick="UI.scrollShelf('${carouselId}', -600)">
            <i class="fa-solid fa-chevron-left"></i>
          </button>
          <div id="${carouselId}" class="shelf-carousel">
            ${tracks.map((track, idx) => {
              const trackId = track.jamendoId || track.id;
              const isLiked = this.likedTrackIds.has(String(trackId));
              return `
                <div class="track-card" data-track-id="${trackId}">
                  <div class="track-cover-wrapper">
                    <img class="track-cover" src="${track.coverUrl}" alt="${track.title}" loading="lazy">
                    <div class="play-overlay-btn" onclick="app.playTrackObject('${trackId}')">
                      <div class="play-circle">
                        <i class="fa-solid fa-play"></i>
                      </div>
                    </div>
                  </div>
                  <div class="track-info">
                    <span class="track-title" title="${track.title}">${track.title}</span>
                    <span class="track-artist" title="${track.artist}">${track.artist}</span>
                  </div>
                  <div class="track-card-actions">
                    <button class="action-icon-btn ${isLiked ? 'active' : ''}" onclick="app.toggleLikeTrack('${trackId}')" title="Like">
                      <i class="${isLiked ? 'fa-solid' : 'fa-regular'} fa-thumbs-up"></i>
                    </button>
                    <button class="action-icon-btn" onclick="app.openAddToPlaylistModal('${trackId}')" title="Add to Playlist">
                      <i class="fa-solid fa-plus"></i>
                    </button>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
          <button class="carousel-nav-btn next-btn" onclick="UI.scrollShelf('${carouselId}', 600)">
            <i class="fa-solid fa-chevron-right"></i>
          </button>
        </div>
      </div>
    `;

    container.insertAdjacentHTML('beforeend', sectionHtml);
  },

  scrollShelf(carouselId, offset) {
    const el = document.getElementById(carouselId);
    if (el) {
      el.scrollBy({ left: offset, behavior: 'smooth' });
    }
  },

  // YouTube Music Track Grid View
  renderTrackGrid(tracks, container) {
    if (!container) return;
    if (!tracks || tracks.length === 0) {
      container.innerHTML = `
        <div style="grid-column: 1/-1; text-align:center; padding: 60px 20px; color:var(--text-muted);">
          <i class="fa-solid fa-compact-disc" style="font-size: 40px; margin-bottom:16px; color:var(--text-dim);"></i>
          <p style="font-size:16px; font-weight:600;">No tracks found</p>
          <p style="font-size:13px; margin-top:4px;">Try searching or selecting another category.</p>
        </div>
      `;
      return;
    }

    container.className = 'track-grid';
    container.innerHTML = tracks.map((track, idx) => {
      const trackId = track.jamendoId || track.id;
      const isLiked = this.likedTrackIds.has(String(trackId));

      return `
        <div class="track-card" data-track-id="${trackId}">
          <div class="track-cover-wrapper">
            <img class="track-cover" src="${track.coverUrl}" alt="${track.title}" loading="lazy">
            <div class="play-overlay-btn" onclick="app.playTrackFromList(${idx})">
              <div class="play-circle">
                <i class="fa-solid fa-play"></i>
              </div>
            </div>
          </div>
          <div class="track-info">
            <span class="track-title" title="${track.title}">${track.title}</span>
            <span class="track-artist" title="${track.artist}">${track.artist}</span>
          </div>
          <div class="track-card-actions">
            <button class="action-icon-btn ${isLiked ? 'active' : ''}" onclick="app.toggleLikeTrack('${trackId}')" title="Like">
              <i class="${isLiked ? 'fa-solid' : 'fa-regular'} fa-thumbs-up"></i>
            </button>
            <button class="action-icon-btn" onclick="app.openAddToPlaylistModal('${trackId}')" title="Add to Playlist">
              <i class="fa-solid fa-plus"></i>
            </button>
          </div>
        </div>
      `;
    }).join('');
  },

  appendTrackGrid(newTracks, container, startIdx = 0) {
    if (!container || !newTracks || newTracks.length === 0) return;
    const html = newTracks.map((track, i) => {
      const idx = startIdx + i;
      const trackId = track.jamendoId || track.id;
      const isLiked = this.likedTrackIds.has(String(trackId));

      return `
        <div class="track-card" data-track-id="${trackId}">
          <div class="track-cover-wrapper">
            <img class="track-cover" src="${track.coverUrl}" alt="${track.title}" loading="lazy">
            <div class="play-overlay-btn" onclick="app.playTrackFromList(${idx})">
              <div class="play-circle">
                <i class="fa-solid fa-play"></i>
              </div>
            </div>
          </div>
          <div class="track-info">
            <span class="track-title" title="${track.title}">${track.title}</span>
            <span class="track-artist" title="${track.artist}">${track.artist}</span>
          </div>
          <div class="track-card-actions">
            <button class="action-icon-btn ${isLiked ? 'active' : ''}" onclick="app.toggleLikeTrack('${trackId}')" title="Like">
              <i class="${isLiked ? 'fa-solid' : 'fa-regular'} fa-thumbs-up"></i>
            </button>
            <button class="action-icon-btn" onclick="app.openAddToPlaylistModal('${trackId}')" title="Add to Playlist">
              <i class="fa-solid fa-plus"></i>
            </button>
          </div>
        </div>
      `;
    }).join('');
    container.insertAdjacentHTML('beforeend', html);
  },

  // Render Track List Table Rows
  renderTrackList(tracks, container, showDeletePlaylistTrackId = null) {
    if (!container) return;
    if (!tracks || tracks.length === 0) {
      container.innerHTML = `
        <div style="text-align:center; padding: 60px 20px; color:var(--text-muted);">
          <i class="fa-solid fa-compact-disc" style="font-size: 40px; margin-bottom:16px; color:var(--text-dim);"></i>
          <p style="font-size:16px; font-weight:600;">No tracks in list</p>
        </div>
      `;
      return;
    }

    container.className = 'track-list';
    container.innerHTML = tracks.map((track, idx) => {
      const trackId = track.jamendoId || track.id;
      const isLiked = this.likedTrackIds.has(String(trackId));
      const formattedTime = this.formatTime(track.duration);

      return `
        <div class="track-row" data-track-id="${trackId}">
          <div class="track-row-num">
            <button class="control-btn" style="width:28px; height:28px;" onclick="app.playTrackFromList(${idx})">
              <i class="fa-solid fa-play" style="font-size:12px;"></i>
            </button>
          </div>
          <img class="track-row-thumb" src="${track.coverUrl}" alt="${track.title}" loading="lazy">
          <div class="track-row-details">
            <span class="track-row-title">${track.title}</span>
            <span class="track-row-artist">${track.artist}</span>
          </div>
          <span class="track-row-album">${track.album || 'Single'}</span>
          <span class="track-row-time">${formattedTime}</span>
          <div class="track-row-actions">
            <button class="action-icon-btn ${isLiked ? 'active' : ''}" onclick="app.toggleLikeTrack('${trackId}')">
              <i class="${isLiked ? 'fa-solid' : 'fa-regular'} fa-thumbs-up"></i>
            </button>
            ${showDeletePlaylistTrackId ? `
              <button class="action-icon-btn" onclick="app.removeTrackFromPlaylist('${showDeletePlaylistTrackId}', '${trackId}')" title="Remove from Playlist" style="color:var(--accent-yt-red);">
                <i class="fa-solid fa-trash-can"></i>
              </button>
            ` : `
              <button class="action-icon-btn" onclick="app.openAddToPlaylistModal('${trackId}')" title="Add to Playlist">
                <i class="fa-solid fa-plus"></i>
              </button>
            `}
          </div>
        </div>
      `;
    }).join('');
  },

  // Render Playlists in Sidebar Navigation
  renderPlaylistNav(playlists) {
    this.userPlaylists = playlists;
    const container = document.getElementById('playlistNavList');
    if (!container) return;

    if (!playlists || playlists.length === 0) {
      container.innerHTML = `
        <span style="font-size:12px; color:var(--text-dim); padding:8px 16px;">No playlists yet</span>
      `;
      return;
    }

    container.innerHTML = playlists.map(p => `
      <a href="#playlist/${p.id}" class="nav-item" data-view="playlist" data-playlist-id="${p.id}">
        <i class="fa-solid fa-list-check"></i>
        <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${p.name}</span>
      </a>
    `).join('');
  },

  // Render YouTube Music Drawer "Up Next" Queue items
  renderQueue() {
    const container = document.getElementById('drawerQueueList');
    if (!container || !player) return;

    if (!player.queue || player.queue.length === 0) {
      container.innerHTML = `<div style="text-align:center; padding:30px; color:var(--text-dim); font-size:14px;">Queue is empty</div>`;
      return;
    }

    container.innerHTML = player.queue.map((track, idx) => {
      const isCurrent = idx === player.queueIndex;
      return `
        <div class="track-row" style="grid-template-columns: 30px 44px 1fr 40px; padding: 8px 10px; ${isCurrent ? 'background:rgba(255,0,0,0.15); border-left:3px solid var(--accent-yt-red);' : ''}">
          <span style="font-size:12px; color:var(--text-dim); text-align:center;">${idx + 1}</span>
          <img src="${track.coverUrl}" style="width:40px; height:40px; border-radius:4px; object-fit:cover;">
          <div style="display:flex; flex-direction:column; overflow:hidden;">
            <span style="font-size:14px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; ${isCurrent ? 'color:var(--accent-yt-red);' : 'color:#fff'}">${track.title}</span>
            <span style="font-size:12px; color:var(--text-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${track.artist}</span>
          </div>
          <button class="control-btn" onclick="player.playTrack(player.queue[${idx}], player.queue, ${idx})">
            <i class="fa-solid ${isCurrent && player.isPlaying ? 'fa-pause' : 'fa-play'}" style="font-size:12px;"></i>
          </button>
        </div>
      `;
    }).join('');
  },

  // Update like/dislike buttons across UI
  updateLikeStatus(jamendoId) {
    const isLiked = this.likedTrackIds.has(String(jamendoId));
    const isDisliked = this.dislikedTrackIds.has(String(jamendoId));

    const playerLikeBtn = document.getElementById('playerLikeBtn');
    const playerDislikeBtn = document.getElementById('playerDislikeBtn');

    if (playerLikeBtn && player.currentTrack && (String(player.currentTrack.jamendoId) === String(jamendoId) || String(player.currentTrack.id) === String(jamendoId))) {
      playerLikeBtn.classList.toggle('active', isLiked);
      playerLikeBtn.querySelector('i').className = `${isLiked ? 'fa-solid' : 'fa-regular'} fa-thumbs-up`;
    }

    if (playerDislikeBtn && player.currentTrack && (String(player.currentTrack.jamendoId) === String(jamendoId) || String(player.currentTrack.id) === String(jamendoId))) {
      playerDislikeBtn.classList.toggle('active', isDisliked);
      playerDislikeBtn.querySelector('i').className = `${isDisliked ? 'fa-solid' : 'fa-regular'} fa-thumbs-down`;
    }

    const matches = document.querySelectorAll(`[data-track-id="${jamendoId}"] .action-icon-btn`);
    matches.forEach(btn => {
      if (btn.getAttribute('title') === 'Like') {
        btn.classList.toggle('active', isLiked);
        const icon = btn.querySelector('i');
        if (icon) icon.className = `${isLiked ? 'fa-solid' : 'fa-regular'} fa-thumbs-up`;
      }
    });
  }
};
