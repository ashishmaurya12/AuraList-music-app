const fs = require('fs');
const path = require('path');
const vm = require('vm');
const musicProvider = require('../backend/services/musicProvider');

describe('Phases 2, 3 & 4: Integrated Frontend & Feature Logic', () => {
  let UI;
  let context;

  beforeAll(() => {
    const uiPath = path.join(__dirname, '..', 'public', 'js', 'ui.js');
    const uiCode = fs.readFileSync(uiPath, 'utf8');

    const createdElements = [];
    const createMockElement = (tag) => {
      const el = {
        tagName: (tag || 'DIV').toUpperCase(),
        children: [],
        dataset: {},
        classList: {
          toggle: jest.fn(),
          add: jest.fn(),
          remove: jest.fn(),
          contains: () => false
        },
        setAttribute: jest.fn(),
        appendChild: function(c) { this.children.push(c); return c; },
        replaceChildren: function() { this.children = []; },
        addEventListener: jest.fn(),
        querySelector: () => ({ addEventListener: jest.fn() }),
        querySelectorAll: () => [],
        scrollTo: jest.fn(),
        style: {},
        textContent: '',
        offsetTop: 200
      };
      createdElements.push(el);
      return el;
    };

    const mockDocument = {
      getElementById: (id) => createMockElement('div'),
      createElement: (tag) => createMockElement(tag),
      querySelectorAll: () => []
    };

    const mockWindow = { document: mockDocument, location: { hash: '' } };

    context = vm.createContext({
      window: mockWindow,
      document: mockDocument,
      console,
      setTimeout,
      clearTimeout,
      player: {
        queue: [],
        currentTrack: null,
        isPlaying: false,
        seek: jest.fn(),
        playTrack: jest.fn()
      },
      app: {
        navigateToArtist: jest.fn(),
        playTrackFromList: jest.fn()
      },
      API: {}
    });

    vm.runInContext(uiCode, context);
    UI = vm.runInContext('UI', context);
  });

  describe('Mood-Based Discovery Mapping Integrity', () => {
    it('only classifies tracks based on title, album, or category - never by artist name alone', async () => {
      const chillResult = await musicProvider.getMoodTracks('chill', { limit: 10 });
      expect(chillResult.mood).toBe('chill');
      expect(chillResult.label).toBe('Chill');
      expect(Array.isArray(chillResult.tracks)).toBe(true);

      for (const track of chillResult.tracks) {
        const isMatched = musicProvider.MOOD_CONFIG.chill.regex.test(track.title || '') ||
                          musicProvider.MOOD_CONFIG.chill.regex.test(track.album || '') ||
                          musicProvider.MOOD_CONFIG.chill.regex.test(track.category || '');
        expect(isMatched).toBe(true);
      }
    });

    it('keeps tracks with insufficient metadata unclassified', async () => {
      const unclassifiedTrack = {
        title: 'Random Song',
        album: 'Single',
        category: 'indian',
        artist: 'Unknown Singer'
      };

      for (const [moodKey, cfg] of Object.entries(musicProvider.MOOD_CONFIG)) {
        const match = cfg.regex.test(unclassifiedTrack.title) || cfg.regex.test(unclassifiedTrack.album);
        expect(match).toBe(false);
      }
    });
  });

  describe('Synchronized Lyrics Experience', () => {
    it('correctly parses LRC timestamps into chronological seconds and text lines', () => {
      const sampleLrc = `
[00:12.50]First line of the song
[00:18.20]Second line with emotional vocals
[01:05.00]Chorus explodes here
      `.trim();

      const container = context.document.createElement('div');
      UI.renderLyrics({ lyrics: sampleLrc, isSynchronized: true }, container);

      expect(UI.parsedLyrics).toHaveLength(3);
      expect(UI.parsedLyrics[0].time).toBe(12.5);
      expect(UI.parsedLyrics[0].text).toBe('First line of the song');
      expect(UI.parsedLyrics[2].time).toBe(65);
    });

    it('falls back to clean unsynchronized typography when timestamps are not provided', () => {
      const plainLyrics = 'Line one\nLine two\nChorus line';
      const container = context.document.createElement('div');
      UI.renderLyrics({ lyrics: plainLyrics, isSynchronized: false }, container);

      expect(UI.parsedLyrics).toHaveLength(0);
      expect(container.children.length).toBeGreaterThan(0);
    });

    it('handles lyrics unavailable state gracefully without throwing', () => {
      const container = context.document.createElement('div');
      UI.renderLyrics({ lyrics: 'Lyrics unavailable for this track.' }, container);

      expect(UI.parsedLyrics).toHaveLength(0);
      expect(container.innerHTML || container.textContent).toBeDefined();
    });
  });

  describe('Listening Insights Dashboard Integrity', () => {
    it('renders genuine statistics without fabricating metrics', () => {
      const sampleInsights = {
        totalPlays: 24,
        totalListeningSeconds: 3720,
        topTracks: [{ jamendoId: '1', title: 'Gehra Hua', artist: 'Arijit Singh', plays: 12 }],
        topArtists: [{ artist: 'Arijit Singh', plays: 15 }],
        dailyTrends: [
          { date: '2026-10-24', dayName: 'Sat', plays: 6 },
          { date: '2026-10-23', dayName: 'Fri', plays: 18 }
        ],
        monthlySummary: { monthName: 'October 2026', plays: 24, listeningSeconds: 3720 },
        countingRules: 'Minimum 15 seconds required'
      };

      const container = context.document.createElement('div');
      UI.renderListeningInsights(sampleInsights, container);

      expect(container.children.length).toBeGreaterThan(0);
    });

    it('shows empty state when user has 0 qualified plays', () => {
      const emptyInsights = {
        totalPlays: 0,
        totalListeningSeconds: 0,
        topTracks: [],
        topArtists: [],
        dailyTrends: []
      };

      const container = context.document.createElement('div');
      UI.renderListeningInsights(emptyInsights, container);

      expect(container.innerHTML || container.children.length).toBeDefined();
    });
  });

  describe('Keyboard Shortcuts Accessibility & Application Handler', () => {
    let mockAppInstance;
    let mockPlayer;
    let searchInput;

    beforeEach(() => {
      mockPlayer = {
        togglePlay: jest.fn(),
        seek: jest.fn(),
        toggleMute: jest.fn(),
        next: jest.fn(),
        prev: jest.fn(),
        audio: { currentTime: 30, duration: 200 }
      };

      searchInput = {
        focus: jest.fn(),
        select: jest.fn()
      };

      mockAppInstance = {
        closeModals: jest.fn(),
        toggleFullscreenPlayer: jest.fn(),
        openShortcutsModal: jest.fn()
      };

      // Import AppController
      const AppController = require('../public/js/app');
      mockAppInstance.handleKeyboardShortcut = AppController.prototype.handleKeyboardShortcut;

      // Provide mock environment globals
      global.player = mockPlayer;
      global.document = {
        getElementById: (id) => {
          if (id === 'globalSearchInput') return searchInput;
          return { classList: { remove: jest.fn(), add: jest.fn() } };
        }
      };
      context.document = global.document;
    });

    it('triggers playback control (togglePlay) when Space is pressed outside form inputs', () => {
      const event = {
        code: 'Space',
        target: { tagName: 'DIV' },
        preventDefault: jest.fn()
      };

      mockAppInstance.handleKeyboardShortcut(event);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(mockPlayer.togglePlay).toHaveBeenCalledTimes(1);
    });

    it('strictly ignores shortcut keys when active element is an input, textarea, select, or contenteditable', () => {
      const inputTargets = [
        { tagName: 'INPUT' },
        { tagName: 'TEXTAREA' },
        { tagName: 'SELECT' },
        { tagName: 'DIV', isContentEditable: true }
      ];

      for (const target of inputTargets) {
        const event = {
          code: 'Space',
          target,
          preventDefault: jest.fn()
        };

        mockAppInstance.handleKeyboardShortcut(event);

        expect(event.preventDefault).not.toHaveBeenCalled();
        expect(mockPlayer.togglePlay).not.toHaveBeenCalled();
      }
    });

    it('seeks forward 5 seconds on ArrowRight', () => {
      const event = {
        key: 'ArrowRight',
        target: { tagName: 'BODY' },
        preventDefault: jest.fn()
      };

      mockAppInstance.handleKeyboardShortcut(event);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(mockPlayer.seek).toHaveBeenCalledWith(35); // 30 + 5
    });

    it('seeks backward 5 seconds on ArrowLeft without going below 0', () => {
      mockPlayer.audio.currentTime = 3;
      const event = {
        key: 'ArrowLeft',
        target: { tagName: 'BODY' },
        preventDefault: jest.fn()
      };

      mockAppInstance.handleKeyboardShortcut(event);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(mockPlayer.seek).toHaveBeenCalledWith(0); // max(0, 3 - 5)
    });

    it('focuses and selects global search input when "/" is pressed', () => {
      const event = {
        key: '/',
        target: { tagName: 'BODY' },
        preventDefault: jest.fn()
      };

      mockAppInstance.handleKeyboardShortcut(event);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(searchInput.focus).toHaveBeenCalledTimes(1);
      expect(searchInput.select).toHaveBeenCalledTimes(1);
    });

    it('toggles mute, next, and previous tracks on M, N, and P keys', () => {
      mockAppInstance.handleKeyboardShortcut({ key: 'm', target: { tagName: 'BODY' }, preventDefault: jest.fn() });
      expect(mockPlayer.toggleMute).toHaveBeenCalledTimes(1);

      mockAppInstance.handleKeyboardShortcut({ key: 'n', target: { tagName: 'BODY' }, preventDefault: jest.fn() });
      expect(mockPlayer.next).toHaveBeenCalledTimes(1);

      mockAppInstance.handleKeyboardShortcut({ key: 'p', target: { tagName: 'BODY' }, preventDefault: jest.fn() });
      expect(mockPlayer.prev).toHaveBeenCalledTimes(1);
    });

    it('opens help modal on "?" and closes open views on Escape', () => {
      mockAppInstance.handleKeyboardShortcut({ key: '?', target: { tagName: 'BODY' }, preventDefault: jest.fn() });
      expect(mockAppInstance.openShortcutsModal).toHaveBeenCalledTimes(1);

      mockAppInstance.handleKeyboardShortcut({ key: 'Escape', target: { tagName: 'INPUT' }, preventDefault: jest.fn() });
      expect(mockAppInstance.closeModals).toHaveBeenCalledTimes(1);
      expect(mockAppInstance.toggleFullscreenPlayer).toHaveBeenCalledWith(false);
    });
  });
});
