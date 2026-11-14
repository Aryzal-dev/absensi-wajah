const API = {
  TOKEN_KEY: 'absensi_jwt_token',
  USER_KEY: 'absensi_user_profile',

  getToken() {
    return localStorage.getItem(this.TOKEN_KEY);
  },

  setSession(token, user) {
    localStorage.setItem(this.TOKEN_KEY, token);
    localStorage.setItem(this.USER_KEY, JSON.stringify(user));
  },

  getUser() {
    try {
      return JSON.parse(localStorage.getItem(this.USER_KEY));
    } catch {
      return null;
    }
  },

  clearSession() {
    localStorage.removeItem(this.TOKEN_KEY);
    localStorage.removeItem(this.USER_KEY);
  },

  async request(endpoint, options = {}) {
    const headers = options.headers || {};
    const token = this.getToken();

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    if (!(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
    }

    try {
      const response = await fetch(endpoint, { ...options, headers });
      const data = await response.json().catch(() => ({ success: false, message: 'Respon server tidak valid.' }));

      if (response.status === 401) {
        this.clearSession();
        window.dispatchEvent(new CustomEvent('auth:expired'));
      }

      if (!response.ok) {
        throw new Error(data.message || `Error status ${response.status}`);
      }

      return data;
    } catch (err) {
      throw err;
    }
  },

  get(endpoint) {
    return this.request(endpoint, { method: 'GET' });
  },

  post(endpoint, data) {
    const body = data instanceof FormData ? data : JSON.stringify(data);
    return this.request(endpoint, { method: 'POST', body });
  },

  put(endpoint, data) {
    const body = data instanceof FormData ? data : JSON.stringify(data);
    return this.request(endpoint, { method: 'PUT', body });
  },

  delete(endpoint) {
    return this.request(endpoint, { method: 'DELETE' });
  }
};
