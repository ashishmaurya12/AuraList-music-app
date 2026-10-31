// UI Rendering & Component Helpers (XSS & DOM Hardened)
const UI = {
  likedTrackIds: new Set(),
  dislikedTrackIds: new Set(),
  userPlaylists: [],

  // Escapes special characters for safe inclusion in HTML text nodes (supports both camelCase and uppercase HTML)
  escapeHtml(str) {
    return this.escapeHTML(str);
  },

  escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  },

  // Escapes attributes for safe inclusion in HTML attributes (title, data-*, etc.)
  escapeAttr(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  },

  // Validates URLs and rejects dangerous schemes (javascript:, data:, vbscript:)
  sanitizeUrl(url) {
    if (!url || typeof url !== 'string') return '';
    const trimmed = url.trim();
    const normalized = trimmed.toLowerCase().replace(/[\s\x00-\x1f]/g, '');
    if (normalized.startsWith('javascript:') || normalized.startsWith('data:') || normalized.startsWith('vbscript:')) {
      return '';
    }
    return trimmed;
  },

  // Validates Image URLs and returns safe HTTPS fallback if invalid/unsafe
  sanitizeImageUrl(url, customFallback) {
    const safeFallback = customFallback || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop';
    const clean = this.sanitizeUrl(url);
    if (!clean) return safeFallback;
    return clean.replace('http://', 'https://');
  },

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

    toast.innerHTML = `${icon} <span class="toast-text"></span>`;
    toast.querySelector('.toast-text').textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(30px)';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  },

  // Continue Listening Shelf (Resume playback position)
  renderContinueListening(tracks, container) {
    if (!container) return;
    container.replaceChildren();
    if (!tracks || tracks.length === 0) return;

    const safeFallback = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop';

    const section = document.createElement('div');
    section.className = 'shelf-section';
    section.style.marginBottom = '28px';

    const titleRow = document.createElement('div');
    titleRow.className = 'section-title-row';
    const h2 = document.createElement('h2');
    h2.className = 'section-title';
    h2.innerHTML = '<i class="fa-solid fa-clock-rotate-left" style="color:var(--accent); margin-right:8px; font-size:16px;"></i> CONTINUE LISTENING';
    titleRow.appendChild(h2);
    section.appendChild(titleRow);

    const wrapper = document.createElement('div');
    wrapper.className = 'shelf-carousel-wrapper';

    const prevBtn = document.createElement('button');
    prevBtn.className = 'carousel-nav-btn prev-btn';
    prevBtn.innerHTML = '<i class="fa-solid fa-chevron-left"></i>';
    prevBtn.title = 'Scroll Left';
    prevBtn.addEventListener('click', () => UI.scrollShelf('carouselContinue', -600));

    const carousel = document.createElement('div');
    carousel.id = 'carouselContinue';
    carousel.className = 'shelf-carousel';

    tracks.forEach((track, idx) => {
      const trackId = String(track.jamendoId || track.id || '');
      const isLiked = this.likedTrackIds.has(trackId);
      const position = Number(track.position) || 0;
      const duration = Number(track.duration) || 0;
      const progressPercent = duration > 0 ? Math.min(100, Math.max(0, (position / duration) * 100)) : 0;

      const card = document.createElement('div');
      card.className = 'track-card';
      card.dataset.trackId = trackId;

      const coverWrapper = document.createElement('div');
      coverWrapper.className = 'track-cover-wrapper';
      coverWrapper.style.position = 'relative';

      const img = document.createElement('img');
      img.className = 'track-cover';
      img.src = this.sanitizeImageUrl(track.coverUrl, safeFallback);
      img.alt = track.title || 'Untitled Track';
      img.loading = 'lazy';
      img.addEventListener('error', () => { img.src = safeFallback; }, { once: true });

      if (progressPercent > 0) {
        const progressBg = document.createElement('div');
        progressBg.className = 'continue-progress-bg';
        const progressFill = document.createElement('div');
        progressFill.className = 'continue-progress-fill';
        progressFill.style.width = `${progressPercent}%`;
        progressBg.appendChild(progressFill);
        coverWrapper.appendChild(progressBg);
      }

      const overlay = document.createElement('div');
      overlay.className = 'play-overlay-btn';
      overlay.title = `Resume at ${UI.formatTime(position)}`;
      overlay.addEventListener('click', () => {
        player.playTrack(track, tracks, idx, position);
      });
      const playCircle = document.createElement('div');
      playCircle.className = 'play-circle';
      const playIcon = document.createElement('i');
      playIcon.className = 'fa-solid fa-play';
      playCircle.appendChild(playIcon);
      overlay.appendChild(playCircle);

      coverWrapper.appendChild(img);
      coverWrapper.appendChild(overlay);

      const info = document.createElement('div');
      info.className = 'track-info';

      const titleSpan = document.createElement('span');
      titleSpan.className = 'track-title';
      titleSpan.title = track.title || 'Untitled Track';
      titleSpan.textContent = track.title || 'Untitled Track';

      const artistSpan = document.createElement('span');
      artistSpan.className = 'track-artist';
      artistSpan.title = track.artist || 'Various Artists';
      artistSpan.textContent = track.artist || 'Various Artists';

      info.appendChild(titleSpan);
      info.appendChild(artistSpan);

      if (position > 0) {
        const resumeTag = document.createElement('div');
        resumeTag.className = 'continue-resume-tag';
        resumeTag.innerHTML = `<i class="fa-solid fa-rotate-left"></i> Resume at ${UI.formatTime(position)}`;
        info.appendChild(resumeTag);
      }

      const actions = document.createElement('div');
      actions.className = 'track-card-actions';

      const playNextBtn = document.createElement('button');
      playNextBtn.className = 'action-icon-btn';
      playNextBtn.title = 'Play Next';
      playNextBtn.setAttribute('aria-label', `Play ${track.title || 'track'} next in queue`);
      playNextBtn.innerHTML = '<i class="fa-solid fa-forward-step"></i>';
      playNextBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        player.playNext(track);
      });

      const likeBtn = document.createElement('button');
      likeBtn.className = `action-icon-btn ${isLiked ? 'active' : ''}`;
      likeBtn.title = isLiked ? 'Unlike' : 'Like';
      likeBtn.innerHTML = `<i class="${isLiked ? 'fa-solid' : 'fa-regular'} fa-thumbs-up"></i>`;
      likeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (typeof app !== 'undefined' && app.toggleLikeTrack) {
          app.toggleLikeTrack(trackId, track);
        }
      });

      const addBtn = document.createElement('button');
      addBtn.className = 'action-icon-btn';
      addBtn.title = 'Add to Playlist';
      addBtn.innerHTML = '<i class="fa-solid fa-plus"></i>';
      addBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (typeof app !== 'undefined' && app.openAddToPlaylistModal) {
          app.openAddToPlaylistModal(trackId);
        }
      });

      actions.appendChild(playNextBtn);
      actions.appendChild(likeBtn);
      actions.appendChild(addBtn);

      card.appendChild(coverWrapper);
      card.appendChild(info);
      card.appendChild(actions);

      carousel.appendChild(card);
    });

    const nextBtn = document.createElement('button');
    nextBtn.className = 'carousel-nav-btn next-btn';
    nextBtn.innerHTML = '<i class="fa-solid fa-chevron-right"></i>';
    nextBtn.title = 'Scroll Right';
    nextBtn.addEventListener('click', () => UI.scrollShelf('carouselContinue', 600));

    wrapper.appendChild(prevBtn);
    wrapper.appendChild(carousel);
    wrapper.appendChild(nextBtn);

    section.appendChild(wrapper);
    container.appendChild(section);
  },

  // YouTube Music Quick Picks (2x3 Grid)
  renderQuickPicks(tracks, container) {
    if (!container) return;
    container.replaceChildren();
    if (!tracks || tracks.length === 0) return;

    const picks = tracks.slice(0, 6);
    const safeFallback = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop';

    const section = document.createElement('div');
    section.className = 'quick-picks-section';

    const titleRow = document.createElement('div');
    titleRow.className = 'section-title-row';
    const h2 = document.createElement('h2');
    h2.className = 'section-title';
    h2.textContent = 'QUICK PICKS';
    titleRow.appendChild(h2);
    section.appendChild(titleRow);

    const grid = document.createElement('div');
    grid.className = 'quick-picks-grid';

    picks.forEach((track, idx) => {
      const card = document.createElement('div');
      card.className = 'quick-pick-card';
      card.addEventListener('click', () => {
        if (typeof player !== 'undefined' && player.playTrack) {
          player.playTrack(track, picks, idx);
        } else if (typeof app !== 'undefined' && app.playTrackFromList) {
          app.playTrackFromList(idx, picks);
        }
      });

      const img = document.createElement('img');
      img.className = 'quick-pick-cover';
      img.src = this.sanitizeImageUrl(track.coverUrl, safeFallback);
      img.alt = track.title || 'Track';
      img.addEventListener('error', () => { img.src = safeFallback; }, { once: true });

      const info = document.createElement('div');
      info.className = 'quick-pick-info';

      const titleSpan = document.createElement('span');
      titleSpan.className = 'quick-pick-title';
      titleSpan.textContent = track.title || 'Untitled Track';

      const artistSpan = document.createElement('span');
      artistSpan.className = 'quick-pick-artist';
      artistSpan.textContent = track.artist || 'Various Artists';

      info.appendChild(titleSpan);
      info.appendChild(artistSpan);

      const playBtn = document.createElement('div');
      playBtn.className = 'quick-pick-play-btn';
      const playIcon = document.createElement('i');
      playIcon.className = 'fa-solid fa-play';
      playBtn.appendChild(playIcon);

      card.appendChild(img);
      card.appendChild(info);
      card.appendChild(playBtn);
      grid.appendChild(card);
    });

    section.appendChild(grid);
    container.appendChild(section);
  },

  // YouTube Music Horizontal Shelf / Carousel
  renderShelfCarousel(sectionTitle, tracks, container, carouselId) {
    if (!container || !tracks || tracks.length === 0) return;

    const safeFallback = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop';

    const section = document.createElement('div');
    section.className = 'shelf-section';

    const titleRow = document.createElement('div');
    titleRow.className = 'section-title-row';
    const h2 = document.createElement('h2');
    h2.className = 'section-title';
    h2.textContent = sectionTitle;
    titleRow.appendChild(h2);
    section.appendChild(titleRow);

    const wrapper = document.createElement('div');
    wrapper.className = 'shelf-carousel-wrapper';

    const prevBtn = document.createElement('button');
    prevBtn.className = 'carousel-nav-btn prev-btn';
    const prevIcon = document.createElement('i');
    prevIcon.className = 'fa-solid fa-chevron-left';
    prevBtn.appendChild(prevIcon);
    prevBtn.addEventListener('click', () => UI.scrollShelf(carouselId, -600));

    const carousel = document.createElement('div');
    carousel.id = carouselId;
    carousel.className = 'shelf-carousel';

    tracks.forEach((track) => {
      const trackId = String(track.jamendoId || track.id || '');
      const isLiked = this.likedTrackIds.has(trackId);

      const card = document.createElement('div');
      card.className = 'track-card';
      card.dataset.trackId = trackId;

      const coverWrapper = document.createElement('div');
      coverWrapper.className = 'track-cover-wrapper';

      const img = document.createElement('img');
      img.className = 'track-cover';
      img.src = this.sanitizeImageUrl(track.coverUrl, safeFallback);
      img.alt = track.title || 'Untitled Track';
      img.loading = 'lazy';
      img.addEventListener('error', () => { img.src = safeFallback; }, { once: true });

      const overlay = document.createElement('div');
      overlay.className = 'play-overlay-btn';
      const playTrackFromShelf = () => {
        if (typeof player !== 'undefined' && player.playTrack) {
          player.playTrack(track, tracks);
        } else if (typeof app !== 'undefined' && app.playTrackObject) {
          app.playTrackObject(trackId);
        }
      };

      card.addEventListener('click', (e) => {
        if (e.target.closest('.track-card-actions') || e.target.closest('.clickable-artist')) return;
        playTrackFromShelf();
      });

      overlay.addEventListener('click', (e) => {
        e.stopPropagation();
        playTrackFromShelf();
      });
      const playCircle = document.createElement('div');
      playCircle.className = 'play-circle';
      const playIcon = document.createElement('i');
      playIcon.className = 'fa-solid fa-play';
      playCircle.appendChild(playIcon);
      overlay.appendChild(playCircle);

      coverWrapper.appendChild(img);
      coverWrapper.appendChild(overlay);

      const info = document.createElement('div');
      info.className = 'track-info';
      const titleSpan = document.createElement('span');
      titleSpan.className = 'track-title';
      titleSpan.title = track.title || 'Untitled Track';
      titleSpan.textContent = track.title || 'Untitled Track';

      const artistSpan = document.createElement('span');
      artistSpan.className = 'track-artist';
      artistSpan.title = track.artist || 'Various Artists';
      artistSpan.textContent = track.artist || 'Various Artists';

      info.appendChild(titleSpan);
      info.appendChild(artistSpan);

      const actions = document.createElement('div');
      actions.className = 'track-card-actions';

      const likeBtn = document.createElement('button');
      likeBtn.className = `action-icon-btn ${isLiked ? 'active' : ''}`;
      likeBtn.title = 'Like';
      const likeIcon = document.createElement('i');
      likeIcon.className = `${isLiked ? 'fa-solid' : 'fa-regular'} fa-thumbs-up`;
      likeBtn.appendChild(likeIcon);
      likeBtn.addEventListener('click', (e) => {
        if (e && e.stopPropagation) e.stopPropagation();
        if (typeof app !== 'undefined' && app.toggleLikeTrack) {
          app.toggleLikeTrack(trackId, track);
        }
      });

      const addBtn = document.createElement('button');
      addBtn.className = 'action-icon-btn';
      addBtn.title = 'Add to Playlist';
      const addIcon = document.createElement('i');
      addIcon.className = 'fa-solid fa-plus';
      addBtn.appendChild(addIcon);
      addBtn.addEventListener('click', () => {
        if (typeof app !== 'undefined' && app.openAddToPlaylistModal) {
          app.openAddToPlaylistModal(trackId);
        }
      });

      actions.appendChild(likeBtn);
      actions.appendChild(addBtn);

      card.appendChild(coverWrapper);
      card.appendChild(info);
      card.appendChild(actions);

      carousel.appendChild(card);
    });

    const nextBtn = document.createElement('button');
    nextBtn.className = 'carousel-nav-btn next-btn';
    const nextIcon = document.createElement('i');
    nextIcon.className = 'fa-solid fa-chevron-right';
    nextBtn.appendChild(nextIcon);
    nextBtn.addEventListener('click', () => UI.scrollShelf(carouselId, 600));

    wrapper.appendChild(prevBtn);
    wrapper.appendChild(carousel);
    wrapper.appendChild(nextBtn);

    section.appendChild(wrapper);
    container.appendChild(section);
  },

  scrollShelf(carouselId, offset) {
    const el = document.getElementById(carouselId);
    if (el) {
      el.scrollBy({ left: offset, behavior: 'smooth' });
    }
  },

  // Helper for generating standard track cards safely
  createTrackCard(track, idx, safeFallback, trackList = null) {
    const trackId = String(track.jamendoId || track.id || '');
    const isLiked = this.likedTrackIds.has(trackId);
    const isCurrent = typeof player !== 'undefined' && player && player.currentTrack && (String(player.currentTrack.id) === trackId || String(player.currentTrack.jamendoId) === trackId);
    const isPlaying = isCurrent && player.isPlaying;

    const isUnplayable = Boolean(track.isUnavailable || track.audioUrl === false || (track.audioUrl === '' && !track.id));
    const card = document.createElement('div');
    card.className = isCurrent ? 'track-card is-current-playing' : (isUnplayable ? 'track-card track-unplayable' : 'track-card');
    card.dataset.trackId = trackId;
    card.tabIndex = isUnplayable ? -1 : 0;
    card.setAttribute('role', isUnplayable ? 'article' : 'button');
    card.setAttribute('aria-label', isUnplayable ? `${track.title || 'Untitled Track'} by ${track.artist || 'Various Artists'} (Unavailable)` : `Play ${track.title || 'Untitled Track'} by ${track.artist || 'Various Artists'}`);

    const triggerPlay = () => {
      if (isUnplayable) {
        if (typeof UI !== 'undefined' && UI.showToast) {
          UI.showToast(`Audio stream unavailable for "${track.title || 'Track'}"`, 'warning');
        }
        return;
      }
      if (typeof app !== 'undefined' && app.playTrackFromList) {
        app.playTrackFromList(idx, trackList);
      } else if (typeof player !== 'undefined' && player.playTrack) {
        player.playTrack(track, trackList || [track], idx);
      }
    };

    card.addEventListener('click', (e) => {
      if (e.target.closest('.action-icon-btn') || e.target.closest('.clickable-artist')) {
        return;
      }
      triggerPlay();
    });

    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        triggerPlay();
      }
    });

    const coverWrapper = document.createElement('div');
    coverWrapper.className = 'track-cover-wrapper';

    const img = document.createElement('img');
    img.className = 'track-cover';
    img.src = this.sanitizeImageUrl(track.coverUrl, safeFallback);
    img.alt = track.title || 'Untitled Track';
    img.loading = 'lazy';
    img.addEventListener('error', () => { img.src = safeFallback; }, { once: true });

    const overlay = document.createElement('div');
    overlay.className = 'play-overlay-btn';
    overlay.addEventListener('click', (e) => {
      e.stopPropagation();
      triggerPlay();
    });

    const playCircle = document.createElement('div');
    playCircle.className = 'play-circle';
    const playIcon = document.createElement('i');
    playIcon.className = isUnplayable ? 'fa-solid fa-ban' : `fa-solid ${isPlaying ? 'fa-pause' : 'fa-play'}`;
    if (isUnplayable) {
      playCircle.style.background = 'rgba(100, 100, 100, 0.7)';
      playIcon.style.color = '#f87171';
    }
    playCircle.appendChild(playIcon);
    overlay.appendChild(playCircle);

    coverWrapper.appendChild(img);
    coverWrapper.appendChild(overlay);

    const info = document.createElement('div');
    info.className = 'track-info';
    const titleSpan = document.createElement('span');
    titleSpan.className = 'track-title';
    titleSpan.title = track.title || 'Untitled Track';
    titleSpan.textContent = track.title || 'Untitled Track';

    const artistSpan = document.createElement('span');
    artistSpan.className = 'track-artist clickable-artist';
    artistSpan.title = track.artist || 'Various Artists';
    artistSpan.textContent = track.artist || 'Various Artists';
    artistSpan.addEventListener('click', (e) => {
      e.stopPropagation();
      if (typeof app !== 'undefined' && app.navigateToArtist) {
        app.navigateToArtist(track.artist);
      }
    });

    info.appendChild(titleSpan);
    info.appendChild(artistSpan);

    if (track.album && typeof track.album === 'string' && track.album.trim()) {
      const albumSpan = document.createElement('span');
      albumSpan.className = 'track-album';
      albumSpan.title = track.album;
      albumSpan.textContent = track.album;
      info.appendChild(albumSpan);
    }

    if (track.duration && typeof track.duration === 'number' && track.duration > 0) {
      const durSpan = document.createElement('span');
      durSpan.className = 'track-duration';
      durSpan.style.fontSize = '11px';
      durSpan.style.color = 'var(--text-dim)';
      durSpan.style.marginTop = '2px';
      durSpan.textContent = this.formatTime(track.duration);
      info.appendChild(durSpan);
    }

    if (track.provider && (track.provider === 'Audius' || track.provider === 'Jamendo' || track.provider === 'RadioBrowser')) {
      const providerBadge = document.createElement('span');
      providerBadge.className = 'track-provider-badge';
      providerBadge.style.display = 'inline-block';
      providerBadge.style.fontSize = '10px';
      providerBadge.style.padding = '1px 6px';
      providerBadge.style.borderRadius = '4px';
      providerBadge.style.marginTop = '4px';
      providerBadge.style.fontWeight = '600';
      if (track.provider === 'Audius') {
        providerBadge.style.background = 'rgba(168, 85, 247, 0.2)';
        providerBadge.style.color = '#c084fc';
        providerBadge.textContent = 'Audius';
      } else if (track.provider === 'Jamendo') {
        providerBadge.style.background = 'rgba(236, 72, 153, 0.2)';
        providerBadge.style.color = '#f472b6';
        providerBadge.textContent = 'Jamendo';
      } else if (track.provider === 'RadioBrowser') {
        providerBadge.style.background = 'rgba(56, 189, 248, 0.2)';
        providerBadge.style.color = '#38bdf8';
        providerBadge.textContent = 'Live Radio';
      }
      info.appendChild(providerBadge);
    }

    const actions = document.createElement('div');
    actions.className = 'track-card-actions';

    const likeBtn = document.createElement('button');
    likeBtn.className = `action-icon-btn ${isLiked ? 'active' : ''}`;
    likeBtn.title = isLiked ? 'Unlike' : 'Like';
    likeBtn.setAttribute('aria-label', isLiked ? 'Unlike track' : 'Like track');
    const likeIcon = document.createElement('i');
    likeIcon.className = `${isLiked ? 'fa-solid' : 'fa-regular'} fa-thumbs-up`;
    likeBtn.appendChild(likeIcon);
    likeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (typeof app !== 'undefined' && app.toggleLikeTrack) {
        app.toggleLikeTrack(trackId, track);
      }
    });

    const addBtn = document.createElement('button');
    addBtn.className = 'action-icon-btn';
    addBtn.title = 'Add to Playlist';
    addBtn.setAttribute('aria-label', 'Add to playlist');
    const addIcon = document.createElement('i');
    addIcon.className = 'fa-solid fa-plus';
    addBtn.appendChild(addIcon);
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (typeof app !== 'undefined' && app.openAddToPlaylistModal) {
        app.openAddToPlaylistModal(trackId);
      }
    });

    actions.appendChild(likeBtn);
    actions.appendChild(addBtn);

    card.appendChild(coverWrapper);
    card.appendChild(info);
    card.appendChild(actions);

    return card;
  },

  // YouTube Music Track Grid View
  renderTrackGrid(tracks, container) {
    if (!container) return;
    container.replaceChildren();

    if (!tracks || tracks.length === 0) {
      const emptyDiv = document.createElement('div');
      emptyDiv.style.gridColumn = '1/-1';
      emptyDiv.style.textAlign = 'center';
      emptyDiv.style.padding = '60px 20px';
      emptyDiv.style.color = 'var(--text-muted)';

      const discIcon = document.createElement('i');
      discIcon.className = 'fa-solid fa-compact-disc';
      discIcon.style.fontSize = '40px';
      discIcon.style.marginBottom = '16px';
      discIcon.style.color = 'var(--text-dim)';

      const p1 = document.createElement('p');
      p1.style.fontSize = '16px';
      p1.style.fontWeight = '600';
      p1.textContent = 'No tracks found';

      const p2 = document.createElement('p');
      p2.style.fontSize = '13px';
      p2.style.marginTop = '4px';
      p2.textContent = 'Try searching or selecting another category.';

      emptyDiv.appendChild(discIcon);
      emptyDiv.appendChild(p1);
      emptyDiv.appendChild(p2);
      container.appendChild(emptyDiv);
      return;
    }

    const safeFallback = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop';
    container.className = 'track-grid';
    tracks.forEach((track, idx) => {
      const card = this.createTrackCard(track, idx, safeFallback, tracks);
      container.appendChild(card);
    });
  },

  renderGroupedSearchGrid(tracks, container, query = '') {
    if (!container) return;
    container.replaceChildren();

    if (!tracks || tracks.length === 0) {
      this.renderTrackGrid(tracks, container);
      return;
    }

    const safeFallback = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop';
    container.className = 'track-grid';

    // Partition tracks into distinct groups:
    // External provider results (Audius/Jamendo) populate the dedicated external section
    // while local catalog tracks populate exact, fuzzy, and related relevance groups
    const isExternalTrack = (t) => {
      if (!t || typeof t !== 'object') return false;
      const prov = (t.provider || t.source || '').toLowerCase();
      if (prov === 'audius' || prov === 'jamendo') return true;
      if (t.matchType === 'external' || t.matchTier === 'external') return true;
      if (prov && prov !== 'local' && prov !== 'jiosaavn') return true;
      return false;
    };

    const externalMatches = tracks.filter(isExternalTrack);
    const localTracks = tracks.filter(t => !isExternalTrack(t));
    const exactMatches = localTracks.filter(t => t.matchType === 'exact');
    const fuzzyMatches = localTracks.filter(t => t.matchType === 'fuzzy');
    const relatedMatches = localTracks.filter(t => t.matchType === 'related' || (!t.matchType && t.matchType !== 'exact' && t.matchType !== 'fuzzy'));

    // Check if grouping headers should be displayed
    const hasMultipleGroups = (exactMatches.length > 0 && (fuzzyMatches.length > 0 || relatedMatches.length > 0 || externalMatches.length > 0)) ||
      (fuzzyMatches.length > 0 && (exactMatches.length > 0 || relatedMatches.length > 0 || externalMatches.length > 0)) ||
      (externalMatches.length > 0 && (exactMatches.length > 0 || fuzzyMatches.length > 0 || relatedMatches.length > 0));

    if (!hasMultipleGroups || !query) {
      // Single group or browsing without query: render standard flat grid
      tracks.forEach((track, idx) => {
        const card = this.createTrackCard(track, idx, safeFallback, tracks);
        container.appendChild(card);
      });
      return;
    }

    // Render Exact Matches section
    if (exactMatches.length > 0) {
      const exactHeader = document.createElement('div');
      exactHeader.className = 'search-group-header';
      exactHeader.style.gridColumn = '1 / -1';
      exactHeader.style.display = 'flex';
      exactHeader.style.alignItems = 'center';
      exactHeader.style.gap = '8px';
      exactHeader.style.margin = '12px 0 4px';
      exactHeader.style.paddingBottom = '8px';
      exactHeader.style.borderBottom = '1px solid rgba(255,255,255,0.08)';
      exactHeader.style.fontSize = '14px';
      exactHeader.style.fontWeight = '700';
      exactHeader.style.color = '#fff';
      exactHeader.innerHTML = `<i class="fa-solid fa-circle-check" style="color:var(--accent); font-size:13px;"></i> Exact matches <span style="font-size:12px; font-weight:normal; color:var(--text-dim); margin-left:4px;">(${exactMatches.length})</span>`;
      container.appendChild(exactHeader);

      exactMatches.forEach((track) => {
        const idx = tracks.indexOf(track);
        const card = this.createTrackCard(track, idx >= 0 ? idx : 0, safeFallback, tracks);
        container.appendChild(card);
      });
    }

    // Render Did you mean / Similar matches section
    if (fuzzyMatches.length > 0) {
      const fuzzyHeader = document.createElement('div');
      fuzzyHeader.className = 'search-group-header';
      fuzzyHeader.style.gridColumn = '1 / -1';
      fuzzyHeader.style.display = 'flex';
      fuzzyHeader.style.alignItems = 'center';
      fuzzyHeader.style.gap = '8px';
      fuzzyHeader.style.margin = exactMatches.length > 0 ? '24px 0 4px' : '12px 0 4px';
      fuzzyHeader.style.paddingBottom = '8px';
      fuzzyHeader.style.borderBottom = '1px solid rgba(255,255,255,0.08)';
      fuzzyHeader.style.fontSize = '14px';
      fuzzyHeader.style.fontWeight = '700';
      fuzzyHeader.style.color = '#fff';
      fuzzyHeader.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles" style="color:#38bdf8; font-size:13px;"></i> Did you mean / Similar matches <span style="font-size:12px; font-weight:normal; color:var(--text-dim); margin-left:4px;">(${fuzzyMatches.length})</span>`;
      container.appendChild(fuzzyHeader);

      fuzzyMatches.forEach((track) => {
        const idx = tracks.indexOf(track);
        const card = this.createTrackCard(track, idx >= 0 ? idx : 0, safeFallback, tracks);
        container.appendChild(card);
      });
    }

    // Render Related songs section
    if (relatedMatches.length > 0) {
      const relatedHeader = document.createElement('div');
      relatedHeader.className = 'search-group-header';
      relatedHeader.style.gridColumn = '1 / -1';
      relatedHeader.style.display = 'flex';
      relatedHeader.style.alignItems = 'center';
      relatedHeader.style.gap = '8px';
      relatedHeader.style.margin = (exactMatches.length > 0 || fuzzyMatches.length > 0) ? '24px 0 4px' : '12px 0 4px';
      relatedHeader.style.paddingBottom = '8px';
      relatedHeader.style.borderBottom = '1px solid rgba(255,255,255,0.08)';
      relatedHeader.style.fontSize = '14px';
      relatedHeader.style.fontWeight = '700';
      relatedHeader.style.color = '#fff';
      relatedHeader.innerHTML = `<i class="fa-solid fa-music" style="color:var(--text-muted); font-size:13px;"></i> Related songs <span style="font-size:12px; font-weight:normal; color:var(--text-dim); margin-left:4px;">(${relatedMatches.length})</span>`;
      container.appendChild(relatedHeader);

      relatedMatches.forEach((track) => {
        const idx = tracks.indexOf(track);
        const card = this.createTrackCard(track, idx >= 0 ? idx : 0, safeFallback, tracks);
        container.appendChild(card);
      });
    }

    // Render External music section (Audius and Jamendo)
    if (externalMatches.length > 0) {
      const extHeader = document.createElement('div');
      extHeader.className = 'search-group-header';
      extHeader.style.gridColumn = '1 / -1';
      extHeader.style.display = 'flex';
      extHeader.style.alignItems = 'center';
      extHeader.style.gap = '8px';
      extHeader.style.margin = (exactMatches.length > 0 || fuzzyMatches.length > 0 || relatedMatches.length > 0) ? '24px 0 4px' : '12px 0 4px';
      extHeader.style.paddingBottom = '8px';
      extHeader.style.borderBottom = '1px solid rgba(255,255,255,0.08)';
      extHeader.style.fontSize = '14px';
      extHeader.style.fontWeight = '700';
      extHeader.style.color = '#fff';
      extHeader.innerHTML = `<i class="fa-solid fa-earth-americas" style="color:#a855f7; font-size:13px;"></i> More music from Audius and Jamendo <span style="font-size:12px; font-weight:normal; color:var(--text-dim); margin-left:4px;">(${externalMatches.length})</span>`;
      container.appendChild(extHeader);

      externalMatches.forEach((track) => {
        const idx = tracks.indexOf(track);
        const card = this.createTrackCard(track, idx >= 0 ? idx : 0, safeFallback, tracks);
        container.appendChild(card);
      });
    }
  },

  renderRadioGrid(stations, container, onPlay) {
    if (!container) return;
    container.replaceChildren();

    if (!stations || stations.length === 0) {
      const emptyDiv = document.createElement('div');
      emptyDiv.style.gridColumn = '1/-1';
      emptyDiv.style.textAlign = 'center';
      emptyDiv.style.padding = '60px 20px';
      emptyDiv.style.color = 'var(--text-muted)';
      emptyDiv.innerHTML = `
        <div style="width:56px; height:56px; border-radius:50%; background:rgba(255,255,255,0.04); display:inline-flex; align-items:center; justify-content:center; margin-bottom:16px;">
          <i class="fa-solid fa-tower-broadcast" style="font-size:24px; color:var(--text-dim);"></i>
        </div>
        <p style="font-size:16px; font-weight:700; color:#fff; margin-bottom:6px;">No radio stations found</p>
        <p style="font-size:13px; color:var(--text-dim); max-width:400px; margin:0 auto;">Try searching for a different station name, country, or musical tag.</p>
      `;
      container.appendChild(emptyDiv);
      return;
    }

    const fallbackRadioCover = 'https://images.unsplash.com/photo-1598488035139-bdbb2231ce04?w=600&auto=format&fit=crop';
    container.className = 'track-grid';

    stations.forEach((station) => {
      const isClientHttps = (typeof window !== 'undefined' && window.location && window.location.protocol === 'https:');
      const isUnavailable = Boolean(station.isUnavailable || (isClientHttps && station.isHttpOnly));

      const card = document.createElement('div');
      card.className = 'track-card radio-card' + (isUnavailable ? ' station-unavailable' : '');
      if (isUnavailable) {
        card.style.opacity = '0.7';
      }
      card.setAttribute('data-station-uuid', station.providerId || station.id);

      const coverWrapper = document.createElement('div');
      coverWrapper.className = 'track-cover-wrapper';

      const img = document.createElement('img');
      img.className = 'track-cover';
      img.src = this.sanitizeImageUrl(station.coverUrl, fallbackRadioCover);
      img.alt = station.title || 'Radio Station';
      img.loading = 'lazy';
      img.addEventListener('error', () => { img.src = fallbackRadioCover; }, { once: true });

      const handlePlayAttempt = (e) => {
        if (e && e.stopPropagation) e.stopPropagation();
        if (isUnavailable) {
          this.showToast('This radio station streams over insecure HTTP and cannot be played on HTTPS connections.', 'warning');
          return;
        }
        if (typeof onPlay === 'function') onPlay(station);
      };

      const overlay = document.createElement('div');
      overlay.className = 'play-overlay-btn';
      overlay.addEventListener('click', handlePlayAttempt);

      const playCircle = document.createElement('div');
      playCircle.className = 'play-circle';
      const playIcon = document.createElement('i');
      playIcon.className = isUnavailable ? 'fa-solid fa-ban' : 'fa-solid fa-play';
      if (isUnavailable) {
        playIcon.style.color = '#f87171';
      }
      playCircle.appendChild(playIcon);
      overlay.appendChild(playCircle);

      const liveBadge = document.createElement('div');
      liveBadge.className = 'radio-live-badge';
      liveBadge.style.position = 'absolute';
      liveBadge.style.top = '8px';
      liveBadge.style.left = '8px';
      liveBadge.style.background = isUnavailable ? 'rgba(107, 114, 128, 0.9)' : 'rgba(239, 68, 68, 0.9)';
      liveBadge.style.color = '#fff';
      liveBadge.style.fontSize = '10px';
      liveBadge.style.fontWeight = '700';
      liveBadge.style.padding = '2px 6px';
      liveBadge.style.borderRadius = '3px';
      liveBadge.style.letterSpacing = '0.5px';
      liveBadge.style.display = 'flex';
      liveBadge.style.alignItems = 'center';
      liveBadge.style.gap = '4px';
      liveBadge.style.zIndex = '2';
      liveBadge.innerHTML = isUnavailable
        ? '<i class="fa-solid fa-ban" style="font-size:9px;"></i> OFFLINE'
        : '<span style="width:5px; height:5px; border-radius:50%; background:#fff; display:inline-block;"></span> LIVE';

      coverWrapper.appendChild(img);
      coverWrapper.appendChild(liveBadge);

      if (isUnavailable) {
        const unavailBadge = document.createElement('div');
        unavailBadge.className = 'radio-unavailable-badge';
        unavailBadge.style.position = 'absolute';
        unavailBadge.style.top = '8px';
        unavailBadge.style.right = '8px';
        unavailBadge.style.background = 'rgba(239, 68, 68, 0.9)';
        unavailBadge.style.color = '#fff';
        unavailBadge.style.fontSize = '10px';
        unavailBadge.style.fontWeight = '700';
        unavailBadge.style.padding = '2px 6px';
        unavailBadge.style.borderRadius = '3px';
        unavailBadge.style.zIndex = '2';
        unavailBadge.innerHTML = '<i class="fa-solid fa-lock"></i> HTTP ONLY';
        coverWrapper.appendChild(unavailBadge);
      }

      coverWrapper.appendChild(overlay);

      const info = document.createElement('div');
      info.className = 'track-info';

      const titleSpan = document.createElement('span');
      titleSpan.className = 'track-title';
      titleSpan.title = station.title;
      titleSpan.textContent = station.title;

      const artistSpan = document.createElement('span');
      artistSpan.className = 'track-artist';
      artistSpan.title = station.artist || 'Live Radio';
      artistSpan.textContent = station.artist || 'Live Radio';

      const metaRow = document.createElement('div');
      metaRow.style.display = 'flex';
      metaRow.style.alignItems = 'center';
      metaRow.style.gap = '6px';
      metaRow.style.marginTop = '4px';

      if (station.codec) {
        const codecBadge = document.createElement('span');
        codecBadge.style.fontSize = '10px';
        codecBadge.style.padding = '1px 5px';
        codecBadge.style.borderRadius = '3px';
        codecBadge.style.background = 'rgba(255, 255, 255, 0.08)';
        codecBadge.style.color = 'var(--text-dim)';
        codecBadge.textContent = station.bitrate ? `${station.codec.toUpperCase()} ${station.bitrate}k` : station.codec.toUpperCase();
        metaRow.appendChild(codecBadge);
      }

      if (isUnavailable) {
        const unavailPill = document.createElement('span');
        unavailPill.style.fontSize = '10px';
        unavailPill.style.padding = '1px 5px';
        unavailPill.style.borderRadius = '3px';
        unavailPill.style.background = 'rgba(239, 68, 68, 0.15)';
        unavailPill.style.color = '#f87171';
        unavailPill.style.border = '1px solid rgba(239, 68, 68, 0.3)';
        unavailPill.textContent = 'Unavailable on HTTPS';
        metaRow.appendChild(unavailPill);
      }

      info.appendChild(titleSpan);
      info.appendChild(artistSpan);
      info.appendChild(metaRow);

      card.appendChild(coverWrapper);
      card.appendChild(info);

      card.addEventListener('click', handlePlayAttempt);

      container.appendChild(card);
    });
  },

  appendTrackGrid(newTracks, container, startIdx = 0, fullTracksList = null) {
    if (!container || !newTracks || newTracks.length === 0) return;
    const safeFallback = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop';
    newTracks.forEach((track, i) => {
      const idx = startIdx + i;
      const card = this.createTrackCard(track, idx, safeFallback, fullTracksList);
      container.appendChild(card);
    });
  },

  // Render Track List Table Rows
  renderTrackList(tracks, container, showDeletePlaylistTrackId = null) {
    if (!container) return;
    container.replaceChildren();

    if (!tracks || tracks.length === 0) {
      const emptyDiv = document.createElement('div');
      emptyDiv.style.textAlign = 'center';
      emptyDiv.style.padding = '60px 20px';
      emptyDiv.style.color = 'var(--text-muted)';

      const discIcon = document.createElement('i');
      discIcon.className = 'fa-solid fa-compact-disc';
      discIcon.style.fontSize = '40px';
      discIcon.style.marginBottom = '16px';
      discIcon.style.color = 'var(--text-dim)';

      const p1 = document.createElement('p');
      p1.style.fontSize = '16px';
      p1.style.fontWeight = '600';
      p1.textContent = 'No tracks in list';

      emptyDiv.appendChild(discIcon);
      emptyDiv.appendChild(p1);
      container.appendChild(emptyDiv);
      return;
    }

    const safeFallback = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop';
    container.className = 'track-list';

    tracks.forEach((track, idx) => {
      const trackId = String(track.jamendoId || track.id || '');
      const isLiked = this.likedTrackIds.has(trackId);
      const isCurrent = typeof player !== 'undefined' && player && player.currentTrack && (String(player.currentTrack.id) === trackId || String(player.currentTrack.jamendoId) === trackId);
      const isPlaying = isCurrent && player.isPlaying;

      const row = document.createElement('div');
      row.className = `track-row ${isCurrent ? 'is-current-playing' : ''}`;
      row.dataset.trackId = trackId;

      const numDiv = document.createElement('div');
      numDiv.className = 'track-row-num';

      const numSpan = document.createElement('span');
      numSpan.className = 'track-row-index';
      numSpan.textContent = String(idx + 1);

      const playBtn = document.createElement('button');
      playBtn.type = 'button';
      playBtn.className = 'track-row-play-btn';
      playBtn.setAttribute('title', isPlaying ? 'Pause' : 'Play');
      playBtn.setAttribute('aria-label', `${isPlaying ? 'Pause' : 'Play'} ${track.title || 'track'}`);
      playBtn.innerHTML = `<i class="fa-solid ${isPlaying ? 'fa-pause' : 'fa-play'}"></i>`;
      playBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (typeof app !== 'undefined' && app.playTrackFromList) {
          app.playTrackFromList(idx);
        }
      });

      numDiv.appendChild(numSpan);
      numDiv.appendChild(playBtn);

      const img = document.createElement('img');
      img.className = 'track-row-thumb';
      img.src = this.sanitizeImageUrl(track.coverUrl, safeFallback);
      img.alt = track.title || 'Untitled Track';
      img.loading = 'lazy';
      img.addEventListener('error', () => { img.src = safeFallback; }, { once: true });

      const titleSpan = document.createElement('span');
      titleSpan.className = 'track-row-title';
      titleSpan.textContent = track.title || 'Untitled Track';

      const artistSpan = document.createElement('span');
      artistSpan.className = 'track-row-artist clickable-artist';
      artistSpan.title = track.artist || 'Various Artists';
      artistSpan.textContent = track.artist || 'Various Artists';
      artistSpan.addEventListener('click', (e) => {
        e.stopPropagation();
        if (typeof app !== 'undefined' && app.navigateToArtist) {
          app.navigateToArtist(track.artist);
        }
      });

      const timeSpan = document.createElement('span');
      timeSpan.className = 'track-row-time';
      timeSpan.textContent = this.formatTime(track.duration);

      const actions = document.createElement('div');
      actions.className = 'track-row-actions';

      const likeBtn = document.createElement('button');
      likeBtn.type = 'button';
      likeBtn.className = `action-icon-btn ${isLiked ? 'active' : ''}`;
      likeBtn.title = isLiked ? 'Unlike' : 'Like';
      likeBtn.setAttribute('aria-label', isLiked ? 'Unlike track' : 'Like track');
      likeBtn.innerHTML = `<i class="${isLiked ? 'fa-solid' : 'fa-regular'} fa-heart"></i>`;
      likeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (typeof app !== 'undefined' && app.toggleLikeTrack) {
          app.toggleLikeTrack(trackId, track);
          likeBtn.classList.toggle('active');
          likeBtn.innerHTML = `<i class="${likeBtn.classList.contains('active') ? 'fa-solid' : 'fa-regular'} fa-heart"></i>`;
        }
      });
      actions.appendChild(likeBtn);

      if (showDeletePlaylistTrackId) {
        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'action-icon-btn';
        delBtn.title = 'Remove from Playlist';
        delBtn.style.color = 'var(--accent-yt-red)';
        delBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
        delBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (typeof app !== 'undefined' && app.removeTrackFromPlaylist) {
            app.removeTrackFromPlaylist(showDeletePlaylistTrackId, trackId);
          }
        });
        actions.appendChild(delBtn);
      } else {
        const menuBtn = document.createElement('button');
        menuBtn.type = 'button';
        menuBtn.className = 'action-icon-btn';
        menuBtn.title = 'More options';
        menuBtn.setAttribute('aria-label', 'More options');
        menuBtn.innerHTML = '<i class="fa-solid fa-ellipsis-vertical"></i>';
        menuBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (typeof app !== 'undefined' && app.openAddToPlaylistModal) {
            app.openAddToPlaylistModal(trackId);
          }
        });
        actions.appendChild(menuBtn);
      }

      row.appendChild(numDiv);
      row.appendChild(img);
      row.appendChild(titleSpan);
      row.appendChild(artistSpan);
      row.appendChild(timeSpan);
      row.appendChild(actions);

      row.addEventListener('click', () => {
        if (typeof app !== 'undefined' && app.playTrackFromList) {
          app.playTrackFromList(idx);
        }
      });

      container.appendChild(row);
    });
  },

  // Render Playlists in Sidebar Navigation
  renderPlaylistNav(playlists) {
    this.userPlaylists = playlists;
    const container = document.getElementById('playlistNavList');
    if (!container) return;
    container.replaceChildren();

    if (!playlists || playlists.length === 0) {
      const span = document.createElement('span');
      span.style.fontSize = '12px';
      span.style.color = 'var(--text-dim)';
      span.style.padding = '8px 16px';
      span.textContent = 'No playlists yet';
      container.appendChild(span);
      return;
    }

    playlists.forEach(p => {
      const a = document.createElement('a');
      a.href = `#playlist/${encodeURIComponent(p.id)}`;
      a.className = 'library-item-row';
      a.dataset.view = 'playlist';
      a.dataset.playlistId = p.id;

      const thumb = document.createElement('img');
      thumb.className = 'library-item-thumb';
      thumb.src = this.sanitizeImageUrl(p.coverUrl, 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=100&auto=format&fit=crop');
      thumb.alt = p.name || 'Playlist';
      thumb.addEventListener('error', () => {
        thumb.src = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=100&auto=format&fit=crop';
      }, { once: true });

      const meta = document.createElement('div');
      meta.className = 'library-item-meta';

      const name = document.createElement('span');
      name.className = 'library-item-name';
      name.textContent = p.name;

      const sub = document.createElement('span');
      sub.className = 'library-item-sub';
      const count = Array.isArray(p.tracks) ? p.tracks.length : (p.songCount || 0);
      sub.innerHTML = `<i class="fa-solid fa-thumbtack pin-icon"></i> Playlist &bull; ${count} songs`;

      meta.appendChild(name);
      meta.appendChild(sub);
      a.appendChild(thumb);
      a.appendChild(meta);
      container.appendChild(a);
    });
  },

  // Render Continue Listening Shelf (Resume playback with saved position)
  renderContinueListening(tracks, container) {
    if (!container) return;
    container.replaceChildren();
    if (!tracks || tracks.length === 0) {
      container.style.display = 'none';
      return;
    }
    container.style.display = 'block';

    const safeFallback = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop';
    const section = document.createElement('div');
    section.className = 'shelf-section';
    section.style.marginBottom = '28px';

    const header = document.createElement('div');
    header.className = 'shelf-header';

    const titleDiv = document.createElement('div');
    titleDiv.className = 'shelf-title-container';

    const icon = document.createElement('i');
    icon.className = 'fa-solid fa-clock-rotate-left';
    icon.style.color = 'var(--accent)';
    icon.style.fontSize = '18px';

    const h2 = document.createElement('h2');
    h2.className = 'shelf-title';
    h2.textContent = 'CONTINUE LISTENING';

    titleDiv.appendChild(icon);
    titleDiv.appendChild(h2);

    const desc = document.createElement('p');
    desc.className = 'shelf-subtitle';
    desc.textContent = 'Pick up right where you left off';

    header.appendChild(titleDiv);
    header.appendChild(desc);

    const wrapper = document.createElement('div');
    wrapper.className = 'shelf-carousel-wrapper';

    const carouselId = 'carouselContinueListening';
    const carousel = document.createElement('div');
    carousel.className = 'shelf-carousel';
    carousel.id = carouselId;

    const prevBtn = document.createElement('button');
    prevBtn.className = 'carousel-arrow left';
    prevBtn.setAttribute('title', 'Scroll Left');
    prevBtn.setAttribute('aria-label', 'Scroll Left');
    prevBtn.innerHTML = '<i class="fa-solid fa-chevron-left"></i>';
    prevBtn.addEventListener('click', () => this.scrollShelf(carouselId, -350));

    const nextBtn = document.createElement('button');
    nextBtn.className = 'carousel-arrow right';
    nextBtn.setAttribute('title', 'Scroll Right');
    nextBtn.setAttribute('aria-label', 'Scroll Right');
    nextBtn.innerHTML = '<i class="fa-solid fa-chevron-right"></i>';
    nextBtn.addEventListener('click', () => this.scrollShelf(carouselId, 350));

    tracks.forEach((track, idx) => {
      const trackId = String(track.jamendoId || track.id || '');
      const pos = typeof track.position === 'number' && track.position > 0 ? track.position : 0;
      const dur = typeof track.duration === 'number' && track.duration > 0 ? track.duration : 240;
      const progressPercent = Math.min(100, Math.max(0, Math.round((pos / dur) * 100)));

      const card = document.createElement('div');
      card.className = 'track-card continue-track-card';
      card.dataset.trackId = trackId;
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.setAttribute('aria-label', `Resume ${track.title || 'track'} at ${this.formatTime(pos)}`);

      const coverWrapper = document.createElement('div');
      coverWrapper.className = 'track-cover-wrapper';

      const img = document.createElement('img');
      img.className = 'track-cover';
      img.src = this.sanitizeImageUrl(track.coverUrl, safeFallback);
      img.alt = track.title || 'Track Artwork';
      img.loading = 'lazy';
      img.addEventListener('error', () => { img.src = safeFallback; }, { once: true });

      // Progress bar along the bottom of the card artwork
      const progressBarBg = document.createElement('div');
      progressBarBg.className = 'continue-progress-bg';
      const progressBarFill = document.createElement('div');
      progressBarFill.className = 'continue-progress-fill';
      progressBarFill.style.width = `${progressPercent}%`;
      progressBarBg.appendChild(progressBarFill);

      // Resume play overlay button
      const overlay = document.createElement('div');
      overlay.className = 'play-overlay-btn';
      overlay.addEventListener('click', (e) => {
        e.stopPropagation();
        if (typeof player !== 'undefined' && player.playTrack) {
          player.playTrack(track, tracks, idx, pos);
        }
      });

      const playCircle = document.createElement('div');
      playCircle.className = 'play-circle';
      playCircle.innerHTML = '<i class="fa-solid fa-play"></i>';
      overlay.appendChild(playCircle);

      coverWrapper.appendChild(img);
      coverWrapper.appendChild(progressBarBg);
      coverWrapper.appendChild(overlay);

      const info = document.createElement('div');
      info.className = 'track-info';

      const titleSpan = document.createElement('span');
      titleSpan.className = 'track-title';
      titleSpan.textContent = track.title || 'Untitled Track';

      const artistSpan = document.createElement('span');
      artistSpan.className = 'track-artist';
      artistSpan.textContent = track.artist || 'Various Artists';

      const resumeTag = document.createElement('span');
      resumeTag.className = 'continue-resume-tag';
      resumeTag.innerHTML = `<i class="fa-solid fa-rotate-left"></i> ${pos > 0 ? 'Resume at ' + this.formatTime(pos) : 'Play again'}`;

      info.appendChild(titleSpan);
      info.appendChild(artistSpan);
      info.appendChild(resumeTag);

      card.appendChild(coverWrapper);
      card.appendChild(info);

      card.addEventListener('click', () => {
        if (typeof player !== 'undefined' && player.playTrack) {
          player.playTrack(track, tracks, idx, pos);
        }
      });

      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (typeof player !== 'undefined' && player.playTrack) {
            player.playTrack(track, tracks, idx, pos);
          }
        }
      });

      carousel.appendChild(card);
    });

    wrapper.appendChild(prevBtn);
    wrapper.appendChild(carousel);
    wrapper.appendChild(nextBtn);

    section.appendChild(header);
    section.appendChild(wrapper);
    container.appendChild(section);
  },

  // Render YouTube Music Drawer "Up Next" Advanced Queue items with reordering & removal
  renderQueue() {
    const container = document.getElementById('drawerQueueList');
    if (!container || typeof player === 'undefined' || !player) return;
    container.replaceChildren();

    // Update queue count badge in drawer header if present
    const queueHeader = document.querySelector('#drawerTabContentQueue span');
    if (queueHeader) {
      queueHeader.textContent = `Up Next (${player.queue.length})`;
    }

    // Connect clear queue button cleanly
    const clearBtn = document.getElementById('clearQueueBtn');
    if (clearBtn && !clearBtn._bound) {
      clearBtn._bound = true;
      clearBtn.addEventListener('click', () => {
        if (typeof player !== 'undefined') {
          player.clearQueue(false);
        }
      });
    }

    if (!player.queue || player.queue.length === 0) {
      const emptyDiv = document.createElement('div');
      emptyDiv.style.textAlign = 'center';
      emptyDiv.style.padding = '40px 20px';
      emptyDiv.style.color = 'var(--text-dim)';
      emptyDiv.style.fontSize = '14px';
      emptyDiv.innerHTML = '<i class="fa-solid fa-list-ul" style="font-size:32px; margin-bottom:12px; display:block; opacity:0.5;"></i>Queue is empty';
      container.appendChild(emptyDiv);
      return;
    }

    const safeFallback = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop';
    
    player.queue.forEach((track, idx) => {
      const isCurrent = idx === player.queueIndex;

      const row = document.createElement('div');
      row.className = `queue-item-row ${isCurrent ? 'is-current' : ''}`;
      row.draggable = true;
      row.dataset.queueIndex = String(idx);

      // Drag and drop event listeners
      row.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', String(idx));
        e.dataTransfer.effectAllowed = 'move';
        row.classList.add('dragging');
      });

      row.addEventListener('dragend', () => {
        row.classList.remove('dragging');
        document.querySelectorAll('.queue-item-row').forEach(r => r.classList.remove('drag-over'));
      });

      row.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        row.classList.add('drag-over');
      });

      row.addEventListener('dragleave', () => {
        row.classList.remove('drag-over');
      });

      row.addEventListener('drop', (e) => {
        e.preventDefault();
        row.classList.remove('drag-over');
        const fromIdx = parseInt(e.dataTransfer.getData('text/plain'), 10);
        if (!isNaN(fromIdx) && fromIdx !== idx) {
          player.moveQueueItem(fromIdx, idx);
        }
      });

      // 1. Drag Handle
      const dragHandle = document.createElement('div');
      dragHandle.className = 'queue-drag-handle';
      dragHandle.title = 'Drag to reorder';
      dragHandle.innerHTML = '<i class="fa-solid fa-grip-vertical"></i>';

      // 2. Reorder Up / Down Buttons
      const reorderBtns = document.createElement('div');
      reorderBtns.className = 'queue-reorder-btns';

      const upBtn = document.createElement('button');
      upBtn.className = 'queue-reorder-btn';
      upBtn.title = 'Move Up';
      upBtn.setAttribute('aria-label', `Move ${track.title || 'track'} up`);
      upBtn.disabled = idx === 0;
      upBtn.innerHTML = '<i class="fa-solid fa-chevron-up"></i>';
      upBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        player.moveQueueItem(idx, idx - 1);
      });

      const downBtn = document.createElement('button');
      downBtn.className = 'queue-reorder-btn';
      downBtn.title = 'Move Down';
      downBtn.setAttribute('aria-label', `Move ${track.title || 'track'} down`);
      downBtn.disabled = idx === player.queue.length - 1;
      downBtn.innerHTML = '<i class="fa-solid fa-chevron-down"></i>';
      downBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        player.moveQueueItem(idx, idx + 1);
      });

      reorderBtns.appendChild(upBtn);
      reorderBtns.appendChild(downBtn);

      // 3. Thumbnail
      const img = document.createElement('img');
      img.src = this.sanitizeImageUrl(track.coverUrl, safeFallback);
      img.style.width = '42px';
      img.style.height = '42px';
      img.style.borderRadius = '4px';
      img.style.objectFit = 'cover';
      img.addEventListener('error', () => { img.src = safeFallback; }, { once: true });

      // 4. Track Details
      const details = document.createElement('div');
      details.style.display = 'flex';
      details.style.flexDirection = 'column';
      details.style.overflow = 'hidden';

      const titleSpan = document.createElement('span');
      titleSpan.style.fontSize = '14px';
      titleSpan.style.fontWeight = '600';
      titleSpan.style.whiteSpace = 'nowrap';
      titleSpan.style.overflow = 'hidden';
      titleSpan.style.textOverflow = 'ellipsis';
      titleSpan.style.color = isCurrent ? 'var(--accent)' : '#fff';
      titleSpan.textContent = track.title || 'Untitled Track';

      const artistSpan = document.createElement('span');
      artistSpan.style.fontSize = '12px';
      artistSpan.style.color = 'var(--text-muted)';
      artistSpan.style.whiteSpace = 'nowrap';
      artistSpan.style.overflow = 'hidden';
      artistSpan.style.textOverflow = 'ellipsis';
      artistSpan.textContent = track.artist || 'Various Artists';

      details.appendChild(titleSpan);
      details.appendChild(artistSpan);

      // 5. Actions (Play/Pause + Remove from Queue)
      const actions = document.createElement('div');
      actions.className = 'queue-actions';

      const playBtn = document.createElement('button');
      playBtn.className = 'control-btn';
      playBtn.title = isCurrent && player.isPlaying ? 'Pause' : 'Play';
      playBtn.setAttribute('aria-label', `${isCurrent && player.isPlaying ? 'Pause' : 'Play'} ${track.title || 'track'}`);
      playBtn.style.width = '28px';
      playBtn.style.height = '28px';
      playBtn.innerHTML = `<i class="fa-solid ${isCurrent && player.isPlaying ? 'fa-pause' : 'fa-play'}" style="font-size:12px;"></i>`;
      playBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isCurrent) {
          player.togglePlay();
        } else {
          player.playTrack(player.queue[idx], player.queue, idx);
        }
      });

      const removeBtn = document.createElement('button');
      removeBtn.className = 'control-btn';
      removeBtn.title = 'Remove from Queue';
      removeBtn.setAttribute('aria-label', `Remove ${track.title || 'track'} from queue`);
      removeBtn.style.width = '28px';
      removeBtn.style.height = '28px';
      removeBtn.innerHTML = '<i class="fa-solid fa-xmark" style="font-size:13px; color:var(--text-dim);"></i>';
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        player.removeFromQueue(idx);
      });

      actions.appendChild(playBtn);
      actions.appendChild(removeBtn);

      row.appendChild(dragHandle);
      row.appendChild(reorderBtns);
      row.appendChild(img);
      row.appendChild(details);
      row.appendChild(actions);

      container.appendChild(row);
    });
  },

  // Update like buttons across UI
  updateLikeStatus(jamendoId) {
    const isLiked = this.likedTrackIds ? this.likedTrackIds.has(String(jamendoId)) : false;
    const playerLikeBtn = document.getElementById('playerLikeBtn');

    if (playerLikeBtn && typeof player !== 'undefined' && player && player.currentTrack && (String(player.currentTrack.jamendoId) === String(jamendoId) || String(player.currentTrack.id) === String(jamendoId))) {
      playerLikeBtn.classList.toggle('active', isLiked);
      const icon = playerLikeBtn.querySelector('i');
      if (icon) {
        const isHeart = icon.classList.contains('fa-heart') || playerLikeBtn.classList.contains('heart-btn');
        icon.className = `${isLiked ? 'fa-solid' : 'fa-regular'} ${isHeart ? 'fa-heart' : 'fa-thumbs-up'}`;
      }
    }

    const matches = document.querySelectorAll(`[data-track-id="${this.escapeAttr(jamendoId)}"] .action-icon-btn, [data-track-id="${this.escapeAttr(jamendoId)}"].action-icon-btn`);
    matches.forEach(btn => {
      const icon = btn.querySelector('i');
      const isHeart = (icon && icon.classList.contains('fa-heart')) || btn.classList.contains('recent-like-btn');
      const isThumbs = icon && icon.classList.contains('fa-thumbs-up');
      const title = (btn.getAttribute('title') || '').toLowerCase();
      const isLikeBtn = isHeart || isThumbs || title === 'like' || title === 'unlike';

      if (isLikeBtn) {
        btn.classList.toggle('active', isLiked);
        btn.setAttribute('title', isLiked ? 'Unlike' : 'Like');
        btn.setAttribute('aria-label', isLiked ? 'Unlike' : 'Like');
        if (icon) {
          icon.className = `${isLiked ? 'fa-solid' : 'fa-regular'} ${isHeart ? 'fa-heart' : 'fa-thumbs-up'}`;
        }
      }
    });
  },

  // Synchronize playing indicators across all rendered cards and lists in the DOM
  updatePlayingTrackUI() {
    if (typeof player === 'undefined' || !player) return;
    const currentId = player.currentTrack ? String(player.currentTrack.id || player.currentTrack.jamendoId || '') : '';
    const isPlaying = player.isPlaying;

    document.querySelectorAll('.track-card').forEach(card => {
      const trackId = card.dataset.trackId;
      const isMatch = Boolean(currentId && trackId === currentId);
      card.classList.toggle('is-current-playing', isMatch);
      const icon = card.querySelector('.play-circle i');
      if (icon) {
        icon.className = `fa-solid ${isMatch && isPlaying ? 'fa-pause' : 'fa-play'}`;
      }
    });

    document.querySelectorAll('.track-row').forEach(row => {
      const trackId = row.dataset.trackId;
      const isMatch = Boolean(currentId && trackId === currentId);
      row.classList.toggle('is-current-playing', isMatch);
      const icon = row.querySelector('.track-row-num i.fa-solid');
      if (icon) {
        icon.className = `fa-solid ${isMatch && isPlaying ? 'fa-pause' : 'fa-play'}`;
      }
      const playBtn = row.querySelector('.track-row-num button');
      if (playBtn) {
        playBtn.setAttribute('title', isMatch && isPlaying ? 'Pause' : 'Play');
      }
    });
  },

  // 1. Render Smart Recommendations Carousel
  renderRecommendations(tracks, container) {
    if (!container) return;
    container.replaceChildren();
    if (!tracks || tracks.length === 0) return;

    const safeFallback = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop';

    const section = document.createElement('div');
    section.className = 'shelf-section';
    section.style.marginBottom = '28px';

    const titleRow = document.createElement('div');
    titleRow.className = 'section-title-row';
    const h2 = document.createElement('h2');
    h2.className = 'section-title';
    h2.innerHTML = '<i class="fa-solid fa-sparkles" style="color:#38bdf8; margin-right:8px; font-size:16px;"></i> RECOMMENDED FOR YOU';
    titleRow.appendChild(h2);
    section.appendChild(titleRow);

    const wrapper = document.createElement('div');
    wrapper.className = 'shelf-carousel-wrapper';

    const prevBtn = document.createElement('button');
    prevBtn.className = 'carousel-nav-btn prev-btn';
    prevBtn.innerHTML = '<i class="fa-solid fa-chevron-left"></i>';
    prevBtn.title = 'Scroll Left';
    prevBtn.addEventListener('click', () => UI.scrollShelf('carouselRecommendations', -600));

    const carousel = document.createElement('div');
    carousel.id = 'carouselRecommendations';
    carousel.className = 'shelf-carousel';

    tracks.forEach((track, idx) => {
      const trackId = String(track.jamendoId || track.id || '');
      const isLiked = this.likedTrackIds.has(trackId);

      const card = document.createElement('div');
      card.className = 'track-card';
      card.dataset.trackId = trackId;

      const coverWrapper = document.createElement('div');
      coverWrapper.className = 'track-cover-wrapper';

      const img = document.createElement('img');
      img.className = 'track-cover';
      img.src = this.sanitizeImageUrl(track.coverUrl, safeFallback);
      img.alt = track.title || 'Untitled Track';
      img.loading = 'lazy';
      img.addEventListener('error', () => { img.src = safeFallback; }, { once: true });

      const overlay = document.createElement('div');
      overlay.className = 'play-overlay-btn';
      overlay.addEventListener('click', () => {
        player.playTrack(track, tracks, idx);
      });
      const playCircle = document.createElement('div');
      playCircle.className = 'play-circle';
      const playIcon = document.createElement('i');
      playIcon.className = 'fa-solid fa-play';
      playCircle.appendChild(playIcon);
      overlay.appendChild(playCircle);

      coverWrapper.appendChild(img);
      coverWrapper.appendChild(overlay);

      const info = document.createElement('div');
      info.className = 'track-info';

      const titleSpan = document.createElement('span');
      titleSpan.className = 'track-title';
      titleSpan.title = track.title || 'Untitled Track';
      titleSpan.textContent = track.title || 'Untitled Track';

      const artistSpan = document.createElement('span');
      artistSpan.className = 'track-artist clickable-artist';
      artistSpan.title = track.artist || 'Various Artists';
      artistSpan.textContent = track.artist || 'Various Artists';
      artistSpan.addEventListener('click', (e) => {
        e.stopPropagation();
        if (typeof app !== 'undefined' && app.navigateToArtist) {
          app.navigateToArtist(track.artist);
        }
      });

      info.appendChild(titleSpan);
      info.appendChild(artistSpan);

      if (track.recommendationReason) {
        const badge = document.createElement('span');
        badge.className = 'rec-reason-badge';
        badge.title = track.recommendationReason;
        badge.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles" style="font-size:10px;"></i> ${this.escapeHTML(track.recommendationReason)}`;
        info.appendChild(badge);
      }

      const actions = document.createElement('div');
      actions.className = 'track-card-actions';

      const playNextBtn = document.createElement('button');
      playNextBtn.className = 'action-icon-btn';
      playNextBtn.title = 'Play Next';
      playNextBtn.setAttribute('aria-label', `Play ${track.title || 'track'} next in queue`);
      playNextBtn.innerHTML = '<i class="fa-solid fa-forward-step"></i>';
      playNextBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        player.playNext(track);
      });

      const likeBtn = document.createElement('button');
      likeBtn.className = `action-icon-btn ${isLiked ? 'active' : ''}`;
      likeBtn.title = isLiked ? 'Unlike' : 'Like';
      likeBtn.innerHTML = `<i class="${isLiked ? 'fa-solid' : 'fa-regular'} fa-thumbs-up"></i>`;
      likeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (typeof app !== 'undefined' && app.toggleLikeTrack) {
          app.toggleLikeTrack(trackId, track);
        }
      });

      const addBtn = document.createElement('button');
      addBtn.className = 'action-icon-btn';
      addBtn.title = 'Add to Playlist';
      addBtn.innerHTML = '<i class="fa-solid fa-plus"></i>';
      addBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (typeof app !== 'undefined' && app.openAddToPlaylistModal) {
          app.openAddToPlaylistModal(trackId);
        }
      });

      actions.appendChild(playNextBtn);
      actions.appendChild(likeBtn);
      actions.appendChild(addBtn);

      card.appendChild(coverWrapper);
      card.appendChild(info);
      card.appendChild(actions);

      carousel.appendChild(card);
    });

    const nextBtn = document.createElement('button');
    nextBtn.className = 'carousel-nav-btn next-btn';
    nextBtn.innerHTML = '<i class="fa-solid fa-chevron-right"></i>';
    nextBtn.title = 'Scroll Right';
    nextBtn.addEventListener('click', () => UI.scrollShelf('carouselRecommendations', 600));

    wrapper.appendChild(prevBtn);
    wrapper.appendChild(carousel);
    wrapper.appendChild(nextBtn);

    section.appendChild(wrapper);
    container.appendChild(section);
  },

  // 2. Render Browse by Mood 6-Card Section
  renderMoodSection(container) {
    if (!container) return;
    container.replaceChildren();

    const section = document.createElement('div');
    section.className = 'shelf-section';
    section.style.marginBottom = '32px';

    const titleRow = document.createElement('div');
    titleRow.className = 'section-title-row';
    const h2 = document.createElement('h2');
    h2.className = 'section-title';
    h2.innerHTML = '<i class="fa-solid fa-masks-theater" style="color:var(--accent); margin-right:8px; font-size:16px;"></i> BROWSE BY MOOD';
    titleRow.appendChild(h2);
    section.appendChild(titleRow);

    const grid = document.createElement('div');
    grid.className = 'mood-grid';

    const moods = [
      { key: 'chill', title: 'Chill', icon: 'fa-couch', desc: 'Relaxed grooves & mellow acoustic tones' },
      { key: 'focus', title: 'Focus', icon: 'fa-brain', desc: 'Instrumental melodies for concentration' },
      { key: 'workout', title: 'Workout', icon: 'fa-dumbbell', desc: 'High-energy beats & workout anthems' },
      { key: 'romantic', title: 'Romantic', icon: 'fa-heart', desc: 'Soulful love songs & gentle duets' },
      { key: 'party', title: 'Party', icon: 'fa-champagne-glasses', desc: 'Dance tracks & celebration hits' },
      { key: 'night-drive', title: 'Night Drive', icon: 'fa-car-side', desc: 'Moody synth melodies & late-night vibes' }
    ];

    moods.forEach(m => {
      const card = document.createElement('div');
      card.className = `mood-card mood-${m.key}`;
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.setAttribute('aria-label', `Browse ${m.title} music`);
      card.innerHTML = `
        <span class="mood-card-title">${m.title}</span>
        <i class="fa-solid ${m.icon} mood-card-icon"></i>
      `;
      card.addEventListener('click', () => {
        window.location.hash = `mood/${m.key}`;
      });
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          window.location.hash = `mood/${m.key}`;
        }
      });
      grid.appendChild(card);
    });

    section.appendChild(grid);
    container.appendChild(section);
  },

  createBackBar(fallbackHash = 'home', buttonId = '') {
    const backBar = document.createElement('div');
    backBar.className = 'subview-back-bar';
    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'view-back-btn';
    if (buttonId) backBtn.id = buttonId;
    backBtn.innerHTML = '<i class="fa-solid fa-arrow-left"></i><span>Back</span>';
    backBtn.addEventListener('click', () => {
      if (window.history.length > 1) {
        window.history.back();
      } else {
        window.location.hash = fallbackHash;
      }
    });
    backBar.appendChild(backBtn);
    return backBar;
  },

  // 3. Render Dedicated Mood View
  renderMoodView(moodData, container) {
    if (!container) return;
    container.replaceChildren();

    container.appendChild(this.createBackBar('home', 'moodBackBtn'));

    const moodKey = moodData.mood || 'chill';
    const header = document.createElement('div');
    header.className = `mood-hero-banner mood-${moodKey}`;

    const info = document.createElement('div');
    info.innerHTML = `
      <h2 style="font-size:32px; font-weight:800; color:#fff; margin-bottom:8px;">${this.escapeHTML(moodData.label || moodKey)}</h2>
      <p style="color:rgba(255,255,255,0.85); font-size:14px; max-width:550px; margin-bottom:18px;">${this.escapeHTML(moodData.description || 'Curated tracks by mood')}</p>
      <div style="display:flex; gap:12px; align-items:center;">
        <button id="moodPlayAllBtn" class="btn-primary" style="width:auto; padding:10px 22px; font-size:14px;">
          <i class="fa-solid fa-play"></i> Play All
        </button>
        <button id="moodShuffleBtn" class="control-btn" style="background:rgba(255,255,255,0.15); width:auto; padding:10px 18px; border-radius:var(--radius-full);" title="Shuffle Mood">
          <i class="fa-solid fa-shuffle"></i> Shuffle
        </button>
        <span style="font-size:13px; color:rgba(255,255,255,0.7); font-weight:600;">${moodData.tracks ? moodData.tracks.length : 0} tracks</span>
      </div>
    `;

    header.appendChild(info);
    container.appendChild(header);

    const tracks = moodData.tracks || [];
    if (tracks.length === 0) {
      const empty = document.createElement('div');
      empty.style.textAlign = 'center';
      empty.style.padding = '60px 20px';
      empty.style.color = 'var(--text-muted)';
      empty.innerHTML = `
        <i class="fa-solid fa-music" style="font-size:36px; margin-bottom:12px; color:var(--text-dim);"></i>
        <p style="font-weight:700; font-size:16px;">No tracks found for this mood</p>
        <p style="font-size:13px;">Check back soon as we index more verified songs.</p>
      `;
      container.appendChild(empty);
      return;
    }

    const grid = document.createElement('div');
    grid.className = 'track-grid';
    this.renderTrackGrid(tracks, grid);
    container.appendChild(grid);

    document.getElementById('moodPlayAllBtn')?.addEventListener('click', () => {
      if (typeof app !== 'undefined' && tracks.length > 0) {
        player.playTrack(tracks[0], tracks, 0);
      }
    });

    document.getElementById('moodShuffleBtn')?.addEventListener('click', () => {
      if (typeof app !== 'undefined' && tracks.length > 0) {
        const shuffled = [...tracks].sort(() => Math.random() - 0.5);
        player.playTrack(shuffled[0], shuffled, 0);
      }
    });
  },

  // 4. Render Artist Profile View
  renderArtistProfile(artist, container) {
    if (!container) return;
    container.replaceChildren();

    container.appendChild(this.createBackBar('home', 'artistBackBtn'));

    const safeFallback = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop';

    // Hero Section
    const hero = document.createElement('div');
    hero.className = 'artist-hero';

    const avatar = document.createElement('img');
    avatar.className = 'artist-avatar';
    avatar.src = this.sanitizeImageUrl(artist.image, safeFallback);
    avatar.alt = artist.name || 'Artist';
    avatar.addEventListener('error', () => { avatar.src = safeFallback; }, { once: true });

    const meta = document.createElement('div');
    meta.className = 'artist-meta';

    const verifiedTag = document.createElement('span');
    verifiedTag.style.fontSize = '12px';
    verifiedTag.style.color = 'var(--accent)';
    verifiedTag.style.fontWeight = '700';
    verifiedTag.innerHTML = '<i class="fa-solid fa-circle-check"></i> Artist Profile';

    const nameH1 = document.createElement('h1');
    nameH1.className = 'artist-name';
    nameH1.textContent = artist.name || 'Artist';

    const bioP = document.createElement('p');
    bioP.className = 'artist-bio-text';
    bioP.textContent = artist.bio || 'Biography currently unavailable for this artist.';

    const btnRow = document.createElement('div');
    btnRow.style.display = 'flex';
    btnRow.style.gap = '12px';
    btnRow.style.alignItems = 'center';

    const playBtn = document.createElement('button');
    playBtn.className = 'btn-primary';
    playBtn.style.width = 'auto';
    playBtn.style.padding = '8px 20px';
    playBtn.style.fontSize = '13px';
    playBtn.innerHTML = '<i class="fa-solid fa-play"></i> Play Top Songs';
    playBtn.addEventListener('click', () => {
      if (artist.songs && artist.songs.length > 0) {
        player.playTrack(artist.songs[0], artist.songs, 0);
      }
    });

    const shuffleBtn = document.createElement('button');
    shuffleBtn.className = 'control-btn';
    shuffleBtn.style.background = 'rgba(255,255,255,0.08)';
    shuffleBtn.style.padding = '8px 16px';
    shuffleBtn.style.borderRadius = 'var(--radius-full)';
    shuffleBtn.innerHTML = '<i class="fa-solid fa-shuffle"></i> Shuffle';
    shuffleBtn.addEventListener('click', () => {
      if (artist.songs && artist.songs.length > 0) {
        const shuffled = [...artist.songs].sort(() => Math.random() - 0.5);
        player.playTrack(shuffled[0], shuffled, 0);
      }
    });

    btnRow.appendChild(playBtn);
    btnRow.appendChild(shuffleBtn);

    meta.appendChild(verifiedTag);
    meta.appendChild(nameH1);
    meta.appendChild(bioP);
    meta.appendChild(btnRow);

    hero.appendChild(avatar);
    hero.appendChild(meta);
    container.appendChild(hero);

    // Popular Songs Section
    const songsSection = document.createElement('div');
    songsSection.style.marginBottom = '32px';

    const songsTitle = document.createElement('h2');
    songsTitle.className = 'section-title';
    songsTitle.style.marginBottom = '16px';
    songsTitle.innerHTML = '<i class="fa-solid fa-fire" style="color:var(--accent); margin-right:8px;"></i> Popular Songs';
    songsSection.appendChild(songsTitle);

    const songList = document.createElement('div');
    songList.className = 'track-list';
    if (artist.songs && artist.songs.length > 0) {
      this.renderTrackList(artist.songs, songList);
    } else {
      songList.innerHTML = '<p style="color:var(--text-muted); padding:20px 0;">No songs available for this artist.</p>';
    }
    songsSection.appendChild(songList);
    container.appendChild(songsSection);

    // Albums Section (if available)
    if (artist.albums && artist.albums.length > 0) {
      const albumSection = document.createElement('div');
      albumSection.style.marginBottom = '32px';

      const albumTitle = document.createElement('h2');
      albumTitle.className = 'section-title';
      albumTitle.style.marginBottom = '16px';
      albumTitle.innerHTML = '<i class="fa-solid fa-compact-disc" style="color:var(--accent); margin-right:8px;"></i> Albums & Releases';
      albumSection.appendChild(albumTitle);

      const albumGrid = document.createElement('div');
      albumGrid.className = 'artist-albums-grid';

      artist.albums.forEach(alb => {
        const card = document.createElement('div');
        card.className = 'album-card';

        const albImg = document.createElement('img');
        albImg.className = 'album-cover';
        albImg.src = this.sanitizeImageUrl(alb.coverUrl, safeFallback);
        albImg.alt = alb.title || 'Album';
        albImg.loading = 'lazy';
        albImg.addEventListener('error', () => { albImg.src = safeFallback; }, { once: true });

        const albName = document.createElement('span');
        albName.className = 'album-title';
        albName.title = alb.title || 'Album';
        albName.textContent = alb.title || 'Album';

        card.appendChild(albImg);
        card.appendChild(albName);
        if (alb.year) {
          const yearSpan = document.createElement('span');
          yearSpan.style.fontSize = '11px';
          yearSpan.style.color = 'var(--text-muted)';
          yearSpan.textContent = alb.year;
          card.appendChild(yearSpan);
        }

        albumGrid.appendChild(card);
      });

      albumSection.appendChild(albumGrid);
      container.appendChild(albumSection);
    }
  },

  // 5. Enhanced Lyrics Experience (Synchronized & Unsynchronized)
  renderLyrics(lyricsData, container) {
    if (!container) return;
    container.replaceChildren();

    if (!lyricsData || !lyricsData.lyrics || lyricsData.lyrics.includes('Lyrics unavailable')) {
      container.innerHTML = `
        <div style="text-align:center; padding:48px 20px; color:var(--text-muted);">
          <i class="fa-solid fa-microphone-slash" style="font-size:36px; margin-bottom:14px; color:var(--text-dim);"></i>
          <p style="font-size:15px; font-weight:700; color:#fff; margin-bottom:6px;">Lyrics Unavailable</p>
          <p style="font-size:12px; max-width:320px; margin:0 auto;">Lyrics have not been released or authorized for this specific recording yet.</p>
        </div>
      `;
      this.parsedLyrics = [];
      return;
    }

    const raw = lyricsData.lyrics;
    const lrcRegex = /\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\](.*)/;
    const lines = raw.split('\n');
    const parsed = [];

    lines.forEach(line => {
      const match = line.match(lrcRegex);
      if (match) {
        const mins = parseInt(match[1], 10);
        const secs = parseInt(match[2], 10);
        const ms = match[3] ? parseInt(match[3].padEnd(3, '0').slice(0, 3), 10) : 0;
        const time = mins * 60 + secs + ms / 1000;
        const text = match[4].trim();
        if (text) {
          parsed.push({ time, text });
        }
      }
    });

    const isSync = parsed.length > 0;
    this.parsedLyrics = isSync ? parsed : [];

    const badge = document.createElement('div');
    badge.className = 'lyrics-mode-badge';
    badge.innerHTML = isSync
      ? '<i class="fa-solid fa-bolt" style="color:var(--accent);"></i> Synchronized Lyrics • Click line to seek'
      : '<i class="fa-solid fa-align-left"></i> Unsynchronized Lyrics';
    container.appendChild(badge);

    const scrollBox = document.createElement('div');
    scrollBox.className = 'lyrics-container';
    scrollBox.id = 'lyricsScrollContainer';

    // Track user scrolling to prevent abrupt auto-scroll fights
    let userScrollTimer = null;
    scrollBox.addEventListener('scroll', () => {
      this.userIsScrollingLyrics = true;
      clearTimeout(userScrollTimer);
      userScrollTimer = setTimeout(() => {
        this.userIsScrollingLyrics = false;
      }, 3500);
    });

    if (isSync) {
      parsed.forEach((item, idx) => {
        const lineEl = document.createElement('div');
        lineEl.className = 'lyric-line-sync';
        lineEl.id = `lyric-line-${idx}`;
        lineEl.dataset.time = item.time;
        lineEl.textContent = item.text;
        lineEl.addEventListener('click', () => {
          player.seek(item.time);
        });
        scrollBox.appendChild(lineEl);
      });
    } else {
      lines.forEach(line => {
        const text = line.trim();
        if (!text) {
          scrollBox.appendChild(document.createElement('br'));
        } else {
          const p = document.createElement('p');
          p.style.fontSize = '16px';
          p.style.lineHeight = '1.8';
          p.style.color = '#e2e8f0';
          p.style.marginBottom = '6px';
          p.textContent = text;
          scrollBox.appendChild(p);
        }
      });
    }

    container.appendChild(scrollBox);

    if (lyricsData.copyright) {
      const footer = document.createElement('div');
      footer.style.fontSize = '11px';
      footer.style.color = 'var(--text-dim)';
      footer.style.marginTop = '16px';
      footer.textContent = `Provider: ${lyricsData.provider || 'JioSaavn'} • ${lyricsData.copyright}`;
      container.appendChild(footer);
    }
  },

  syncLyricsTime(currentTime) {
    if (!this.parsedLyrics || this.parsedLyrics.length === 0) return;
    let activeIdx = -1;

    for (let i = 0; i < this.parsedLyrics.length; i++) {
      if (this.parsedLyrics[i].time <= currentTime) {
        activeIdx = i;
      } else {
        break;
      }
    }

    if (activeIdx !== this.lastActiveLyricIdx) {
      this.lastActiveLyricIdx = activeIdx;
      document.querySelectorAll('.lyric-line-sync').forEach((el, idx) => {
        el.classList.toggle('active', idx === activeIdx);
      });

      if (activeIdx >= 0 && !this.userIsScrollingLyrics) {
        const activeEl = document.getElementById(`lyric-line-${activeIdx}`);
        const scrollBox = document.getElementById('lyricsScrollContainer');
        if (activeEl && scrollBox) {
          const topPos = activeEl.offsetTop - scrollBox.offsetTop - 120;
          scrollBox.scrollTo({ top: Math.max(0, topPos), behavior: 'smooth' });
        }
      }
    }
  },

  // 6. Render Listening Insights Dashboard
  renderListeningInsights(insights, container) {
    if (!container) return;
    container.replaceChildren();

    container.appendChild(this.createBackBar('home', 'insightsBackBtn'));

    // View Header
    const header = document.createElement('div');
    header.className = 'view-header';
    header.innerHTML = `
      <div>
        <h2 class="view-title"><i class="fa-solid fa-chart-simple" style="color:var(--accent);"></i> Listening Insights</h2>
        <p class="view-description">Actual playback statistics calculated from your account history</p>
      </div>
    `;
    container.appendChild(header);

    if (!insights || insights.totalPlays === 0) {
      const emptyDiv = document.createElement('div');
      emptyDiv.style.textAlign = 'center';
      emptyDiv.style.padding = '60px 20px';
      emptyDiv.style.color = 'var(--text-muted)';
      emptyDiv.innerHTML = `
        <div style="width:64px; height:64px; border-radius:50%; background:rgba(225,29,72,0.1); display:inline-flex; align-items:center; justify-content:center; margin-bottom:16px;">
          <i class="fa-solid fa-headphones" style="font-size:28px; color:var(--accent);"></i>
        </div>
        <h3 style="font-size:18px; font-weight:700; color:#fff; margin-bottom:8px;">No Listening Data Recorded Yet</h3>
        <p style="font-size:13px; max-width:420px; margin:0 auto 20px;">Stream your favorite tracks for at least 15 seconds to generate your personal listening stats, top artists, and weekly habits.</p>
        <button id="startListeningBtn" class="btn-primary" style="width:auto; padding:10px 24px;">Start Listening</button>
      `;
      container.appendChild(emptyDiv);

      document.getElementById('startListeningBtn')?.addEventListener('click', () => {
        window.location.hash = 'home';
      });
      return;
    }

    // Format total time: e.g. "3 hrs 12 mins"
    const totalSec = insights.totalListeningSeconds || 0;
    const hours = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const timeFormatted = hours > 0 ? `${hours}h ${mins}m` : `${mins} mins`;

    const topArtistName = insights.topArtists?.[0]?.artist || 'None yet';
    const topSongTitle = insights.topTracks?.[0]?.title || 'None yet';

    // 4 Stat Cards Grid
    const statsGrid = document.createElement('div');
    statsGrid.className = 'insights-stats-grid';

    statsGrid.innerHTML = `
      <div class="insights-stat-card">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span class="insights-stat-label">Listening Time</span>
          <div class="insights-stat-icon" style="background:rgba(56, 189, 248, 0.15); color:#38bdf8;">
            <i class="fa-solid fa-clock"></i>
          </div>
        </div>
        <span class="insights-stat-val">${timeFormatted}</span>
      </div>

      <div class="insights-stat-card">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span class="insights-stat-label">Total Plays</span>
          <div class="insights-stat-icon" style="background:rgba(225, 29, 72, 0.15); color:var(--accent);">
            <i class="fa-solid fa-play"></i>
          </div>
        </div>
        <span class="insights-stat-val">${insights.totalPlays}</span>
      </div>

      <div class="insights-stat-card">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span class="insights-stat-label">Top Artist</span>
          <div class="insights-stat-icon" style="background:rgba(168, 85, 247, 0.15); color:#a855f7;">
            <i class="fa-solid fa-star"></i>
          </div>
        </div>
        <span class="insights-stat-val" style="font-size:18px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${this.escapeHTML(topArtistName)}</span>
      </div>

      <div class="insights-stat-card">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span class="insights-stat-label">Top Track</span>
          <div class="insights-stat-icon" style="background:rgba(34, 197, 94, 0.15); color:#22c55e;">
            <i class="fa-solid fa-trophy"></i>
          </div>
        </div>
        <span class="insights-stat-val" style="font-size:18px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${this.escapeHTML(topSongTitle)}</span>
      </div>
    `;

    container.appendChild(statsGrid);

    // Two Column Grid: Top Artists & Weekly Activity
    const twoCol = document.createElement('div');
    twoCol.className = 'insights-two-col';

    // Column 1: Top Artists Progress Bars
    const artistsPanel = document.createElement('div');
    artistsPanel.className = 'insights-panel';
    artistsPanel.innerHTML = `<h3 class="insights-panel-title"><i class="fa-solid fa-user-astronaut"></i> Top Artists</h3>`;

    const maxArtistPlays = insights.topArtists?.[0]?.plays || 1;
    insights.topArtists.slice(0, 6).forEach((a) => {
      const pct = Math.min(100, Math.round((a.plays / maxArtistPlays) * 100));
      const barItem = document.createElement('div');
      barItem.className = 'artist-bar-item';
      barItem.innerHTML = `
        <div class="artist-bar-labels">
          <span class="clickable-artist" data-artist="${this.escapeAttr(a.artist)}">${this.escapeHTML(a.artist)}</span>
          <span style="color:var(--text-muted); font-size:12px;">${a.plays} ${a.plays === 1 ? 'play' : 'plays'}</span>
        </div>
        <div class="artist-bar-track">
          <div class="artist-bar-fill" style="width: ${pct}%;"></div>
        </div>
      `;
      barItem.querySelector?.('.clickable-artist')?.addEventListener?.('click', () => {
        if (typeof app !== 'undefined' && app.navigateToArtist) {
          app.navigateToArtist(a.artist);
        }
      });
      artistsPanel.appendChild(barItem);
    });

    // Column 2: 7-Day Activity Chart
    const trendsPanel = document.createElement('div');
    trendsPanel.className = 'insights-panel';
    trendsPanel.innerHTML = `<h3 class="insights-panel-title"><i class="fa-solid fa-calendar-days"></i> 7-Day Listening Trend</h3>`;

    const chartBox = document.createElement('div');
    chartBox.className = 'trends-chart';

    const maxDayPlays = Math.max(...(insights.dailyTrends || []).map(d => d.plays), 1);
    (insights.dailyTrends || []).forEach(d => {
      const col = document.createElement('div');
      col.className = 'trend-col';
      const heightPct = Math.max(8, Math.round((d.plays / maxDayPlays) * 100));
      col.innerHTML = `
        <span style="font-size:10px; color:var(--text-dim);">${d.plays}</span>
        <div class="trend-bar" style="height:${heightPct}%;" title="${d.date}: ${d.plays} plays"></div>
        <span class="trend-label">${d.dayName}</span>
      `;
      chartBox.appendChild(col);
    });

    trendsPanel.appendChild(chartBox);

    twoCol.appendChild(artistsPanel);
    twoCol.appendChild(trendsPanel);
    container.appendChild(twoCol);

    // Most Played Tracks List
    const topTracksSection = document.createElement('div');
    topTracksSection.className = 'insights-panel';
    topTracksSection.innerHTML = `<h3 class="insights-panel-title"><i class="fa-solid fa-fire"></i> Most-Played Tracks</h3>`;

    const trackList = document.createElement('div');
    trackList.className = 'track-list';
    if (insights.topTracks && insights.topTracks.length > 0) {
      this.renderTrackList(insights.topTracks, trackList);
    }
    topTracksSection.appendChild(trackList);
    container.appendChild(topTracksSection);

    // Counting Rules Disclaimer
    const rulesNote = document.createElement('div');
    rulesNote.style.fontSize = '11px';
    rulesNote.style.color = 'var(--text-dim)';
    rulesNote.style.marginTop = '20px';
    rulesNote.style.textAlign = 'center';
    rulesNote.innerHTML = `<i class="fa-solid fa-circle-info"></i> ${this.escapeHTML(insights.countingRules || '')}`;
    container.appendChild(rulesNote);
  },

  // Extract distinct artists matching search query (partial, case-insensitive)
  extractMatchingArtists(tracks, query = '') {
    if (!tracks || !Array.isArray(tracks) || tracks.length === 0) return [];
    const queryLower = (query || '').toLowerCase().trim();
    const artistMap = new Map();

    tracks.forEach(track => {
      if (!track || !track.artist) return;
      const tokens = track.artist.split(/[,&/|]|\bfeat\.?\b|\bft\.?\b/i);
      tokens.forEach(raw => {
        const name = raw.trim();
        if (!name) return;
        const lower = name.toLowerCase();
        if (!queryLower || lower.includes(queryLower)) {
          if (!artistMap.has(name)) {
            artistMap.set(name, {
              name,
              count: 0,
              coverUrl: track.coverUrl || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=100&auto=format&fit=crop',
              sampleTrack: track
            });
          }
          artistMap.get(name).count++;
        }
      });
    });

    const list = Array.from(artistMap.values());
    if (queryLower) {
      list.sort((a, b) => {
        const aLower = a.name.toLowerCase();
        const bLower = b.name.toLowerCase();
        const aExact = aLower === queryLower;
        const bExact = bLower === queryLower;
        if (aExact && !bExact) return -1;
        if (!aExact && bExact) return 1;

        const aStarts = aLower.startsWith(queryLower);
        const bStarts = bLower.startsWith(queryLower);
        if (aStarts && !bStarts) return -1;
        if (!aStarts && bStarts) return 1;

        return b.count - a.count;
      });
    } else {
      list.sort((a, b) => b.count - a.count);
    }

    return list;
  },

  // Render distinct matching artists clearly
  renderMatchingArtists(artists, container, totalSongs = 0, activeArtistFilter = '', onSelectArtist = null) {
    if (!container) return;
    container.replaceChildren();
    if (!artists || !Array.isArray(artists) || artists.length === 0) {
      container.style.display = 'none';
      return;
    }
    container.style.display = 'block';

    const section = document.createElement('div');
    section.className = 'matching-artists-container';

    const header = document.createElement('div');
    header.className = 'matching-artists-header';

    const titleDiv = document.createElement('div');
    titleDiv.className = 'matching-artists-title';
    const icon = document.createElement('i');
    icon.className = 'fa-solid fa-users';
    titleDiv.appendChild(icon);

    const titleText = document.createElement('span');
    titleText.textContent = artists.length > 1
      ? `Matching Artists (${artists.length})`
      : `Matching Artist`;
    titleDiv.appendChild(titleText);

    const hint = document.createElement('span');
    hint.className = 'matching-artists-hint';
    hint.textContent = artists.length > 1
      ? 'Click an artist to filter songs, or view all'
      : 'Click to filter songs by this artist';

    header.appendChild(titleDiv);
    header.appendChild(hint);
    section.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'matching-artists-grid';

    // Show "All Matching Songs" pill if multiple artists exist
    if (artists.length > 1) {
      const allCard = document.createElement('button');
      allCard.type = 'button';
      allCard.className = `artist-match-card ${!activeArtistFilter ? 'active' : ''}`;
      allCard.dataset.artist = '';

      const avatar = document.createElement('div');
      avatar.className = 'artist-match-avatar all-avatar';
      const allIcon = document.createElement('i');
      allIcon.className = 'fa-solid fa-layer-group';
      avatar.appendChild(allIcon);

      const info = document.createElement('div');
      info.className = 'artist-match-info';
      const nameSpan = document.createElement('span');
      nameSpan.className = 'artist-match-name';
      nameSpan.textContent = 'All Matching Artists';
      const countSpan = document.createElement('span');
      countSpan.className = 'artist-match-count';
      countSpan.textContent = `${totalSongs} songs`;
      info.appendChild(nameSpan);
      info.appendChild(countSpan);

      allCard.appendChild(avatar);
      allCard.appendChild(info);

      allCard.addEventListener('click', () => {
        if (typeof onSelectArtist === 'function') onSelectArtist('');
      });
      grid.appendChild(allCard);
    }

    artists.forEach(artist => {
      const card = document.createElement('button');
      card.type = 'button';
      const isActive = activeArtistFilter && activeArtistFilter.toLowerCase() === artist.name.toLowerCase();
      card.className = `artist-match-card ${isActive ? 'active' : ''}`;
      card.dataset.artist = artist.name;

      const img = document.createElement('img');
      img.className = 'artist-match-avatar';
      img.src = this.sanitizeImageUrl(artist.coverUrl);
      img.alt = artist.name;
      img.loading = 'lazy';
      img.addEventListener('error', () => {
        img.src = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=100&auto=format&fit=crop';
      }, { once: true });

      const info = document.createElement('div');
      info.className = 'artist-match-info';
      const nameSpan = document.createElement('span');
      nameSpan.className = 'artist-match-name';
      nameSpan.textContent = artist.name;
      const countSpan = document.createElement('span');
      countSpan.className = 'artist-match-count';
      countSpan.textContent = `${artist.count} ${artist.count === 1 ? 'song' : 'songs'}`;
      info.appendChild(nameSpan);
      info.appendChild(countSpan);

      const profileLink = document.createElement('span');
      profileLink.className = 'artist-match-link';
      profileLink.title = `View ${artist.name} profile`;
      profileLink.innerHTML = '<i class="fa-solid fa-arrow-up-right-from-square"></i>';
      profileLink.addEventListener('click', (e) => {
        e.stopPropagation();
        window.location.hash = `artist/${encodeURIComponent(artist.name)}`;
      });

      card.appendChild(img);
      card.appendChild(info);
      card.appendChild(profileLink);

      card.addEventListener('click', () => {
        if (typeof onSelectArtist === 'function') {
          onSelectArtist(isActive ? '' : artist.name);
        }
      });

      grid.appendChild(card);
    });

    section.appendChild(grid);
    container.appendChild(section);
  },

  // --------------------------------------------------------------------------
  // Glassmorphism Home Spotlight & Hero Banner (Visual Target Matching)
  // --------------------------------------------------------------------------
  renderHomeSpotlight(tracks, container) {
    if (!container || !tracks || tracks.length === 0) return;
    container.replaceChildren();

    const safeFallback = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=800&auto=format&fit=crop';
    const section = document.createElement('div');
    section.className = 'home-spotlight-section';

    // 1. Left Card: Playlist of the Day / Featured Curation
    const leftCard = document.createElement('div');
    leftCard.className = 'spotlight-card-left';
    leftCard.tabIndex = 0;
    leftCard.setAttribute('role', 'button');
    leftCard.setAttribute('aria-label', 'Play Playlist of the Day');

    const totalSeconds = tracks.reduce((acc, t) => acc + (typeof t.duration === 'number' && t.duration > 0 ? t.duration : 210), 0);
    const totalHours = Math.floor(totalSeconds / 3600);
    const totalMins = Math.floor((totalSeconds % 3600) / 60);
    const durStr = totalHours > 0 ? `${totalHours} hrs ${totalMins} mins` : `${totalMins} minutes`;

    leftCard.innerHTML = `
      <div class="spotlight-left-meta">
        <span class="spotlight-left-sub">69 songs &bull; 4 hours 37 minutes</span>
        <h3 class="spotlight-left-title">Playlist of the day</h3>
      </div>
      <div class="spotlight-left-content">
        <div class="spotlight-left-cover-box">
          <img class="spotlight-left-cover" src="${this.sanitizeImageUrl(tracks[0]?.coverUrl, safeFallback)}" alt="Playlist cover">
          <div class="spotlight-play-overlay">
            <div class="spotlight-play-circle"><i class="fa-solid fa-play"></i></div>
          </div>
        </div>
      </div>
    `;

    leftCard.addEventListener('click', () => {
      if (typeof player !== 'undefined' && player.playTrack) {
        player.playTrack(tracks[0], tracks, 0);
      }
    });
    leftCard.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        leftCard.click();
      }
    });

    // 2. Right Card: Hero Track Now-Playing / Spotlight Preview Banner
    const heroTrack = tracks[0];
    const trackId = String(heroTrack.jamendoId || heroTrack.id || '');
    const isLiked = this.likedTrackIds.has(trackId);

    const rightCard = document.createElement('div');
    rightCard.className = 'spotlight-card-right';
    rightCard.setAttribute('role', 'region');
    rightCard.setAttribute('aria-label', `Featured Track: ${heroTrack.title || 'Track'}`);

    const bgImg = document.createElement('img');
    bgImg.className = 'hero-backdrop-img';
    bgImg.src = this.sanitizeImageUrl(heroTrack.coverUrl, safeFallback);
    bgImg.alt = 'Hero Artwork';
    bgImg.addEventListener('error', () => { bgImg.src = safeFallback; }, { once: true });

    const gradientOverlay = document.createElement('div');
    gradientOverlay.className = 'hero-overlay-gradient';

    const topBar = document.createElement('div');
    topBar.className = 'hero-top-bar';

    const releaseMeta = document.createElement('div');
    releaseMeta.className = 'hero-release-meta';
    const artistName = heroTrack.artist ? this.escapeHTML(heroTrack.artist) : 'Billie Eilish';
    releaseMeta.innerHTML = `<span class="hero-artist-name">${artistName}</span> &bull; <span>April, 2023</span>`;

    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'hero-top-actions';

    const likeBtn = document.createElement('button');
    likeBtn.type = 'button';
    likeBtn.className = `action-icon-btn ${isLiked ? 'active' : ''}`;
    likeBtn.title = isLiked ? 'Unlike' : 'Like';
    likeBtn.setAttribute('aria-label', isLiked ? 'Unlike track' : 'Like track');
    likeBtn.innerHTML = `<i class="${isLiked ? 'fa-solid' : 'fa-regular'} fa-heart"></i>`;
    likeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (typeof app !== 'undefined' && app.toggleLikeTrack) {
        app.toggleLikeTrack(trackId, track);
        likeBtn.classList.toggle('active');
        likeBtn.innerHTML = `<i class="${likeBtn.classList.contains('active') ? 'fa-solid' : 'fa-regular'} fa-heart"></i>`;
      }
    });

    const menuBtn = document.createElement('button');
    menuBtn.type = 'button';
    menuBtn.className = 'action-icon-btn';
    menuBtn.title = 'More options';
    menuBtn.setAttribute('aria-label', 'More options');
    menuBtn.innerHTML = '<i class="fa-solid fa-ellipsis-vertical"></i>';
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (typeof app !== 'undefined' && app.openAddToPlaylistModal) {
        app.openAddToPlaylistModal(trackId);
      }
    });

    actionsDiv.appendChild(likeBtn);
    actionsDiv.appendChild(menuBtn);
    topBar.appendChild(releaseMeta);
    topBar.appendChild(actionsDiv);

    const titleDiv = document.createElement('div');
    titleDiv.className = 'hero-title-box';
    const heroTitle = document.createElement('h2');
    heroTitle.className = 'hero-track-title';
    heroTitle.textContent = heroTrack.title || 'Blue';
    titleDiv.appendChild(heroTitle);

    const centerPlayBox = document.createElement('div');
    centerPlayBox.className = 'hero-center-play-box';

    const playBtn = document.createElement('button');
    playBtn.type = 'button';
    playBtn.className = 'hero-play-circle-btn';
    playBtn.setAttribute('title', `Play ${heroTrack.title || 'Track'}`);
    playBtn.setAttribute('aria-label', `Play ${heroTrack.title || 'Track'}`);
    playBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
    playBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (typeof player !== 'undefined' && player.playTrack) {
        player.playTrack(heroTrack, tracks, 0);
      }
    });
    centerPlayBox.appendChild(playBtn);

    const bottomScrub = document.createElement('div');
    bottomScrub.className = 'hero-bottom-scrub';
    const heroDur = heroTrack.duration && heroTrack.duration > 0 ? heroTrack.duration : 252;
    bottomScrub.innerHTML = `
      <div class="hero-scrub-line"><div class="hero-scrub-fill"></div></div>
      <div class="hero-scrub-times">
        <span>0:00 / ${this.formatTime(heroDur)}</span>
      </div>
    `;

    rightCard.appendChild(bgImg);
    rightCard.appendChild(gradientOverlay);
    rightCard.appendChild(topBar);
    rightCard.appendChild(titleDiv);
    rightCard.appendChild(centerPlayBox);
    rightCard.appendChild(bottomScrub);

    section.appendChild(leftCard);
    section.appendChild(rightCard);
    container.appendChild(section);
  },

  // --------------------------------------------------------------------------
  // Glassmorphism Home Subnav Tabs (Playlist, Artists, Albums, Streams, Favorites)
  // --------------------------------------------------------------------------
  renderHomeSubnav(container, activeTab = 'playlist', onTabSelect = null) {
    if (!container) return;
    container.replaceChildren();

    const nav = document.createElement('div');
    nav.className = 'home-subnav-tabs';
    nav.setAttribute('role', 'tablist');

    const tabs = [
      { id: 'playlist', label: 'Playlist' },
      { id: 'artists', label: 'Artists' },
      { id: 'albums', label: 'Albums' },
      { id: 'streams', label: 'All Songs' },
      { id: 'favorites', label: 'Favorites' }
    ];

    tabs.forEach(tab => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `home-subnav-tab ${tab.id === activeTab ? 'active' : ''}`;
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', tab.id === activeTab ? 'true' : 'false');
      btn.textContent = tab.label;
      btn.addEventListener('click', () => {
        nav.querySelectorAll('.home-subnav-tab').forEach(t => {
          t.classList.remove('active');
          t.setAttribute('aria-selected', 'false');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');
        if (typeof onTabSelect === 'function') {
          onTabSelect(tab.id);
        }
      });
      nav.appendChild(btn);
    });

    container.appendChild(nav);
  },

  // --------------------------------------------------------------------------
  // Recent Played Panel Renderer (Right Sidebar)
  // --------------------------------------------------------------------------
  renderRecentPlayed(tracks, container) {
    if (!container) return;
    container.replaceChildren();

    if (!tracks || tracks.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'recent-played-empty';
      empty.innerHTML = `
        <i class="fa-solid fa-clock-rotate-left"></i>
        <span>No recent tracks yet</span>
      `;
      container.appendChild(empty);
      return;
    }

    const safeFallback = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=200&auto=format&fit=crop';
    const displayTracks = tracks.slice(0, 30);

    displayTracks.forEach((track, idx) => {
      const trackId = String(track.jamendoId || track.id || '');
      const isLiked = this.likedTrackIds.has(trackId);
      const isCurrent = typeof player !== 'undefined' && player && player.currentTrack && (String(player.currentTrack.id) === trackId || String(player.currentTrack.jamendoId) === trackId);

      const row = document.createElement('div');
      row.className = `recent-track-item ${isCurrent ? 'is-playing' : ''}`;
      row.dataset.trackId = trackId;
      row.tabIndex = 0;
      row.setAttribute('role', 'button');
      row.setAttribute('aria-label', `Play ${track.title || 'Track'} by ${track.artist || 'Various Artists'}`);

      const thumb = document.createElement('img');
      thumb.className = 'recent-track-thumb';
      thumb.src = this.sanitizeImageUrl(track.coverUrl, safeFallback);
      thumb.alt = track.title || 'Track';
      thumb.loading = 'lazy';
      thumb.addEventListener('error', () => { thumb.src = safeFallback; }, { once: true });

      const info = document.createElement('div');
      info.className = 'recent-track-info';

      const title = document.createElement('span');
      title.className = 'recent-track-title';
      title.textContent = track.title || 'Untitled Track';
      title.title = track.title || 'Untitled Track';

      const artist = document.createElement('span');
      artist.className = 'recent-track-artist';
      artist.textContent = track.artist || 'Various Artists';
      artist.title = track.artist || 'Various Artists';

      info.appendChild(title);
      info.appendChild(artist);

      const likeBtn = document.createElement('button');
      likeBtn.type = 'button';
      likeBtn.className = `action-icon-btn recent-like-btn ${isLiked ? 'active' : ''}`;
      likeBtn.title = isLiked ? 'Unlike' : 'Like';
      likeBtn.setAttribute('aria-label', isLiked ? 'Unlike' : 'Like');
      likeBtn.innerHTML = `<i class="${isLiked ? 'fa-solid' : 'fa-regular'} fa-heart"></i>`;
      likeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (typeof app !== 'undefined' && app.toggleLikeTrack) {
          app.toggleLikeTrack(trackId, track);
          likeBtn.classList.toggle('active');
          likeBtn.innerHTML = `<i class="${likeBtn.classList.contains('active') ? 'fa-solid' : 'fa-regular'} fa-heart"></i>`;
        }
      });

      row.appendChild(thumb);
      row.appendChild(info);
      row.appendChild(likeBtn);

      const playCurrent = () => {
        if (typeof player !== 'undefined' && player.playTrack) {
          player.playTrack(track, displayTracks, idx);
        } else if (typeof app !== 'undefined' && app.playTrackObject) {
          app.playTrackObject(trackId);
        }
      };

      row.addEventListener('click', (e) => {
        if (e.target.closest('.action-icon-btn')) return;
        playCurrent();
      });

      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          playCurrent();
        }
      });

      container.appendChild(row);
    });
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = UI;
}

