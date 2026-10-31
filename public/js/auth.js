// public/js/auth.js
// Handles login and registration form submission and navigation cleanly without inline scripts.

(function () {
  'use strict';

  // If already authenticated with a valid token, redirect directly to the main app
  if (typeof API !== 'undefined' && typeof API.getToken === 'function' && API.getToken()) {
    if (typeof window !== 'undefined' && window.location && !window.location.pathname.includes('/app')) {
      window.location.href = '/app';
      return;
    }
  }

  function showError(alertBox, msg) {
    if (!alertBox) return;
    alertBox.textContent = msg;
    alertBox.style.display = 'block';
  }

  function hideError(alertBox) {
    if (!alertBox) return;
    alertBox.textContent = '';
    alertBox.style.display = 'none';
  }

  document.addEventListener('DOMContentLoaded', () => {
    // ── Login Form Handler ───────────────────────────────────────────
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
      const alertBox = document.getElementById('alertBox');
      const loginBtn = document.getElementById('loginBtn');
      const emailInput = document.getElementById('email');
      const passwordInput = document.getElementById('password');

      loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        hideError(alertBox);

        const email = emailInput ? emailInput.value.trim() : '';
        const password = passwordInput ? passwordInput.value.trim() : '';

        if (!email || !password) {
          showError(alertBox, 'Please fill in all fields.');
          return;
        }

        if (loginBtn) {
          loginBtn.disabled = true;
          loginBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Logging in...';
        }

        try {
          const res = await API.post('/auth/login', { email, password });
          if (res && res.token) {
            API.setToken(res.token);
            API.setUser(res.user);
            window.location.href = '/app';
          } else {
            showError(alertBox, (res && res.error) || 'Login failed. Please try again.');
          }
        } catch (err) {
          showError(alertBox, err.message || 'Network error occurred.');
        } finally {
          if (loginBtn) {
            loginBtn.disabled = false;
            loginBtn.innerHTML = '<span>Log In</span>';
          }
        }
      });
    }

    // ── Registration Form Handler ────────────────────────────────────
    const registerForm = document.getElementById('registerForm');
    if (registerForm) {
      const alertBox = document.getElementById('alertBox');
      const registerBtn = document.getElementById('registerBtn');
      const nameInput = document.getElementById('name');
      const emailInput = document.getElementById('email');
      const passwordInput = document.getElementById('password');

      registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        hideError(alertBox);

        const name = nameInput ? nameInput.value.trim() : '';
        const email = emailInput ? emailInput.value.trim() : '';
        const password = passwordInput ? passwordInput.value.trim() : '';

        if (!name || !email || !password) {
          showError(alertBox, 'Please fill in all fields.');
          return;
        }

        if (password.length < 8) {
          showError(alertBox, 'Password must be at least 8 characters long.');
          return;
        }

        if (registerBtn) {
          registerBtn.disabled = true;
          registerBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Creating account...';
        }

        try {
          const res = await API.post('/auth/register', { name, email, password });
          if (res && res.token) {
            API.setToken(res.token);
            API.setUser(res.user);
            window.location.href = '/app';
          } else {
            showError(alertBox, (res && res.error) || 'Registration failed. Please try again.');
          }
        } catch (err) {
          showError(alertBox, err.message || 'Network error occurred.');
        } finally {
          if (registerBtn) {
            registerBtn.disabled = false;
            registerBtn.innerHTML = '<span>Create Account</span>';
          }
        }
      });
    }
  });
})();

