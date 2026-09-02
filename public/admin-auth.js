/**
 * Autenticação Basic Auth partilhada pelo painel admin e ferramentas internas.
 * Credenciais em sessionStorage (mesma chave que admin-reports.html).
 */
(function (global) {
  'use strict';

  const AUTH_KEY = 'reino_admin_reports_auth';

  function buildAuthHeader(user, pass) {
    return `Basic ${btoa(`${user}:${pass}`)}`;
  }

  function getAuthHeader() {
    return sessionStorage.getItem(AUTH_KEY) || '';
  }

  function setAuthHeader(header) {
    if (header) sessionStorage.setItem(AUTH_KEY, header);
    else sessionStorage.removeItem(AUTH_KEY);
  }

  function headers(extra = {}) {
    const auth = getAuthHeader();
    return {
      ...(auth ? { Authorization: auth } : {}),
      ...extra,
    };
  }

  async function verifyAuth() {
    const auth = getAuthHeader();
    if (!auth) return false;
    const response = await fetch('/api/reports-admin?stats=1', {
      cache: 'no-store',
      headers: { Authorization: auth },
    });
    if (!response.ok) {
      setAuthHeader('');
      return false;
    }
    return true;
  }

  async function login(user, pass) {
    const header = buildAuthHeader(user, pass);
    const response = await fetch('/api/reports-admin?stats=1', {
      cache: 'no-store',
      headers: { Authorization: header },
    });
    if (!response.ok) {
      setAuthHeader('');
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Credenciais inválidas.');
    }
    setAuthHeader(header);
    return true;
  }

  function logout() {
    setAuthHeader('');
  }

  /**
   * Mostra formulário de login até credenciais válidas; depois revela #appEl.
   * gateEl: { user, pass, btn, status } ou ids como strings.
   */
  async function initGate({ gateEl, appEl }) {
    const gate = typeof gateEl === 'object' ? gateEl : {};
    const userInput = gate.user || document.getElementById(gateEl.userId || 'adminUser');
    const passInput = gate.pass || document.getElementById(gateEl.passId || 'adminPass');
    const loginBtn = gate.btn || document.getElementById(gateEl.btnId || 'adminLoginBtn');
    const statusEl = gate.status || document.getElementById(gateEl.statusId || 'adminLoginStatus');
    const gateSection = gate.section || document.getElementById(gateEl.sectionId || 'adminLoginGate');
    const app = typeof appEl === 'string' ? document.getElementById(appEl) : appEl;

    async function showApp() {
      if (gateSection) gateSection.hidden = true;
      if (app) app.hidden = false;
    }

    async function showGate(message) {
      if (gateSection) gateSection.hidden = false;
      if (app) app.hidden = true;
      if (statusEl && message) {
        statusEl.textContent = message;
        statusEl.className = 'admin-login-status err';
      }
    }

    if (await verifyAuth()) {
      await showApp();
      return true;
    }

    await showGate('');

    if (!loginBtn) return false;

    loginBtn.addEventListener('click', async () => {
      const user = userInput?.value?.trim() || '';
      const pass = passInput?.value || '';
      if (!user || !pass) {
        if (statusEl) {
          statusEl.textContent = 'Introduz utilizador e palavra-passe.';
          statusEl.className = 'admin-login-status err';
        }
        return;
      }
      if (statusEl) {
        statusEl.textContent = 'A verificar…';
        statusEl.className = 'admin-login-status';
      }
      loginBtn.disabled = true;
      try {
        await login(user, pass);
        if (passInput) passInput.value = '';
        await showApp();
      } catch (err) {
        await showGate(err.message || 'Credenciais inválidas.');
      } finally {
        loginBtn.disabled = false;
      }
    });

    passInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') loginBtn.click();
    });

    return false;
  }

  global.ReinoAdminAuth = Object.freeze({
    AUTH_KEY,
    buildAuthHeader,
    getAuthHeader,
    setAuthHeader,
    headers,
    verifyAuth,
    login,
    logout,
    initGate,
  });
})(typeof window !== 'undefined' ? window : globalThis);
