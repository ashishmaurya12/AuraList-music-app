const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('Frontend DOM Sanitization & XSS Prevention (public/js/ui.js)', () => {
  let UI;

  beforeAll(() => {
    const uiPath = path.join(__dirname, '..', 'public', 'js', 'ui.js');
    const uiCode = fs.readFileSync(uiPath, 'utf8');

    const mockDocument = {
      getElementById: () => null,
      createElement: () => ({ setAttribute: () => {}, classList: { add: () => {} } }),
      querySelectorAll: () => []
    };

    const mockWindow = { document: mockDocument, location: { hash: '' } };

    const context = vm.createContext({
      window: mockWindow,
      document: mockDocument,
      console,
      setTimeout,
      player: { queue: [], currentTrack: null },
      API: {}
    });

    vm.runInContext(uiCode, context);
    UI = vm.runInContext('UI', context);
  });

  describe('UI.escapeHTML()', () => {
    it('should escape HTML tags and script execution payloads', () => {
      const payloads = [
        '<script>alert(1)</script>',
        '<img src=x onerror=alert(1)>',
        '"><svg onload=alert(1)>'
      ];

      payloads.forEach(payload => {
        const escaped = UI.escapeHTML(payload);
        expect(escaped).not.toContain('<script>');
        expect(escaped).not.toContain('<img');
        expect(escaped).not.toContain('<svg');
        expect(escaped).toContain('&lt;');
      });
    });
  });

  describe('UI.escapeAttr()', () => {
    it('should escape double quotes and single quotes for attribute safety', () => {
      const payload = '"><svg onload=alert(1)>';
      const escaped = UI.escapeAttr(payload);
      expect(escaped).not.toContain('"');
      expect(escaped).not.toContain("'");
      expect(escaped).toContain('&quot;');
    });
  });

  describe('UI.sanitizeUrl()', () => {
    it('should reject dangerous pseudo-protocols (javascript:, data:, vbscript:)', () => {
      const dangerous = [
        'javascript:alert(1)',
        'JAVASCRIPT:alert(document.domain)',
        'vbscript:msgbox("xss")',
        'data:text/html,<script>alert(1)</script>',
        '  javascript: void(0)'
      ];

      dangerous.forEach(url => {
        expect(UI.sanitizeUrl(url)).toBe('');
      });
    });

    it('should allow legitimate HTTP and HTTPS URLs', () => {
      const safe = [
        'https://example.com/audio.mp3',
        'http://example.com/stream',
        '/api/music/stream/123'
      ];

      safe.forEach(url => {
        expect(UI.sanitizeUrl(url)).toBe(url);
      });
    });
  });

  describe('UI.sanitizeImageUrl()', () => {
    it('should return safe fallback image URL when passed a dangerous protocol', () => {
      const fallback = 'fallback.jpg';
      expect(UI.sanitizeImageUrl('javascript:alert(1)', fallback)).toBe(fallback);
      expect(UI.sanitizeImageUrl('data:text/html,xss', fallback)).toBe(fallback);
    });

    it('should upgrade http:// image URLs to https://', () => {
      const httpUrl = 'http://images.unsplash.com/photo-123.jpg';
      expect(UI.sanitizeImageUrl(httpUrl)).toBe('https://images.unsplash.com/photo-123.jpg');
    });
  });
});
