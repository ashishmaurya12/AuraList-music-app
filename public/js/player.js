// YouTube Music Player Controller & Audio Engine
class PlayerEngine {
  constructor() {
    this.audio = document.getElementById('audioEngine');
    this.currentTrack = null;
    this.queue = [];
    this.queueIndex = -1;
    this.isPlaying = false;
    this.isShuffle = false;
    this.repeatMode = 'off'; // 'off' | 'all' | 'one'
    
    this.initEventListeners();
    this.loadSavedVolume();
  }

  loadSavedVolume() {
    const savedVol = localStorage.getItem('auralist_volume');
    const vol = savedVol !== null ? parseFloat(savedVol) : 0.8;
    if (this.audio) this.audio.volume = vol;
    const volBar = document.getElementById('volumeBar');
    if (volBar) volBar.value = vol;
    this.updateVolumeIcon(vol);
  }

  initEventListeners() {
    if (!this.audio) return;

    this.audio.addEventListener('timeupdate', () => {
      this.updateProgressUI();
    });

    this.audio.addEventListener('loadedmetadata', () => {
      this.updateDurationUI();
    });

    this.audio.addEventListener('ended', () => {
      this.onTrackEnded();
    });

    this.audio.addEventListener('play', () => {
      this.isPlaying = true;
      this.updatePlayPauseUI();
      this.setEqualizerState(true);
    });

    this.audio.addEventListener('pause', () => {
      this.isPlaying = false;
      this.updatePlayPauseUI();
      this.setEqualizerState(false);
    });

    this.audio.addEventListener('error', (e) => {
      console.warn('Audio playback error:', e);
      if (typeof UI !== 'undefined' && UI.showToast) {
        UI.showToast('Audio stream unavailable. Skipping to next track...', 'error');
      }
      setTimeout(() => this.next(), 1500);
    });
  }

  // Play a track and set queue context
  playTrack(track, queueList = null, index = 0) {
    if (!track || !track.audioUrl) {
      if (typeof UI !== 'undefined' && UI.showToast) {
        UI.showToast('Invalid track audio stream', 'error');
      }
      return;
    }

    this.currentTrack = track;

    if (queueList && Array.isArray(queueList)) {
      this.queue = [...queueList];
      this.queueIndex = index >= 0 ? index : this.queue.findIndex(t => t.id === track.id || t.jamendoId === track.jamendoId);
    } else if (this.queue.length === 0) {
      this.queue = [track];
      this.queueIndex = 0;
    }

    this.audio.src = track.audioUrl;
    this.audio.play().then(() => {
      this.isPlaying = true;
      this.updateNowPlayingUI();
      this.logHistory(track);
      if (typeof UI !== 'undefined' && UI.renderQueue) {
        UI.renderQueue();
      }
      this.fetchLyrics(track.id || track.jamendoId);
    }).catch(err => {
      console.error('Play request rejected:', err);
    });
  }

  togglePlay() {
    if (!this.currentTrack) {
      if (this.queue.length > 0) {
        this.playTrack(this.queue[0], this.queue, 0);
      }
      return;
    }

    if (this.audio.paused) {
      this.audio.play();
    } else {
      this.audio.pause();
    }
  }

  next() {
    if (this.queue.length === 0) return;

    if (this.repeatMode === 'one' && this.currentTrack) {
      this.audio.currentTime = 0;
      this.audio.play();
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
          return;
        }
      }
    }

    const nextTrack = this.queue[this.queueIndex];
    if (nextTrack) {
      this.playTrack(nextTrack);
    }
  }

  prev() {
    if (this.queue.length === 0) return;

    if (this.audio.currentTime > 3) {
      this.audio.currentTime = 0;
      return;
    }

    this.queueIndex--;
    if (this.queueIndex < 0) {
      this.queueIndex = this.repeatMode === 'all' ? this.queue.length - 1 : 0;
    }

    const prevTrack = this.queue[this.queueIndex];
    if (prevTrack) {
      this.playTrack(prevTrack);
    }
  }

  toggleShuffle() {
    this.isShuffle = !this.isShuffle;
    const shuffleBtn = document.getElementById('shuffleBtn');
    if (shuffleBtn) {
      shuffleBtn.classList.toggle('active', this.isShuffle);
    }
    if (typeof UI !== 'undefined' && UI.showToast) {
      UI.showToast(`Shuffle ${this.isShuffle ? 'On' : 'Off'}`);
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

    if (typeof UI !== 'undefined' && UI.showToast) {
      UI.showToast(`Repeat Mode: ${this.repeatMode.toUpperCase()}`);
    }
  }

  seek(seconds) {
    if (this.audio && !isNaN(seconds)) {
      this.audio.currentTime = seconds;
    }
  }

  setVolume(volume) {
    const vol = Math.max(0, Math.min(1, parseFloat(volume)));
    this.audio.volume = vol;
    localStorage.setItem('auralist_volume', vol);
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
    const muteBtn = document.getElementById('muteBtn');
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
    this.next();
  }

  addToQueue(track) {
    this.queue.push(track);
    if (typeof UI !== 'undefined') {
      UI.showToast(`Added "${track.title}" to Up Next Queue`);
      if (UI.renderQueue) UI.renderQueue();
    }
  }

  clearQueue() {
    this.queue = this.currentTrack ? [this.currentTrack] : [];
    this.queueIndex = this.currentTrack ? 0 : -1;
    if (typeof UI !== 'undefined') {
      UI.showToast('Up Next Queue cleared');
      if (UI.renderQueue) UI.renderQueue();
    }
  }

  async fetchLyrics(trackId) {
    const lyricsEl = document.getElementById('lyricsContent');
    if (lyricsEl) lyricsEl.textContent = 'Loading lyrics...';

    try {
      const data = await API.get(`/music/lyrics/${trackId}`);
      if (lyricsEl) {
        lyricsEl.textContent = data.lyrics || 'Lyrics unavailable for this track.';
      }
    } catch (e) {
      if (lyricsEl) lyricsEl.textContent = 'Failed to load lyrics.';
    }
  }

  async logHistory(track) {
    try {
      if (API.getToken()) {
        await API.post('/history', {
          jamendoId: track.jamendoId || track.id,
          title: track.title,
          artist: track.artist,
          coverUrl: track.coverUrl,
          audioUrl: track.audioUrl,
          duration: track.duration
        });
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

    const coverSrc = this.currentTrack.coverUrl || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=400&auto=format&fit=crop';
    
    if (cover) cover.src = coverSrc;
    if (title) title.textContent = this.currentTrack.title;
    if (artist) artist.textContent = this.currentTrack.artist;

    if (drawerCover) drawerCover.src = coverSrc;
    if (drawerTitle) drawerTitle.textContent = this.currentTrack.title;
    if (drawerArtist) drawerArtist.textContent = this.currentTrack.artist;

    if (typeof UI !== 'undefined' && UI.updateLikeStatus) {
      UI.updateLikeStatus(this.currentTrack.jamendoId || this.currentTrack.id);
    }
  }

  updatePlayPauseUI() {
    const playPauseBtn = document.getElementById('playPauseBtn');
    if (!playPauseBtn) return;
    const icon = playPauseBtn.querySelector('i');
    if (this.isPlaying) {
      icon.className = 'fa-solid fa-pause';
      playPauseBtn.title = 'Pause';
    } else {
      icon.className = 'fa-solid fa-play';
      playPauseBtn.title = 'Play';
    }
  }

  updateProgressUI() {
    const seekBar = document.getElementById('seekBar');
    const currentTimeEl = document.getElementById('currentTime');

    if (!this.audio.duration || isNaN(this.audio.duration)) return;

    const currentSec = Math.floor(this.audio.currentTime);
    const progressPercent = (this.audio.currentTime / this.audio.duration) * 100;

    if (seekBar) {
      seekBar.value = progressPercent;
      seekBar.style.background = `linear-gradient(to right, var(--accent-yt-red) ${progressPercent}%, rgba(255,255,255,0.15) ${progressPercent}%)`;
    }

    if (currentTimeEl && typeof UI !== 'undefined') {
      currentTimeEl.textContent = UI.formatTime(currentSec);
    }
  }

  updateDurationUI() {
    const totalDurationEl = document.getElementById('totalDuration');
    if (!totalDurationEl) return;
    
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
    const eq = document.getElementById('equalizer');
    if (eq) {
      eq.classList.toggle('paused', !animating);
    }
  }
}

const player = new PlayerEngine();
