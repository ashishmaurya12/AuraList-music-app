// API helper for token management and network requests
const API = {
  getToken() {
    const token = localStorage.getItem('auralist_token');
    if (!token || typeof token !== 'string') return null;
    const trimmed = token.trim();
    if (trimmed.split('.').length === 3) {
      return trimmed;
    }
    this.clearAuth();
    return null;
  },

  setToken(token) {
    if (token) {
      localStorage.setItem('auralist_token', token);
    } else {
      localStorage.removeItem('auralist_token');
    }
  },

  getUser() {
    try {
      const raw = localStorage.getItem('auralist_user');
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
      return null;
    } catch (e) {
      this.clearAuth();
      return null;
    }
  },

  setUser(user) {
    if (user) {
      localStorage.setItem('auralist_user', JSON.stringify(user));
    } else {
      localStorage.removeItem('auralist_user');
    }
  },

  clearAuth() {
    localStorage.removeItem('auralist_token');
    localStorage.removeItem('auralist_user');
    try {
      if (typeof fetch === 'function') {
        fetch('/api/auth/logout', {
          method: 'POST',
          credentials: 'include',
          headers: { 'X-Requested-With': 'XMLHttpRequest' }
        }).catch(() => {});
      }
    } catch (e) {}
  },

  async request(endpoint, options = {}) {
    const token = this.getToken();
    const headers = {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      ...options.headers
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const config = {
      credentials: 'include',
      ...options,
      headers
    };

    try {
      const response = await fetch(`/api${endpoint}`, config);
      if (response && response.headers && typeof response.headers.get === 'function') {
        this.lastProviderStatus = response.headers.get('x-provider-status') || (response.ok ? 'online' : 'offline');
        this.lastProviderError = response.headers.get('x-provider-error') || null;
      }
      const data = await response.json().catch(() => ({}));

      if (response.status === 401) {
        this.clearAuth();
        if (window.location.pathname.includes('/app')) {
          window.location.href = '/login';
        }
        throw new Error(data.error || 'Session expired. Please log in again.');
      }

      if (!response.ok) {
        throw new Error(data.error || `HTTP Error ${response.status}`);
      }

      return data;
    } catch (error) {
      console.error(`API Error [${endpoint}]:`, error.message);
      throw error;
    }
  },

  get(endpoint) {
    return this.request(endpoint, { method: 'GET' });
  },

  post(endpoint, body) {
    return this.request(endpoint, {
      method: 'POST',
      body: JSON.stringify(body)
    });
  },

  put(endpoint, body) {
    return this.request(endpoint, {
      method: 'PUT',
      body: JSON.stringify(body)
    });
  },

  delete(endpoint) {
    return this.request(endpoint, { method: 'DELETE' });
  }
};
