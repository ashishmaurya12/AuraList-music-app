// Auralist Music - YouTube Music Application Controller
class AppController {
  constructor() {
    this.currentView = 'home';
    this.currentTracks = [];
    this.recentTracks = [];
    this.trackCache = new Map();
    this.catalogTracks = [];
    this.selectedTrackForPlaylist = null;
    this.searchDebounceTimer = null;
    this.currentGenre = 'all';
    this.searchRequestId = 0;
    this.suggestionDebounceTimer = null;
    this.suggestionsVisible = false;
    this.activeSuggestionIndex = -1;
    this.currentSuggestions = [];
    this.profileDropdownVisible = false;

    this.initTheme();
    this.init();
  }

  registerTrack(track) {
    if (!track) return;
    const id = String(track.jamendoId || track.id || '');
    if (id) {
      if (!this.trackCache) this.trackCache = new Map();
      this.trackCache.set(id, track);
      if (track.id) this.trackCache.set(String(track.id), track);
      if (track.jamendoId) this.trackCache.set(String(track.jamendoId), track);
    }
  }

  registerTracks(tracks) {
    if (Array.isArray(tracks)) {
      tracks.forEach(t => this.registerTrack(t));
    }
  }

  initTheme() {
    this.applyTheme('midnight', false);
  }

  applyTheme(theme = 'midnight', save = true) {
    if (save && typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem('auralist_theme', 'midnight');
      } catch (e) {}
    }
    if (typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.setAttribute('data-theme', 'midnight');
    }
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

    this.loadRecentPlayed();
    this.handleRoute();
    window.addEventListener('hashchange', () => this.handleRoute());
  }

  updateUserUI(user) {
    const avatar = document.getElementById('userAvatar');
    if (avatar) {
      const initial = (user && user.name ? user.name : 'U').charAt(0).toUpperCase();
      avatar.textContent = initial;
      if (user && user.name) {
        avatar.setAttribute('title', `${user.name} (${user.email || 'Account'})`);
        avatar.setAttribute('aria-label', `Account menu for ${user.name}`);
      }
    }
  }

  setupEventListeners() {
    // Nav Drawer links
    document.querySelectorAll('.nav-item').forEach(link => {
      link.addEventListener('click', (e) => {
        const view = link.getAttribute('data-view');
        const playlistId = link.getAttribute('data-playlist-id');

        // Auto-close sidebar on mobile after selection
        if (this.isMobileLayout()) {
          this.closeSidebar();
        }

        if (playlistId) {
          window.location.hash = `playlist/${playlistId}`;
        } else if (view) {
          window.location.hash = view;
        }
      });
    });

    // Global Search Input, Mode Toggle, and Clear Button
    this.currentSearchType = 'all';
    const searchInput = document.getElementById('globalSearchInput');
    const searchTypeBtn = document.getElementById('searchTypeBtn');
    const searchTypeMenu = document.getElementById('searchTypeMenu');
    const clearSearchBtn = document.getElementById('clearSearchBtn');

    if (searchTypeBtn && searchTypeMenu) {
      searchTypeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        searchTypeMenu.style.display = searchTypeMenu.style.display === 'none' ? 'flex' : 'none';
      });

      document.addEventListener('click', (e) => {
        if (!e.target.closest('#searchTypeDropdown')) {
          if (searchTypeMenu) searchTypeMenu.style.display = 'none';
        }
      });

      searchTypeMenu.querySelectorAll('.search-type-option').forEach(opt => {
        opt.addEventListener('click', () => {
          const type = opt.dataset.type || 'all';
          this.setSearchType(type);
          searchTypeMenu.style.display = 'none';
        });
      });
    }

    if (clearSearchBtn && searchInput) {
      clearSearchBtn.addEventListener('click', () => {
        searchInput.value = '';
        clearSearchBtn.style.display = 'none';
        this.hideSuggestions();
        this.activeArtistFilter = '';
        this.activeQuery = '';
        this.allSearchResults = [];
        this.currentTracks = [];
        searchInput.focus();

        let targetHash = '#search';
        if (this.currentSearchType && this.currentSearchType !== 'all') {
          targetHash = `#search?type=${encodeURIComponent(this.currentSearchType)}`;
        }
        if (typeof window !== 'undefined') {
          if (window.history && typeof window.history.replaceState === 'function') {
            window.history.replaceState(null, '', window.location.pathname + targetHash);
          } else {
            window.location.hash = targetHash;
          }
        }
        if (this.currentView === 'search') {
          this.loadSearchTracks('', 'all', this.currentSearchType, '');
        }
      });
    }

    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        const val = e.target.value;
        if (clearSearchBtn) {
          clearSearchBtn.style.display = val.trim() ? 'flex' : 'none';
        }

        // Suggestions debounce (faster 200ms for responsive type-ahead)
        clearTimeout(this.suggestionDebounceTimer);
        const trimmed = val.trim();
        if (trimmed.length >= 2) {
          this.suggestionDebounceTimer = setTimeout(() => {
            this.fetchSuggestions(trimmed);
          }, 200);
        } else {
          this.hideSuggestions();
        }

        // Search navigation debounce (350ms)
        clearTimeout(this.searchDebounceTimer);
        this.searchDebounceTimer = setTimeout(() => {
          const query = val.trim();
          if (query) {
            let hash = `search?q=${encodeURIComponent(query)}`;
            if (this.currentSearchType && this.currentSearchType !== 'all') {
              hash += `&type=${encodeURIComponent(this.currentSearchType)}`;
            }
            window.location.hash = hash;
          } else if (this.currentView === 'search') {
            this.activeArtistFilter = '';
            this.activeQuery = '';
            this.allSearchResults = [];
            this.currentTracks = [];
            let targetHash = '#search';
            if (this.currentSearchType && this.currentSearchType !== 'all') {
              targetHash = `#search?type=${encodeURIComponent(this.currentSearchType)}`;
            }
            if (typeof window !== 'undefined' && window.history && typeof window.history.replaceState === 'function') {
              window.history.replaceState(null, '', window.location.pathname + targetHash);
            }
            this.loadSearchTracks('', 'all', this.currentSearchType, '');
          }
        }, 350);
      });

      searchInput.addEventListener('keydown', (e) => {
        if (!this.suggestionsVisible || this.currentSuggestions.length === 0) return;

        if (e.key === 'ArrowDown') {
          e.preventDefault();
          this.activeSuggestionIndex = Math.min(this.activeSuggestionIndex + 1, this.currentSuggestions.length);
          this.highlightSuggestion();
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          this.activeSuggestionIndex = Math.max(this.activeSuggestionIndex - 1, -1);
          this.highlightSuggestion();
        } else if (e.key === 'Enter') {
          if (this.activeSuggestionIndex >= 0) {
            e.preventDefault();
            if (this.activeSuggestionIndex === this.currentSuggestions.length) {
              // "See all results" footer
              this.hideSuggestions();
              const query = searchInput.value.trim();
              if (query) {
                window.location.hash = `search?q=${encodeURIComponent(query)}`;
              }
            } else {
              this.selectSuggestion(this.currentSuggestions[this.activeSuggestionIndex]);
            }
          } else {
            this.hideSuggestions();
          }
        } else if (e.key === 'Escape' || e.key === 'Tab') {
          this.hideSuggestions();
        }
      });

      searchInput.addEventListener('focus', () => {
        if (searchInput.value.trim().length >= 2 && this.currentSuggestions.length > 0) {
          this.showSuggestionsDropdown();
        }
      });

      document.addEventListener('click', (e) => {
        if (!e.target.closest('#globalSearchBar') && !e.target.closest('#searchSuggestionsDropdown')) {
          this.hideSuggestions();
        }
      });
    }

    // Player Bar Controls
    document.getElementById('playerCover')?.addEventListener('click', () => this.toggleFullscreenPlayer());
    document.getElementById('playerTitle')?.addEventListener('click', () => this.toggleFullscreenPlayer());
    document.getElementById('lyricsToggleBtn')?.addEventListener('click', () => this.openFullscreenPlayer('lyrics'));
    document.getElementById('queueToggleBtn')?.addEventListener('click', () => this.openFullscreenPlayer('queue'));
    document.getElementById('expandPlayerBtn')?.addEventListener('click', () => this.toggleFullscreenPlayer());

    // Drawer Controls
    document.getElementById('closeDrawerBtn1')?.addEventListener('click', () => this.toggleFullscreenPlayer(false));
    document.getElementById('closeDrawerBtn2')?.addEventListener('click', () => this.toggleFullscreenPlayer(false));
    document.getElementById('clearQueueBtn')?.addEventListener('click', () => player.clearQueue());

    document.querySelectorAll('.drawer-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const tabName = tab.getAttribute('data-tab');
        if (tabName) this.switchDrawerTab(tabName);
      });
    });

    document.getElementById('playPauseBtn')?.addEventListener('click', () => player.togglePlay());
    document.getElementById('prevBtn')?.addEventListener('click', () => player.prev());
    document.getElementById('nextBtn')?.addEventListener('click', () => player.next());
    document.getElementById('shuffleBtn')?.addEventListener('click', () => player.toggleShuffle());
    document.getElementById('repeatBtn')?.addEventListener('click', () => player.toggleRepeat());
    
    document.getElementById('playerLikeBtn')?.addEventListener('click', () => {
      if (player.currentTrack) {
        this.toggleLikeTrack(player.currentTrack.jamendoId || player.currentTrack.id, player.currentTrack);
      }
    });

    document.getElementById('playerAddToPlaylistBtn')?.addEventListener('click', () => {
      if (player.currentTrack) {
        this.openAddToPlaylistModal(player.currentTrack.jamendoId || player.currentTrack.id, player.currentTrack);
      } else {
        UI.showToast('No track currently playing', 'error');
      }
    });

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
      this.handleLogout();
    });

    // History Navigation Arrows (Back & Forward across pages)
    document.getElementById('navBackBtn')?.addEventListener('click', () => {
      if (typeof window !== 'undefined' && window.history && window.history.length > 1) {
        window.history.back();
      } else if (typeof window !== 'undefined') {
        window.location.hash = 'home';
      }
    });
    document.getElementById('navForwardBtn')?.addEventListener('click', () => {
      if (typeof window !== 'undefined' && window.history) {
        window.history.forward();
      }
    });

    // Toggle Sidebar (Desktop & Mobile)
    document.getElementById('toggleSidebarBtn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleSidebar();
    });

    // Mobile Sidebar Backdrop Overlay Click
    document.getElementById('sidebarOverlay')?.addEventListener('click', () => {
      this.closeSidebar();
    });

    // User Profile Avatar Click -> Dropdown Popover
    document.getElementById('userAvatar')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleProfileDropdown();
    });

    // Outside Click to Dismiss Profile Dropdown
    document.addEventListener('click', (e) => {
      if (this.profileDropdownVisible && !e.target.closest('#userProfileMenuWrapper')) {
        this.toggleProfileDropdown(false);
      }
    });

    // Window Resize Handler to synchronize responsive sidebar & overlay state (RAF throttled)
    let resizeRaf = null;
    window.addEventListener('resize', () => {
      if (resizeRaf) cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(() => {
        const isMobile = this.isMobileLayout();
        const overlay = document.getElementById('sidebarOverlay');
        const sidebar = document.getElementById('appSidebar');
        const container = document.querySelector('.app-container');
        const btn = document.getElementById('toggleSidebarBtn');

        if (!isMobile) {
          if (overlay) {
            overlay.style.display = 'none';
            overlay.classList.remove('active');
            overlay.setAttribute('aria-hidden', 'true');
          }
          if (sidebar) sidebar.classList.remove('open');
          const isCollapsed = sidebar ? sidebar.classList.contains('collapsed') : false;
          if (btn) {
            btn.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
            btn.classList.toggle('active', isCollapsed);
          }
        } else {
          if (container) container.classList.remove('sidebar-collapsed');
          if (sidebar) sidebar.classList.remove('collapsed');
          const isOpen = sidebar ? sidebar.classList.contains('open') : false;
          if (overlay) {
            overlay.style.display = isOpen ? 'block' : 'none';
            overlay.classList.toggle('active', isOpen);
            overlay.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
          }
          if (btn) {
            btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
            btn.classList.toggle('active', isOpen);
          }
        }
      });
    }, { passive: true });

    // Rename Playlist Form
    document.getElementById('renamePlaylistForm')?.addEventListener('submit', (e) => this.handleRenamePlaylist(e));

    document.getElementById('shortcutsHelpBtn')?.addEventListener('click', () => this.openShortcutsModal());

    // Sidebar New Playlist Button
    document.getElementById('sidebarNewPlaylistBtn')?.addEventListener('click', () => this.openCreatePlaylistModal());

    // Promo Enhancer Button (Right Sidebar)
    document.getElementById('promoEnhancerBtn')?.addEventListener('click', () => {
      if (typeof player !== 'undefined' && player.openEnhancerModal) {
        player.openEnhancerModal();
      }
    });

    // Dismiss Promo Card Button
    document.getElementById('promoCloseBtn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const card = document.getElementById('recentPlayedPromoCard');
      if (card) {
        card.style.display = 'none';
      }
    });

    // Header Waveform Spectrum Button
    document.getElementById('headerWaveformBtn')?.addEventListener('click', () => {
      if (typeof player !== 'undefined' && player.openEnhancerModal) {
        player.openEnhancerModal();
      }
    });

    // Library Filter Button & Category Pills
    document.getElementById('libraryFilterBtn')?.addEventListener('click', () => {
      window.location.hash = 'library';
    });

    document.querySelectorAll('.lib-tag-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        document.querySelectorAll('.lib-tag-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        const filter = pill.getAttribute('data-lib-filter');
        if (filter === 'albums') {
          window.location.hash = 'albums';
        } else {
          window.location.hash = 'library';
        }
      });
    });

    // Mood Filter Pills
    document.querySelectorAll('.mood-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        document.querySelectorAll('.mood-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        const mood = pill.getAttribute('data-mood');
        this.handleMoodPillClick(mood);
      });
    });

    // Global Keyboard Shortcuts
    this._boundKeyHandler = (e) => this.handleKeyboardShortcut(e);
    window.addEventListener('keydown', this._boundKeyHandler);

    this.initSettingsModal();
  }

  isMobileLayout() {
    return typeof window !== 'undefined' && window.innerWidth <= 960;
  }

  toggleSidebar(forceOpen = null) {
    const isMobile = this.isMobileLayout();
    const sidebar = document.getElementById('appSidebar');
    const overlay = document.getElementById('sidebarOverlay');
    const btn = document.getElementById('toggleSidebarBtn');
    const container = document.querySelector('.app-container');

    if (isMobile) {
      const currentlyOpen = sidebar ? sidebar.classList.contains('open') : false;
      const shouldOpen = forceOpen !== null ? Boolean(forceOpen) : !currentlyOpen;

      if (sidebar) {
        sidebar.classList.toggle('open', shouldOpen);
        sidebar.classList.remove('collapsed');
      }
      if (container) {
        container.classList.remove('sidebar-collapsed');
      }
      if (overlay) {
        overlay.style.display = shouldOpen ? 'block' : 'none';
        overlay.classList.toggle('active', shouldOpen);
        overlay.setAttribute('aria-hidden', shouldOpen ? 'false' : 'true');
      }
      if (btn) {
        btn.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
        btn.classList.toggle('active', shouldOpen);
      }
    } else {
      // Desktop: collapsed toggles width to 0 and shrinks grid column
      const currentlyCollapsed = sidebar ? sidebar.classList.contains('collapsed') : false;
      const shouldCollapse = forceOpen !== null ? !forceOpen : !currentlyCollapsed;

      if (sidebar) {
        sidebar.classList.toggle('collapsed', shouldCollapse);
        sidebar.classList.remove('open');
      }
      if (container) {
        container.classList.toggle('sidebar-collapsed', shouldCollapse);
      }
      if (overlay) {
        overlay.style.display = 'none';
        overlay.classList.remove('active');
        overlay.setAttribute('aria-hidden', 'true');
      }
      if (btn) {
        btn.setAttribute('aria-expanded', shouldCollapse ? 'false' : 'true');
        btn.classList.toggle('active', shouldCollapse);
      }
    }
  }

  closeSidebar() {
    this.toggleSidebar(false);
  }

  toggleProfileDropdown(forceShow = null) {
    const dropdown = document.getElementById('profileDropdown');
    const avatar = document.getElementById('userAvatar');
    if (!dropdown) return;

    const shouldShow = forceShow !== null ? Boolean(forceShow) : !this.profileDropdownVisible;
    this.profileDropdownVisible = shouldShow;

    if (shouldShow) {
      this.renderProfileDropdown();
      dropdown.style.display = 'block';
      if (avatar) avatar.setAttribute('aria-expanded', 'true');
    } else {
      dropdown.style.display = 'none';
      if (avatar) avatar.setAttribute('aria-expanded', 'false');
    }
  }

  renderProfileDropdown() {
    const dropdown = document.getElementById('profileDropdown');
    if (!dropdown) return;

    const user = typeof API !== 'undefined' && API.getUser ? API.getUser() : null;
    const token = typeof API !== 'undefined' && API.getToken ? API.getToken() : null;
    const isLoggedIn = Boolean(token && user);

    if (isLoggedIn) {
      const initial = (user.name || 'U').charAt(0).toUpperCase();
      const rawName = user.name || 'User';
      const rawEmail = user.email || '';

      const escapeFn = (typeof UI !== 'undefined' && (UI.escapeHTML || UI.escapeHtml))
        ? (UI.escapeHTML || UI.escapeHtml).bind(UI)
        : (s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;'));
      const escapeAttrFn = (typeof UI !== 'undefined' && UI.escapeAttr)
        ? UI.escapeAttr.bind(UI)
        : escapeFn;

      const safeInitial = escapeFn(initial);
      const safeName = escapeFn(rawName);
      const safeEmail = escapeFn(rawEmail);
      const safeNameAttr = escapeAttrFn(rawName);
      const safeEmailAttr = escapeAttrFn(rawEmail);

      dropdown.innerHTML = `
        <div class="profile-dropdown-header">
          <div class="profile-dropdown-avatar">${safeInitial}</div>
          <div class="profile-dropdown-user-info">
            <span class="profile-dropdown-name" title="${safeNameAttr}">${safeName}</span>
            <span class="profile-dropdown-email" title="${safeEmailAttr}">${safeEmail}</span>
            <a href="javascript:void(0)" class="profile-dropdown-account-link" data-action="settings" data-tab="channel">Manage your Google Account</a>
          </div>
        </div>
        <div class="profile-dropdown-menu">
          <div class="profile-plan-pill" style="display:none;" title="Auralist Account (Standard Free)">Auralist Account (Standard Free)</div>
          <!-- Section 1 (Image 2) -->
          <button type="button" class="profile-dropdown-item" data-action="channel" role="menuitem">
            <i class="fa-regular fa-id-badge"></i>
            <span>Create a channel</span>
          </button>
          <button type="button" class="profile-dropdown-item" data-action="premium" role="menuitem">
            <i class="fa-brands fa-youtube" style="color:#ff0000;"></i>
            <span>Get Music Premium</span>
          </button>
          <button type="button" class="profile-dropdown-item" data-action="switch-account" role="menuitem">
            <i class="fa-solid fa-users-rectangle"></i>
            <span style="flex:1;">Switch account</span>
            <i class="fa-solid fa-chevron-right" style="font-size:11px; color:var(--text-dim); margin-left:auto;"></i>
          </button>
          <button type="button" class="profile-dropdown-item logout-item" data-action="logout" title="Log Out" aria-label="Log Out" role="menuitem">
            <i class="fa-solid fa-arrow-right-from-bracket"></i>
            <span>Sign out</span>
          </button>

          <div class="profile-dropdown-divider" role="separator"></div>

          <!-- Section 2 (Image 2) -->
          <button type="button" class="profile-dropdown-item" data-action="upload-music" role="menuitem">
            <i class="fa-solid fa-cloud-arrow-up"></i>
            <span>Upload music</span>
          </button>
          <button type="button" class="profile-dropdown-item" data-action="history" role="menuitem">
            <i class="fa-solid fa-clock-rotate-left"></i>
            <span>History</span>
          </button>
          <button type="button" class="profile-dropdown-item" data-action="settings" data-target="#settings" title="Audio & App Settings" aria-label="Settings" role="menuitem">
            <i class="fa-solid fa-gear"></i>
            <span>Settings</span>
          </button>
          <button type="button" class="profile-dropdown-item" data-action="terms" role="menuitem">
            <i class="fa-regular fa-file-lines"></i>
            <span>Terms and privacy policy</span>
          </button>
          <button type="button" class="profile-dropdown-item" data-action="shortcuts" title="Keyboard Shortcuts" aria-label="Help" role="menuitem">
            <i class="fa-regular fa-circle-question"></i>
            <span>Help</span>
          </button>
          <button type="button" class="profile-dropdown-item" data-action="feedback" role="menuitem">
            <i class="fa-regular fa-message"></i>
            <span>Send feedback</span>
          </button>
          <button type="button" class="profile-dropdown-item" data-action="enhancer" role="menuitem" style="display:none;" title="Studio DSP Equalizer">
            <i class="fa-solid fa-sliders"></i>
            <span>Studio DSP Equalizer</span>
          </button>
        </div>
      `;

      // In environments with full DOM querySelector, set textContent to ensure text-only rendering
      if (typeof dropdown.querySelector === 'function') {
        const avatarEl = dropdown.querySelector('.profile-dropdown-avatar');
        const nameEl = dropdown.querySelector('.profile-dropdown-name');
        const emailEl = dropdown.querySelector('.profile-dropdown-email');
        if (avatarEl) avatarEl.textContent = initial;
        if (nameEl) {
          nameEl.textContent = rawName;
          nameEl.title = rawName;
        }
        if (emailEl) {
          emailEl.textContent = rawEmail;
          emailEl.title = rawEmail;
        }
      }
    } else {
      dropdown.innerHTML = `
        <div class="profile-dropdown-menu">
          <a href="/login" class="profile-dropdown-item" role="menuitem">
            <i class="fa-solid fa-arrow-right-to-bracket"></i>
            <span>Sign In</span>
          </a>
          <a href="/register" class="profile-dropdown-item" role="menuitem">
            <i class="fa-solid fa-user-plus"></i>
            <span>Create Account</span>
          </a>
          <div class="profile-dropdown-divider" role="separator"></div>
          <button type="button" class="profile-dropdown-item" data-action="settings" data-target="#settings" title="Audio & App Settings" role="menuitem">
            <i class="fa-solid fa-gear"></i>
            <span>Settings</span>
          </button>
          <button type="button" class="profile-dropdown-item" data-action="terms" role="menuitem">
            <i class="fa-regular fa-file-lines"></i>
            <span>Terms and privacy policy</span>
          </button>
          <button type="button" class="profile-dropdown-item" data-action="shortcuts" title="Keyboard Shortcuts" role="menuitem">
            <i class="fa-regular fa-circle-question"></i>
            <span>Help</span>
          </button>
          <button type="button" class="profile-dropdown-item" data-action="feedback" role="menuitem">
            <i class="fa-regular fa-message"></i>
            <span>Send feedback</span>
          </button>
        </div>
      `;
    }

    // Attach item listeners inside dropdown
    dropdown.querySelectorAll('.profile-dropdown-item, .profile-dropdown-account-link').forEach(item => {
      item.addEventListener('click', () => {
        const action = item.getAttribute('data-action');
        const target = item.getAttribute('data-target');

        this.toggleProfileDropdown(false);

        if (action === 'route' && target) {
          window.location.hash = target;
        } else if (action === 'history') {
          window.location.hash = 'history';
        } else if (action === 'settings') {
          const tab = item.getAttribute('data-tab') || 'general';
          this.openSettingsModal(tab);
        } else if (action === 'premium') {
          this.openPremiumModal();
        } else if (action === 'channel') {
          this.openChannelModal();
        } else if (action === 'switch-account') {
          this.openSwitchAccountModal();
        } else if (action === 'upload-music') {
          this.openUploadMusicModal();
        } else if (action === 'terms') {
          this.openSettingsModal('privacy');
        } else if (action === 'feedback') {
          this.openFeedbackModal();
        } else if (action === 'enhancer') {
          if (typeof player !== 'undefined' && typeof player.openEnhancerModal === 'function') {
            player.openEnhancerModal();
          }
        } else if (action === 'shortcuts') {
          this.openShortcutsModal();
        } else if (action === 'logout') {
          this.handleLogout();
        }
      });
    });
  }

  handleLogout() {
    if (typeof API !== 'undefined' && API.clearAuth) {
      API.clearAuth();
    }
    if (typeof window !== 'undefined') {
      window.location.href = '/login';
    }
  }

  handleKeyboardShortcut(e) {
    if (!e) return;
    const targetTag = (e.target?.tagName || '').toLowerCase();
    const isInput = targetTag === 'input' || targetTag === 'textarea' || targetTag === 'select' || Boolean(e.target?.isContentEditable);

    // Escape always closes open modals, profile dropdown, sidebar, and fullscreen drawer
    if (e.key === 'Escape') {
      if (typeof this.closeModals === 'function') this.closeModals();
      if (typeof this.toggleFullscreenPlayer === 'function') this.toggleFullscreenPlayer(false);
      if (typeof this.toggleProfileDropdown === 'function') this.toggleProfileDropdown(false);
      if (typeof this.closeSidebar === 'function') {
        this.closeSidebar();
      } else if (typeof document !== 'undefined') {
        document.getElementById('appSidebar')?.classList.remove('open');
      }
      return;
    }

    // Do not trigger player shortcuts if the user is typing into an input
    if (isInput) return;

    if (e.code === 'Space') {
      if (typeof e.preventDefault === 'function') e.preventDefault();
      if (typeof player !== 'undefined' && player.togglePlay) player.togglePlay();
    } else if (e.key === 'ArrowRight') {
      if (typeof e.preventDefault === 'function') e.preventDefault();
      if (typeof player !== 'undefined' && player.seek) {
        const rawCurrent = player.audio && player.audio.currentTime;
        const current = (typeof rawCurrent === 'number' && Number.isFinite(rawCurrent) && rawCurrent >= 0) ? rawCurrent : 0;
        const rawDur = player.audio && player.audio.duration;
        const hasValidDuration = typeof rawDur === 'number' && Number.isFinite(rawDur) && rawDur > 0;
        let target = current + 5;
        if (hasValidDuration) {
          target = Math.min(Math.max(0, rawDur - 0.5), target);
        }
        player.seek(Math.max(0, target));
      }
    } else if (e.key === 'ArrowLeft') {
      if (typeof e.preventDefault === 'function') e.preventDefault();
      if (typeof player !== 'undefined' && player.seek) {
        const rawCurrent = player.audio && player.audio.currentTime;
        const current = (typeof rawCurrent === 'number' && Number.isFinite(rawCurrent) && rawCurrent >= 0) ? rawCurrent : 0;
        player.seek(Math.max(0, current - 5));
      }
    } else if (e.key === '/') {
      if (typeof e.preventDefault === 'function') e.preventDefault();
      const sInput = typeof document !== 'undefined' ? document.getElementById('globalSearchInput') : null;
      if (sInput) {
        if (typeof sInput.focus === 'function') sInput.focus();
        if (typeof sInput.select === 'function') sInput.select();
      }
    } else if (e.key === 'm' || e.key === 'M') {
      if (typeof e.preventDefault === 'function') e.preventDefault();
      if (typeof player !== 'undefined' && player.toggleMute) player.toggleMute();
    } else if (e.key === 'n' || e.key === 'N') {
      if (typeof e.preventDefault === 'function') e.preventDefault();
      if (typeof player !== 'undefined' && player.next) player.next();
    } else if (e.key === 'p' || e.key === 'P') {
      if (typeof e.preventDefault === 'function') e.preventDefault();
      if (typeof player !== 'undefined' && player.prev) player.prev();
    } else if (e.key === '?' || (e.shiftKey && e.key === '/')) {
      if (typeof e.preventDefault === 'function') e.preventDefault();
      this.openShortcutsModal();
    }
  }

  setSearchType(type = 'all') {
    this.currentSearchType = type;
    const searchTypeLabel = document.getElementById('searchTypeLabel');
    if (searchTypeLabel) {
      searchTypeLabel.textContent = type === 'artist' ? 'Artists' : type === 'song' ? 'Songs' : 'All';
    }

    document.querySelectorAll('.search-type-option').forEach(opt => {
      opt.classList.toggle('active', opt.dataset.type === type);
    });

    const searchInput = document.getElementById('globalSearchInput');
    if (searchInput) {
      if (type === 'artist') {
        searchInput.placeholder = 'Search songs by artist name (e.g. Arijit Singh)...';
      } else if (type === 'song') {
        searchInput.placeholder = 'Search songs by title...';
      } else {
        searchInput.placeholder = 'Search songs, artists, albums...';
      }

      const query = searchInput.value.trim();
      if (query) {
        let hash = `search?q=${encodeURIComponent(query)}`;
        if (type !== 'all') hash += `&type=${encodeURIComponent(type)}`;
        window.location.hash = hash;
      }
    }
  }

  // Type-ahead Search Suggestions
  async fetchSuggestions(query) {
    if (!query || query.length < 2) {
      this.hideSuggestions();
      return;
    }

    const dropdown = document.getElementById('searchSuggestionsDropdown');
    if (!dropdown) return;

    dropdown.style.display = 'block';
    dropdown.innerHTML = '<div class="suggestions-loading"><i class="fa-solid fa-spinner fa-spin"></i> Searching suggestions...</div>';
    this.suggestionsVisible = true;

    try {
      const suggestions = await API.get(`/music/suggestions?q=${encodeURIComponent(query)}&limit=10`);

      // Verify query is still current
      const currentInput = document.getElementById('globalSearchInput');
      if (!currentInput || currentInput.value.trim() !== query) return;

      this.currentSuggestions = suggestions || [];
      this.activeSuggestionIndex = -1;
      this.renderSuggestions(this.currentSuggestions, query);
    } catch (err) {
      const currentInput = document.getElementById('globalSearchInput');
      if (!currentInput || currentInput.value.trim() !== query) return;
      dropdown.innerHTML = '<div class="suggestions-no-results"><i class="fa-solid fa-circle-exclamation"></i> Error loading suggestions</div>';
    }
  }

  renderSuggestions(suggestions, query) {
    const dropdown = document.getElementById('searchSuggestionsDropdown');
    if (!dropdown) return;

    dropdown.innerHTML = '';

    if (!suggestions || suggestions.length === 0) {
      dropdown.innerHTML = `<div class="suggestions-no-results">
        <i class="fa-solid fa-magnifying-glass" style="font-size:18px; margin-bottom:4px;"></i>
        No suggestions for "${UI.escapeHTML(query)}"
      </div>`;
      dropdown.style.display = 'block';
      this.suggestionsVisible = true;
      return;
    }

    const safeFallback = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=100&auto=format&fit=crop';

    suggestions.forEach((item, idx) => {
      const row = document.createElement('div');
      row.className = 'search-suggestion-item';
      row.dataset.index = idx;
      row.id = `search-suggestion-item-${idx}`;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', 'false');

      const iconDiv = document.createElement('div');
      if (item.type === 'artist') {
        iconDiv.className = 'suggestion-icon artist-icon';
        iconDiv.innerHTML = '<i class="fa-solid fa-user"></i>';
      } else if (item.type === 'album') {
        iconDiv.className = 'suggestion-icon album-icon';
        iconDiv.innerHTML = '<i class="fa-solid fa-compact-disc"></i>';
      } else if (item.type === 'mood') {
        iconDiv.className = 'suggestion-icon mood-icon';
        iconDiv.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles" style="color:#ec4899;"></i>';
      } else {
        iconDiv.className = 'suggestion-icon';
        if (item.coverUrl) {
          const img = document.createElement('img');
          img.src = UI.sanitizeImageUrl(item.coverUrl, safeFallback);
          img.alt = item.text || '';
          img.loading = 'lazy';
          img.addEventListener('error', () => { img.src = safeFallback; }, { once: true });
          iconDiv.innerHTML = '';
          iconDiv.appendChild(img);
        } else {
          iconDiv.innerHTML = '<i class="fa-solid fa-music"></i>';
        }
      }

      const infoDiv = document.createElement('div');
      infoDiv.className = 'suggestion-info';

      const titleSpan = document.createElement('span');
      titleSpan.className = 'suggestion-title';
      titleSpan.textContent = item.text || '';
      infoDiv.appendChild(titleSpan);

      if (item.type === 'artist' && item.count) {
        const sub = document.createElement('span');
        sub.className = 'suggestion-subtitle';
        sub.textContent = `${item.count} ${item.count === 1 ? 'song' : 'songs'} in catalog`;
        infoDiv.appendChild(sub);
      } else if (item.artist) {
        const sub = document.createElement('span');
        sub.className = 'suggestion-subtitle';
        sub.textContent = item.artist;
        infoDiv.appendChild(sub);
      }

      const badge = document.createElement('span');
      if (item.type === 'artist') {
        badge.className = 'suggestion-type-badge artist-badge';
        badge.textContent = 'Artist';
      } else if (item.type === 'album') {
        badge.className = 'suggestion-type-badge album-badge';
        badge.textContent = 'Album';
      } else if (item.type === 'mood') {
        badge.className = 'suggestion-type-badge mood-badge';
        badge.textContent = 'Mood';
      } else {
        badge.className = 'suggestion-type-badge track-badge';
        badge.textContent = 'Song';
      }

      row.appendChild(iconDiv);
      row.appendChild(infoDiv);

      // Duration for tracks
      if (item.type === 'track' && item.duration) {
        const dur = document.createElement('span');
        dur.className = 'suggestion-duration';
        dur.textContent = UI.formatTime(item.duration);
        row.appendChild(dur);
      }

      row.appendChild(badge);

      // Play button for playable tracks
      if (item.type === 'track' && (item.audioUrl || item.id)) {
        const playBtn = document.createElement('button');
        playBtn.type = 'button';
        playBtn.className = 'action-icon-btn';
        playBtn.style.padding = '4px 8px';
        playBtn.style.fontSize = '12px';
        playBtn.style.color = 'var(--accent)';
        playBtn.title = `Play ${item.text}`;
        playBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
        playBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.playSuggestionTrack(item);
        });
        row.appendChild(playBtn);
      }

      row.addEventListener('click', () => {
        this.selectSuggestion(item);
      });

      dropdown.appendChild(row);
    });

    // "See all results" footer
    const footer = document.createElement('div');
    footer.className = 'suggestions-footer';
    footer.id = 'search-suggestion-footer';
    footer.setAttribute('role', 'option');
    footer.setAttribute('aria-selected', 'false');
    footer.innerHTML = `<i class="fa-solid fa-magnifying-glass"></i> See all results for "${UI.escapeHTML(query)}"`;
    footer.addEventListener('click', () => {
      this.hideSuggestions();
      const searchInput = document.getElementById('globalSearchInput');
      const q = searchInput ? searchInput.value.trim() : query;
      if (q) {
        window.location.hash = `search?q=${encodeURIComponent(q)}`;
      }
    });
    dropdown.appendChild(footer);

    dropdown.style.display = 'block';
    this.suggestionsVisible = true;
  }

  async playSuggestionTrack(item) {
    this.hideSuggestions();
    const searchInput = document.getElementById('globalSearchInput');
    if (searchInput) searchInput.value = item.text;

    let trackToPlay = {
      id: item.id,
      jamendoId: item.id,
      title: item.text,
      artist: item.artist || 'Various Artists',
      coverUrl: item.coverUrl || '',
      audioUrl: item.audioUrl || '',
      duration: item.duration || 0
    };

    if (!trackToPlay.audioUrl && item.id) {
      try {
        const resolved = await API.get(`/music/track/${item.id}`);
        if (resolved && resolved.audioUrl) {
          trackToPlay = resolved;
        }
      } catch (err) {
        console.warn('[App] Could not resolve stream for suggestion:', err.message);
      }
    }

    if (trackToPlay.audioUrl && typeof player !== 'undefined' && player.playTrack) {
      player.playTrack(trackToPlay, [trackToPlay], 0);
    } else {
      window.location.hash = `search?q=${encodeURIComponent(item.text)}`;
    }
  }

  selectSuggestion(item) {
    this.hideSuggestions();
    const searchInput = document.getElementById('globalSearchInput');

    if (item.type === 'artist') {
      if (searchInput) searchInput.value = item.text;
      window.location.hash = `search?q=${encodeURIComponent(item.text)}&type=artist`;
    } else if (item.type === 'album' || item.type === 'mood') {
      if (searchInput) searchInput.value = item.text;
      window.location.hash = `search?q=${encodeURIComponent(item.text)}`;
    } else if (item.type === 'track') {
      this.playSuggestionTrack(item);
    }
  }

  highlightSuggestion() {
    const dropdown = document.getElementById('searchSuggestionsDropdown');
    const input = document.getElementById('globalSearchInput');
    if (!dropdown) return;

    const items = dropdown.querySelectorAll('.search-suggestion-item');
    const footer = dropdown.querySelector('.suggestions-footer');

    items.forEach((el, i) => {
      const isActive = i === this.activeSuggestionIndex;
      el.classList.toggle('active', isActive);
      el.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    const isFooterActive = this.activeSuggestionIndex === this.currentSuggestions.length;
    if (footer) {
      footer.classList.toggle('active', isFooterActive);
      footer.setAttribute('aria-selected', isFooterActive ? 'true' : 'false');
    }

    const activeEl = this.activeSuggestionIndex >= 0 && this.activeSuggestionIndex < items.length
      ? items[this.activeSuggestionIndex]
      : (isFooterActive ? footer : null);

    if (input) {
      if (activeEl && activeEl.id) {
        input.setAttribute('aria-activedescendant', activeEl.id);
      } else {
        input.removeAttribute('aria-activedescendant');
      }
    }

    if (activeEl && typeof activeEl.scrollIntoView === 'function') {
      activeEl.scrollIntoView({ block: 'nearest' });
    }
  }

  showSuggestionsDropdown() {
    const dropdown = document.getElementById('searchSuggestionsDropdown');
    const input = document.getElementById('globalSearchInput');
    if (dropdown && this.currentSuggestions.length > 0) {
      dropdown.style.display = 'block';
      this.suggestionsVisible = true;
      if (input) {
        input.setAttribute('aria-expanded', 'true');
      }
    }
  }

  hideSuggestions() {
    const dropdown = document.getElementById('searchSuggestionsDropdown');
    const input = document.getElementById('globalSearchInput');
    if (dropdown) {
      dropdown.style.display = 'none';
    }
    this.suggestionsVisible = false;
    this.activeSuggestionIndex = -1;
    if (input) {
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
    }
  }

  // Routing Handler
  handleRoute() {
    this.hideSuggestions();
    this.toggleProfileDropdown(false);
    if (typeof this.toggleFullscreenPlayer === 'function') {
      this.toggleFullscreenPlayer(false);
    }
    if (this.isMobileLayout()) {
      this.closeSidebar();
    }
    const hash = window.location.hash.replace('#', '') || 'home';
    
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));

    if (hash.startsWith('playlist/')) {
      const playlistId = hash.split('/')[1];
      this.currentView = 'playlist';
      this.loadPlaylistView(playlistId);
      const activeNav = document.querySelector(`[data-playlist-id="${playlistId}"]`);
      if (activeNav) activeNav.classList.add('active');
    } else if (hash.startsWith('mood/')) {
      const moodKey = hash.split('/')[1];
      this.currentView = 'mood';
      this.loadMoodView(moodKey);
    } else if (hash.startsWith('artist/')) {
      const artistQuery = decodeURIComponent(hash.slice(7));
      this.currentView = 'artist';
      this.loadArtistView(artistQuery);
    } else if (hash.startsWith('search')) {
      this.currentView = 'search';
      const activeNav = document.querySelector(`[data-view="search"]`);
      if (activeNav) activeNav.classList.add('active');

      const urlParams = new URLSearchParams(hash.includes('?') ? hash.split('?')[1] : '');
      const query = urlParams.get('q') || '';
      const genre = urlParams.get('genre') || this.currentGenre;
      const type = urlParams.get('type') || this.currentSearchType || 'all';
      const artist = urlParams.get('artist') || '';

      this.currentSearchType = type;
      this.activeArtistFilter = artist;

      const searchInput = document.getElementById('globalSearchInput');
      if (searchInput && (query || artist)) {
        searchInput.value = query || artist;
        const clearBtn = document.getElementById('clearSearchBtn');
        if (clearBtn) clearBtn.style.display = 'flex';
      }
      const searchTypeLabel = document.getElementById('searchTypeLabel');
      if (searchTypeLabel) {
        searchTypeLabel.textContent = type === 'artist' ? 'Artists' : type === 'song' ? 'Songs' : 'All';
      }

      this.loadSearchTracks(query, genre, type, artist);
    } else {
      this.currentView = hash;
      const activeNav = document.querySelector(`[data-view="${hash}"]`);
      if (activeNav) activeNav.classList.add('active');

      if (hash === 'albums') {
        document.querySelectorAll('.lib-tag-pill').forEach(p => p.classList.toggle('active', p.getAttribute('data-lib-filter') === 'albums'));
      } else if (hash === 'library') {
        document.querySelectorAll('.lib-tag-pill').forEach(p => p.classList.toggle('active', p.getAttribute('data-lib-filter') === 'playlists'));
      }

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
        case 'albums':
          this.loadAlbumsView();
          break;
        case 'catalog':
          this.loadCatalogView();
          break;
        case 'radio':
          this.loadRadioView();
          break;
        case 'liked':
          this.loadLikedTracksView();
          break;
        case 'history':
          this.loadHistoryView();
          break;
        case 'insights':
          this.loadInsightsView();
          break;
        case 'settings':
          this.loadSettingsView();
          break;
        default:
          this.loadHomeView();
          break;
      }
    }
  }

  // View Loader: HOME PAGE
  async loadHomeView() {
    const container = document.getElementById('mainView');
    container.innerHTML = `
      <div id="homeSpotlightBox"></div>
      <div id="homeSubnavBox"></div>
      <div id="homeTrackListBox"></div>
      <div id="continueListeningBox"></div>
      <div id="recommendationsBox"></div>
      <div id="quickPicksBox"></div>
      <div id="moodsBox"></div>
      <div id="shelfTrending"></div>
      <div id="shelfBollywood"></div>
      <div id="shelfHollywood"></div>
      <div id="shelfPunjabi"></div>
      <div id="shelfRomantic"></div>
    `;

    try {
      // 0. Fetch Continue Listening tracks (persisted history with playback positions)
      if (API.getToken()) {
        try {
          const continueTracks = await API.get('/history/continue');
          if (Array.isArray(continueTracks) && continueTracks.length > 0) {
            UI.renderContinueListening(continueTracks, document.getElementById('continueListeningBox'));
          }
        } catch (e) {
          console.warn('[App] Could not load continue listening tracks:', e.message);
        }
      }

      // 1. Fetch Smart Recommendations (rule-based personalized tracks with reasons)
      try {
        const recTracks = await API.get('/music/recommendations?limit=15');
        if (Array.isArray(recTracks) && recTracks.length > 0) {
          UI.renderRecommendations(recTracks, document.getElementById('recommendationsBox'));
        }
      } catch (e) {
        console.warn('[App] Could not load recommendations:', e.message);
      }

      // 2. Fetch trending tracks for Spotlight, Subnav, Quick Picks & Shelf 1
      const trendingTracks = await API.get('/music/trending');
      this.currentTracks = trendingTracks;

      // Render Hero Spotlight & Subnav matching visual target
      if (Array.isArray(trendingTracks) && trendingTracks.length > 0) {
        if (typeof UI.renderHomeSpotlight === 'function') {
          UI.renderHomeSpotlight(trendingTracks, document.getElementById('homeSpotlightBox'));
        }
        if (typeof UI.renderHomeSubnav === 'function') {
          UI.renderHomeSubnav(document.getElementById('homeSubnavBox'), 'playlist', (selectedTab) => {
            this.handleHomeTabSelect(selectedTab, trendingTracks);
          });
        }
        UI.renderTrackList(trendingTracks.slice(0, 20), document.getElementById('homeTrackListBox'));
      }

      UI.renderQuickPicks(trendingTracks, document.getElementById('quickPicksBox'));
      UI.renderMoodSection(document.getElementById('moodsBox'));
      UI.renderShelfCarousel('TRENDING NOW', trendingTracks.slice(0, 15), document.getElementById('shelfTrending'), 'carouselTrending');

      // 3. Fetch category shelves
      const [bollywood, hollywood, punjabi, romantic] = await Promise.all([
        API.get('/music/search?genre=bollywood&limit=15'),
        API.get('/music/search?genre=hollywood&limit=15'),
        API.get('/music/search?genre=punjabi&limit=15'),
        API.get('/music/search?genre=romantic&limit=15')
      ]);

      UI.renderShelfCarousel('BOLLYWOOD HITS', bollywood, document.getElementById('shelfBollywood'), 'carouselBollywood');
      UI.renderShelfCarousel('GLOBAL POP', hollywood, document.getElementById('shelfHollywood'), 'carouselHollywood');
      UI.renderShelfCarousel('PUNJABI HITS', punjabi, document.getElementById('shelfPunjabi'), 'carouselPunjabi');
      UI.renderShelfCarousel('ROMANTIC SESSIONS', romantic, document.getElementById('shelfRomantic'), 'carouselRomantic');
    } catch (err) {
      UI.showToast('Failed to load music recommendations', 'error');
    }
  }

  handleHomeTabSelect(tabId, trendingTracks) {
    const listContainer = document.getElementById('homeTrackListBox');
    if (!listContainer) return;

    if (tabId === 'playlist') {
      UI.renderTrackList((trendingTracks || []).slice(0, 25), listContainer);
    } else if (tabId === 'artists') {
      this.renderInPlaceArtists(listContainer);
    } else if (tabId === 'albums') {
      this.renderInPlaceAlbums(listContainer);
    } else if (tabId === 'streams') {
      this.renderInPlaceStreams(listContainer);
    } else if (tabId === 'favorites') {
      this.renderInPlaceFavorites(listContainer);
    }
  }

  async renderInPlaceArtists(listContainer) {
    if (!listContainer) return;
    listContainer.replaceChildren();

    const loading = document.createElement('div');
    loading.className = 'in-place-loading';
    loading.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span>Loading top artists...</span>';
    listContainer.appendChild(loading);

    try {
      const res = await API.get('/music/artists?limit=40');
      const artists = (res && Array.isArray(res.artists)) ? res.artists : [];
      listContainer.replaceChildren();

      if (artists.length === 0) {
        listContainer.innerHTML = '<div class="in-place-empty-state"><i class="fa-solid fa-users"></i><span>No artists found</span></div>';
        return;
      }

      const grid = document.createElement('div');
      grid.className = 'home-artist-grid';

      const safeArtistFallback = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=200&auto=format&fit=crop';

      artists.forEach(artist => {
        const card = document.createElement('div');
        card.className = 'home-artist-card';
        card.setAttribute('role', 'button');
        card.tabIndex = 0;
        card.title = `View songs by ${artist.name}`;

        const img = document.createElement('img');
        img.className = 'home-artist-avatar';
        img.src = UI.sanitizeImageUrl(artist.coverUrl, safeArtistFallback);
        img.alt = artist.name;
        img.loading = 'lazy';
        img.addEventListener('error', () => { img.src = safeArtistFallback; }, { once: true });

        const name = document.createElement('span');
        name.className = 'home-artist-name';
        name.textContent = artist.name;

        const count = document.createElement('span');
        count.className = 'home-artist-meta';
        count.textContent = `${artist.songCount} ${artist.songCount === 1 ? 'song' : 'songs'}`;

        card.appendChild(img);
        card.appendChild(name);
        card.appendChild(count);

        const selectArtist = () => {
          this.renderInPlaceArtistTracks(listContainer, artist);
        };

        card.addEventListener('click', selectArtist);
        card.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            selectArtist();
          }
        });

        grid.appendChild(card);
      });

      listContainer.appendChild(grid);
    } catch (err) {
      console.warn('[App] Error in renderInPlaceArtists:', err);
      listContainer.innerHTML = '<div class="in-place-empty-state"><i class="fa-solid fa-triangle-exclamation"></i><span>Failed to load artists</span></div>';
    }
  }

  async renderInPlaceArtistTracks(listContainer, artist) {
    if (!listContainer || !artist) return;
    listContainer.replaceChildren();

    const navBar = document.createElement('div');
    navBar.className = 'home-inplace-header';

    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'home-inplace-back-btn';
    backBtn.innerHTML = '<i class="fa-solid fa-arrow-left"></i><span>All Artists</span>';
    backBtn.addEventListener('click', () => {
      this.renderInPlaceArtists(listContainer);
    });

    const info = document.createElement('span');
    info.className = 'home-inplace-title';
    info.innerHTML = `Songs by <strong style="color:var(--text-main);">${UI.escapeHTML(artist.name)}</strong>`;

    navBar.appendChild(backBtn);
    navBar.appendChild(info);

    const trackContainer = document.createElement('div');
    trackContainer.id = 'inPlaceArtistTrackList';
    trackContainer.className = 'in-place-track-container';
    trackContainer.innerHTML = '<div class="in-place-loading"><i class="fa-solid fa-spinner fa-spin"></i><span>Loading tracks...</span></div>';

    listContainer.appendChild(navBar);
    listContainer.appendChild(trackContainer);

    try {
      const searchRes = await API.get(`/music/search?q=${encodeURIComponent(artist.name)}&type=artist&limit=30`);
      trackContainer.replaceChildren();

      const tracks = Array.isArray(searchRes) ? searchRes : (searchRes && searchRes.tracks ? searchRes.tracks : []);
      if (tracks.length === 0) {
        trackContainer.innerHTML = '<div class="in-place-empty-state"><i class="fa-solid fa-music"></i><span>No songs found for this artist</span></div>';
        return;
      }

      this.currentTracks = tracks;
      UI.renderTrackList(tracks, trackContainer);
    } catch (err) {
      console.warn('[App] Error fetching artist tracks:', err);
      trackContainer.innerHTML = '<div class="in-place-empty-state"><i class="fa-solid fa-triangle-exclamation"></i><span>Failed to load tracks</span></div>';
    }
  }

  async renderInPlaceAlbums(listContainer) {
    if (!listContainer) return;
    listContainer.replaceChildren();

    const loading = document.createElement('div');
    loading.className = 'in-place-loading';
    loading.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span>Loading albums...</span>';
    listContainer.appendChild(loading);

    try {
      const res = await API.get('/music/albums?limit=40');
      const albums = (res && Array.isArray(res.albums)) ? res.albums : [];
      listContainer.replaceChildren();

      if (albums.length === 0) {
        listContainer.innerHTML = '<div class="in-place-empty-state"><i class="fa-solid fa-compact-disc"></i><span>No albums found</span></div>';
        return;
      }

      const grid = document.createElement('div');
      grid.className = 'home-album-grid';

      const safeAlbumFallback = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=300&auto=format&fit=crop';

      albums.forEach(album => {
        const card = document.createElement('div');
        card.className = 'home-album-card';
        card.setAttribute('role', 'button');
        card.tabIndex = 0;
        card.title = `${album.title} - ${album.artist || 'Various'}`;

        const img = document.createElement('img');
        img.className = 'home-album-cover';
        img.src = UI.sanitizeImageUrl(album.coverUrl, safeAlbumFallback);
        img.alt = album.title;
        img.loading = 'lazy';
        img.addEventListener('error', () => { img.src = safeAlbumFallback; }, { once: true });

        const title = document.createElement('span');
        title.className = 'home-album-title';
        title.textContent = album.title;

        const artist = document.createElement('span');
        artist.className = 'home-album-artist';
        artist.textContent = album.artist || 'Various Artists';

        card.appendChild(img);
        card.appendChild(title);
        card.appendChild(artist);

        const selectAlbum = () => {
          this.renderInPlaceAlbumTracks(listContainer, album);
        };

        card.addEventListener('click', selectAlbum);
        card.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            selectAlbum();
          }
        });

        grid.appendChild(card);
      });

      listContainer.appendChild(grid);
    } catch (err) {
      console.warn('[App] Error in renderInPlaceAlbums:', err);
      listContainer.innerHTML = '<div class="in-place-empty-state"><i class="fa-solid fa-triangle-exclamation"></i><span>Failed to load albums</span></div>';
    }
  }

  async renderInPlaceAlbumTracks(listContainer, album) {
    if (!listContainer || !album) return;
    listContainer.replaceChildren();

    const navBar = document.createElement('div');
    navBar.className = 'home-inplace-header';

    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'home-inplace-back-btn';
    backBtn.innerHTML = '<i class="fa-solid fa-arrow-left"></i><span>All Albums</span>';
    backBtn.addEventListener('click', () => {
      this.renderInPlaceAlbums(listContainer);
    });

    const info = document.createElement('span');
    info.className = 'home-inplace-title';
    info.innerHTML = `Album: <strong style="color:var(--text-main);">${UI.escapeHTML(album.title)}</strong> (${UI.escapeHTML(album.artist || 'Various')})`;

    navBar.appendChild(backBtn);
    navBar.appendChild(info);

    const trackContainer = document.createElement('div');
    trackContainer.id = 'inPlaceAlbumTrackList';
    trackContainer.className = 'in-place-track-container';

    listContainer.appendChild(navBar);
    listContainer.appendChild(trackContainer);

    if (album.tracks && Array.isArray(album.tracks) && album.tracks.length > 0) {
      this.currentTracks = album.tracks;
      UI.renderTrackList(album.tracks, trackContainer);
    } else {
      trackContainer.innerHTML = '<div class="in-place-loading"><i class="fa-solid fa-spinner fa-spin"></i><span>Loading album tracks...</span></div>';
      try {
        const searchRes = await API.get(`/music/search?album=${encodeURIComponent(album.title)}&limit=30`);
        trackContainer.replaceChildren();
        const tracks = Array.isArray(searchRes) ? searchRes : (searchRes && searchRes.tracks ? searchRes.tracks : []);
        if (tracks.length === 0) {
          trackContainer.innerHTML = '<div class="in-place-empty-state"><i class="fa-solid fa-music"></i><span>No tracks found for this album</span></div>';
          return;
        }
        this.currentTracks = tracks;
        UI.renderTrackList(tracks, trackContainer);
      } catch (err) {
        trackContainer.innerHTML = '<div class="in-place-empty-state"><i class="fa-solid fa-triangle-exclamation"></i><span>Failed to load tracks</span></div>';
      }
    }
  }

  async renderInPlaceFavorites(listContainer) {
    if (!listContainer) return;
    listContainer.replaceChildren();

    const loading = document.createElement('div');
    loading.className = 'in-place-loading';
    loading.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span>Loading favourites...</span>';
    listContainer.appendChild(loading);

    try {
      const likes = await API.get('/likes');
      listContainer.replaceChildren();

      if (!Array.isArray(likes) || likes.length === 0) {
        listContainer.innerHTML = `
          <div class="in-place-empty-state">
            <i class="fa-regular fa-heart"></i>
            <span>No favourite songs yet. Click the heart icon on any song to save it here.</span>
          </div>
        `;
        return;
      }

      this.currentTracks = likes;
      UI.likedTrackIds = new Set(likes.map(l => String(l.jamendoId || l.id)));
      UI.renderTrackList(likes, listContainer);
    } catch (err) {
      console.warn('[App] Error in renderInPlaceFavorites:', err);
      listContainer.innerHTML = `
        <div class="in-place-empty-state">
          <i class="fa-regular fa-heart"></i>
          <span>No favourite songs yet. Click the heart icon on any song to save it here.</span>
        </div>
      `;
    }
  }

  async renderInPlaceStreams(listContainer) {
    if (!listContainer) return;
    listContainer.replaceChildren();

    const loading = document.createElement('div');
    loading.className = 'in-place-loading';
    loading.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span>Loading all songs...</span>';
    listContainer.appendChild(loading);

    try {
      const res = await API.get('/music/catalog?limit=25');
      listContainer.replaceChildren();

      const tracks = (res && Array.isArray(res.tracks)) ? res.tracks : (Array.isArray(res) ? res : []);
      if (tracks.length === 0) {
        listContainer.innerHTML = '<div class="in-place-empty-state"><i class="fa-solid fa-music"></i><span>No songs available</span></div>';
        return;
      }

      this.currentTracks = tracks;
      UI.renderTrackList(tracks, listContainer);
    } catch (err) {
      console.warn('[App] Error in renderInPlaceStreams:', err);
      listContainer.innerHTML = '<div class="in-place-empty-state"><i class="fa-solid fa-triangle-exclamation"></i><span>Failed to load songs</span></div>';
    }
  }

  handleMoodPillClick(mood) {
    if (!mood || mood === 'all') {
      window.location.hash = 'home';
      return;
    }
    window.location.hash = `mood/${encodeURIComponent(mood)}`;
  }

  async loadRecentPlayed() {
    const listContainer = document.getElementById('recentPlayedList');
    if (!listContainer) return;

    try {
      let historyTracks = [];
      if (API.getToken()) {
        try {
          const res = await API.get('/history?limit=30');
          if (Array.isArray(res) && res.length > 0) {
            historyTracks = res.map(h => (h && h.track ? h.track : h)).filter(t => t && (t.title || t.id));
          }
        } catch (e) {
          console.warn('[App] Could not load history for recent played panel:', e.message);
        }
      }

      // If history is sparse, augment with trending tracks so real tracks & artwork always fill the panel
      if (historyTracks.length < 20) {
        try {
          const trending = await API.get('/music/trending');
          if (Array.isArray(trending)) {
            const seen = new Set(historyTracks.map(t => String(t.jamendoId || t.id || '')));
            for (const t of trending) {
              const tid = String(t.jamendoId || t.id || '');
              if (tid && !seen.has(tid)) {
                historyTracks.push(t);
                seen.add(tid);
                if (historyTracks.length >= 25) break;
              }
            }
          }
        } catch (e) {}
      }

      this.recentTracks = historyTracks;
      this.registerTracks(historyTracks);

      if (typeof UI.renderRecentPlayed === 'function') {
        UI.renderRecentPlayed(historyTracks, listContainer);
      }
    } catch (err) {
      console.warn('[App] Error in loadRecentPlayed:', err.message);
    }
  }

  // View Loader: EXPLORE PAGE
  async loadExploreView() {
    const container = document.getElementById('mainView');
    container.innerHTML = `
      <div class="view-header">
        <div>
          <h2 class="view-title"><i class="fa-solid fa-compass"></i> Explore Music</h2>
          <p class="view-description">Curated new releases, global charts, and mood stations</p>
        </div>
      </div>
      <div id="exploreMoodsBox"></div>
      <div id="exploreShelf1"></div>
      <div id="exploreShelf2"></div>
      <div id="exploreShelf3"></div>
    `;

    try {
      UI.renderMoodSection(document.getElementById('exploreMoodsBox'));

      const [newReleases, hiphop, lofi] = await Promise.all([
        API.get('/music/search?q=New%20Release&limit=15'),
        API.get('/music/search?genre=hiphop&limit=15'),
        API.get('/music/search?genre=lofi&limit=15')
      ]);

      UI.renderShelfCarousel('NEW RELEASES', newReleases, document.getElementById('exploreShelf1'), 'carouselNewReleases');
      UI.renderShelfCarousel('HIP-HOP & RAP', hiphop, document.getElementById('exploreShelf2'), 'carouselHipHop');
      UI.renderShelfCarousel('CHILL & LO-FI', lofi, document.getElementById('exploreShelf3'), 'carouselLoFi');
    } catch (err) {
      UI.showToast('Failed to load explore feed', 'error');
    }
  }

  // View Loader: LIBRARY PAGE (Authentic Collection Dashboard)
  async loadLibraryView() {
    const container = document.getElementById('mainView');
    container.innerHTML = `<div style="text-align:center; padding:40px;"><i class="fa-solid fa-spinner fa-spin fa-2x" style="color:var(--accent)"></i></div>`;

    try {
      const [likes, history, playlists] = await Promise.all([
        API.get('/likes'),
        API.get('/history'),
        API.get('/playlists')
      ]);

      UI.userPlaylists = playlists;
      UI.renderPlaylistNav(playlists);

      container.innerHTML = `
        <div class="view-header">
          <div>
            <h2 class="view-title"><i class="fa-solid fa-lines-leaning"></i> Your Library</h2>
            <p class="view-description">Your playlists, saved favorites, and listening activity</p>
          </div>
          <button id="libCreatePlaylistBtn" class="btn-primary" style="width:auto; padding:8px 18px; font-size:13px;">
            <i class="fa-solid fa-plus"></i> New Playlist
          </button>
        </div>

        <div class="library-stats-grid">
          <div class="library-stat-card" id="statLikedCard">
            <div class="library-stat-header">
              <span class="library-stat-label">Favourite Songs</span>
              <div class="library-stat-icon" style="background:rgba(225,29,72,0.12); color:var(--accent);">
                <i class="fa-solid fa-heart"></i>
              </div>
            </div>
            <span class="library-stat-count">${likes.length}</span>
          </div>

          <div class="library-stat-card" id="statPlaylistsCard">
            <div class="library-stat-header">
              <span class="library-stat-label">Playlists</span>
              <div class="library-stat-icon" style="background:rgba(56,189,248,0.12); color:var(--accent-secondary);">
                <i class="fa-solid fa-list-check"></i>
              </div>
            </div>
            <span class="library-stat-count">${playlists.length}</span>
          </div>

          <div class="library-stat-card" id="statHistoryCard">
            <div class="library-stat-header">
              <span class="library-stat-label">Recently Played</span>
              <div class="library-stat-icon" style="background:rgba(148,163,184,0.12); color:var(--text-muted);">
                <i class="fa-solid fa-clock-rotate-left"></i>
              </div>
            </div>
            <span class="library-stat-count">${history.length}</span>
          </div>
        </div>

        <div id="libraryLikedShelf"></div>
        <div id="libraryHistoryShelf"></div>
      `;

      document.getElementById('libCreatePlaylistBtn')?.addEventListener('click', () => {
        this.openCreatePlaylistModal();
      });

      document.getElementById('statLikedCard')?.addEventListener('click', () => {
        window.location.hash = 'liked';
      });

      document.getElementById('statHistoryCard')?.addEventListener('click', () => {
        window.location.hash = 'history';
      });

      if (likes.length > 0) {
        UI.renderShelfCarousel('FAVORITES', likes, document.getElementById('libraryLikedShelf'), 'carouselLikedLib');
      } else {
        const likedBox = document.getElementById('libraryLikedShelf');
        if (likedBox) {
          likedBox.innerHTML = `
            <div style="background:rgba(255,255,255,0.03); border:1px dashed var(--border-color); border-radius:var(--radius-md); padding:24px; text-align:center; margin-bottom:32px;">
              <i class="fa-regular fa-heart" style="font-size:24px; color:var(--text-dim); margin-bottom:10px; display:block;"></i>
              <p style="font-weight:600; font-size:14px; margin-bottom:4px;">No favourite songs yet</p>
              <p style="color:var(--text-muted); font-size:13px;">Click the heart icon on any track to save it to your library.</p>
            </div>
          `;
        }
      }

      if (history.length > 0) {
        UI.renderShelfCarousel('RECENTLY PLAYED', history, document.getElementById('libraryHistoryShelf'), 'carouselHistoryLib');
      }
    } catch (err) {
      UI.showToast('Failed to load Library view', 'error');
    }
  }

  // View Loader: CATALOG VIEW
  async loadCatalogView() {
    this.catalogPage = 1;
    this.isFetchingCatalog = false;
    this.catalogTotalSongs = 0;
    this.catalogTotalPages = 0;

    const container = document.getElementById('mainView');
    container.replaceChildren();

    const header = document.createElement('div');
    header.className = 'view-header';

    const leftDiv = document.createElement('div');
    const h2 = document.createElement('h2');
    h2.id = 'catalogViewTitle';
    h2.className = 'view-title';
    h2.innerHTML = '<i class="fa-solid fa-compact-disc"></i> All Songs Collection';

    leftDiv.appendChild(h2);

    const playBtn = document.createElement('button');
    playBtn.id = 'playAllCatalogBtn';
    playBtn.className = 'hero-btn';
    playBtn.style.padding = '8px 18px';
    playBtn.style.fontSize = '13px';
    playBtn.innerHTML = '<i class="fa-solid fa-play"></i> Play All';
    playBtn.addEventListener('click', () => this.playAllCurrent());

    header.appendChild(leftDiv);
    header.appendChild(playBtn);

    const grid = document.createElement('div');
    grid.id = 'catalogGrid';
    grid.className = 'track-grid';
    grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:40px;"><i class="fa-solid fa-spinner fa-spin fa-2x" style="color:var(--accent-yt-red)"></i></div>';

    const loadMoreDiv = document.createElement('div');
    loadMoreDiv.id = 'loadMoreCatalogContainer';
    loadMoreDiv.style.textAlign = 'center';
    loadMoreDiv.style.marginTop = '32px';

    const loadMoreBtn = document.createElement('button');
    loadMoreBtn.id = 'loadMoreCatalogBtn';
    loadMoreBtn.className = 'btn-primary';
    loadMoreBtn.style.padding = '10px 24px';
    loadMoreBtn.style.fontSize = '14px';
    loadMoreBtn.style.width = 'auto';
    loadMoreBtn.innerHTML = '<i class="fa-solid fa-angles-down"></i> Load Next Page';
    loadMoreBtn.addEventListener('click', () => this.loadMoreCatalogTracks());

    loadMoreDiv.appendChild(loadMoreBtn);

    container.appendChild(header);
    container.appendChild(grid);
    container.appendChild(loadMoreDiv);

    try {
      const data = await API.get('/music/catalog?page=1&limit=40');
      const totalSongs = data.totalSongs || 0;
      const totalPages = data.totalPages || Math.ceil(totalSongs / (data.limit || 40));
      this.catalogTotalSongs = totalSongs;
      this.catalogTotalPages = totalPages;
      this.currentTracks = data.tracks || [];

      const titleEl = document.getElementById('catalogViewTitle');
      if (titleEl) titleEl.innerHTML = `<i class="fa-solid fa-compact-disc"></i> All Songs Collection`;

      this._updateLoadMoreCatalogLabel();
      UI.renderTrackGrid(this.currentTracks, document.getElementById('catalogGrid'));
    } catch (err) {
      UI.showToast('Failed to load catalog view', 'error');
    }
  }

  // View Loader: LIVE RADIO
  async loadRadioView() {
    const container = document.getElementById('mainView');
    container.innerHTML = `
      <div class="view-header radio-header" style="margin-bottom:24px;">
        <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:16px;">
          <div>
            <div style="display:inline-flex; align-items:center; gap:8px; margin-bottom:6px;">
              <span style="display:inline-flex; align-items:center; gap:5px; background:rgba(239,68,68,0.15); color:#f87171; font-size:11px; font-weight:700; padding:2px 8px; border-radius:12px; letter-spacing:0.5px;">
                <span style="width:6px; height:6px; border-radius:50%; background:#ef4444; display:inline-block;"></span> LIVE
              </span>
              <span style="color:var(--text-dim); font-size:13px; font-weight:500;">Powered by Radio Browser</span>
            </div>
            <h1 style="font-size:28px; font-weight:800; color:#fff; margin:0 0 4px;">Live Radio Worldwide</h1>
            <p style="color:var(--text-muted); font-size:14px; margin:0;">Explore thousands of live broadcasting stations by name, country, or musical genre.</p>
          </div>
        </div>

        <!-- Radio Search & Filters Bar -->
        <div style="display:flex; flex-wrap:wrap; gap:10px; margin-top:20px; align-items:center; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.06); border-radius:12px; padding:12px 16px;">
          <div style="flex:1; min-width:200px; position:relative;">
            <i class="fa-solid fa-magnifying-glass" style="position:absolute; left:12px; top:50%; transform:translateY(-50%); color:var(--text-dim); font-size:13px;"></i>
            <input type="text" id="radioSearchInput" placeholder="Search station name..." style="width:100%; padding:8px 12px 8px 34px; background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.1); border-radius:8px; color:#fff; font-size:13px; outline:none;">
          </div>
          <div style="min-width:140px;">
            <select id="radioCountrySelect" style="width:100%; padding:8px 12px; background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.1); border-radius:8px; color:#fff; font-size:13px; outline:none;">
              <option value="">All Countries</option>
              <option value="India">India</option>
              <option value="United States">United States</option>
              <option value="United Kingdom">United Kingdom</option>
              <option value="Canada">Canada</option>
              <option value="Australia">Australia</option>
              <option value="France">France</option>
              <option value="Germany">Germany</option>
              <option value="Japan">Japan</option>
              <option value="Brazil">Brazil</option>
              <option value="Spain">Spain</option>
            </select>
          </div>
          <div style="min-width:130px;">
            <input type="text" id="radioTagInput" placeholder="Tag (e.g. pop, news)" style="width:100%; padding:8px 12px; background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.1); border-radius:8px; color:#fff; font-size:13px; outline:none;">
          </div>
          <button id="radioFilterBtn" class="primary-btn" style="padding:8px 18px; border-radius:8px; font-size:13px; font-weight:600; display:inline-flex; align-items:center; gap:6px;">
            <i class="fa-solid fa-filter"></i> Filter
          </button>
        </div>

        <!-- Quick Tag Pills -->
        <div id="radioQuickTags" style="display:flex; flex-wrap:wrap; gap:8px; margin-top:14px;">
          <button class="radio-tag-pill active" data-tag="" style="padding:4px 12px; border-radius:16px; font-size:12px; background:var(--accent); color:#000; border:none; cursor:pointer; font-weight:600;">Popular</button>
          <button class="radio-tag-pill" data-tag="pop" style="padding:4px 12px; border-radius:16px; font-size:12px; background:rgba(255,255,255,0.06); color:#fff; border:1px solid rgba(255,255,255,0.08); cursor:pointer;">Pop</button>
          <button class="radio-tag-pill" data-tag="news" style="padding:4px 12px; border-radius:16px; font-size:12px; background:rgba(255,255,255,0.06); color:#fff; border:1px solid rgba(255,255,255,0.08); cursor:pointer;">News</button>
          <button class="radio-tag-pill" data-tag="classical" style="padding:4px 12px; border-radius:16px; font-size:12px; background:rgba(255,255,255,0.06); color:#fff; border:1px solid rgba(255,255,255,0.08); cursor:pointer;">Classical</button>
          <button class="radio-tag-pill" data-tag="jazz" style="padding:4px 12px; border-radius:16px; font-size:12px; background:rgba(255,255,255,0.06); color:#fff; border:1px solid rgba(255,255,255,0.08); cursor:pointer;">Jazz</button>
          <button class="radio-tag-pill" data-tag="rock" style="padding:4px 12px; border-radius:16px; font-size:12px; background:rgba(255,255,255,0.06); color:#fff; border:1px solid rgba(255,255,255,0.08); cursor:pointer;">Rock</button>
          <button class="radio-tag-pill" data-tag="ambient" style="padding:4px 12px; border-radius:16px; font-size:12px; background:rgba(255,255,255,0.06); color:#fff; border:1px solid rgba(255,255,255,0.08); cursor:pointer;">Ambient</button>
          <button class="radio-tag-pill" data-tag="bollywood" style="padding:4px 12px; border-radius:16px; font-size:12px; background:rgba(255,255,255,0.06); color:#fff; border:1px solid rgba(255,255,255,0.08); cursor:pointer;">Bollywood</button>
        </div>
      </div>

      <div id="radioGridContainer" class="track-grid">
        <div style="grid-column:1/-1; text-align:center; padding:40px 20px;">
          <div class="spinner" style="margin:0 auto 16px;"></div>
          <p style="color:var(--text-muted); font-size:14px;">Tuning into live radio frequencies...</p>
        </div>
      </div>
    `;

    const gridContainer = document.getElementById('radioGridContainer');
    const searchInput = document.getElementById('radioSearchInput');
    const countrySelect = document.getElementById('radioCountrySelect');
    const tagInput = document.getElementById('radioTagInput');
    const filterBtn = document.getElementById('radioFilterBtn');
    const quickTags = document.getElementById('radioQuickTags');

    const fetchAndRender = async () => {
      gridContainer.innerHTML = `
        <div style="grid-column:1/-1; text-align:center; padding:40px 20px;">
          <div class="spinner" style="margin:0 auto 16px;"></div>
          <p style="color:var(--text-muted); font-size:14px;">Loading live stations...</p>
        </div>
      `;
      try {
        const params = new URLSearchParams();
        const nameVal = searchInput?.value?.trim() || '';
        const countryVal = countrySelect?.value?.trim() || '';
        const tagVal = tagInput?.value?.trim() || '';
        if (nameVal) params.set('name', nameVal);
        if (countryVal) params.set('country', countryVal);
        if (tagVal) params.set('tag', tagVal);
        params.set('limit', '36');

        const stations = await API.get(`/music/radio/stations?${params.toString()}`);
        UI.renderRadioGrid(stations, gridContainer, (station) => {
          player.playTrack(station, [station], 0);
        });
      } catch (err) {
        gridContainer.innerHTML = `
          <div style="grid-column:1/-1; text-align:center; padding:50px 20px;">
            <i class="fa-solid fa-triangle-exclamation" style="font-size:32px; color:#f87171; margin-bottom:12px; display:block;"></i>
            <p style="font-weight:700; font-size:16px; color:#fca5a5; margin-bottom:6px;">Radio Service Temporarily Unavailable</p>
            <p style="color:var(--text-muted); font-size:13px; max-width:440px; margin:0 auto;">Could not reach radio streaming mirrors. Please verify your connection or try again shortly.</p>
          </div>
        `;
      }
    };

    filterBtn?.addEventListener('click', fetchAndRender);
    searchInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') fetchAndRender();
    });
    countrySelect?.addEventListener('change', fetchAndRender);

    quickTags?.addEventListener('click', (e) => {
      const pill = e.target.closest('.radio-tag-pill');
      if (!pill) return;
      document.querySelectorAll('.radio-tag-pill').forEach(p => {
        p.classList.remove('active');
        p.style.background = 'rgba(255,255,255,0.06)';
        p.style.color = '#fff';
        p.style.fontWeight = 'normal';
      });
      pill.classList.add('active');
      pill.style.background = 'var(--accent)';
      pill.style.color = '#000';
      pill.style.fontWeight = '600';

      const tag = pill.getAttribute('data-tag') || '';
      if (tagInput) tagInput.value = tag;
      fetchAndRender();
    });

    await fetchAndRender();
  }

  // View Loader: ALBUMS VIEW
  async loadAlbumsView() {
    const container = document.getElementById('mainView');
    container.replaceChildren();

    const header = document.createElement('div');
    header.className = 'view-header';

    const leftDiv = document.createElement('div');
    const h2 = document.createElement('h2');
    h2.id = 'albumsViewTitle';
    h2.className = 'view-title';
    h2.innerHTML = '<i class="fa-solid fa-compact-disc"></i> Curated Albums';

    const p = document.createElement('p');
    p.id = 'albumsViewDesc';
    p.className = 'view-description';
    p.textContent = 'Explore top studio albums, soundtracks, and complete discographies';

    leftDiv.appendChild(h2);
    leftDiv.appendChild(p);

    const playBtn = document.createElement('button');
    playBtn.id = 'playAllAlbumsBtn';
    playBtn.className = 'hero-btn';
    playBtn.style.padding = '8px 18px';
    playBtn.style.fontSize = '13px';
    playBtn.innerHTML = '<i class="fa-solid fa-play"></i> Play Top Album';
    playBtn.addEventListener('click', () => {
      if (this.currentTracks && this.currentTracks.length > 0) {
        this.playAllCurrent();
      }
    });

    header.appendChild(leftDiv);
    header.appendChild(playBtn);

    const grid = document.createElement('div');
    grid.id = 'albumsGrid';
    grid.className = 'track-grid';
    grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:40px;"><i class="fa-solid fa-spinner fa-spin fa-2x" style="color:var(--accent-yt-red)"></i></div>';

    container.appendChild(header);
    container.appendChild(grid);

    try {
      const data = await API.get('/music/albums?limit=60');
      const albums = (data && data.albums) ? data.albums : [];

      if (albums.length === 0) {
        grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:40px; color:var(--text-muted);">No albums found</div>';
        return;
      }

      this.currentTracks = albums.flatMap(a => a.tracks || []).slice(0, 50);

      grid.replaceChildren();
      albums.forEach(album => {
        const card = document.createElement('div');
        card.className = 'track-card album-card';
        card.title = `${album.title} - ${album.artist}`;

        const coverWrapper = document.createElement('div');
        coverWrapper.className = 'track-cover-wrapper';

        const img = document.createElement('img');
        img.className = 'track-cover';
        img.alt = album.title;
        img.src = album.coverUrl || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=400&auto=format&fit=crop';
        img.loading = 'lazy';
        img.addEventListener('error', () => {
          img.src = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=400&auto=format&fit=crop';
        }, { once: true });

        const playOverlay = document.createElement('div');
        playOverlay.className = 'play-overlay-btn';
        playOverlay.innerHTML = '<div class="play-circle"><i class="fa-solid fa-play"></i></div>';

        coverWrapper.appendChild(img);
        coverWrapper.appendChild(playOverlay);

        const info = document.createElement('div');
        info.className = 'track-info';

        const title = document.createElement('div');
        title.className = 'track-title';
        title.textContent = album.title;

        const artist = document.createElement('div');
        artist.className = 'track-artist';
        artist.textContent = album.artist;

        const count = document.createElement('div');
        count.className = 'track-album';
        count.style.fontSize = '11px';
        count.style.color = 'var(--text-muted)';
        count.textContent = `${album.songCount || 1} Songs`;

        info.appendChild(title);
        info.appendChild(artist);
        info.appendChild(count);

        card.appendChild(coverWrapper);
        card.appendChild(info);

        card.addEventListener('click', () => {
          if (album.tracks && album.tracks.length > 0 && typeof player !== 'undefined' && player.playTrack) {
            player.playTrack(album.tracks[0], album.tracks, 0);
          } else {
            window.location.hash = `search?q=${encodeURIComponent(album.title)}`;
          }
        });

        grid.appendChild(card);
      });
    } catch (err) {
      console.warn('[App] Error loading albums:', err);
      grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:40px; color:var(--text-muted);">Failed to load albums</div>';
    }
  }

  // Helper to keep the "Load Next Page" button label accurate
  _updateLoadMoreCatalogLabel() {
    const btn = document.getElementById('loadMoreCatalogBtn');
    if (!btn) return;
    const totalPages = this.catalogTotalPages || 0;
    if (totalPages > 0) {
      btn.innerHTML = `<i class="fa-solid fa-angles-down"></i> Load Next Page (${this.catalogPage} of ${totalPages} pages)`;
    } else {
      btn.innerHTML = `<i class="fa-solid fa-angles-down"></i> Load Next Page`;
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

      // Persist the server-reported totals so the label stays accurate
      if (data.totalSongs) this.catalogTotalSongs = data.totalSongs;
      if (data.totalPages) this.catalogTotalPages = data.totalPages;

      if (newTracks.length > 0) {
        const startIdx = this.currentTracks.length;
        this.currentTracks.push(...newTracks);
        UI.appendTrackGrid(newTracks, document.getElementById('catalogGrid'), startIdx);
        this._updateLoadMoreCatalogLabel();
      } else {
        if (btn) btn.style.display = 'none';
      }
    } catch (e) {
      UI.showToast('Failed to load more catalog songs', 'error');
    } finally {
      this.isFetchingCatalog = false;
      if (document.getElementById('loadMoreCatalogBtn')) {
        this._updateLoadMoreCatalogLabel();
      }
    }
  }

  // View Loader: SEARCH VIEW (Unified Song & Artist Search)
  async loadSearchTracks(query = '', genre = 'all', searchType = 'all', selectedArtist = '') {
    this.searchPage = 1;
    this.activeQuery = query;
    this.activeGenre = genre;
    this.activeSearchType = searchType || 'all';
    this.activeArtistFilter = selectedArtist || '';
    this.isFetchingMore = false;

    const isArtistType = this.activeSearchType === 'artist';

    const titleText = this.activeArtistFilter
      ? `Songs by ${this.activeArtistFilter}`
      : query
        ? (isArtistType ? `Artist Results for "${query}"` : `Results for "${query}"`)
        : genre !== 'all'
          ? `${genre.charAt(0).toUpperCase() + genre.slice(1)} Collection`
          : 'Browse Music';

    const container = document.getElementById('mainView');
    container.replaceChildren();

    const header = document.createElement('div');
    header.className = 'view-header';

    const leftDiv = document.createElement('div');
    const h2 = document.createElement('h2');
    h2.id = 'searchViewTitle';
    h2.className = 'view-title';

    const icon = document.createElement('i');
    icon.className = isArtistType
      ? 'fa-solid fa-user'
      : query
        ? 'fa-solid fa-magnifying-glass'
        : 'fa-solid fa-compass';
    h2.appendChild(icon);
    h2.appendChild(document.createTextNode(' ' + titleText));

    const p = document.createElement('p');
    p.id = 'searchViewDesc';
    p.className = 'view-description';
    p.textContent = this.activeArtistFilter
      ? `All available songs by artist ${this.activeArtistFilter}`
      : query
        ? (isArtistType ? `Showing all songs by artists matching "${query}"` : `Showing songs matching "${query}"`)
        : 'Curated music collection';

    leftDiv.appendChild(h2);
    leftDiv.appendChild(p);

    const playBtn = document.createElement('button');
    playBtn.id = 'playAllSearchBtn';
    playBtn.className = 'btn-primary';
    playBtn.style.width = 'auto';
    playBtn.style.padding = '8px 18px';
    playBtn.style.fontSize = '13px';
    playBtn.style.display = 'none';
    playBtn.innerHTML = '<i class="fa-solid fa-play"></i> Play All';
    playBtn.addEventListener('click', () => this.playAllCurrent());

    header.appendChild(leftDiv);
    header.appendChild(playBtn);

    // Search Type Filter Pills Row: [All Results] [Search by Artist] [Song Titles]
    const filterRow = document.createElement('div');
    filterRow.className = 'search-type-pills-row';
    filterRow.innerHTML = `
      <button type="button" class="search-type-pill ${this.activeSearchType === 'all' ? 'active' : ''}" data-type="all">
        <i class="fa-solid fa-border-all"></i> All Results
      </button>
      <button type="button" class="search-type-pill ${this.activeSearchType === 'artist' ? 'active' : ''}" data-type="artist">
        <i class="fa-solid fa-user"></i> Search by Artist
      </button>
      <button type="button" class="search-type-pill ${this.activeSearchType === 'song' ? 'active' : ''}" data-type="song">
        <i class="fa-solid fa-music"></i> Song Titles
      </button>
    `;
    filterRow.querySelectorAll('.search-type-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        const type = btn.dataset.type || 'all';
        this.setSearchType(type);
      });
    });

    // Container for Matching Artists
    const matchingArtistsBox = document.createElement('div');
    matchingArtistsBox.id = 'matchingArtistsBox';
    matchingArtistsBox.style.display = 'none';

    // Track Grid
    const grid = document.createElement('div');
    grid.id = 'searchGrid';
    grid.className = 'track-grid';
    grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:40px;"><i class="fa-solid fa-spinner fa-spin fa-2x" style="color:var(--accent)"></i></div>';

    // Load More Container
    const loadMoreDiv = document.createElement('div');
    loadMoreDiv.id = 'loadMoreContainer';
    loadMoreDiv.style.textAlign = 'center';
    loadMoreDiv.style.marginTop = '32px';
    loadMoreDiv.style.display = 'none';

    const loadMoreBtn = document.createElement('button');
    loadMoreBtn.id = 'loadMoreBtn';
    loadMoreBtn.className = 'btn-primary';
    loadMoreBtn.style.padding = '10px 24px';
    loadMoreBtn.style.fontSize = '14px';
    loadMoreBtn.style.width = 'auto';
    loadMoreBtn.innerHTML = '<i class="fa-solid fa-angles-down"></i> Load More Songs';
    loadMoreBtn.addEventListener('click', () => this.loadMoreSearchTracks());

    loadMoreDiv.appendChild(loadMoreBtn);

    container.appendChild(header);
    if (query || this.activeArtistFilter) {
      container.appendChild(filterRow);
    }
    container.appendChild(matchingArtistsBox);
    container.appendChild(grid);
    container.appendChild(loadMoreDiv);

    try {
      const reqId = ++this.searchRequestId;
      let endpoint = `/music/search?limit=40&page=1`;
      if (query) endpoint += `&q=${encodeURIComponent(query)}`;
      if (genre && genre !== 'all') endpoint += `&genre=${encodeURIComponent(genre)}`;
      if (this.activeSearchType && this.activeSearchType !== 'all') endpoint += `&type=${encodeURIComponent(this.activeSearchType)}`;
      if (this.activeArtistFilter) endpoint += `&artist=${encodeURIComponent(this.activeArtistFilter)}`;

      const tracks = await API.get(endpoint);
      if (reqId !== this.searchRequestId) return;
      this.allSearchResults = tracks || [];
      this.currentTracks = tracks || [];

      if (!tracks || tracks.length === 0) {
        const isProviderOffline = (typeof API !== 'undefined' && API.lastProviderStatus === 'offline');
        if (isProviderOffline) {
          grid.innerHTML = `
            <div style="grid-column:1/-1; text-align:center; padding:60px 20px;">
              <div style="width:56px; height:56px; border-radius:50%; background:rgba(239,68,68,0.1); display:inline-flex; align-items:center; justify-content:center; margin-bottom:16px;">
                <i class="fa-solid fa-cloud-slash" style="font-size:22px; color:#f87171;"></i>
              </div>
              <p style="font-size:16px; font-weight:700; margin-bottom:6px; color:#fff;">Live Music Service Temporarily Unavailable</p>
              <p style="color:var(--text-muted); font-size:13px; max-width:440px; margin:0 auto;">
                The external music streaming provider could not be reached. Local catalog matches were checked, but no cached tracks matched "${UI.escapeHTML(query || genre)}". Please verify your connection or try again shortly.
              </p>
            </div>
          `;
          return;
        }

        grid.innerHTML = `
          <div style="grid-column:1/-1; text-align:center; padding:60px 20px;">
            <div style="width:56px; height:56px; border-radius:50%; background:rgba(255,255,255,0.04); display:inline-flex; align-items:center; justify-content:center; margin-bottom:16px;">
              <i class="fa-solid fa-magnifying-glass" style="font-size:22px; color:var(--text-dim);"></i>
            </div>
            <p style="font-size:18px; font-weight:700; margin-bottom:8px; color:#fff;">No songs found</p>
            <p style="color:var(--text-muted); font-size:14px; max-width:440px; margin:0 auto 12px;">We couldn't find any songs matching "${UI.escapeHTML(query || genre)}".</p>
            <p style="color:var(--text-dim); font-size:13px; max-width:440px; margin:0 auto;">Try searching for another artist name (e.g. Arijit Singh, Kishore Kumar, Shreya Ghoshal, Atif Aslam) or song title.</p>
          </div>
        `;
        return;
      }

      // If user searched a term, extract and display matching artists clearly
      if (query || this.activeArtistFilter) {
        const matchingArtists = UI.extractMatchingArtists(this.allSearchResults, query || this.activeArtistFilter);
        if (matchingArtists.length > 0) {
          UI.renderMatchingArtists(
            matchingArtists,
            matchingArtistsBox,
            this.allSearchResults.length,
            this.activeArtistFilter,
            (artistName) => {
              this.filterResultsByArtist(artistName);
            }
          );
        }
      }

      // Apply initial artist filter if provided
      if (this.activeArtistFilter) {
        const filterLower = this.activeArtistFilter.toLowerCase().trim();
        this.currentTracks = this.allSearchResults.filter(t => {
          const tArtist = (t.artist || '').toLowerCase();
          return tArtist.includes(filterLower) || filterLower.includes(tArtist) || tArtist.split(/[,&/|]/).some(a => a.trim().toLowerCase().includes(filterLower));
        });
      }

      if (typeof UI.renderGroupedSearchGrid === 'function') {
        UI.renderGroupedSearchGrid(this.currentTracks, grid, query || this.activeArtistFilter);
      } else {
        UI.renderTrackGrid(this.currentTracks, grid);
      }

      if (this.currentTracks.length > 0) {
        const playBtnEl = document.getElementById('playAllSearchBtn');
        if (playBtnEl) playBtnEl.style.display = 'inline-flex';
      }

      if (tracks.length >= 15) {
        const loadMoreBox = document.getElementById('loadMoreContainer');
        if (loadMoreBox) loadMoreBox.style.display = 'block';
      }
    } catch (err) {
      grid.innerHTML = `
        <div style="grid-column:1/-1; text-align:center; padding:50px 20px;">
          <div style="width:56px; height:56px; border-radius:50%; background:rgba(239,68,68,0.1); display:inline-flex; align-items:center; justify-content:center; margin-bottom:16px;">
            <i class="fa-solid fa-triangle-exclamation" style="font-size:22px; color:#f87171;"></i>
          </div>
          <p style="font-weight:700; font-size:16px; color:#fca5a5; margin-bottom:8px;">Search temporarily unavailable</p>
          <p style="color:var(--text-muted); font-size:13px;">Please check your connection and try again.</p>
        </div>
      `;
    }
  }

  // Filter current search results by a specific artist
  async filterResultsByArtist(artistName) {
    this.activeArtistFilter = artistName || '';
    const normArtist = (artistName || '').toLowerCase().trim();
    const normQuery = (this.activeQuery || '').toLowerCase().trim();

    // If activeQuery was just part of the artist's name, streamline query so title filter does not conflict
    let queryParam = this.activeQuery || '';
    if (normArtist && normQuery && (normArtist.includes(normQuery) || normQuery.includes(normArtist))) {
      queryParam = '';
    }

    let hash = queryParam ? `search?q=${encodeURIComponent(queryParam)}` : 'search';
    const params = [];
    if (queryParam) params.push(`q=${encodeURIComponent(queryParam)}`);
    if (this.activeGenre && this.activeGenre !== 'all') params.push(`genre=${encodeURIComponent(this.activeGenre)}`);
    if (this.activeSearchType && this.activeSearchType !== 'all') params.push(`type=${encodeURIComponent(this.activeSearchType)}`);
    if (artistName) params.push(`artist=${encodeURIComponent(artistName)}`);

    hash = params.length > 0 ? `search?${params.join('&')}` : 'search';

    if (typeof window !== 'undefined') {
      if (window.location.hash === `#${hash}` || window.location.hash === hash) {
        await this.loadSearchTracks(queryParam, this.activeGenre, this.activeSearchType, this.activeArtistFilter);
      } else {
        window.location.hash = hash;
      }
    } else {
      await this.loadSearchTracks(queryParam, this.activeGenre, this.activeSearchType, this.activeArtistFilter);
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
      if (this.activeSearchType && this.activeSearchType !== 'all') endpoint += `&type=${encodeURIComponent(this.activeSearchType)}`;
      if (this.activeArtistFilter) endpoint += `&artist=${encodeURIComponent(this.activeArtistFilter)}`;

      const newTracks = await API.get(endpoint);
      if (newTracks && newTracks.length > 0) {
        const startIdx = this.currentTracks.length;
        if (this.allSearchResults) {
          this.allSearchResults.push(...newTracks);
        }
        let tracksToAdd = newTracks;
        if (this.activeArtistFilter) {
          const lower = this.activeArtistFilter.toLowerCase();
          tracksToAdd = newTracks.filter(t => {
            const tArtist = (t.artist || '').toLowerCase();
            return tArtist.includes(lower) || lower.includes(tArtist);
          });
        }
        // Deduplicate against existing currentTracks
        const existingIds = new Set(this.currentTracks.map(t => String(t.id || t.jamendoId)));
        const uniqueToAdd = tracksToAdd.filter(t => !existingIds.has(String(t.id || t.jamendoId)));
        if (uniqueToAdd.length > 0) {
          this.currentTracks.push(...uniqueToAdd);
          UI.appendTrackGrid(uniqueToAdd, document.getElementById('searchGrid'), startIdx, this.currentTracks);
        }
      } else {
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
    container.replaceChildren();

    if (typeof UI !== 'undefined' && typeof UI.createBackBar === 'function') {
      container.appendChild(UI.createBackBar('home', 'likedBackBtn'));
    }

    const header = document.createElement('div');
    header.className = 'view-header';

    const leftDiv = document.createElement('div');
    const h2 = document.createElement('h2');
    h2.className = 'view-title';
    h2.innerHTML = '<i class="fa-solid fa-heart" style="color:var(--accent);"></i> Favourite Songs';

    const p = document.createElement('p');
    p.className = 'view-description';
    p.textContent = 'Your collection of loved and favourite tracks';

    leftDiv.appendChild(h2);
    leftDiv.appendChild(p);

    const playBtn = document.createElement('button');
    playBtn.className = 'hero-btn';
    playBtn.style.padding = '8px 18px';
    playBtn.style.fontSize = '13px';
    playBtn.innerHTML = '<i class="fa-solid fa-play"></i> Play Favourites';
    playBtn.addEventListener('click', () => this.playAllCurrent());

    header.appendChild(leftDiv);
    header.appendChild(playBtn);

    const listDiv = document.createElement('div');
    listDiv.id = 'likedTrackList';
    listDiv.className = 'track-list';
    listDiv.innerHTML = '<div style="text-align:center; padding:40px;"><i class="fa-solid fa-spinner fa-spin fa-2x" style="color:var(--accent-yt-red)"></i></div>';

    container.appendChild(header);
    container.appendChild(listDiv);

    try {
      const likes = await API.get('/likes');
      this.currentTracks = likes;
      UI.likedTrackIds = new Set(likes.map(l => String(l.jamendoId)));
      UI.renderTrackList(likes, document.getElementById('likedTrackList'));
    } catch (err) {
      UI.showToast('Failed to load favourite songs', 'error');
    }
  }

  // View Loader: HISTORY VIEW
  async loadHistoryView() {
    const container = document.getElementById('mainView');
    container.innerHTML = `
      <div id="historyBackBarSlot"></div>
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

    if (typeof UI !== 'undefined' && typeof UI.createBackBar === 'function') {
      const slot = document.getElementById('historyBackBarSlot');
      if (slot) slot.replaceWith(UI.createBackBar('home', 'historyBackBtn'));
    }

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
        container.replaceChildren();
        const emptyDiv = document.createElement('div');
        emptyDiv.style.textAlign = 'center';
        emptyDiv.style.padding = '60px 20px';
        const h2 = document.createElement('h2');
        h2.textContent = 'Playlist Not Found';
        emptyDiv.appendChild(h2);
        container.appendChild(emptyDiv);
        return;
      }

      this.currentTracks = playlist.tracks || [];

      container.replaceChildren();

      if (typeof UI !== 'undefined' && typeof UI.createBackBar === 'function') {
        container.appendChild(UI.createBackBar('library', 'playlistBackBtn'));
      }

      const header = document.createElement('div');
      header.className = 'view-header';

      const leftDiv = document.createElement('div');
      const h2 = document.createElement('h2');
      h2.className = 'view-title';
      const icon = document.createElement('i');
      icon.className = 'fa-solid fa-list-check';
      h2.appendChild(icon);
      h2.appendChild(document.createTextNode(' ' + playlist.name));

      const p = document.createElement('p');
      p.className = 'view-description';
      p.textContent = `${playlist.tracks.length} tracks • Created ${new Date(playlist.createdAt).toLocaleDateString()}`;

      leftDiv.appendChild(h2);
      leftDiv.appendChild(p);

      const rightDiv = document.createElement('div');
      rightDiv.style.display = 'flex';
      rightDiv.style.gap = '10px';

      const playBtn = document.createElement('button');
      playBtn.className = 'btn-primary';
      playBtn.style.width = 'auto';
      playBtn.style.padding = '8px 18px';
      playBtn.style.fontSize = '13px';
      playBtn.innerHTML = '<i class="fa-solid fa-play"></i> Play Playlist';
      playBtn.addEventListener('click', () => this.playAllCurrent());

      const renameBtn = document.createElement('button');
      renameBtn.className = 'control-btn';
      renameBtn.title = 'Rename Playlist';
      renameBtn.innerHTML = '<i class="fa-solid fa-pen"></i>';
      renameBtn.addEventListener('click', () => this.openRenamePlaylistModal(playlist.id, playlist.name));

      const delBtn = document.createElement('button');
      delBtn.className = 'control-btn';
      delBtn.title = 'Delete Playlist';
      delBtn.style.color = 'var(--accent-yt-red)';
      delBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
      delBtn.addEventListener('click', () => this.deletePlaylist(playlist.id));

      rightDiv.appendChild(playBtn);
      rightDiv.appendChild(renameBtn);
      rightDiv.appendChild(delBtn);

      header.appendChild(leftDiv);
      header.appendChild(rightDiv);

      const tracksContainer = document.createElement('div');
      tracksContainer.id = 'playlistTracksContainer';

      container.appendChild(header);
      container.appendChild(tracksContainer);

      UI.renderTrackList(playlist.tracks, document.getElementById('playlistTracksContainer'), playlist.id);
    } catch (err) {
      UI.showToast('Failed to load playlist', 'error');
    }
  }

  // Play track handlers
  playTrackFromList(index, tracksList = null) {
    const list = tracksList || this.currentTracks;
    if (!list || list.length === 0) return;
    if (index < 0 || index >= list.length) return;

    const track = list[index];
    if (!track) return;

    const currentId = player.currentTrack ? (player.currentTrack.jamendoId || player.currentTrack.id) : null;
    const trackId = track.jamendoId || track.id;
    // Only toggle play if it's the exact same track AND audio element has an active valid src without error
    if (currentId && String(currentId) === String(trackId) && player.audio && player.audio.src && !player.audio.error) {
      player.togglePlay();
      return;
    }

    player.playTrack(track, list, index);
  }

  async playTrackObject(trackId) {
    const currentId = player.currentTrack ? (player.currentTrack.jamendoId || player.currentTrack.id) : null;
    if (currentId && String(currentId) === String(trackId)) {
      player.togglePlay();
      return;
    }

    const idStr = String(trackId);
    let track = (this.currentTracks && this.currentTracks.find(t => String(t.id) === idStr || String(t.jamendoId) === idStr)) ||
                (this.recentTracks && this.recentTracks.find(t => String(t.id) === idStr || String(t.jamendoId) === idStr)) ||
                (this.trackCache && this.trackCache.get(idStr));
    if (!track) {
      try {
        track = await API.get(`/music/track/${trackId}`);
        if (track) this.registerTrack(track);
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
    const mainPanel = document.querySelector('.main-glass-panel');
    if (!drawer) return;
    const isOpen = open !== null ? open : !drawer.classList.contains('open');
    drawer.classList.toggle('open', isOpen);
    if (mainPanel) {
      mainPanel.classList.toggle('player-expanded-mode', isOpen);
    }
    if (isOpen) {
      if (typeof player !== 'undefined' && player.currentTrack && typeof player.updateNowPlayingUI === 'function') {
        player.updateNowPlayingUI();
      }
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
    } else if (tabName === 'related') {
      if (player.currentTrack) {
        player.fetchRelatedTracks(player.currentTrack);
      } else if (this.currentTracks.length > 0) {
        UI.renderTrackList(this.currentTracks.slice(0, 10), document.getElementById('relatedTracksList'));
      }
    }
  }

  // Likes Management
  async loadUserLikes() {
    try {
      const likes = await API.get('/likes');
      UI.likedTrackIds = new Set(likes.map(l => String(l.jamendoId)));
      this.updateLikedBadge();
    } catch (e) {}
  }

  updateLikedBadge() {
    const badge = document.getElementById('likedCountBadge');
    if (badge && UI.likedTrackIds) {
      badge.textContent = UI.likedTrackIds.size;
    }
  }

  async toggleLikeTrack(jamendoId, explicitTrack = null) {
    const idStr = String(jamendoId || '');
    if (!idStr) return;

    let track = explicitTrack;

    if (!track) {
      track = (this.currentTracks && this.currentTracks.find(t => String(t.jamendoId || t.id) === idStr)) ||
              (this.recentTracks && this.recentTracks.find(t => String(t.jamendoId || t.id) === idStr)) ||
              (this.trackCache && this.trackCache.get(idStr));
    }

    // Only fallback to player.currentTrack if player's currentTrack matches the target ID!
    if (!track && typeof player !== 'undefined' && player && player.currentTrack) {
      const curId = String(player.currentTrack.jamendoId || player.currentTrack.id || '');
      if (curId === idStr) {
        track = player.currentTrack;
      }
    }

    // If still not found and track is not already liked, attempt to fetch details from API
    if (!track && UI.likedTrackIds && !UI.likedTrackIds.has(idStr)) {
      try {
        track = await API.get(`/music/track/${encodeURIComponent(idStr)}`);
        if (track) this.registerTrack(track);
      } catch (e) {
        console.warn('[App] Could not fetch track details for like:', e.message);
      }
    }

    if (!track && UI.likedTrackIds && !UI.likedTrackIds.has(idStr)) {
      UI.showToast('Could not find track information to like', 'error');
      return;
    }

    try {
      const payload = track ? {
        title: track.title,
        artist: track.artist,
        coverUrl: track.coverUrl,
        audioUrl: track.audioUrl || (track.id ? `/api/music/stream/${track.id}` : `/api/music/stream/${idStr}`),
        duration: track.duration || 0
      } : {};

      const res = await API.post(`/likes/${idStr}`, payload);

      if (res.liked) {
        if (UI.likedTrackIds) UI.likedTrackIds.add(idStr);
      } else {
        if (UI.likedTrackIds) UI.likedTrackIds.delete(idStr);
      }

      this.updateLikedBadge();
      UI.updateLikeStatus(idStr);
      if (this.currentView === 'liked') this.loadLikedTracksView();
      this.loadRecentPlayed();
    } catch (err) {
      if (UI.updateLikeStatus) UI.updateLikeStatus(idStr);
      UI.showToast('Failed to update likes', 'error');
    }
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
    document.querySelectorAll('.modal-overlay').forEach(m => {
      m.classList.remove('open');
      m.classList.remove('active');
    });
  }

  openRenamePlaylistModal(playlistId, currentName) {
    const modal = document.getElementById('renamePlaylistModal');
    const idInput = document.getElementById('renamePlaylistId');
    const nameInput = document.getElementById('renamePlaylistNameInput');
    if (!modal || !idInput || !nameInput) return;

    idInput.value = playlistId;
    nameInput.value = currentName || '';
    modal.classList.add('open');
    nameInput.focus();
    nameInput.select();
  }

  async handleRenamePlaylist(e) {
    e.preventDefault();
    const idInput = document.getElementById('renamePlaylistId');
    const nameInput = document.getElementById('renamePlaylistNameInput');
    if (!idInput || !nameInput) return;

    const playlistId = idInput.value;
    const name = nameInput.value.trim();
    if (!name) return;

    try {
      await API.put(`/playlists/${playlistId}`, { name });
      this.closeModals();
      UI.showToast(`Playlist renamed to "${name}"`);
      await this.loadUserPlaylists();
      if (this.currentView === 'playlist') {
        this.loadPlaylistView(playlistId);
      }
    } catch (err) {
      UI.showToast(err.message || 'Failed to rename playlist', 'error');
    }
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

  async openAddToPlaylistModal(jamendoId, explicitTrack = null) {
    const idStr = String(jamendoId || '');
    let track = explicitTrack;
    if (!track) {
      track = (this.currentTracks && this.currentTracks.find(t => String(t.jamendoId || t.id) === idStr)) ||
              (this.recentTracks && this.recentTracks.find(t => String(t.jamendoId || t.id) === idStr)) ||
              (this.trackCache && this.trackCache.get(idStr));
    }
    if (!track && typeof player !== 'undefined' && player && player.currentTrack) {
      const curId = String(player.currentTrack.jamendoId || player.currentTrack.id || '');
      if (curId === idStr) track = player.currentTrack;
    }
    this.selectedTrackForPlaylist = track;
    if (!this.selectedTrackForPlaylist) return;

    const modal = document.getElementById('addToPlaylistModal');
    const container = document.getElementById('playlistSelectList');
    if (!container) return;

    container.replaceChildren();
    const playlists = UI.userPlaylists;

    if (!playlists || playlists.length === 0) {
      const p = document.createElement('p');
      p.style.fontSize = '13px';
      p.style.color = 'var(--text-muted)';
      p.style.padding = '10px';
      p.textContent = 'No playlists found. Create one first!';

      const btn = document.createElement('button');
      btn.className = 'btn-primary';
      btn.style.marginTop = '10px';
      btn.textContent = 'Create Playlist';
      btn.addEventListener('click', () => {
        this.closeModals();
        this.openCreatePlaylistModal();
      });

      container.appendChild(p);
      container.appendChild(btn);
    } else {
      playlists.forEach(p => {
        const btn = document.createElement('button');
        btn.className = 'nav-item';
        btn.style.justifyContent = 'space-between';
        btn.style.width = '100%';
        btn.style.border = '1px solid var(--border-color)';
        btn.dataset.playlistId = p.id;
        btn.addEventListener('click', () => this.addTrackToPlaylist(p.id));

        const nameSpan = document.createElement('span');
        nameSpan.style.fontWeight = '600';
        const icon = document.createElement('i');
        icon.className = 'fa-solid fa-list-check';
        icon.style.marginRight = '10px';
        nameSpan.appendChild(icon);
        nameSpan.appendChild(document.createTextNode(p.name));

        const countSpan = document.createElement('span');
        countSpan.style.fontSize = '12px';
        countSpan.style.color = 'var(--text-muted)';
        countSpan.textContent = `${p.tracks.length} tracks`;

        btn.appendChild(nameSpan);
        btn.appendChild(countSpan);
        container.appendChild(btn);
      });
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

  // View Loader: MOOD VIEW
  async loadMoodView(moodKey) {
    const container = document.getElementById('mainView');
    container.innerHTML = `<div style="text-align:center; padding:50px;"><i class="fa-solid fa-spinner fa-spin fa-2x" style="color:var(--accent)"></i></div>`;
    try {
      const data = await API.get(`/music/moods/${encodeURIComponent(moodKey)}`);
      this.currentTracks = data.tracks || [];
      UI.renderMoodView(data, container);
    } catch (e) {
      UI.showToast('Failed to load mood tracks', 'error');
    }
  }

  // View Loader: ARTIST PROFILE VIEW
  async loadArtistView(artistQuery) {
    const container = document.getElementById('mainView');
    container.innerHTML = `<div style="text-align:center; padding:50px;"><i class="fa-solid fa-spinner fa-spin fa-2x" style="color:var(--accent)"></i></div>`;
    try {
      const profile = await API.get(`/music/artist/${encodeURIComponent(artistQuery)}`);
      this.currentTracks = profile.songs || [];
      UI.renderArtistProfile(profile, container);
    } catch (e) {
      container.innerHTML = `
        <div style="text-align:center; padding:60px 20px;">
          <h2 style="font-size:22px; font-weight:700; color:#fff; margin-bottom:8px;">Artist Profile Unavailable</h2>
          <p style="color:var(--text-muted); font-size:13px; max-width:400px; margin:0 auto 20px;">We couldn't find an artist profile matching "${UI.escapeHTML(artistQuery)}".</p>
          <button onclick="window.history.back()" class="btn-primary" style="width:auto; padding:8px 20px;">Go Back</button>
        </div>
      `;
    }
  }

  // View Loader: LISTENING INSIGHTS
  async loadInsightsView() {
    const container = document.getElementById('mainView');
    container.innerHTML = `<div style="text-align:center; padding:50px;"><i class="fa-solid fa-spinner fa-spin fa-2x" style="color:var(--accent)"></i></div>`;
    try {
      const insights = await API.get('/history/insights');
      UI.renderListeningInsights(insights, container);
    } catch (e) {
      UI.showToast('Failed to load listening insights', 'error');
    }
  }

  // View Loader: SETTINGS VIEW
  async loadSettingsView() {
    const container = document.getElementById('mainView');
    if (!container) return;
    container.replaceChildren();

    const currentTheme = (typeof localStorage !== 'undefined' ? localStorage.getItem('auralist_theme') : null) || 'system';
    const user = typeof API !== 'undefined' && API.getUser ? API.getUser() : null;
    const isLoggedIn = Boolean(user && user.name);

    const safeName = typeof UI !== 'undefined' && UI.escapeHtml ? UI.escapeHtml(user?.name || '') : (user?.name || '');
    const safeEmail = typeof UI !== 'undefined' && UI.escapeHtml ? UI.escapeHtml(user?.email || '') : (user?.email || '');

    const currentQuality = typeof player !== 'undefined' ? player.audioQuality : 'hd';
    const compressorChecked = typeof player !== 'undefined' ? Boolean(player.compressorEnabled) : true;
    const currentVol = typeof player !== 'undefined' && player.audio ? Math.round(player.audio.volume * 100) : 80;

    const wrapper = document.createElement('div');
    wrapper.className = 'settings-container';
    wrapper.innerHTML = `
      <div id="settingsBackBarSlot"></div>
      <div class="view-header" style="margin-bottom:28px;">
        <div>
          <h2 class="view-title"><i class="fa-solid fa-gear"></i> Settings</h2>
          <p class="view-description">Manage your application appearance, account security, audio playback preferences, and privacy.</p>
        </div>
      </div>

      <!-- Section 1: Appearance -->
      <div class="settings-card" id="settingsAppearanceCard">
        <div class="settings-card-header">
          <h3 class="settings-card-title"><i class="fa-solid fa-palette"></i> Appearance & Theme</h3>
          <p class="settings-card-desc">AuraList signature aesthetic: Midnight Echoes with cinematic ambient lighting and glassmorphism.</p>
        </div>
        <div class="theme-options-grid" style="grid-template-columns: 1fr;">
          <div class="theme-option-card active" data-theme-val="midnight" tabindex="0" role="button" aria-label="Midnight Echoes Theme">
            <i class="fa-solid fa-city theme-icon" style="color:#00DCA0;"></i>
            <span class="theme-label">Midnight Echoes (Signature Theme)</span>
            <span class="theme-sublabel" style="font-size:11px; color:var(--text-dim); display:block; margin-top:2px;">Neon City Skyline &bull; Dark Studio Glassmorphism &bull; Active</span>
          </div>
        </div>
      </div>

      <!-- Section 2: Account & Security -->
      <div class="settings-card" id="settingsAccountCard">
        <div class="settings-card-header">
          <h3 class="settings-card-title"><i class="fa-solid fa-user-shield"></i> Account & Security</h3>
          <p class="settings-card-desc">Manage your profile details and update your secure password.</p>
        </div>

        ${isLoggedIn ? `
          <form id="settingsProfileForm" class="settings-field-group" style="margin-bottom:24px; padding-bottom:20px; border-bottom:1px solid var(--border-subtle);">
            <div class="form-group" style="margin-bottom:14px;">
              <label class="settings-label" for="settingsNameInput">Display Name</label>
              <input type="text" id="settingsNameInput" class="form-control" value="${safeName}" maxlength="50" required style="padding-left:14px;">
            </div>
            <div class="form-group" style="margin-bottom:14px;">
              <label class="settings-label" for="settingsEmailInput">Email Address</label>
              <input type="email" id="settingsEmailInput" class="form-control" value="${safeEmail}" disabled readonly style="padding-left:14px; opacity:0.65; cursor:not-allowed;">
              <p class="settings-subtext"><i class="fa-solid fa-lock" style="margin-right:4px;"></i> Email address cannot be changed directly to prevent account hijacking.</p>
            </div>
            <button type="submit" id="saveProfileBtn" class="btn-primary btn-auto" style="padding:10px 22px; font-size:13px; display:inline-flex; align-items:center; gap:8px;">
              <i class="fa-solid fa-floppy-disk"></i> Save Profile
            </button>
          </form>

          <form id="settingsPasswordForm" class="settings-field-group">
            <h4 style="font-size:14px; font-weight:700; color:var(--text-main); margin-bottom:12px;">Change Password</h4>
            <div class="form-group" style="margin-bottom:14px;">
              <label class="settings-label" for="settingsCurrentPass">Current Password</label>
              <input type="password" id="settingsCurrentPass" class="form-control" placeholder="••••••••" required style="padding-left:14px;" autocomplete="current-password">
            </div>
            <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:12px; margin-bottom:14px;">
              <div class="form-group" style="margin-bottom:0;">
                <label class="settings-label" for="settingsNewPass">New Password</label>
                <input type="password" id="settingsNewPass" class="form-control" placeholder="Minimum 8 characters" minlength="8" required style="padding-left:14px;" autocomplete="new-password">
              </div>
              <div class="form-group" style="margin-bottom:0;">
                <label class="settings-label" for="settingsConfirmPass">Confirm New Password</label>
                <input type="password" id="settingsConfirmPass" class="form-control" placeholder="Repeat new password" minlength="8" required style="padding-left:14px;" autocomplete="new-password">
              </div>
            </div>
            <button type="submit" id="changePasswordBtn" class="btn-primary btn-auto" style="padding:10px 22px; font-size:13px; display:inline-flex; align-items:center; gap:8px;">
              <i class="fa-solid fa-key"></i> Update Password
            </button>
          </form>
        ` : `
          <div style="text-align:center; padding:24px 16px;">
            <i class="fa-solid fa-user-slash fa-2x" style="color:var(--text-dim); margin-bottom:12px;"></i>
            <p style="color:var(--text-main); font-weight:600; margin-bottom:6px;">You are currently browsing as a Guest</p>
            <p style="color:var(--text-muted); font-size:13px; margin-bottom:16px;">Sign in to save your personal playlists, like songs, and customize your profile.</p>
            <div style="display:flex; justify-content:center; gap:12px;">
              <a href="/login" class="btn-primary btn-auto" style="padding:8px 20px; font-size:13px; text-decoration:none;">Sign In</a>
              <a href="/register" class="btn-secondary btn-auto" style="padding:8px 20px; font-size:13px; text-decoration:none;">Create Account</a>
            </div>
          </div>
        `}
      </div>

      <!-- Section 3: Audio & Playback Preferences -->
      <div class="settings-card" id="settingsPlaybackCard">
        <div class="settings-card-header">
          <h3 class="settings-card-title"><i class="fa-solid fa-sliders"></i> Audio & Playback Preferences</h3>
          <p class="settings-card-desc">Configure audio stream bitrate, digital signal processing (DSP), and output levels.</p>
        </div>

        <div class="settings-row-between">
          <div>
            <span class="settings-label">Streaming Audio Quality</span>
            <p class="settings-subtext">Toggle between crystal-clear 320 kbps Ultra HD and standard data-saver audio.</p>
          </div>
          <div style="display:flex; gap:8px;">
            <button type="button" class="btn-secondary btn-auto ${currentQuality === 'hd' ? 'btn-primary' : ''}" id="settingsQualityHdBtn" style="padding:6px 14px; font-size:12px;">
              320 kbps HD
            </button>
            <button type="button" class="btn-secondary btn-auto ${currentQuality === 'standard' ? 'btn-primary' : ''}" id="settingsQualityStdBtn" style="padding:6px 14px; font-size:12px;">
              160 kbps Std
            </button>
          </div>
        </div>

        <div class="settings-row-between">
          <div>
            <span class="settings-label">Dynamics Compressor</span>
            <p class="settings-subtext">Studio-grade normalization prevents volume spikes and clipping distortion.</p>
          </div>
          <label class="switch-toggle" for="settingsCompToggle" style="margin:0;">
            <input type="checkbox" id="settingsCompToggle" ${compressorChecked ? 'checked' : ''}>
            <span class="switch-slider"></span>
          </label>
        </div>

        <div class="settings-row-between">
          <div style="flex:1; max-width:320px;">
            <span class="settings-label">Default Master Volume</span>
            <p class="settings-subtext">Adjust the initial audio output level.</p>
          </div>
          <div style="display:flex; align-items:center; gap:12px; width:220px;">
            <input type="range" id="settingsVolumeRange" class="range-slider" min="0" max="100" value="${currentVol}" style="flex:1;">
            <span id="settingsVolumeText" style="font-size:13px; font-weight:700; color:var(--text-main); width:38px; text-align:right;">${currentVol}%</span>
          </div>
        </div>

        <div style="margin-top:16px; padding-top:16px; border-top:1px solid var(--border-subtle); display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px;">
          <div>
            <span class="settings-label">Equalizer DSP Studio</span>
            <p class="settings-subtext">Fine-tune individual 3-band frequencies (Bass, Mid, Treble) and acoustic presets.</p>
          </div>
          <button type="button" id="settingsOpenEqBtn" class="btn-secondary btn-auto" style="padding:8px 16px; font-size:13px; display:inline-flex; align-items:center; gap:8px;">
            <i class="fa-solid fa-sliders"></i> Open Equalizer
          </button>
        </div>
      </div>

      <!-- Section 4: Privacy & Listening History -->
      <div class="settings-card" id="settingsPrivacyCard">
        <div class="settings-card-header">
          <h3 class="settings-card-title"><i class="fa-solid fa-shield-halved"></i> Privacy & Listening Data</h3>
          <p class="settings-card-desc">Learn how your data is used and manage your stored listening metrics.</p>
        </div>

        <div style="background:rgba(255,255,255,0.03); border:1px solid var(--border-subtle); border-radius:var(--radius-md); padding:16px; margin-bottom:18px;">
          <p style="font-size:13px; color:var(--text-muted); line-height:1.6; margin:0;">
            <strong style="color:var(--text-main);">How AuraList uses your data:</strong> Playback sessions and timestamps are tracked on the server to compute personal <em>Listening Insights</em>, maintain resume positions for <em>Continue Listening</em>, and generate tailored discovery recommendations. Your history is strictly isolated per account and never sold.
          </p>
        </div>

        ${isLoggedIn ? `
          <div class="settings-row-between">
            <div>
              <span class="settings-label" style="color:#f87171;">Clear Listening History</span>
              <p class="settings-subtext">Permanently delete all your playback checkpoints and listening events.</p>
            </div>
            <button type="button" id="settingsClearHistoryBtn" class="btn-danger btn-auto">
              <i class="fa-solid fa-trash-can" style="margin-right:6px;"></i> Clear History
            </button>
          </div>
        ` : `
          <p class="settings-subtext">Sign in to review and manage your stored listening history.</p>
        `}
      </div>

      <!-- Section 5: About AuraList -->
      <div class="settings-card" id="settingsAboutCard">
        <div class="settings-card-header">
          <h3 class="settings-card-title"><i class="fa-solid fa-circle-info"></i> About AuraList</h3>
          <p class="settings-card-desc">Application architecture and music engine specifications.</p>
        </div>

        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:16px;">
          <div>
            <span class="settings-subtext">Version</span>
            <p style="font-size:14px; font-weight:700; color:var(--text-main); margin-top:2px;">AuraList v1.0.0</p>
          </div>
          <div>
            <span class="settings-subtext">Catalog Size</span>
            <p style="font-size:14px; font-weight:700; color:var(--text-main); margin-top:2px;">3,731 Songs Indexed</p>
          </div>
          <div>
            <span class="settings-subtext">Streaming Providers</span>
            <p style="font-size:14px; font-weight:700; color:var(--text-main); margin-top:2px;">JioSaavn • Jamendo • Audius</p>
          </div>
          <div>
            <span class="settings-subtext">Audio Processing</span>
            <p style="font-size:14px; font-weight:700; color:var(--text-main); margin-top:2px;">Web Audio API (Biquad DSP + Compressor)</p>
          </div>
        </div>
      </div>
    `;

    container.appendChild(wrapper);

    if (typeof UI !== 'undefined' && typeof UI.createBackBar === 'function') {
      const slot = wrapper.querySelector('#settingsBackBarSlot');
      if (slot) slot.replaceWith(UI.createBackBar('home', 'settingsBackBtn'));
    }

    // Wire Theme Selector
    wrapper.querySelectorAll('.theme-option-card').forEach(card => {
      card.addEventListener('click', () => {
        const theme = card.getAttribute('data-theme-val') || 'midnight';
        this.applyTheme(theme, true);
        wrapper.querySelectorAll('.theme-option-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        if (typeof UI !== 'undefined' && UI.showToast) {
          UI.showToast('Midnight Echoes is the signature active theme', 'info');
        }
      });
    });

    // Wire Profile Form
    const profileForm = document.getElementById('settingsProfileForm');
    if (profileForm) {
      profileForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const nameInput = document.getElementById('settingsNameInput');
        const saveBtn = document.getElementById('saveProfileBtn');
        const newName = nameInput ? nameInput.value.trim() : '';
        if (newName.length < 2) {
          if (typeof UI !== 'undefined' && UI.showToast) UI.showToast('Name must be at least 2 characters.', 'error');
          return;
        }

        try {
          if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
          }
          const res = await API.put('/auth/profile', { name: newName });
          if (res && res.user) {
            if (typeof API.setToken === 'function' && res.token) API.setToken(res.token);
            if (typeof API.setUser === 'function') API.setUser(res.user);
            this.updateUserUI(res.user);
            if (typeof UI !== 'undefined' && UI.showToast) UI.showToast('Profile updated successfully!', 'success');
          }
        } catch (err) {
          if (typeof UI !== 'undefined' && UI.showToast) UI.showToast(err.message || 'Failed to update profile', 'error');
        } finally {
          if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save Profile';
          }
        }
      });
    }

    // Wire Password Form
    const passwordForm = document.getElementById('settingsPasswordForm');
    if (passwordForm) {
      passwordForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const curInput = document.getElementById('settingsCurrentPass');
        const newInput = document.getElementById('settingsNewPass');
        const confInput = document.getElementById('settingsConfirmPass');
        const passBtn = document.getElementById('changePasswordBtn');

        const currentPassword = curInput ? curInput.value : '';
        const newPassword = newInput ? newInput.value : '';
        const confirmPassword = confInput ? confInput.value : '';

        if (!currentPassword) {
          if (typeof UI !== 'undefined' && UI.showToast) UI.showToast('Current password is required.', 'error');
          return;
        }
        if (newPassword.length < 8) {
          if (typeof UI !== 'undefined' && UI.showToast) UI.showToast('New password must be at least 8 characters.', 'error');
          return;
        }
        if (newPassword !== confirmPassword) {
          if (typeof UI !== 'undefined' && UI.showToast) UI.showToast('New passwords do not match.', 'error');
          return;
        }

        try {
          if (passBtn) {
            passBtn.disabled = true;
            passBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Updating...';
          }
          await API.put('/auth/password', { currentPassword, newPassword });
          if (curInput) curInput.value = '';
          if (newInput) newInput.value = '';
          if (confInput) confInput.value = '';
          if (typeof UI !== 'undefined' && UI.showToast) UI.showToast('Password updated successfully!', 'success');
        } catch (err) {
          if (typeof UI !== 'undefined' && UI.showToast) UI.showToast(err.message || 'Failed to update password', 'error');
        } finally {
          if (passBtn) {
            passBtn.disabled = false;
            passBtn.innerHTML = '<i class="fa-solid fa-key"></i> Update Password';
          }
        }
      });
    }

    // Wire Quality Buttons
    const qHdBtn = document.getElementById('settingsQualityHdBtn');
    const qStdBtn = document.getElementById('settingsQualityStdBtn');
    if (qHdBtn && qStdBtn) {
      qHdBtn.addEventListener('click', () => {
        if (typeof player !== 'undefined') player.setAudioQuality('hd');
        qHdBtn.className = 'btn-primary btn-auto';
        qStdBtn.className = 'btn-secondary btn-auto';
      });
      qStdBtn.addEventListener('click', () => {
        if (typeof player !== 'undefined') player.setAudioQuality('standard');
        qStdBtn.className = 'btn-primary btn-auto';
        qHdBtn.className = 'btn-secondary btn-auto';
      });
    }

    // Wire Compressor Toggle
    const compToggle = document.getElementById('settingsCompToggle');
    if (compToggle) {
      compToggle.addEventListener('change', (e) => {
        if (typeof player !== 'undefined') player.setCompressor(e.target.checked);
      });
    }

    // Wire Master Volume Slider
    const volRange = document.getElementById('settingsVolumeRange');
    const volText = document.getElementById('settingsVolumeText');
    if (volRange) {
      volRange.addEventListener('input', (e) => {
        const val = Number(e.target.value);
        if (volText) volText.textContent = `${val}%`;
        if (typeof player !== 'undefined') player.setVolume(val / 100);
      });
    }

    // Wire Open Equalizer Modal
    const openEqBtn = document.getElementById('settingsOpenEqBtn');
    if (openEqBtn) {
      openEqBtn.addEventListener('click', () => {
        if (typeof player !== 'undefined' && typeof player.openEnhancerModal === 'function') {
          player.openEnhancerModal();
        }
      });
    }

    // Wire Clear History Button
    const clearHistBtn = document.getElementById('settingsClearHistoryBtn');
    if (clearHistBtn) {
      clearHistBtn.addEventListener('click', async () => {
        const confirmed = typeof window !== 'undefined' && window.confirm
          ? window.confirm('Are you sure you want to clear your listening history? This will delete all playback checkpoints and reset Listening Insights.')
          : true;
        if (!confirmed) return;

        try {
          clearHistBtn.disabled = true;
          clearHistBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Clearing...';
          await API.delete('/history');
          if (typeof UI !== 'undefined' && UI.showToast) {
            UI.showToast('Playback history cleared successfully.', 'success');
          }
        } catch (err) {
          if (typeof UI !== 'undefined' && UI.showToast) {
            UI.showToast(err.message || 'Failed to clear history', 'error');
          }
        } finally {
          clearHistBtn.disabled = false;
          clearHistBtn.innerHTML = '<i class="fa-solid fa-trash-can" style="margin-right:6px;"></i> Clear History';
        }
      });
    }
  }

  // Navigate to Artist Profile
  navigateToArtist(artistName) {
    if (!artistName) return;
    const primary = artistName.split(/[,&]/)[0].trim();
    window.location.hash = `artist/${encodeURIComponent(primary)}`;
  }

  // Open Keyboard Shortcuts Modal
  openShortcutsModal() {
    document.getElementById('shortcutsModal')?.classList.add('open');
  }

  // Open Settings Modal (YouTube Music 2-Column Modal matching Image 1)
  openSettingsModal(tab = 'general') {
    const modal = document.getElementById('settingsModal');
    if (!modal) return;
    this.closeModals();
    this.toggleProfileDropdown(false);
    modal.classList.add('open');
    this.switchSettingsTab(tab);
    this.populateSettingsValues();
  }

  switchSettingsTab(tabName) {
    const modal = document.getElementById('settingsModal');
    if (!modal) return;
    modal.querySelectorAll('.settings-nav-tab').forEach(tab => {
      const isMatch = tab.dataset.tab === tabName;
      tab.classList.toggle('active', isMatch);
      tab.setAttribute('aria-selected', isMatch ? 'true' : 'false');
    });
    modal.querySelectorAll('.settings-tab-panel').forEach(panel => {
      panel.classList.toggle('active', panel.id === `settingsTab-${tabName}`);
    });
  }

  populateSettingsValues() {
    const user = typeof API !== 'undefined' && API.getUser ? API.getUser() : null;
    const nameInput = document.getElementById('modalNameInput');
    const emailInput = document.getElementById('modalEmailInput');
    if (nameInput && user) nameInput.value = user.name || '';
    if (emailInput && user) emailInput.value = user.email || '';

    // General toggles from localStorage (Image 1)
    if (typeof localStorage !== 'undefined') {
      const restr = document.getElementById('restrictedModeToggle');
      if (restr) restr.checked = localStorage.getItem('auralist_restricted_mode') === 'true';

      const showLiked = document.getElementById('showLikedMusicToggle');
      if (showLiked) showLiked.checked = localStorage.getItem('auralist_show_liked_music') !== 'false';

      const remRec = document.getElementById('rememberRecentPlaylistToggle');
      if (remRec) remRec.checked = localStorage.getItem('auralist_remember_recent_playlist') !== 'false';

      const pauseHist = document.getElementById('pauseHistoryToggle');
      if (pauseHist) pauseHist.checked = localStorage.getItem('auralist_pause_history') === 'true';
    }

    // Playback sync
    if (typeof player !== 'undefined') {
      const isHd = player.audioQuality === 'hd';
      document.getElementById('modalQualityHdBtn')?.classList.toggle('active', isHd);
      document.getElementById('modalQualityStdBtn')?.classList.toggle('active', !isHd);

      const comp = document.getElementById('modalCompressorToggle');
      if (comp) comp.checked = Boolean(player.compressorEnabled);

      const vol = player.audio ? Math.round(player.audio.volume * 100) : 80;
      const volSlider = document.getElementById('modalVolumeSlider');
      const volVal = document.getElementById('modalVolumeValue');
      if (volSlider) volSlider.value = vol;
      if (volVal) volVal.textContent = `${vol}%`;
    }
  }

  initSettingsModal() {
    const modal = document.getElementById('settingsModal');
    if (!modal) return;

    modal.querySelectorAll('.settings-nav-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        if (tab) this.switchSettingsTab(tab);
      });
    });

    document.getElementById('restrictedModeToggle')?.addEventListener('change', (e) => {
      try { localStorage.setItem('auralist_restricted_mode', e.target.checked ? 'true' : 'false'); } catch (err) {}
    });

    document.getElementById('showLikedMusicToggle')?.addEventListener('change', (e) => {
      try { localStorage.setItem('auralist_show_liked_music', e.target.checked ? 'true' : 'false'); } catch (err) {}
    });

    document.getElementById('rememberRecentPlaylistToggle')?.addEventListener('change', (e) => {
      try { localStorage.setItem('auralist_remember_recent_playlist', e.target.checked ? 'true' : 'false'); } catch (err) {}
    });

    document.getElementById('familyCentreRow')?.addEventListener('click', () => {
      if (typeof window !== 'undefined') window.open('https://families.google.com/', '_blank');
    });

    document.getElementById('modalQualityHdBtn')?.addEventListener('click', () => {
      if (typeof player !== 'undefined') player.setAudioQuality('hd');
      document.getElementById('modalQualityHdBtn')?.classList.add('active');
      document.getElementById('modalQualityStdBtn')?.classList.remove('active');
    });

    document.getElementById('modalQualityStdBtn')?.addEventListener('click', () => {
      if (typeof player !== 'undefined') player.setAudioQuality('standard');
      document.getElementById('modalQualityStdBtn')?.classList.add('active');
      document.getElementById('modalQualityHdBtn')?.classList.remove('active');
    });

    document.getElementById('modalCompressorToggle')?.addEventListener('change', (e) => {
      if (typeof player !== 'undefined') player.setCompressor(e.target.checked);
    });

    document.getElementById('modalOpenEqualizerBtn')?.addEventListener('click', () => {
      this.closeModals();
      if (typeof player !== 'undefined' && typeof player.openEnhancerModal === 'function') {
        player.openEnhancerModal();
      }
    });

    document.getElementById('modalVolumeSlider')?.addEventListener('input', (e) => {
      const vol = Number(e.target.value);
      if (typeof player !== 'undefined') player.setVolume(vol / 100);
      const valEl = document.getElementById('modalVolumeValue');
      if (valEl) valEl.textContent = `${vol}%`;
    });

    document.getElementById('clearDownloadsBtn')?.addEventListener('click', () => {
      if (typeof UI !== 'undefined' && UI.showToast) UI.showToast('Offline cache cleared successfully');
    });

    document.getElementById('modalClearHistoryBtn')?.addEventListener('click', async () => {
      const confirmed = typeof window !== 'undefined' && window.confirm
        ? window.confirm('Are you sure you want to permanently clear your playback history?')
        : true;
      if (!confirmed) return;
      try {
        await API.delete('/history');
        this.loadRecentPlayed();
        if (typeof UI !== 'undefined' && UI.showToast) UI.showToast('Playback history cleared successfully.', 'success');
      } catch (err) {
        if (typeof UI !== 'undefined' && UI.showToast) UI.showToast(err.message || 'Failed to clear history', 'error');
      }
    });

    document.getElementById('pauseHistoryToggle')?.addEventListener('change', (e) => {
      try { localStorage.setItem('auralist_pause_history', e.target.checked ? 'true' : 'false'); } catch (err) {}
      if (typeof UI !== 'undefined' && UI.showToast) UI.showToast(e.target.checked ? 'Listening history paused' : 'Listening history resumed', 'info');
    });

    document.getElementById('clearSearchHistoryBtn')?.addEventListener('click', () => {
      try { localStorage.removeItem('auralist_search_history'); } catch (err) {}
      if (typeof UI !== 'undefined' && UI.showToast) UI.showToast('Search history cleared');
    });

    document.getElementById('modalProfileForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const nameInput = document.getElementById('modalNameInput');
      const name = nameInput ? nameInput.value.trim() : '';
      if (!name || name.length < 2) {
        if (typeof UI !== 'undefined' && UI.showToast) UI.showToast('Name must be at least 2 characters.', 'error');
        return;
      }
      try {
        const res = await API.put('/auth/profile', { name });
        if (res && res.user) {
          this.updateUserUI(res.user);
          this.renderProfileDropdown();
          if (typeof UI !== 'undefined' && UI.showToast) UI.showToast('Profile updated successfully!', 'success');
        }
      } catch (err) {
        if (typeof UI !== 'undefined' && UI.showToast) UI.showToast(err.message || 'Failed to update profile', 'error');
      }
    });

    document.getElementById('modalPasswordForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const currentPassword = document.getElementById('modalCurrentPass')?.value || '';
      const newPassword = document.getElementById('modalNewPass')?.value || '';
      const confirmPassword = document.getElementById('modalConfirmPass')?.value || '';
      if (!currentPassword) {
        if (typeof UI !== 'undefined' && UI.showToast) UI.showToast('Current password is required.', 'error');
        return;
      }
      if (newPassword.length < 8) {
        if (typeof UI !== 'undefined' && UI.showToast) UI.showToast('New password must be at least 8 characters.', 'error');
        return;
      }
      if (newPassword !== confirmPassword) {
        if (typeof UI !== 'undefined' && UI.showToast) UI.showToast('New passwords do not match.', 'error');
        return;
      }
      try {
        await API.put('/auth/password', { currentPassword, newPassword });
        e.target.reset();
        if (typeof UI !== 'undefined' && UI.showToast) UI.showToast('Password updated successfully!', 'success');
      } catch (err) {
        if (typeof UI !== 'undefined' && UI.showToast) UI.showToast(err.message || 'Failed to update password', 'error');
      }
    });

    document.getElementById('resetRecBtn')?.addEventListener('click', () => {
      this.refreshRecommendations();
      if (typeof UI !== 'undefined' && UI.showToast) UI.showToast('Recommendations refreshed');
    });

    document.getElementById('aboutTermsLink')?.addEventListener('click', () => {
      this.switchSettingsTab('privacy');
    });

    // Wire local audio upload
    document.getElementById('triggerAudioFileInputBtn')?.addEventListener('click', () => {
      document.getElementById('localAudioFileInput')?.click();
    });
    document.getElementById('localAudioFileInput')?.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) {
        const fileUrl = URL.createObjectURL(file);
        const customTrack = {
          id: 'local_' + Date.now(),
          title: file.name.replace(/\.[^/.]+$/, ""),
          artist: 'Local File',
          audioUrl: fileUrl,
          coverUrl: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop',
          duration: 0
        };
        if (typeof player !== 'undefined') {
          player.playTrack(customTrack, [customTrack], 0);
        }
        this.closeModals();
        if (typeof UI !== 'undefined' && UI.showToast) UI.showToast(`Playing local audio: "${customTrack.title}"`);
      }
    });

    document.getElementById('createChannelForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = document.getElementById('channelNameInput')?.value.trim();
      if (name) {
        this.closeModals();
        if (typeof UI !== 'undefined' && UI.showToast) UI.showToast(`Creator Channel "${name}" created!`);
      }
    });

    document.getElementById('feedbackForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const ta = document.getElementById('feedbackText');
      if (ta) ta.value = '';
      this.closeModals();
      if (typeof UI !== 'undefined' && UI.showToast) UI.showToast('Thank you for your feedback!');
    });
  }

  openPremiumModal() {
    this.closeModals();
    document.getElementById('premiumModal')?.classList.add('open');
  }

  openChannelModal() {
    this.closeModals();
    const user = typeof API !== 'undefined' && API.getUser ? API.getUser() : null;
    const nameInput = document.getElementById('channelNameInput');
    if (nameInput && user) nameInput.value = user.name ? `${user.name}'s Channel` : '';
    document.getElementById('channelModal')?.classList.add('open');
  }

  openSwitchAccountModal() {
    this.closeModals();
    const user = typeof API !== 'undefined' && API.getUser ? API.getUser() : null;
    const list = document.getElementById('switchAccountList');
    if (list && user) {
      list.innerHTML = `
        <div style="display:flex; align-items:center; gap:12px; padding:10px; background:rgba(255,255,255,0.06); border-radius:8px;">
          <div style="width:36px; height:36px; border-radius:50%; background:#00796b; display:flex; align-items:center; justify-content:center; color:#fff; font-weight:700;">
            ${(user.name || 'U').charAt(0).toUpperCase()}
          </div>
          <div style="flex:1;">
            <div style="font-weight:600; font-size:13px; color:#fff;">${user.name || 'User'}</div>
            <div style="font-size:11.5px; color:#aaa;">${user.email || ''}</div>
          </div>
          <i class="fa-solid fa-check" style="color:#3ea6ff;"></i>
        </div>
      `;
    }
    document.getElementById('switchAccountModal')?.classList.add('open');
  }

  openUploadMusicModal() {
    this.closeModals();
    document.getElementById('uploadMusicModal')?.classList.add('open');
  }

  openFeedbackModal() {
    this.closeModals();
    document.getElementById('feedbackModal')?.classList.add('open');
  }

  // Refresh Smart Recommendations on demand
  async refreshRecommendations() {
    const box = document.getElementById('recommendationsBox');
    if (!box || this.currentView !== 'home') return;
    try {
      const recTracks = await API.get('/music/recommendations?limit=15');
      if (Array.isArray(recTracks) && recTracks.length > 0) {
        UI.renderRecommendations(recTracks, box);
      }
    } catch (e) {}
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = AppController;
} else {
  const app = new AppController();
  if (typeof window !== 'undefined') {
    window.app = app;
  }
}
