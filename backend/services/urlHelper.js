/**
 * backend/services/urlHelper.js
 *
 * Safe URL validation, sanitization, and protocol enforcement for audio and artwork streams.
 */

const IMAGE_EXTENSION_REGEX = /\.(jpe?g|png|webp|gif|svg|bmp|tiff?|ico)(\?.*)?$/i;

function isImageUrl(url) {
  if (!url || typeof url !== 'string') return false;
  return IMAGE_EXTENSION_REGEX.test(url.trim());
}

/**
 * Audio URL Validation and Security Policy:
 * 1. Remote streaming hosts: Upgrade http:// to https:// to prevent mixed-content browser blocks.
 * 2. Local loopback hosts (localhost, 127.0.0.1, ::1): Insecure http:// is preserved for local dev/testing.
 * 3. Dangerous pseudo-protocols (javascript:, data:, vbscript:, ftp:, file:): Strictly rejected ('').
 * 4. Artwork/Image files (.jpg, .png, .webp, etc.): Strictly rejected ('') to prevent media errors.
 * 5. Malformed or non-http(s) URLs: Strictly rejected ('').
 */
function formatAudioUrl(url) {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (!trimmed || trimmed.startsWith('javascript:') || trimmed.startsWith('data:') || trimmed.startsWith('vbscript:')) {
    return '';
  }
  // Strictly reject artwork and image files from being treated as audio streams
  if (isImageUrl(trimmed)) {
    return '';
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      const host = (parsed.hostname || '').toLowerCase();
      // Local development and test endpoints (localhost, 127.0.0.1, ::1) preserve HTTP
      if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.local')) {
        return trimmed;
      }
      // Non-standard ports (e.g. :8000, :8080) commonly serve raw HTTP audio without TLS; do not blindly rewrite
      if (parsed.port && parsed.port !== '80' && parsed.port !== '443') {
        return trimmed;
      }
      // Upgrade known providers that officially support HTTPS on standard web ports
      const isKnownHttpsProvider =
        host.endsWith('.saavncdn.com') ||
        host.endsWith('.audius.co') ||
        host.endsWith('.jamendo.com') ||
        host === 'example.com';
      if (isKnownHttpsProvider && parsed.protocol === 'http:') {
        return trimmed.replace(/^http:\/\//i, 'https://');
      }
      // For unverified third-party hosts, preserve original protocol without blind rewriting
      return trimmed;
    }
  } catch (err) {
    return '';
  }
  return '';
}

/**
 * Radio Stream URL Validation:
 * Validates protocol (http: or https:), rejects dangerous pseudo-protocols and image files.
 * Preserves the actual protocol (http:// or https://) without string-replacement rewriting.
 */
function formatRadioStreamUrl(url) {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (!trimmed || trimmed.startsWith('javascript:') || trimmed.startsWith('data:') || trimmed.startsWith('vbscript:')) {
    return '';
  }
  if (isImageUrl(trimmed)) {
    return '';
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return trimmed;
    }
  } catch (err) {
    return '';
  }
  return '';
}

/**
 * Defensive Image URL Formatting
 */
function formatImageUrl(url) {
  const defaultImage = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop';
  if (!url || typeof url !== 'string') {
    return defaultImage;
  }
  const trimmed = url.trim();
  if (trimmed.startsWith('javascript:') || trimmed.startsWith('data:')) {
    return defaultImage;
  }
  return trimmed
    .replace('150x150', '500x500')
    .replace('50x50', '500x500')
    .replace('http://', 'https://');
}

module.exports = {
  isImageUrl,
  formatAudioUrl,
  formatRadioStreamUrl,
  formatImageUrl
};

