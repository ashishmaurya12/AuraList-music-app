const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('Audio Quality & Studio DSP Equalizer (HD 320kbps Enhancement)', () => {
  let playerInstance;
  let mockAudioElement;
  let store;
  let eventHandlers;
  let context;
  let mockDocument;

  beforeEach(() => {
    store = new Map();
    eventHandlers = {};

    mockAudioElement = {
      volume: 0.8,
      currentTime: 0,
      duration: 200,
      paused: false,
      muted: false,
      src: '',
      crossOrigin: null,
      error: null,
      hasAttribute: (attr) => attr === 'crossorigin' && Boolean(mockAudioElement.crossOrigin),
      removeAttribute: (attr) => { if (attr === 'crossorigin') mockAudioElement.crossOrigin = null; },
      addEventListener: (event, handler) => { eventHandlers[event] = handler; },
      triggerEvent: (event) => { if (eventHandlers[event]) eventHandlers[event](); },
      play: jest.fn().mockResolvedValue(undefined),
      pause: jest.fn(() => { mockAudioElement.paused = true; })
    };

    mockDocument = {
      getElementById: (id) => {
        if (id === 'audioEngine') return mockAudioElement;
        return {
          addEventListener: () => {},
          classList: { toggle: jest.fn(), contains: () => false },
          querySelector: () => ({ className: '', addEventListener: () => {} }),
          style: {},
          value: 0,
          textContent: ''
        };
      },
      querySelectorAll: () => []
    };

    const mockLocalStorage = {
      getItem: (key) => store.get(key) || null,
      setItem: (key, val) => store.set(key, String(val)),
      removeItem: (key) => store.delete(key),
      clear: () => store.clear()
    };

    const playerCode = fs.readFileSync(path.join(__dirname, '../public/js/player.js'), 'utf8');

    context = vm.createContext({
      document: mockDocument,
      window: {
        location: { origin: 'http://localhost:3000', href: 'http://localhost:3000/app.html' },
        localStorage: mockLocalStorage,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        navigator: { userAgent: 'Mozilla/5.0' } // Browser simulation
      },
      localStorage: mockLocalStorage,
      console,
      setTimeout: (fn) => fn(),
      clearTimeout: jest.fn(),
      URL: global.URL,
      UI: {
        showToast: jest.fn(),
        formatTime: (sec) => `${Math.floor(sec / 60)}:${sec % 60 < 10 ? '0' : ''}${Math.floor(sec % 60)}`,
        updateLikeStatus: jest.fn(),
        updatePlayingTrackUI: jest.fn(),
        renderQueue: jest.fn()
      },
      API: {
        getToken: () => 'valid-jwt-token',
        get: jest.fn().mockResolvedValue({}),
        post: jest.fn().mockResolvedValue({}),
        put: jest.fn().mockResolvedValue({ success: true })
      }
    });

    vm.runInContext(playerCode, context);
    playerInstance = vm.runInContext('player', context);
  });

  it('1. defaults to HD 320 kbps mode in browser environment', () => {
    expect(playerInstance.audioQuality).toBe('hd');
  });

  it('2. getPlayableAudioUrl upgrades low-bitrate streams (_96, _160) to 320kbps HD', () => {
    const raw96 = 'https://aac.saavncdn.com/902/97f0f6399f54555eae2beecacbc082fa_96.mp4';
    const raw160 = 'https://aac.saavncdn.com/820/20c352e29d54066d5691f1a1a15e4578_160.mp4';
    const rawMp3 = 'https://aac.saavncdn.com/123/sample_96.mp3';

    expect(playerInstance.getPlayableAudioUrl(raw96)).toBe('https://aac.saavncdn.com/902/97f0f6399f54555eae2beecacbc082fa_320.mp4');
    expect(playerInstance.getPlayableAudioUrl(raw160)).toBe('https://aac.saavncdn.com/820/20c352e29d54066d5691f1a1a15e4578_320.mp4');
    expect(playerInstance.getPlayableAudioUrl(rawMp3)).toBe('https://aac.saavncdn.com/123/sample_320.mp3');
  });

  it('3. preserves original standard quality stream when audioQuality is set to standard', () => {
    playerInstance.setAudioQuality('standard');
    expect(playerInstance.audioQuality).toBe('standard');

    const raw96 = 'https://aac.saavncdn.com/902/97f0f6399f54555eae2beecacbc082fa_96.mp4';
    expect(playerInstance.getPlayableAudioUrl(raw96)).toBe(raw96);
  });

  it('4. applyPreset updates Bass, Mid, Treble, and Compressor settings correctly', () => {
    playerInstance.applyPreset('bass');
    expect(playerInstance.currentPreset).toBe('bass');
    expect(playerInstance.eqBass).toBe(7.0);
    expect(playerInstance.eqMid).toBe(0.0);
    expect(playerInstance.eqTreble).toBe(1.5);
    expect(playerInstance.compressorEnabled).toBe(true);

    playerInstance.applyPreset('vocal');
    expect(playerInstance.currentPreset).toBe('vocal');
    expect(playerInstance.eqMid).toBe(4.5);

    playerInstance.applyPreset('flat');
    expect(playerInstance.currentPreset).toBe('flat');
    expect(playerInstance.eqBass).toBe(0.0);
    expect(playerInstance.eqMid).toBe(0.0);
    expect(playerInstance.eqTreble).toBe(0.0);
    expect(playerInstance.compressorEnabled).toBe(false);
  });

  it('5. setEqGain clamps values strictly between -12 dB and +12 dB', () => {
    playerInstance.setEqGain('bass', 18);
    expect(playerInstance.eqBass).toBe(12);

    playerInstance.setEqGain('treble', -25);
    expect(playerInstance.eqTreble).toBe(-12);

    playerInstance.setEqGain('mid', 4.5);
    expect(playerInstance.eqMid).toBe(4.5);
  });

  it('6. automatically falls back to original safe URL if 320 stream triggers error', async () => {
    const track = {
      id: 'fallback_test',
      title: 'Fallback Song',
      audioUrl: 'https://aac.saavncdn.com/902/97f0f6399f54555eae2beecacbc082fa_96.mp4'
    };

    await playerInstance.playTrack(track, [track], 0);

    // Initial attempt was 320kbps
    expect(mockAudioElement.src).toBe('https://aac.saavncdn.com/902/97f0f6399f54555eae2beecacbc082fa_320.mp4');

    // Simulate an error on the 320 stream
    mockAudioElement.error = { code: 4 }; // MEDIA_ERR_SRC_NOT_SUPPORTED
    mockAudioElement.triggerEvent('error');

    // Expected automatic fallback to safe original stream
    expect(mockAudioElement.src).toBe('https://aac.saavncdn.com/902/97f0f6399f54555eae2beecacbc082fa_96.mp4');
    expect(playerInstance.effectiveAudioQuality).toBe('fallback');
  });

  it('7. restored playback keeps non-autoplay, prepares quality and DSP on first user togglePlay without duplicate history', async () => {
    const savedState = {
      track: {
        id: 'restored_song_1',
        title: 'Restored Song',
        artist: 'Test Artist',
        audioUrl: 'https://aac.saavncdn.com/123/sample_96.mp4'
      },
      queue: [{
        id: 'restored_song_1',
        title: 'Restored Song',
        artist: 'Test Artist',
        audioUrl: 'https://aac.saavncdn.com/123/sample_96.mp4'
      }],
      queueIndex: 0,
      position: 45,
      duration: 180
    };

    store.set('auralist_last_playback', JSON.stringify(savedState));
    const restored = playerInstance.restorePlaybackState({ autoPlay: false });
    expect(restored).toBe(true);
    expect(playerInstance._isRestoredState).toBe(true);
    expect(playerInstance.isPlaying).toBe(false);

    // Initial audio.src from restore holds raw saved URL without autoplaying
    expect(mockAudioElement.src).toBe('https://aac.saavncdn.com/123/sample_96.mp4');
    expect(mockAudioElement.play).not.toHaveBeenCalled();

    // First user-initiated play via togglePlay prepares source quality and DSP
    playerInstance.togglePlay();

    // Prepared HD URL
    expect(mockAudioElement.src).toBe('https://aac.saavncdn.com/123/sample_320.mp4');
    expect(playerInstance._isRestoredState).toBe(false);
    expect(mockAudioElement.play).toHaveBeenCalled();
  });

  it('8. seek method never assigns negative, NaN, or Infinity into audio.currentTime', () => {
    mockAudioElement.currentTime = 20;
    mockAudioElement.duration = 100;

    playerInstance.seek(-10);
    expect(mockAudioElement.currentTime).toBe(0);

    playerInstance.seek(NaN);
    expect(mockAudioElement.currentTime).toBe(0); // Unchanged

    playerInstance.seek(Infinity);
    expect(mockAudioElement.currentTime).toBe(0); // Unchanged

    playerInstance.seek(150);
    expect(mockAudioElement.currentTime).toBe(100); // Clamped to duration

    playerInstance.seek(50);
    expect(mockAudioElement.currentTime).toBe(50);
  });

  it('9. canUseDSPForSource correctly identifies CORS support and disables DSP for external/unsupported origins', () => {
    // Relative paths and same-origin URLs are eligible for DSP
    expect(playerInstance.canUseDSPForSource('/media/local.mp3')).toBe(true);
    expect(playerInstance.canUseDSPForSource('http://localhost:3000/media/local.mp3')).toBe(true);

    // Saavn CDN audio stream origin is CORS-compatible (Access-Control-Allow-Origin: *)
    expect(playerInstance.canUseDSPForSource('https://aac.saavncdn.com/test.mp4')).toBe(true);
    expect(playerInstance.canUseDSPForSource('https://untrusted-cdn-without-cors.example.com/audio.mp3')).toBe(false);
  });

  it('10. retries without crossOrigin and disables DSP cleanly if CORS stream fails', () => {
    mockAudioElement.src = 'https://some-external-domain.com/stream.mp3';
    mockAudioElement.crossOrigin = 'anonymous';

    // Simulate playback error on CORS audio element
    mockAudioElement.error = { code: 2 }; // MEDIA_ERR_NETWORK / CORS
    mockAudioElement.triggerEvent('error');

    // Should have retried without crossOrigin, disabled DSP, and set fallback
    expect(mockAudioElement.crossOrigin).toBeNull();
    expect(playerInstance.isDspAvailable).toBe(false);
    expect(playerInstance.effectiveAudioQuality).toBe('fallback');
    expect(mockAudioElement.play).toHaveBeenCalled();
  });

  describe('Audio Settings Button, Modal & Quality Badge Removal', () => {
    it('11. verifies public/app.html has audioEnhancerBtn, modal, and NO playerHdBadge', () => {
      const htmlContent = fs.readFileSync(path.join(__dirname, '../public/app.html'), 'utf8');
      expect(htmlContent).toContain('id="audioEnhancerBtn"');
      expect(htmlContent).toContain('id="audioEnhancerModal"');
      expect(htmlContent).not.toContain('id="playerHdBadge"');
      expect(htmlContent).not.toContain('class="hd-badge-pill"');
    });

    it('12. openEnhancerModal adds "open" class and closeEnhancerModal removes "open" and "active"', () => {
      const classSet = new Set();
      const mockModal = {
        classList: {
          add: jest.fn((cls) => classSet.add(cls)),
          remove: jest.fn((...classes) => classes.forEach(c => classSet.delete(c))),
          contains: jest.fn((cls) => classSet.has(cls))
        },
        querySelector: jest.fn(() => ({ addEventListener: jest.fn() })),
        addEventListener: jest.fn()
      };

      const originalGetElementById = mockDocument.getElementById;
      mockDocument.getElementById = (id) => {
        if (id === 'audioEnhancerModal') return mockModal;
        return originalGetElementById(id);
      };

      playerInstance.openEnhancerModal();
      expect(mockModal.classList.add).toHaveBeenCalledWith('open');
      expect(classSet.has('open')).toBe(true);

      playerInstance.closeEnhancerModal();
      expect(mockModal.classList.remove).toHaveBeenCalledWith('open', 'active');
      expect(classSet.has('open')).toBe(false);

      mockDocument.getElementById = originalGetElementById;
    });

    it('13. toggleEnhancerModal toggles modal open/closed state correctly', () => {
      const classSet = new Set();
      const mockModal = {
        classList: {
          add: jest.fn((cls) => classSet.add(cls)),
          remove: jest.fn((...classes) => classes.forEach(c => classSet.delete(c))),
          contains: jest.fn((cls) => classSet.has(cls))
        },
        querySelector: jest.fn(() => ({ addEventListener: jest.fn() })),
        addEventListener: jest.fn()
      };

      const originalGetElementById = mockDocument.getElementById;
      mockDocument.getElementById = (id) => {
        if (id === 'audioEnhancerModal') return mockModal;
        return originalGetElementById(id);
      };

      // Initially closed -> toggle opens
      playerInstance.toggleEnhancerModal();
      expect(classSet.has('open')).toBe(true);

      // Open -> toggle closes
      playerInstance.toggleEnhancerModal();
      expect(classSet.has('open')).toBe(false);

      mockDocument.getElementById = originalGetElementById;
    });

    it('14. updateEnhancerUI expunges any dynamic or cached playerHdBadge from the DOM', () => {
      let badgeRemoved = false;
      const mockBadge = {
        remove: jest.fn(() => { badgeRemoved = true; }),
        classList: { toggle: jest.fn() },
        textContent: ''
      };

      const originalGetElementById = mockDocument.getElementById;
      mockDocument.getElementById = (id) => {
        if (id === 'playerHdBadge') return mockBadge;
        return originalGetElementById(id);
      };

      playerInstance.updateEnhancerUI();
      expect(mockBadge.remove).toHaveBeenCalled();
      expect(badgeRemoved).toBe(true);

      mockDocument.getElementById = originalGetElementById;
    });

    it('15. clicking button, close button, and backdrop correctly triggers open and close handlers', () => {
      let btnClickHandler = null;
      let closeClickHandler = null;
      let backdropClickHandler = null;
      const classSet = new Set();

      const mockModal = {
        classList: {
          add: jest.fn((cls) => classSet.add(cls)),
          remove: jest.fn((...classes) => classes.forEach(c => classSet.delete(c))),
          contains: jest.fn((cls) => classSet.has(cls))
        },
        querySelector: (sel) => {
          if (sel === '.closeModalBtn') {
            return {
              addEventListener: (evt, fn) => { if (evt === 'click') closeClickHandler = fn; }
            };
          }
          return null;
        },
        addEventListener: (evt, fn) => {
          if (evt === 'click') backdropClickHandler = fn;
        }
      };

      const mockBtn = {
        addEventListener: (evt, fn) => {
          if (evt === 'click') btnClickHandler = fn;
        }
      };

      const originalGetElementById = mockDocument.getElementById;
      mockDocument.getElementById = (id) => {
        if (id === 'audioEnhancerBtn') return mockBtn;
        if (id === 'audioEnhancerModal') return mockModal;
        return originalGetElementById(id);
      };

      playerInstance.initEnhancerUI();

      // Click button -> opens modal
      expect(btnClickHandler).toBeDefined();
      btnClickHandler({ stopPropagation: jest.fn() });
      expect(classSet.has('open')).toBe(true);

      // Click close button -> closes modal
      expect(closeClickHandler).toBeDefined();
      closeClickHandler({ stopPropagation: jest.fn() });
      expect(classSet.has('open')).toBe(false);

      // Click button again -> re-opens
      btnClickHandler({ stopPropagation: jest.fn() });
      expect(classSet.has('open')).toBe(true);

      // Click outside on backdrop -> closes modal
      expect(backdropClickHandler).toBeDefined();
      backdropClickHandler({ target: mockModal });
      expect(classSet.has('open')).toBe(false);

      mockDocument.getElementById = originalGetElementById;
    });

    it('16. track changes keep enhancer UI and modal functionality intact', async () => {
      const track1 = { id: 'track_1', title: 'Song 1', audioUrl: 'https://aac.saavncdn.com/sample1_96.mp4' };
      const track2 = { id: 'track_2', title: 'Song 2', audioUrl: 'https://aac.saavncdn.com/sample2_96.mp4' };

      await playerInstance.playTrack(track1, [track1, track2], 0);
      expect(playerInstance.currentTrack.id).toBe('track_1');

      // Change track
      await playerInstance.playTrack(track2, [track1, track2], 1);
      expect(playerInstance.currentTrack.id).toBe('track_2');

      // Preserves volume, equalizer gain, and quality settings
      expect(playerInstance.audioQuality).toBe('hd');
      expect(playerInstance.eqBass).toBeDefined();
    });
  });
});
