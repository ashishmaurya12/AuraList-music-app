// AuraList — Audio Engine & Playback Controller
class PlayerEngine {
  constructor() {
    this.audio = document.getElementById('audioEngine');
    this.currentTrack = null;
    this.queue = [];
    this.queueIndex = -1;
    this.isPlaying = false;
    this.isShuffle = false;
    this.repeatMode = 'off'; // 'off' | 'all' | 'one'
    this.isSeeking = false;
    this.consecutiveErrors = 0;
    this.isSkipping = false;
    this.skipTimer = null;
    
    this.lastStateSave = 0;
    this.lastPositionSync = 0;
    this.sessionListenSeconds = 0;
    this.lastAudioTime = 0;
    this.playbackSessionId = null;
    this._isChangingTrack = false;

    // Audio DSP Equalizer & Quality State
    this.audioContext = null;
    this.sourceNode = null;
    this.bassFilter = null;
    this.midFilter = null;
    this.trebleFilter = null;
    this.compressorNode = null;
    this.audioProcessingReady = false;
    this._originalSafeUrl = '';
    this._hdAttempted = false;
    this.isDspAvailable = true;
    this._isRestoredState = false;
    this._savedRestoredPosition = 0;
    this._domCache = {};

    const isBrowserEnv = typeof window !== 'undefined' && typeof window.navigator !== 'undefined';
    this.audioQuality = isBrowserEnv ? (this.getSavedSetting('auralist_audio_quality') || 'hd') : 'standard';
    this.effectiveAudioQuality = this.audioQuality;
    this.currentPreset = this.getSavedSetting('auralist_eq_preset') || 'studio';
    this.eqBass = parseFloat(this.getSavedSetting('auralist_eq_bass') ?? (this.currentPreset === 'flat' ? 0 : 3.5));
    this.eqMid = parseFloat(this.getSavedSetting('auralist_eq_mid') ?? (this.currentPreset === 'flat' ? 0 : 1.5));
    this.eqTreble = parseFloat(this.getSavedSetting('auralist_eq_treble') ?? (this.currentPreset === 'flat' ? 0 : 3.5));
    this.compressorEnabled = this.getSavedSetting('auralist_compressor') !== 'false';

    this.initEventListeners();
    this.loadSavedVolume();
    this.initEnhancerUI();
    setTimeout(() => {
      this.restorePlaybackState({ autoPlay: false });
    }, 150);
  }

  loadSavedVolume() {
    let vol = 0.8;
    try {
      const savedVol = localStorage.getItem('auralist_volume');
      if (savedVol !== null) {
        const parsed = parseFloat(savedVol);
        if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) {
          vol = parsed;
        }
      }
    } catch (e) {}
    if (this.audio) this.audio.volume = vol;
    const volBar = document.getElementById('volumeBar');
    if (volBar) volBar.value = vol;
    this.updateVolumeIcon(vol);
  }

  initEventListeners() {
    if (!this.audio) return;

    this.audio.addEventListener('timeupdate', () => {
      this.updateProgressUI();
      if (typeof UI !== 'undefined' && UI.syncLyricsTime) {
        UI.syncLyricsTime(this.audio.currentTime);
      }
      if (this.isPlaying && this.audio && !this.audio.paused && !this.isSeeking) {
        const cur = this.audio.currentTime;
        const delta = cur - (this.lastAudioTime || 0);
        // Normal playback increments ~0.1 to 0.5s per timeupdate.
        // A delta > 2.5s or < 0 is a seek jump, so do not credit as listening time.
        if (delta > 0 && delta <= 2.5) {
          this.sessionListenSeconds = (this.sessionListenSeconds || 0) + delta;
        }
        this.lastAudioTime = cur;
      }
      const now = Date.now();
      if (now - this.lastStateSave > 2500) {
        this.lastStateSave = now;
        this.savePlaybackState();
      }
      if (now - this.lastPositionSync > 10000) {
        this.lastPositionSync = now;
        this.syncPositionToBackend();
      }
    });

    this.audio.addEventListener('loadedmetadata', () => {
      this.updateDurationUI();
    });

    this.audio.addEventListener('ended', () => {
      this.onTrackEnded();
    });

    this.audio.addEventListener('play', () => {
      this.isPlaying = true;
      this.consecutiveErrors = 0;
      this.isSkipping = false;
      this.updatePlayPauseUI();
      this.setEqualizerState(true);
      this.savePlaybackState();
    });

    this.audio.addEventListener('pause', () => {
      this.isPlaying = false;
      this.updatePlayPauseUI();
      this.setEqualizerState(false);
      this.savePlaybackState();
      this.syncPositionToBackend();
    });

    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('beforeunload', () => {
        this.savePlaybackState();
        this.syncPositionToBackend();
      });
    }

    this.audio.addEventListener('error', () => {
      // Guard against cleared or reset audio source states
      const hasSrc = Boolean(
        this.audio && (
          (typeof this.audio.getAttribute === 'function' ? this.audio.getAttribute('src') : this.audio.src) ||
          this.currentTrack
        )
      );
      if (!this.audio || !hasSrc) {
        return;
      }
      if (this._hdAttempted && this._originalSafeUrl && this.audio && this.audio.src !== this._originalSafeUrl) {
        console.warn('[Player] 320kbps HD stream unsupported, falling back to standard stream:', this._originalSafeUrl);
        this._hdAttempted = false;
        this.effectiveAudioQuality = 'fallback';
        const fallbackCors = this.canUseDSPForSource(this._originalSafeUrl);
        this.isDspAvailable = fallbackCors;
        this.setupAudioElement(fallbackCors);
        this.updateEnhancerUI();
        this.audio.src = this._originalSafeUrl;
        this.audio.play().catch(() => {});
        return;
      }
      const hasCors = Boolean(
        this.audio && (
          this.audio.crossOrigin ||
          (typeof this.audio.hasAttribute === 'function' && this.audio.hasAttribute('crossorigin'))
        )
      );
      if (hasCors) {
        console.warn('[Player] Stream playback failed with crossOrigin; retrying without CORS / DSP:', this.audio.src);
        this.isDspAvailable = false;
        this.effectiveAudioQuality = 'fallback';
        this._hdAttempted = false;
        this.setupAudioElement(false);
        this.updateEnhancerUI();
        this.audio.src = this._originalSafeUrl || this.audio.src;
        this.audio.play().catch(() => {});
        return;
      }
      const mediaError = this.audio.error;
      const errorCode = mediaError ? mediaError.code : 0;
      const errorMap = {
        1: 'MEDIA_ERR_ABORTED',
        2: 'MEDIA_ERR_NETWORK',
        3: 'MEDIA_ERR_DECODE',
        4: 'MEDIA_ERR_SRC_NOT_SUPPORTED'
      };
      const errorName = errorMap[errorCode] || 'UNKNOWN_MEDIA_ERROR';
      
      console.warn(`[Player] Audio media error [${errorName} (code ${errorCode})]: "${this.currentTrack?.title || 'Unknown'}" (ID: ${this.currentTrack?.id || this.currentTrack?.jamendoId || 'N/A'})`);

      let userMsg = 'Audio stream unavailable. Playing next track...';
      if (errorCode === 2) {
        userMsg = 'Network connection error while streaming. Playing next track...';
      } else if (errorCode === 4) {
        userMsg = `"${this.currentTrack?.title || 'Track'}" stream is temporarily unavailable. Playing next...`;
      }

      this.handlePlaybackFailure('MEDIA_ERROR', userMsg);
    });

    // Seek Bar Interaction (Smooth drag with no stutter)
    const seekBar = document.getElementById('seekBar');
    if (seekBar) {
      const startSeek = () => { this.isSeeking = true; };
      const commitSeek = (e) => {
        if (this.isSeeking && this.audio && this.audio.duration) {
          const targetSec = (parseFloat(e.target.value) / 100) * this.audio.duration;
          this.seek(targetSec);
        }
        this.isSeeking = false;
      };

      seekBar.addEventListener('mousedown', startSeek);
      seekBar.addEventListener('touchstart', startSeek, { passive: true });
      seekBar.addEventListener('change', commitSeek);
      seekBar.addEventListener('mouseup', commitSeek);
      seekBar.addEventListener('touchend', commitSeek);

      seekBar.addEventListener('input', (e) => {
        if (this.audio && this.audio.duration) {
          const percent = parseFloat(e.target.value);
          seekBar.style.background = `linear-gradient(to right, var(--accent) ${percent}%, rgba(255,255,255,0.15) ${percent}%)`;
          const targetSec = (percent / 100) * this.audio.duration;
          const currentTimeEl = document.getElementById('currentTime');
          if (currentTimeEl && typeof UI !== 'undefined') {
            currentTimeEl.textContent = UI.formatTime(Math.floor(targetSec));
          }
        }
      });
    }
  }

  // Handle errors gracefully without duplicate toast alerts or infinite skip loops
  handlePlaybackFailure(category = 'UNKNOWN', userMsg = null) {
    if (this.isSkipping) return;
    this.isSkipping = true;
    this.consecutiveErrors++;

    clearTimeout(this.skipTimer);

    const maxAllowedErrors = Math.max(1, Math.min(this.queue.length, 3));
    if (this.consecutiveErrors >= maxAllowedErrors) {
      const stopMsg = this.queue.length <= 1
        ? (userMsg || `Unable to play "${this.currentTrack?.title || 'track'}". Stream is unavailable.`)
        : 'Playback stopped: multiple tracks in the queue are currently unavailable.';
      this.stopAndReset(stopMsg);
      return;
    }

    if (userMsg && typeof UI !== 'undefined' && UI.showToast) {
      UI.showToast(userMsg, 'error');
    }

    this.skipTimer = setTimeout(() => {
      this.isSkipping = false;
      this.next();
    }, 1000);
  }

  // Safely reset player source and UI on terminal failures
  stopAndReset(toastMsg = null) {
    clearTimeout(this.skipTimer);
    this.isSkipping = false;
    this.isPlaying = false;
    this.consecutiveErrors = 0;
    if (this.audio) {
      try {
        this.audio.pause();
        this.audio.removeAttribute('src');
        this.audio.load();
      } catch (e) {}
    }
    this.updatePlayPauseUI();
    this.setEqualizerState(false);
    if (toastMsg && typeof UI !== 'undefined' && UI.showToast) {
      UI.showToast(toastMsg, 'error');
    }
  }

  // Play a track and set queue context with automatic stream resolution and resume position
  async playTrack(track, queueList = null, index = null, startPosition = 0) {
    if (!track) return;

    clearTimeout(this.skipTimer);
    this.isSkipping = false;

    // Synchronize queue and current index
    if (queueList && Array.isArray(queueList) && queueList.length > 0) {
      this.queue = [...queueList];
      if (index !== null && index >= 0 && index < this.queue.length) {
        this.queueIndex = index;
      } else {
        const foundIdx = this.queue.findIndex(t => String(t.id || t.jamendoId) === String(track.id || track.jamendoId));
        this.queueIndex = foundIdx >= 0 ? foundIdx : 0;
      }
    } else if (this.queue.length === 0) {
      this.queue = [track];
      this.queueIndex = 0;
    } else if (index !== null && index >= 0 && index < this.queue.length) {
      this.queueIndex = index;
    } else {
      const foundIdx = this.queue.findIndex(t => String(t.id || t.jamendoId) === String(track.id || track.jamendoId));
      if (foundIdx >= 0) {
        this.queueIndex = foundIdx;
      }
    }

    this._isChangingTrack = true;

    // Before switching currentTrack, flush active track's final position checkpoint
    if (this.currentTrack && this.audio && !isNaN(this.audio.currentTime) && this.playbackSessionId) {
      const oldTrack = this.currentTrack;
      const oldSessionId = this.playbackSessionId;
      const oldPos = Math.floor(this.audio.currentTime);
      const oldListenSec = Math.floor(this.sessionListenSeconds || 0);
      this.syncPositionToBackend({
        track: oldTrack,
        sessionId: oldSessionId,
        position: oldPos,
        listenDuration: oldListenSec
      });
    }

    // Isolate session immediately: reset active session tokens before changing currentTrack
    this.playbackSessionId = null;
    this.sessionListenSeconds = 0;

    this.currentTrack = track;
    this.updateNowPlayingUI();

    const playReqId = (this._playRequestId = (this._playRequestId || 0) + 1);

    // If audioUrl is missing or incomplete, resolve it from the music API
    if (!track.audioUrl || typeof track.audioUrl !== 'string' || !track.audioUrl.trim() || /\.(jpe?g|png|webp|gif|svg|bmp)(\?.*)?$/i.test(track.audioUrl.trim())) {
      const trackId = track.id || track.jamendoId;
      if (trackId && typeof API !== 'undefined') {
        try {
          const resolved = await API.get(`/music/track/${trackId}`);
          if (playReqId !== this._playRequestId) return;
          if (resolved && resolved.audioUrl) {
            track.audioUrl = resolved.audioUrl;
            if (this.queue[this.queueIndex]) {
              this.queue[this.queueIndex].audioUrl = resolved.audioUrl;
            }
          }
        } catch (err) {
          console.warn(`[Player] Failed to resolve stream for track ${trackId}:`, err.message);
        }
      }
    }

    if (playReqId !== this._playRequestId) return;

    // Verify valid absolute HTTP/HTTPS audio URL (and reject image URLs)
    let safeAudioUrl = track.audioUrl ? track.audioUrl.trim() : '';
    let isValidUrl = false;
    if (safeAudioUrl) {
      const isImage = /\.(jpe?g|png|webp|gif|svg|bmp)(\?.*)?$/i.test(safeAudioUrl);
      if (!isImage) {
        try {
          const parsed = new URL(safeAudioUrl);
          isValidUrl = parsed.protocol === 'http:' || parsed.protocol === 'https:';
        } catch (e) {
          isValidUrl = false;
        }
      }
    }

    if (!isValidUrl) {
      console.warn(`[Player] Track "${track.title}" has no playable stream URL.`);
      this.handlePlaybackFailure('MISSING_STREAM', `"${track.title || 'Track'}" stream is currently unavailable. Playing next...`);
      return;
    }

    const targetUrl = this.getPlayableAudioUrl(safeAudioUrl, track);
    this._originalSafeUrl = safeAudioUrl;
    this._hdAttempted = targetUrl !== safeAudioUrl;
    this._isRestoredState = false;

    // In HTTPS context or production HTTPS mode, reject insecure HTTP-only streams before playback
    const isHttpsContext = typeof window !== 'undefined' && window.location && window.location.protocol === 'https:';
    if (isHttpsContext && targetUrl.startsWith('http://')) {
      const isRadio = Boolean(track.isLiveRadio);
      const itemLabel = isRadio ? 'Radio station' : 'Track';
      console.warn(`[Player] ${itemLabel} "${track.title}" streams over insecure HTTP and cannot be played securely in HTTPS mode.`);
      if (typeof UI !== 'undefined' && UI.showToast) {
        UI.showToast(`"${track.title || itemLabel}" requires a secure HTTPS stream and cannot be played in HTTPS mode.`, 'warning');
      }
      this.handlePlaybackFailure('MIXED_CONTENT_BLOCKED', `"${track.title || itemLabel}" requires a secure stream. Playing next...`);
      return;
    }

    if (track.isLiveRadio && track.isUnavailable) {
      if (typeof UI !== 'undefined' && UI.showToast) {
        UI.showToast(`"${track.title || 'Station'}" is currently unavailable.`, 'warning');
      }
      return;
    }

    const isHdVariant = targetUrl !== safeAudioUrl && targetUrl.includes('_320.');
    this.effectiveAudioQuality = (this.audioQuality === 'hd' && isHdVariant) ? 'hd' : 'standard';

    const supportsCors = this.canUseDSPForSource(targetUrl);
    this.isDspAvailable = supportsCors;
    this.setupAudioElement(supportsCors);

    this.audio.src = targetUrl;
    if (supportsCors) {
      this.initAudioProcessing();
    }
    this.updateEnhancerUI();
    this.audio.play().then(() => {
      this._isChangingTrack = false;
      if (playReqId !== this._playRequestId) return;
      const startPos = (typeof startPosition === 'number' && startPosition > 0 && Number.isFinite(startPosition)) ? startPosition : 0;
      if (startPos > 0) {
        try {
          this.audio.currentTime = startPos;
        } catch (e) {}
      }
      this.playbackSessionId = 'ps_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
      this.sessionListenSeconds = 0;
      this.lastAudioTime = startPos;
      this.isPlaying = true;
      this.consecutiveErrors = 0;
      this.isSkipping = false;
      this.updatePlayPauseUI();
      this.setEqualizerState(true);
      this.logHistory(track, startPos);
      this.savePlaybackState();
      if (typeof UI !== 'undefined' && UI.renderQueue) {
        UI.renderQueue();
      }
      this.fetchLyrics(track.id || track.jamendoId);
    }).catch(err => {
      this._isChangingTrack = false;
      if (playReqId !== this._playRequestId) return;
      if (err.name === 'NotAllowedError') {
        // Autoplay policy prevented playback until user clicks
        console.info('[Player] Autoplay paused: user interaction required.');
        this.isPlaying = false;
        this.updatePlayPauseUI();
        this.setEqualizerState(false);
        if (typeof UI !== 'undefined' && UI.showToast) {
          UI.showToast('Click play to start listening', 'info');
        }
      } else if (err.name === 'AbortError') {
        // Interrupted by another track load
        console.debug('[Player] Play interrupted by newer request.');
      } else {
        console.warn(`[Player] Play promise rejected for "${track.title}":`, err.name, err.message);
        this.handlePlaybackFailure('PLAY_PROMISE_REJECTED', `Unable to play "${track.title || 'track'}". Trying next...`);
      }
    });
  }

  togglePlay() {
    if (!this.currentTrack) {
      if (this.queue.length > 0) {
        this.playTrack(this.queue[0], this.queue, 0);
      }
      return;
    }

    if (this._isRestoredState) {
      this._isRestoredState = false;
      const resumePos = (typeof this._savedRestoredPosition === 'number' && this._savedRestoredPosition > 0)
        ? this._savedRestoredPosition
        : (!isNaN(this.audio.currentTime) && this.audio.currentTime > 0 ? this.audio.currentTime : 0);

      const safeAudioUrl = this.currentTrack.audioUrl ? this.currentTrack.audioUrl.trim() : '';
      const targetUrl = this.getPlayableAudioUrl(safeAudioUrl, this.currentTrack);
      this._originalSafeUrl = safeAudioUrl;
      this._hdAttempted = targetUrl !== safeAudioUrl;
      const isHdVariant = targetUrl !== safeAudioUrl && targetUrl.includes('_320.');
      this.effectiveAudioQuality = (this.audioQuality === 'hd' && isHdVariant) ? 'hd' : 'standard';

      const supportsCors = this.canUseDSPForSource(targetUrl);
      this.isDspAvailable = supportsCors;
      this.setupAudioElement(supportsCors);

      if (this.audio.src !== targetUrl) {
        this.audio.src = targetUrl;
      }
      if (supportsCors) {
        this.initAudioProcessing();
      }
      this.updateEnhancerUI();

      this.audio.play().then(() => {
        if (resumePos > 0) {
          try {
            this.audio.currentTime = resumePos;
          } catch (e) {}
        }
        this.playbackSessionId = 'ps_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
        this.sessionListenSeconds = 0;
        this.lastAudioTime = resumePos;
        this.isPlaying = true;
        this.consecutiveErrors = 0;
        this.isSkipping = false;
        this.updatePlayPauseUI();
        this.setEqualizerState(true);
        this.savePlaybackState();
        this.fetchLyrics(this.currentTrack.id || this.currentTrack.jamendoId);
      }).catch(err => {
        console.warn('[Player] Restored play rejected:', err.message);
      });
      return;
    }

    // If audio element has no source or is in an error state, reload the track cleanly
    if (!this.audio.src || this.audio.error) {
      this.playTrack(this.currentTrack, this.queue, this.queueIndex);
      return;
    }

    if (this.audio.paused) {
      this.audio.play().catch(err => {
        console.warn('[Player] Toggle play rejected:', err.message);
      });
    } else {
      this.audio.pause();
    }
  }

  next() {
    if (this.queue.length === 0) return;

    if (this.repeatMode === 'one' && this.currentTrack) {
      this.audio.currentTime = 0;
      this.audio.play().catch(() => {});
      return;
    }

    if (this.isShuffle) {
      const randomIndex = Math.floor(Math.random() * this.queue.length);
      this.queueIndex = randomIndex;
    } else {
      this.queueIndex++;
      if (this.queueIndex >= this.queue.length) {
        if (this.repeatMode === 'all') {
          this.queueIndex = 0;
        } else {
          this.queueIndex = this.queue.length - 1;
          this.audio.pause();
          this.isPlaying = false;
          this.updatePlayPauseUI();
          this.setEqualizerState(false);
          return;
        }
      }
    }

    const nextTrack = this.queue[this.queueIndex];
    if (nextTrack) {
      this.playTrack(nextTrack, null, this.queueIndex);
    }
  }

  prev() {
    if (this.queue.length === 0) return;

    if (this.audio && this.audio.currentTime > 3) {
      this.audio.currentTime = 0;
      return;
    }

    this.queueIndex--;
    if (this.queueIndex < 0) {
      this.queueIndex = this.repeatMode === 'all' ? this.queue.length - 1 : 0;
    }

    const prevTrack = this.queue[this.queueIndex];
    if (prevTrack) {
      this.playTrack(prevTrack, null, this.queueIndex);
    }
  }

  toggleShuffle() {
    this.isShuffle = !this.isShuffle;
    const shuffleBtn = document.getElementById('shuffleBtn');
    if (shuffleBtn) {
      shuffleBtn.classList.toggle('active', this.isShuffle);
    }
  }

  toggleRepeat() {
    const modes = ['off', 'all', 'one'];
    const currentIndex = modes.indexOf(this.repeatMode);
    this.repeatMode = modes[(currentIndex + 1) % modes.length];

    const repeatBtn = document.getElementById('repeatBtn');
    if (repeatBtn) {
      repeatBtn.classList.toggle('active', this.repeatMode !== 'off');
      const icon = repeatBtn.querySelector('i');
      if (this.repeatMode === 'one') {
        icon.className = 'fa-solid fa-repeat-1';
        repeatBtn.title = 'Repeat (One)';
      } else {
        icon.className = 'fa-solid fa-repeat';
        repeatBtn.title = `Repeat (${this.repeatMode === 'all' ? 'All' : 'Off'})`;
      }
    }
  }

  seek(seconds) {
    if (!this.audio) return;
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || isNaN(seconds)) return;

    let safeSeconds = Math.max(0, seconds);
    const dur = this.audio.duration;
    if (typeof dur === 'number' && Number.isFinite(dur) && dur > 0) {
      safeSeconds = Math.min(safeSeconds, dur);
    }

    try {
      this.isSeeking = true;
      this.audio.currentTime = safeSeconds;
      this.lastAudioTime = safeSeconds; // Prevent seek jump from being counted as listening time
    } catch (e) {
    } finally {
      this.isSeeking = false;
    }
  }

  setVolume(volume) {
    const vol = Math.max(0, Math.min(1, parseFloat(volume)));
    if (isNaN(vol)) return;
    this.audio.volume = vol;
    try {
      localStorage.setItem('auralist_volume', vol);
    } catch (e) {}
    this.updateVolumeIcon(vol);
  }

  toggleMute() {
    this.audio.muted = !this.audio.muted;
    const muteBtn = document.getElementById('muteBtn');
    if (this.audio.muted) {
      if (muteBtn) muteBtn.querySelector('i').className = 'fa-solid fa-volume-xmark';
    } else {
      this.updateVolumeIcon(this.audio.volume);
    }
  }

  updateVolumeIcon(vol) {
    const muteBtn = this.getDomElement('muteBtn');
    if (!muteBtn) return;
    const icon = muteBtn.querySelector('i');
    if (vol === 0 || (this.audio && this.audio.muted)) {
      icon.className = 'fa-solid fa-volume-xmark';
    } else if (vol < 0.5) {
      icon.className = 'fa-solid fa-volume-low';
    } else {
      icon.className = 'fa-solid fa-volume-high';
    }
  }

  onTrackEnded() {
    this.syncPositionToBackend({ completed: true });
    this.next();
  }

  addToQueue(track) {
    if (!track) return;
    this.queue.push(track);
    if (this.queue.length === 1 && !this.currentTrack) {
      this.queueIndex = 0;
      this.currentTrack = track;
      this.updateNowPlayingUI();
    }
    if (typeof UI !== 'undefined') {
      UI.showToast(`Added "${track.title}" to Up Next Queue`);
      if (UI.renderQueue) UI.renderQueue();
    }
    this.savePlaybackState();
  }

  playNext(track) {
    if (!track) return;
    if (this.queue.length === 0) {
      this.playTrack(track, [track], 0);
      return;
    }
    const insertIdx = this.queueIndex >= 0 ? this.queueIndex + 1 : 0;
    this.queue.splice(insertIdx, 0, track);
    if (typeof UI !== 'undefined') {
      UI.showToast(`Playing next: "${track.title}"`);
      if (UI.renderQueue) UI.renderQueue();
    }
    this.savePlaybackState();
  }

  removeFromQueue(index) {
    if (index < 0 || index >= this.queue.length) return;
    const isCurrent = index === this.queueIndex;
    const removed = this.queue.splice(index, 1)[0];

    if (isCurrent) {
      if (this.queue.length === 0) {
        this.stopAndReset();
      } else {
        const nextIdx = Math.min(index, this.queue.length - 1);
        this.queueIndex = nextIdx;
        this.playTrack(this.queue[nextIdx], this.queue, nextIdx);
      }
    } else if (index < this.queueIndex) {
      this.queueIndex--;
    }

    if (typeof UI !== 'undefined') {
      UI.showToast(`Removed "${removed?.title || 'track'}" from queue`);
      if (UI.renderQueue) UI.renderQueue();
    }
    this.savePlaybackState();
  }

  moveQueueItem(fromIndex, toIndex) {
    if (
      fromIndex < 0 ||
      fromIndex >= this.queue.length ||
      toIndex < 0 ||
      toIndex >= this.queue.length ||
      fromIndex === toIndex
    ) {
      return;
    }

    const [moved] = this.queue.splice(fromIndex, 1);
    this.queue.splice(toIndex, 0, moved);

    if (this.queueIndex === fromIndex) {
      this.queueIndex = toIndex;
    } else if (fromIndex < this.queueIndex && toIndex >= this.queueIndex) {
      this.queueIndex--;
    } else if (fromIndex > this.queueIndex && toIndex <= this.queueIndex) {
      this.queueIndex++;
    }

    if (typeof UI !== 'undefined' && UI.renderQueue) {
      UI.renderQueue();
    }
    this.savePlaybackState();
  }

  clearQueue(keepCurrent = false) {
    if (keepCurrent && this.currentTrack) {
      this.queue = [this.currentTrack];
      this.queueIndex = 0;
      if (typeof UI !== 'undefined') {
        UI.showToast('Up Next Queue cleared');
        if (UI.renderQueue) UI.renderQueue();
      }
    } else {
      this.queue = [];
      this.queueIndex = -1;
      this.stopAndReset('Queue cleared');
    }
    this.savePlaybackState();
  }

  savePlaybackState() {
    if (!this.currentTrack) return;
    try {
      const state = {
        track: this.currentTrack,
        queue: this.queue,
        queueIndex: this.queueIndex,
        position: this.audio && !isNaN(this.audio.currentTime) ? Math.floor(this.audio.currentTime) : 0,
        duration: this.audio && !isNaN(this.audio.duration) ? Math.floor(this.audio.duration) : (this.currentTrack.duration || 0),
        timestamp: Date.now()
      };
      localStorage.setItem('auralist_last_playback', JSON.stringify(state));
    } catch (e) {}
  }

  restorePlaybackState({ autoPlay = false } = {}) {
    try {
      const raw = localStorage.getItem('auralist_last_playback');
      if (!raw) return false;
      const state = JSON.parse(raw);
      if (!state || !state.track) return false;

      this.currentTrack = state.track;
      if (Array.isArray(state.queue) && state.queue.length > 0) {
        this.queue = state.queue;
        this.queueIndex = typeof state.queueIndex === 'number' && state.queueIndex >= 0 && state.queueIndex < state.queue.length
          ? state.queueIndex
          : 0;
      } else {
        this.queue = [state.track];
        this.queueIndex = 0;
      }

      this.updateNowPlayingUI();
      if (typeof UI !== 'undefined' && UI.renderQueue) {
        UI.renderQueue();
      }

      const savedPos = typeof state.position === 'number' && state.position > 0 ? state.position : 0;
      const savedDur = typeof state.duration === 'number' && state.duration > 0 ? state.duration : (state.track.duration || 0);

      const currentTimeEl = document.getElementById('currentTime');
      const totalDurationEl = document.getElementById('totalDuration');
      const seekBar = document.getElementById('seekBar');

      if (currentTimeEl && typeof UI !== 'undefined') {
        currentTimeEl.textContent = UI.formatTime(savedPos);
      }
      if (totalDurationEl && typeof UI !== 'undefined') {
        totalDurationEl.textContent = UI.formatTime(savedDur);
      }
      if (seekBar && savedDur > 0) {
        const percent = (savedPos / savedDur) * 100;
        seekBar.value = percent;
        seekBar.style.background = `linear-gradient(to right, var(--accent) ${percent}%, rgba(255,255,255,0.15) ${percent}%)`;
      }

      if (autoPlay) {
        this.playTrack(state.track, this.queue, this.queueIndex, savedPos);
      } else {
        this._isRestoredState = true;
        this._savedRestoredPosition = savedPos;
        if (state.track.audioUrl) {
          this.audio.src = state.track.audioUrl;
          try {
            this.audio.currentTime = savedPos;
          } catch (e) {}
        }
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  async syncPositionToBackend(options = {}) {
    // If track is in transition and no explicit target track was passed, ignore synthetic pause sync
    if (this._isChangingTrack && (!options || !options.track)) {
      return;
    }
    const targetTrack = (options && options.track) || this.currentTrack;
    const targetSessionId = (options && options.sessionId) || this.playbackSessionId;
    if (!targetTrack || !targetSessionId) return;
    const targetTrackId = targetTrack.jamendoId || targetTrack.id;
    if (!targetTrackId) return;

    const pos = (options && typeof options.position === 'number')
      ? options.position
      : (this.audio && !isNaN(this.audio.currentTime) ? Math.floor(this.audio.currentTime) : 0);
    const listenSec = (options && typeof options.listenDuration === 'number')
      ? options.listenDuration
      : Math.floor(this.sessionListenSeconds || 0);

    const trackDur = Number(targetTrack.duration) || 0;
    const isCompleted = Boolean(options && options.completed) && trackDur > 0;

    try {
      if (typeof API !== 'undefined' && API.getToken && API.getToken()) {
        await API.put('/history/position', {
          jamendoId: targetTrackId,
          position: pos,
          listenDuration: listenSec,
          sessionId: targetSessionId,
          completed: isCompleted
        });
      }
    } catch (e) {}
  }

  async fetchLyrics(trackId) {
    const lyricsEl = document.getElementById('lyricsContent');
    if (lyricsEl) {
      lyricsEl.innerHTML = '<div style="text-align:center; padding:30px;"><i class="fa-solid fa-spinner fa-spin fa-2x" style="color:var(--accent)"></i></div>';
    }

    try {
      const data = await API.get(`/music/lyrics/${trackId}`);
      if (typeof UI !== 'undefined' && UI.renderLyrics) {
        UI.renderLyrics(data, lyricsEl);
      } else if (lyricsEl) {
        lyricsEl.textContent = data.lyrics || 'Lyrics are not available for this track yet.';
      }
    } catch (e) {
      if (typeof UI !== 'undefined' && UI.renderLyrics) {
        UI.renderLyrics({ lyrics: 'Lyrics unavailable for this track.', isSynchronized: false }, lyricsEl);
      } else if (lyricsEl) {
        lyricsEl.textContent = 'Lyrics are not available for this track yet.';
      }
    }
  }

  async fetchRelatedTracks(track) {
    const listEl = document.getElementById('relatedTracksList');
    if (!listEl || !track) return;
    listEl.innerHTML = '<div style="text-align:center; padding:30px;"><i class="fa-solid fa-spinner fa-spin fa-2x" style="color:var(--accent)"></i></div>';

    try {
      const query = track.artist && track.artist !== 'Various Artists' ? track.artist : track.title;
      const tracks = await API.get(`/music/search?q=${encodeURIComponent(query)}&limit=10`);
      if (tracks && tracks.length > 0) {
        const filtered = tracks.filter(t => String(t.id || t.jamendoId) !== String(track.id || track.jamendoId));
        UI.renderTrackList(filtered.length > 0 ? filtered : tracks, listEl);
      } else {
        listEl.innerHTML = '<p style="color:var(--text-muted); padding:20px; text-align:center;">No related tracks found for this artist.</p>';
      }
    } catch (err) {
      listEl.innerHTML = '<p style="color:var(--text-muted); padding:20px; text-align:center;">Unable to load related tracks.</p>';
    }
  }

  async logHistory(track, position = 0) {
    try {
      if (typeof API !== 'undefined' && API.getToken && API.getToken()) {
        const res = await API.post('/history', {
          jamendoId: track.jamendoId || track.id,
          title: track.title,
          artist: track.artist,
          coverUrl: track.coverUrl,
          audioUrl: track.audioUrl,
          duration: track.duration,
          position: Math.floor(position || 0),
          listenDuration: Math.floor(this.sessionListenSeconds || 0),
          sessionId: this.playbackSessionId
        });
        if (res && res.sessionId) {
          this.playbackSessionId = res.sessionId;
        }
      }
    } catch (e) {}
  }

  updateNowPlayingUI() {
    if (!this.currentTrack) return;

    const cover = document.getElementById('playerCover');
    const title = document.getElementById('playerTitle');
    const artist = document.getElementById('playerArtist');

    const drawerCover = document.getElementById('drawerCover');
    const drawerTitle = document.getElementById('drawerTitle');
    const drawerArtist = document.getElementById('drawerArtist');

    const fallbackCover = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=400&auto=format&fit=crop';
    const coverSrc = typeof UI !== 'undefined' && UI.sanitizeImageUrl
      ? UI.sanitizeImageUrl(this.currentTrack.coverUrl, fallbackCover)
      : (this.currentTrack.coverUrl || fallbackCover);
    
    if (cover) cover.src = coverSrc;
    if (title) title.textContent = this.currentTrack.title;
    if (artist) {
      artist.textContent = this.currentTrack.artist;
      artist.classList?.add?.('clickable-artist');
      artist.onclick = (e) => {
        e.stopPropagation();
        if (typeof app !== 'undefined' && app.navigateToArtist) {
          app.navigateToArtist(this.currentTrack.artist);
        }
      };
    }

    if (drawerCover) drawerCover.src = coverSrc;
    if (drawerTitle) drawerTitle.textContent = this.currentTrack.title;
    if (drawerArtist) {
      drawerArtist.textContent = this.currentTrack.artist;
      drawerArtist.classList?.add?.('clickable-artist');
      drawerArtist.onclick = (e) => {
        e.stopPropagation();
        if (typeof app !== 'undefined' && app.navigateToArtist) {
          app.navigateToArtist(this.currentTrack.artist);
          if (app.toggleFullscreenPlayer) app.toggleFullscreenPlayer(false);
        }
      };
    }

    if (typeof UI !== 'undefined') {
      if (UI.updateLikeStatus) {
        UI.updateLikeStatus(this.currentTrack.jamendoId || this.currentTrack.id);
      }
      if (UI.updatePlayingTrackUI) {
        UI.updatePlayingTrackUI();
      }
    }
  }

  updatePlayPauseUI() {
    const playPauseBtn = document.getElementById('playPauseBtn');
    if (playPauseBtn) {
      const icon = playPauseBtn.querySelector('i');
      if (this.isPlaying) {
        icon.className = 'fa-solid fa-pause';
        playPauseBtn.title = 'Pause';
      } else {
        icon.className = 'fa-solid fa-play';
        playPauseBtn.title = 'Play';
      }
    }
    if (typeof UI !== 'undefined' && UI.updatePlayingTrackUI) {
      UI.updatePlayingTrackUI();
    }
  }

  getDomElement(id) {
    if (!this._domCache) this._domCache = {};
    const cached = this._domCache[id];
    if (cached) {
      if (typeof document !== 'undefined' && typeof document.contains === 'function') {
        if (!document.contains(cached)) {
          this._domCache[id] = null;
        } else {
          return cached;
        }
      } else {
        return cached;
      }
    }
    const el = (typeof document !== 'undefined' && typeof document.getElementById === 'function')
      ? document.getElementById(id)
      : null;
    if (el) this._domCache[id] = el;
    return el;
  }

  updateProgressUI() {
    const seekBar = this.getDomElement('seekBar');
    const currentTimeEl = this.getDomElement('currentTime');

    if (this.currentTrack && (this.currentTrack.isLiveRadio || this.currentTrack.provider === 'RadioBrowser')) {
      if (currentTimeEl) currentTimeEl.textContent = 'LIVE';
      if (seekBar && !this.isSeeking) {
        seekBar.value = 100;
        seekBar.style.background = 'linear-gradient(to right, #ef4444 100%, #ef4444 100%)';
      }
      return;
    }

    if (!this.audio.duration || isNaN(this.audio.duration)) return;

    const currentSec = Math.floor(this.audio.currentTime);
    const progressPercent = (this.audio.currentTime / this.audio.duration) * 100;

    if (seekBar && !this.isSeeking) {
      seekBar.value = progressPercent;
      seekBar.style.background = `linear-gradient(to right, var(--accent) ${progressPercent}%, rgba(255,255,255,0.15) ${progressPercent}%)`;
    }

    if (currentTimeEl && typeof UI !== 'undefined') {
      currentTimeEl.textContent = UI.formatTime(currentSec);
    }
  }

  updateDurationUI() {
    const totalDurationEl = this.getDomElement('totalDuration');
    if (!totalDurationEl) return;

    if (this.currentTrack && (this.currentTrack.isLiveRadio || this.currentTrack.provider === 'RadioBrowser')) {
      totalDurationEl.textContent = 'LIVE';
      return;
    }
    
    let secs = 0;
    if (this.audio.duration && !isNaN(this.audio.duration) && isFinite(this.audio.duration)) {
      secs = Math.floor(this.audio.duration);
    } else if (this.currentTrack && this.currentTrack.duration) {
      secs = parseInt(this.currentTrack.duration, 10);
    }

    if (typeof UI !== 'undefined') {
      totalDurationEl.textContent = UI.formatTime(secs);
    }
  }

  setEqualizerState(animating) {
    const eq = this.getDomElement('equalizer');
    if (eq) {
      eq.classList.toggle('paused', !animating);
    }
  }

  // --- Audio DSP Equalizer & Quality Engine ---
  getPlayableAudioUrl(url, track = null) {
    if (!url || typeof url !== 'string') return '';
    const trimmed = url.trim();
    let effectiveUrl = trimmed;
    // Prefer officially supported HTTPS streams for verified major providers
    if (effectiveUrl.startsWith('http://')) {
      const isKnownHttps = effectiveUrl.includes('.saavncdn.com') || effectiveUrl.includes('.audius.co') || effectiveUrl.includes('.jamendo.com');
      if (isKnownHttps) {
        effectiveUrl = effectiveUrl.replace(/^http:\/\//i, 'https://');
      }
    }
    // Do not apply Saavn-specific HD URL rewriting to Audius, Jamendo, or radio URLs.
    if (track && (track.provider === 'Audius' || track.provider === 'Jamendo' || track.provider === 'RadioBrowser' || track.isLiveRadio)) {
      return effectiveUrl;
    }
    if (effectiveUrl.includes('audius.co') || effectiveUrl.includes('jamendo.com') || effectiveUrl.includes('radio-browser.info')) {
      return effectiveUrl;
    }
    if (this.audioQuality === 'hd' && effectiveUrl.includes('.saavncdn.com')) {
      return effectiveUrl.replace(/_([0-9]{2,3})\.(mp4|mp3)/i, '_320.$2');
    }
    return effectiveUrl;
  }

  getSavedSetting(key) {
    try {
      if (typeof localStorage !== 'undefined' && localStorage) {
        return localStorage.getItem(key);
      }
    } catch (e) {}
    return null;
  }

  saveSetting(key, val) {
    try {
      if (typeof localStorage !== 'undefined' && localStorage) {
        localStorage.setItem(key, String(val));
      }
    } catch (e) {}
  }

  canUseDSPForSource(url) {
    if (!url || typeof url !== 'string') return false;
    const trimmed = url.trim();
    if (!trimmed) return false;
    // Relative paths (/api/..., ./media/...) are always same-origin
    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
      return true;
    }
    // Same-origin streams and known CORS-enabled streaming CDNs (e.g. JioSaavn / Saavn CDN)
    try {
      const base = (typeof window !== 'undefined' && window.location && window.location.href)
        ? window.location.href
        : 'http://localhost:3000';
      const parsed = new URL(trimmed, base);
      if (typeof window !== 'undefined' && window.location && window.location.origin) {
        if (parsed.origin === window.location.origin) return true;
      }
      const host = parsed.hostname.toLowerCase();
      if (host.endsWith('saavncdn.com') || host.endsWith('jiosaavn.com')) {
        return true;
      }
    } catch (e) {
      return false;
    }
    return false;
  }

  setupAudioElement(needsCors) {
    if (!this.audio) return;
    if (!needsCors) {
      if (this.sourceNode) {
        try {
          this.audio.pause();
          this.audio.removeAttribute('src');
          this.audio.load();
        } catch (e) {}
        const oldAudio = this.audio;
        const newAudio = document.createElement('audio');
        newAudio.id = 'audioEngine';
        newAudio.preload = 'metadata';
        if (oldAudio && oldAudio.parentNode) {
          oldAudio.parentNode.replaceChild(newAudio, oldAudio);
        }
        this.audio = newAudio;
        this.sourceNode = null;
        this.audioProcessingReady = false;
        this.initEventListeners();
        this.loadSavedVolume();
      } else {
        this.audio.crossOrigin = null;
        if (typeof this.audio.removeAttribute === 'function') {
          this.audio.removeAttribute('crossorigin');
        }
      }
    } else {
      this.audio.crossOrigin = 'anonymous';
    }
  }

  initAudioProcessing() {
    if (this.audioProcessingReady) return;
    if (typeof window === 'undefined') return;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass || !this.audio) return;

    // Only disable DSP if an active audio source explicitly does NOT support CORS
    const currentSrc = this.audio.src || (this.currentTrack ? this.currentTrack.audioUrl : '');
    if (currentSrc && !this.canUseDSPForSource(currentSrc)) {
      this.isDspAvailable = false;
      this.updateEnhancerUI();
      return;
    }

    try {
      if (!this.audioContext) {
        this.audioContext = new AudioContextClass();
      }
      if (this.audioContext.state === 'suspended') {
        this.audioContext.resume().catch(() => {});
      }

      if (!this.sourceNode) {
        this.audio.crossOrigin = 'anonymous';
        this.sourceNode = this.audioContext.createMediaElementSource(this.audio);

        // Low-shelf filter for Bass at 100 Hz
        this.bassFilter = this.audioContext.createBiquadFilter();
        this.bassFilter.type = 'lowshelf';
        this.bassFilter.frequency.value = 100;
        this.bassFilter.gain.value = this.eqBass;

        // Peaking filter for Mids / Vocals at 1500 Hz
        this.midFilter = this.audioContext.createBiquadFilter();
        this.midFilter.type = 'peaking';
        this.midFilter.frequency.value = 1500;
        this.midFilter.Q.value = 1.0;
        this.midFilter.gain.value = this.eqMid;

        // High-shelf filter for Treble / Highs at 8000 Hz
        this.trebleFilter = this.audioContext.createBiquadFilter();
        this.trebleFilter.type = 'highshelf';
        this.trebleFilter.frequency.value = 8000;
        this.trebleFilter.gain.value = this.eqTreble;

        // Studio Dynamics Compressor (Anti-Clipping & Volume Normalization)
        this.compressorNode = this.audioContext.createDynamicsCompressor();
        this.compressorNode.threshold.value = -16;
        this.compressorNode.knee.value = 24;
        this.compressorNode.ratio.value = 3.5;
        this.compressorNode.attack.value = 0.003;
        this.compressorNode.release.value = 0.25;

        this.reconnectAudioGraph();
      }

      this.isDspAvailable = true;
      this.audioProcessingReady = true;
      this.updateEnhancerUI();
    } catch (err) {
      console.warn('[Player] Audio processing graph setup bypassed:', err.message);
      this.isDspAvailable = false;
      this.updateEnhancerUI();
    }
  }

  reconnectAudioGraph() {
    if (!this.audioContext || !this.sourceNode) return;
    try {
      this.sourceNode.disconnect();
      this.bassFilter.disconnect();
      this.midFilter.disconnect();
      this.trebleFilter.disconnect();
      if (this.compressorNode) this.compressorNode.disconnect();

      this.sourceNode.connect(this.bassFilter);
      this.bassFilter.connect(this.midFilter);
      this.midFilter.connect(this.trebleFilter);

      if (this.compressorEnabled && this.compressorNode) {
        this.trebleFilter.connect(this.compressorNode);
        this.compressorNode.connect(this.audioContext.destination);
      } else {
        this.trebleFilter.connect(this.audioContext.destination);
      }
    } catch (err) {
      console.warn('[Player] Audio graph connection error:', err.message);
    }
  }

  applyPreset(presetKey) {
    const presets = {
      studio: { bass: 3.5, mid: 1.5, treble: 3.5, compressor: true },
      bass: { bass: 7.0, mid: 0.0, treble: 1.5, compressor: true },
      vocal: { bass: 0.5, mid: 4.5, treble: 3.0, compressor: true },
      club: { bass: 6.0, mid: 1.0, treble: 5.0, compressor: true },
      flat: { bass: 0.0, mid: 0.0, treble: 0.0, compressor: false }
    };
    const p = presets[presetKey] || presets.studio;
    this.currentPreset = presetKey;
    this.setEqGain('bass', p.bass);
    this.setEqGain('mid', p.mid);
    this.setEqGain('treble', p.treble);
    this.setCompressor(p.compressor);
    this.saveSetting('auralist_eq_preset', presetKey);
    this.updateEnhancerUI();
  }

  setEqGain(band, val) {
    const num = parseFloat(val);
    if (isNaN(num)) return;
    const clamped = Math.max(-12, Math.min(12, num));
    if (band === 'bass') {
      this.eqBass = clamped;
      if (this.bassFilter && this.audioContext) {
        this.bassFilter.gain.setTargetAtTime(clamped, this.audioContext.currentTime, 0.02);
      }
      this.saveSetting('auralist_eq_bass', clamped);
    } else if (band === 'mid') {
      this.eqMid = clamped;
      if (this.midFilter && this.audioContext) {
        this.midFilter.gain.setTargetAtTime(clamped, this.audioContext.currentTime, 0.02);
      }
      this.saveSetting('auralist_eq_mid', clamped);
    } else if (band === 'treble') {
      this.eqTreble = clamped;
      if (this.trebleFilter && this.audioContext) {
        this.trebleFilter.gain.setTargetAtTime(clamped, this.audioContext.currentTime, 0.02);
      }
      this.saveSetting('auralist_eq_treble', clamped);
    }
    this.updateEnhancerValuesDisplay();
  }

  setCompressor(enabled) {
    this.compressorEnabled = Boolean(enabled);
    this.saveSetting('auralist_compressor', this.compressorEnabled);
    this.reconnectAudioGraph();
    this.updateEnhancerUI();
  }

  setAudioQuality(quality) {
    this.audioQuality = quality === 'standard' ? 'standard' : 'hd';
    this.saveSetting('auralist_audio_quality', this.audioQuality);

    if (this.currentTrack && this.audio && !this.audio.paused) {
      const curTime = this.audio.currentTime || 0;
      const target = this.getPlayableAudioUrl(this.currentTrack.audioUrl);
      const isHdVariant = target !== this.currentTrack.audioUrl && target.includes('_320.');
      this.effectiveAudioQuality = (this.audioQuality === 'hd' && isHdVariant) ? 'hd' : 'standard';
      if (this.audio.src !== target) {
        this._hdAttempted = target !== this.currentTrack.audioUrl;
        const supportsCors = this.canUseDSPForSource(target);
        this.isDspAvailable = supportsCors;
        this.setupAudioElement(supportsCors);
        this.audio.src = target;
        try { this.audio.currentTime = curTime; } catch (e) {}
        this.audio.play().catch(() => {});
      }
    } else {
      if (this.currentTrack) {
        const target = this.getPlayableAudioUrl(this.currentTrack.audioUrl);
        const isHdVariant = target !== this.currentTrack.audioUrl && target.includes('_320.');
        this.effectiveAudioQuality = (this.audioQuality === 'hd' && isHdVariant) ? 'hd' : 'standard';
      } else {
        this.effectiveAudioQuality = this.audioQuality;
      }
    }
    this.updateEnhancerUI();
  }

  resetEq() {
    this.applyPreset('studio');
  }

  updateEnhancerValuesDisplay() {
    const formatDb = (v) => (v > 0 ? `+${v.toFixed(1)} dB` : `${v.toFixed(1)} dB`);
    const bDisp = document.getElementById('bassValueDisplay');
    const mDisp = document.getElementById('midValueDisplay');
    const tDisp = document.getElementById('trebleValueDisplay');
    if (bDisp) bDisp.textContent = formatDb(this.eqBass);
    if (mDisp) mDisp.textContent = formatDb(this.eqMid);
    if (tDisp) tDisp.textContent = formatDb(this.eqTreble);

    const bSlider = document.getElementById('eqBassSlider');
    const mSlider = document.getElementById('eqMidSlider');
    const tSlider = document.getElementById('eqTrebleSlider');
    if (bSlider) bSlider.value = this.eqBass;
    if (mSlider) mSlider.value = this.eqMid;
    if (tSlider) tSlider.value = this.eqTreble;
  }

  updateEnhancerUI() {
    this.updateEnhancerValuesDisplay();

    // Ensure any legacy/cached quality badge above player bar icon is removed
    const playerBadge = document.getElementById('playerHdBadge');
    if (playerBadge && typeof playerBadge.remove === 'function') {
      playerBadge.remove();
    }

    // Modal quality badges
    const currentQualityBadge = document.getElementById('currentQualityBadge');
    if (currentQualityBadge) {
      if (this.effectiveAudioQuality === 'fallback') {
        currentQualityBadge.textContent = 'Standard fallback';
      } else if (this.effectiveAudioQuality === 'hd') {
        currentQualityBadge.textContent = '320 kbps Ultra HD';
      } else {
        currentQualityBadge.textContent = '160 kbps Standard';
      }
    }

    const qHdBtn = document.getElementById('qualityHdBtn');
    const qStdBtn = document.getElementById('qualityStandardBtn');
    if (qHdBtn && qStdBtn && qHdBtn.classList && qStdBtn.classList) {
      if (typeof qHdBtn.classList.toggle === 'function') {
        qHdBtn.classList.toggle('active', this.audioQuality === 'hd');
      }
      if (typeof qStdBtn.classList.toggle === 'function') {
        qStdBtn.classList.toggle('active', this.audioQuality === 'standard');
      }
    }

    // DSP availability notice and controls state
    const dspNotice = document.getElementById('dspUnavailableNotice');
    if (dspNotice) {
      dspNotice.style.display = this.isDspAvailable ? 'none' : 'block';
    }

    const enhancerBtn = document.getElementById('audioEnhancerBtn');
    if (enhancerBtn) {
      enhancerBtn.title = this.isDspAvailable
        ? 'Audio Quality & Equalizer'
        : 'Audio Quality (Equalizer unavailable for this stream)';
    }

    const eqControls = typeof document !== 'undefined' && typeof document.querySelectorAll === 'function'
      ? document.querySelectorAll('.eq-preset-btn, .eq-slider, #resetEqBtn, #compressorToggle')
      : [];
    if (eqControls && typeof eqControls.forEach === 'function') {
      eqControls.forEach(el => {
        if (!this.isDspAvailable) {
          el.disabled = true;
          el.style.opacity = '0.5';
          el.style.pointerEvents = 'none';
        } else {
          el.disabled = false;
          el.style.opacity = '';
          el.style.pointerEvents = '';
        }
      });
    }

    // Preset buttons active state
    if (typeof document !== 'undefined' && typeof document.querySelectorAll === 'function') {
      const presets = document.querySelectorAll('.eq-preset-btn');
      if (presets && typeof presets.forEach === 'function') {
        presets.forEach(btn => {
          if (btn && btn.classList && typeof btn.classList.toggle === 'function') {
            btn.classList.toggle('active', btn.dataset && btn.dataset.preset === this.currentPreset);
          }
        });
      }
    }

    // Compressor checkbox
    const compToggle = document.getElementById('compressorToggle');
    if (compToggle) {
      compToggle.checked = Boolean(this.compressorEnabled);
    }
  }

  openEnhancerModal() {
    const modal = document.getElementById('audioEnhancerModal');
    if (!modal) return;
    this.initAudioProcessing();
    this.updateEnhancerUI();
    modal.classList.add('open');
  }

  closeEnhancerModal() {
    const modal = document.getElementById('audioEnhancerModal');
    if (!modal) return;
    modal.classList.remove('open', 'active');
  }

  toggleEnhancerModal(force) {
    const modal = document.getElementById('audioEnhancerModal');
    if (!modal) return;
    const isCurrentlyOpen = modal.classList.contains('open') || modal.classList.contains('active');
    const shouldOpen = typeof force === 'boolean' ? force : !isCurrentlyOpen;
    if (shouldOpen) {
      this.openEnhancerModal();
    } else {
      this.closeEnhancerModal();
    }
  }

  initEnhancerUI() {
    if (typeof document === 'undefined') return;

    // Modal open/close
    const enhancerBtn = document.getElementById('audioEnhancerBtn');
    const modal = document.getElementById('audioEnhancerModal');
    if (enhancerBtn && modal) {
      if (typeof enhancerBtn.addEventListener === 'function') {
        enhancerBtn.addEventListener('click', (e) => {
          if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
          this.toggleEnhancerModal();
        });
      }

      const closeBtn = (typeof modal.querySelector === 'function') ? modal.querySelector('.closeModalBtn') : null;
      if (closeBtn && typeof closeBtn.addEventListener === 'function') {
        closeBtn.addEventListener('click', (e) => {
          if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
          this.closeEnhancerModal();
        });
      }

      if (typeof modal.addEventListener === 'function') {
        modal.addEventListener('click', (e) => {
          if (e && e.target === modal) {
            this.closeEnhancerModal();
          }
        });
      }
    }

    // Quality selection
    const qHdBtn = document.getElementById('qualityHdBtn');
    const qStdBtn = document.getElementById('qualityStandardBtn');
    if (qHdBtn) {
      qHdBtn.addEventListener('click', () => {
        this.setAudioQuality('hd');
      });
    }
    if (qStdBtn) {
      qStdBtn.addEventListener('click', () => {
        this.setAudioQuality('standard');
      });
    }

    // Preset selection
    document.querySelectorAll('.eq-preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const preset = btn.dataset.preset;
        if (preset) this.applyPreset(preset);
      });
    });

    // Sliders
    const bSlider = document.getElementById('eqBassSlider');
    const mSlider = document.getElementById('eqMidSlider');
    const tSlider = document.getElementById('eqTrebleSlider');
    if (bSlider) {
      bSlider.addEventListener('input', (e) => this.setEqGain('bass', e.target.value));
    }
    if (mSlider) {
      mSlider.addEventListener('input', (e) => this.setEqGain('mid', e.target.value));
    }
    if (tSlider) {
      tSlider.addEventListener('input', (e) => this.setEqGain('treble', e.target.value));
    }

    // Reset EQ
    const resetBtn = document.getElementById('resetEqBtn');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => this.resetEq());
    }

    // Compressor
    const compToggle = document.getElementById('compressorToggle');
    if (compToggle) {
      compToggle.addEventListener('change', (e) => this.setCompressor(e.target.checked));
    }

    this.updateEnhancerUI();
  }
}

const player = new PlayerEngine();
if (typeof window !== 'undefined') {
  window.player = player;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = PlayerEngine;
}
