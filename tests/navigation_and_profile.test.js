/**
 * tests/navigation_and_profile.test.js
 *
 * Unit tests verifying:
 * 1. Hamburger menu button toggle across Desktop & Mobile layouts
 * 2. Mobile overlay backdrop dismissal and nav-item auto-close
 * 3. Profile dropdown (Orange A button) toggle and outside-click / Escape dismissal
 * 4. Logged-in profile menu options and user info display
 * 5. Logged-out profile menu options (Sign In / Register)
 * 6. Logout workflow calling API.clearAuth() and redirection
 */

const fs = require('fs');
const path = require('path');

// Simple DOM Mock Environment
function createMockDOM() {
  const elements = new Map();
  const eventListeners = new Map();

  function makeElement(id, tagName = 'div', className = '', attributes = {}) {
    const classSet = new Set(className.split(' ').filter(Boolean));
    const attrs = { ...attributes };
    const elListeners = new Map();
    let innerHTML = '';
    let textContent = '';

    const el = {
      id,
      tagName: tagName.toUpperCase(),
      style: {},
      get innerHTML() {
        return innerHTML;
      },
      set innerHTML(val) {
        innerHTML = val;
        // Basic parser for items rendered into innerHTML
        if (val.includes('data-action=')) {
          const matches = [...val.matchAll(/data-action="([^"]+)"(?:\s+data-target="([^"]+)")?/g)];
          subItems = matches.map(m => {
            const item = makeElement('', 'button', 'profile-dropdown-item', {
              'data-action': m[1],
              'data-target': m[2] || ''
            });
            return item;
          });
        }
      },
      get textContent() {
        return textContent;
      },
      set textContent(val) {
        textContent = val;
      },
      classList: {
        contains: (c) => classSet.has(c),
        add: (...cs) => cs.forEach(c => classSet.add(c)),
        remove: (...cs) => cs.forEach(c => classSet.delete(c)),
        toggle: (c, force) => {
          if (force !== undefined) {
            if (force) classSet.add(c);
            else classSet.delete(c);
            return force;
          }
          if (classSet.has(c)) {
            classSet.delete(c);
            return false;
          }
          classSet.add(c);
          return true;
        }
      },
      setAttribute: (k, v) => { attrs[k] = String(v); },
      getAttribute: (k) => attrs[k] || null,
      removeAttribute: (k) => { delete attrs[k]; },
      addEventListener: (evt, handler) => {
        if (!elListeners.has(evt)) elListeners.set(evt, []);
        elListeners.get(evt).push(handler);
      },
      dispatchEvent: (evt) => {
        const list = elListeners.get(evt.type) || [];
        list.forEach(fn => fn(evt));
      },
      click: () => {
        const list = elListeners.get('click') || [];
        const evt = { type: 'click', target: el, stopPropagation: () => {} };
        list.forEach(fn => fn(evt));
      },
      closest: (sel) => {
        if (sel === `#${id}` || sel === `.${className}`) return el;
        if (sel === '#userProfileMenuWrapper' && id === 'userProfileMenuWrapper') return el;
        return null;
      },
      querySelectorAll: (sel) => {
        if (sel === '.profile-dropdown-item') {
          return subItems;
        }
        return [];
      },
      children: [],
      appendChild: (child) => {
        el.children.push(child);
        return child;
      },
      querySelector: (sel) => {
        if (sel.startsWith('#')) {
          const targetId = sel.slice(1);
          return el.children.find(c => c.id === targetId) || null;
        }
        return null;
      }
    };

    let subItems = [];
    elements.set(id, el);
    return el;
  }

  const toggleSidebarBtn = makeElement('toggleSidebarBtn', 'button', 'menu-toggle-btn', { 'aria-expanded': 'false' });
  const appSidebar = makeElement('appSidebar', 'aside', 'sidebar');
  const sidebarOverlay = makeElement('sidebarOverlay', 'div', 'sidebar-overlay', { 'aria-hidden': 'true' });
  sidebarOverlay.style.display = 'none';

  const userProfileMenuWrapper = makeElement('userProfileMenuWrapper', 'div', 'user-profile-menu-wrapper');
  const userAvatar = makeElement('userAvatar', 'button', 'user-avatar', { 'aria-expanded': 'false' });
  const profileDropdown = makeElement('profileDropdown', 'div', 'profile-dropdown', { role: 'menu' });
  profileDropdown.style.display = 'none';

  const appContainer = makeElement('appContainer', 'div', 'app-container');

  const docElement = makeElement('html', 'html');
  const docListeners = new Map();
  const documentMock = {
    documentElement: docElement,
    createElement: (tag) => makeElement('', tag),
    getElementById: (id) => elements.get(id) || null,
    querySelector: (sel) => {
      if (sel === '.app-container') return appContainer;
      if (sel.startsWith('#')) return elements.get(sel.slice(1)) || null;
      return null;
    },
    querySelectorAll: (sel) => {
      if (sel === '.nav-item') return [];
      if (sel === '.profile-dropdown-item') return profileDropdown.querySelectorAll('.profile-dropdown-item');
      return [];
    },
    addEventListener: (evt, fn) => {
      if (!docListeners.has(evt)) docListeners.set(evt, []);
      docListeners.get(evt).push(fn);
    },
    dispatchEvent: (evt) => {
      const list = docListeners.get(evt.type) || [];
      list.forEach(fn => fn(evt));
    }
  };

  const winListeners = new Map();
  const windowMock = {
    innerWidth: 1200,
    location: { href: '/app', hash: '#home', pathname: '/app' },
    addEventListener: (evt, fn) => {
      if (!winListeners.has(evt)) winListeners.set(evt, []);
      winListeners.get(evt).push(fn);
    },
    dispatchEvent: (evt) => {
      const list = winListeners.get(evt.type) || [];
      list.forEach(fn => fn(evt));
    }
  };

  return {
    elements,
    documentMock,
    windowMock,
    toggleSidebarBtn,
    appSidebar,
    sidebarOverlay,
    userProfileMenuWrapper,
    userAvatar,
    profileDropdown,
    appContainer
  };
}

describe('Hamburger Menu Button & Profile Dropdown Controller Tests', () => {
  let dom;
  let AppController;
  let app;
  let mockUser;
  let mockToken;

  beforeEach(() => {
    jest.resetModules();
    dom = createMockDOM();

    global.document = dom.documentMock;
    global.window = dom.windowMock;

    mockUser = { id: 'user_123', name: 'Ashish Maurya', email: 'ashish@example.com' };
    mockToken = 'jwt_test_token_12345';

    let localStore = {};
    global.localStorage = {
      getItem: jest.fn(k => (k in localStore ? localStore[k] : null)),
      setItem: jest.fn((k, v) => { localStore[k] = String(v); }),
      removeItem: jest.fn(k => { delete localStore[k]; }),
      clear: jest.fn(() => { localStore = {}; })
    };

    global.API = {
      getUser: jest.fn(() => mockUser),
      getToken: jest.fn(() => mockToken),
      clearAuth: jest.fn(() => {
        mockUser = null;
        mockToken = null;
      })
    };

    global.UI = {
      escapeHtml: (str) => String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;'),
      escapeHTML: (str) => String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;'),
      escapeAttr: (str) => String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#039;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    };

    AppController = require('../public/js/app');

    // Instantiate without running full network init
    app = Object.create(AppController.prototype);
    app.currentView = 'home';
    app.profileDropdownVisible = false;
  });

  describe('1. Hamburger Menu Button (#toggleSidebarBtn)', () => {
    it('Desktop layout: collapses and expands sidebar upon repeated clicks', () => {
      dom.windowMock.innerWidth = 1200; // Desktop

      // Initial state
      expect(dom.appSidebar.classList.contains('collapsed')).toBe(false);
      expect(dom.appContainer.classList.contains('sidebar-collapsed')).toBe(false);

      // 1st click -> Collapses
      app.toggleSidebar();
      expect(dom.appSidebar.classList.contains('collapsed')).toBe(true);
      expect(dom.appContainer.classList.contains('sidebar-collapsed')).toBe(true);
      expect(dom.toggleSidebarBtn.getAttribute('aria-expanded')).toBe('false');
      expect(dom.toggleSidebarBtn.classList.contains('active')).toBe(true);
      expect(dom.sidebarOverlay.style.display).toBe('none');

      // 2nd click -> Expands back
      app.toggleSidebar();
      expect(dom.appSidebar.classList.contains('collapsed')).toBe(false);
      expect(dom.appContainer.classList.contains('sidebar-collapsed')).toBe(false);
      expect(dom.toggleSidebarBtn.getAttribute('aria-expanded')).toBe('true');
      expect(dom.toggleSidebarBtn.classList.contains('active')).toBe(false);

      // 3rd click -> Collapses again
      app.toggleSidebar();
      expect(dom.appSidebar.classList.contains('collapsed')).toBe(true);
    });

    it('Mobile layout: opens and closes sidebar with backdrop overlay upon repeated clicks', () => {
      dom.windowMock.innerWidth = 768; // Mobile

      // Initial state
      expect(dom.appSidebar.classList.contains('open')).toBe(false);
      expect(dom.sidebarOverlay.style.display).toBe('none');

      // 1st click -> Opens mobile sidebar & activates overlay
      app.toggleSidebar();
      expect(dom.appSidebar.classList.contains('open')).toBe(true);
      expect(dom.sidebarOverlay.style.display).toBe('block');
      expect(dom.sidebarOverlay.getAttribute('aria-hidden')).toBe('false');
      expect(dom.toggleSidebarBtn.getAttribute('aria-expanded')).toBe('true');
      expect(dom.toggleSidebarBtn.classList.contains('active')).toBe(true);

      // 2nd click -> Closes mobile sidebar & hides overlay
      app.toggleSidebar();
      expect(dom.appSidebar.classList.contains('open')).toBe(false);
      expect(dom.sidebarOverlay.style.display).toBe('none');
      expect(dom.sidebarOverlay.getAttribute('aria-hidden')).toBe('true');
      expect(dom.toggleSidebarBtn.getAttribute('aria-expanded')).toBe('false');
      expect(dom.toggleSidebarBtn.classList.contains('active')).toBe(false);
    });

    it('closeSidebar() explicitly forces sidebar closed in both mobile and desktop', () => {
      dom.windowMock.innerWidth = 768;
      app.toggleSidebar(true);
      expect(dom.appSidebar.classList.contains('open')).toBe(true);

      app.closeSidebar();
      expect(dom.appSidebar.classList.contains('open')).toBe(false);
      expect(dom.sidebarOverlay.style.display).toBe('none');
    });
  });

  describe('2. Profile Button (#userAvatar) & Profile Dropdown', () => {
    it('updates user avatar initial and tooltip based on authenticated user', () => {
      app.updateUserUI(mockUser);
      expect(dom.userAvatar.textContent).toBe('A');
      expect(dom.userAvatar.getAttribute('title')).toBe('Ashish Maurya (ashish@example.com)');
      expect(dom.userAvatar.getAttribute('aria-label')).toBe('Account menu for Ashish Maurya');
    });

    it('toggles profile dropdown visibility on repeated calls', () => {
      // 1st toggle -> Opens
      app.toggleProfileDropdown();
      expect(app.profileDropdownVisible).toBe(true);
      expect(dom.profileDropdown.style.display).toBe('block');
      expect(dom.userAvatar.getAttribute('aria-expanded')).toBe('true');

      // 2nd toggle -> Closes
      app.toggleProfileDropdown();
      expect(app.profileDropdownVisible).toBe(false);
      expect(dom.profileDropdown.style.display).toBe('none');
      expect(dom.userAvatar.getAttribute('aria-expanded')).toBe('false');
    });

    it('renders authenticated user information and genuine account options', () => {
      app.toggleProfileDropdown(true);

      const html = dom.profileDropdown.innerHTML;
      // Header with name, email, avatar
      expect(html).toContain('Ashish Maurya');
      expect(html).toContain('ashish@example.com');
      expect(html).toContain('<div class="profile-dropdown-avatar">A</div>');

      // Genuine account and utility options
      expect(html).toContain('Auralist Account (Standard Free)');
      expect(html).toContain('Studio DSP Equalizer');
      expect(html).toContain('data-action="enhancer"');
      expect(html).toContain('Audio & App Settings');
      expect(html).toContain('data-target="#settings"');
      expect(html).toContain('Keyboard Shortcuts');
      expect(html).toContain('data-action="shortcuts"');
      expect(html).toContain('Log Out');
      expect(html).toContain('data-action="logout"');

      // Redundant sidebar items removed
      expect(html).not.toContain('Your Library');
      expect(html).not.toContain('data-target="#library"');
      expect(html).not.toContain('Favourite Songs');
      expect(html).not.toContain('data-target="#liked"');
      expect(html).not.toContain('Playback History');
      expect(html).not.toContain('data-target="#history"');
      expect(html).not.toContain('Listening Insights');
      expect(html).not.toContain('data-target="#insights"');
    });

    it('safely sanitizes malicious user names and email payloads to prevent XSS in profile dropdown', () => {
      // Mock malicious user
      const maliciousUser = {
        id: 'u_malicious',
        name: '<script>alert("xss")</script><img src=x onerror=alert(1)>',
        email: 'test" onfocus="alert(1)"<svg>@example.com'
      };
      global.API.getUser = jest.fn(() => maliciousUser);

      app.renderProfileDropdown();

      const html = dom.profileDropdown.innerHTML;
      // Must NOT contain raw script, img tags, or unescaped injection
      expect(html).not.toContain('<script>');
      expect(html).not.toContain('<img src=x');
      expect(html).not.toContain('<svg>');
      // Must contain escaped HTML entities
      expect(html).toContain('&lt;script&gt;');
      expect(html).toContain('&lt;img src=x');
      expect(html).toContain('&lt;svg&gt;');

      // Reset mockUser
      global.API.getUser = jest.fn(() => mockUser);
    });

    it('Sidebar navigation: shows "All Songs" and "Live Radio"', () => {
      const appHtml = fs.readFileSync(path.join(__dirname, '../public/app.html'), 'utf8');
      expect(appHtml).toContain('All Songs');
      expect(appHtml).toContain('href="#catalog"');
      expect(appHtml).toContain('Live Radio');
      expect(appHtml).toContain('href="#radio"');
      expect(appHtml).not.toContain('data-view="history"');
    });

    it('Midnight Echoes is the sole permanent theme of AuraList', () => {
      app.applyTheme('midnight', false);
      expect(dom.documentMock.documentElement.getAttribute('data-theme')).toBe('midnight');

      // Calling applyTheme with any argument locks into midnight
      app.applyTheme('warm', false);
      expect(dom.documentMock.documentElement.getAttribute('data-theme')).toBe('midnight');
    });

    it('verifies Midnight Echoes background asset exists in public/images', () => {
      expect(fs.existsSync(path.join(__dirname, '../public/images/midnight-echoes-bg.jpg'))).toBe(true);
    });

    it('verifies app.html uses Midnight Echoes ambient background and removes obsolete themes', () => {
      const appHtml = fs.readFileSync(path.join(__dirname, '../public/app.html'), 'utf8');
      expect(appHtml).toContain('src="/images/midnight-echoes-bg.jpg"');
      expect(appHtml).not.toContain('winter-sunrise-bg.jpg');
      expect(appHtml).not.toContain('id="snowfallCanvas"');
      expect(appHtml).not.toContain('id="ambientLampTrigger"');
    });

    it('renders login and create account links when user is logged out', () => {
      mockUser = null;
      mockToken = null;

      app.toggleProfileDropdown(true);

      const html = dom.profileDropdown.innerHTML;
      expect(html).toContain('href="/login"');
      expect(html).toContain('Sign In');
      expect(html).toContain('href="/register"');
      expect(html).toContain('Create Account');
      expect(html).not.toContain('Ashish Maurya');
    });

    it('Escape key closes open profile dropdown and closes sidebar', () => {
      dom.windowMock.innerWidth = 768;
      app.toggleSidebar(true);
      app.toggleProfileDropdown(true);
      expect(dom.appSidebar.classList.contains('open')).toBe(true);
      expect(app.profileDropdownVisible).toBe(true);

      app.closeModals = jest.fn();
      app.toggleFullscreenPlayer = jest.fn();

      app.handleKeyboardShortcut({ key: 'Escape', target: { tagName: 'BUTTON' } });

      expect(app.profileDropdownVisible).toBe(false);
      expect(dom.profileDropdown.style.display).toBe('none');
      expect(dom.appSidebar.classList.contains('open')).toBe(false);
    });

    it('handleLogout clears authentication and redirects to /login', () => {
      app.handleLogout();

      expect(global.API.clearAuth).toHaveBeenCalledTimes(1);
      expect(dom.windowMock.location.href).toBe('/login');
    });
  });

  describe('3. Universal Back Navigation & Subview Back Bars', () => {
    it('UI.createBackBar creates standard back button with fallback and custom ID', () => {
      const UI = require('../public/js/ui.js');
      expect(typeof UI.createBackBar).toBe('function');

      const bar = UI.createBackBar('home', 'testBackBtn');
      expect(bar.className).toBe('subview-back-bar');
      const btn = bar.querySelector('#testBackBtn');
      expect(btn).not.toBeNull();
      expect(btn.className).toBe('view-back-btn');
      expect(btn.innerHTML).toContain('fa-arrow-left');
      expect(btn.innerHTML).toContain('Back');
    });

    it('header navigation buttons #navBackBtn and #navForwardBtn exist in app.html', () => {
      const appHtml = fs.readFileSync(path.join(__dirname, '../public/app.html'), 'utf8');
      expect(appHtml).toContain('id="navBackBtn"');
      expect(appHtml).toContain('id="navForwardBtn"');
      expect(appHtml).toContain('header-nav-arrows');
    });
  });
});

