// API helper for token management and network requests
const API = {
  getToken() {
    return localStorage.getItem('auralist_token');
  },

  setToken(token) {
    if (token) {
      localStorage.setItem('auralist_token', token);
    } else {
      localStorage.removeItem('auralist_token');
    }
  },

  getUser() {
    const raw = localStorage.getItem('auralist_user');
    return raw ? JSON.parse(raw) : null;
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
  },

  async request(endpoint, options = {}) {
    const token = this.getToken();
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const config = {
      ...options,
      headers
    };

    try {
      const response = await fetch(`/api${endpoint}`, config);
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
