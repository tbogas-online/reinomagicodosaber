(() => {
  const STORAGE_KEY = 'reino_installed_version';
  const UPDATE_PENDING_KEY = 'reino_update_pending';
  const UPDATE_FEEDBACK_KEY = 'reino_update_feedback';
  const LOOP_GUARD_KEY = 'reino_update_loop_guard';
  const DISMISS_KEY = 'reino_update_dismissed';
  const CHECK_INTERVAL_MS = 5 * 60 * 1000;
  const UPDATE_TIMEOUT_MS = 20000;
  const STARTUP_DELAY_MS = 3500;
  const SUCCESS_HIDE_MS = 2800;
  const MAX_RELOAD_ATTEMPTS = 3;
  const LOOP_WINDOW_MS = 2 * 60 * 1000;
  const metaBuild = document.querySelector('meta[name="app-build"]')?.getAttribute('content') || 'dev';

  try {
    const cleanUrl = new URL(window.location.href);
    if (cleanUrl.searchParams.has('v')) {
      cleanUrl.searchParams.delete('v');
      window.history.replaceState(null, '', cleanUrl.pathname + cleanUrl.search + cleanUrl.hash);
    }
  } catch { /* ignore */ }

  const banner = document.getElementById('app-update-banner');
  const bannerIcon = document.getElementById('app-update-icon');
  const updateBtn = document.getElementById('app-update-apply') || document.getElementById('app-update-btn');
  const dismissBtn = document.getElementById('app-update-dismiss');
  const retryBtn = document.getElementById('app-update-retry');
  const bannerText = document.getElementById('app-update-text');
  const bannerSubtext = document.getElementById('app-update-subtext');
  const bannerActions = banner?.querySelector('.app-update-actions');

  let registration = null;
  let pendingVersion = '';
  let reloadOnController = false;
  let updateTimeoutId = null;
  let successHideId = null;
  let updateInProgress = false;
  let bannerMode = 'idle';
  let checkInFlight = false;

  const BANNER_ICONS = {
    available: '✨',
    updating: '⏳',
    success: '✅',
    error: '⚠️',
    idle: '✦',
  };

  function runWhenIdle(fn, timeout = STARTUP_DELAY_MS) {
    if ('requestIdleCallback' in window) {
      requestIdleCallback(fn, { timeout });
      return;
    }
    setTimeout(fn, timeout);
  }

  function getInstalledVersion() {
    try {
      return localStorage.getItem(STORAGE_KEY) || metaBuild;
    } catch {
      return metaBuild;
    }
  }

  function setInstalledVersion(version) {
    if (!version) return;
    try { localStorage.setItem(STORAGE_KEY, version); } catch { /* ignore */ }
  }

  function formatBuildLabel(version) {
    const v = String(version || '').trim();
    if (!v || v === 'dev') return '';
    if (/^\d{8}-\d{6}$/.test(v)) {
      const d = v.slice(6, 8) + '/' + v.slice(4, 6) + ' ' + v.slice(9, 11) + ':' + v.slice(11, 13);
      return d;
    }
    return v;
  }

  function readJsonStorage(key) {
    try {
      const raw = sessionStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function writeJsonStorage(key, value) {
    try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
  }

  function readDismissedVersion() {
    try { return sessionStorage.getItem(DISMISS_KEY) || ''; } catch { return ''; }
  }

  function setDismissedVersion(version) {
    try { sessionStorage.setItem(DISMISS_KEY, version || ''); } catch { /* ignore */ }
  }

  function clearUpdateTimeout() {
    if (!updateTimeoutId) return;
    clearTimeout(updateTimeoutId);
    updateTimeoutId = null;
  }

  function clearSuccessHide() {
    if (!successHideId) return;
    clearTimeout(successHideId);
    successHideId = null;
  }

  function recordReloadAttempt(targetVersion) {
    const now = Date.now();
    const guard = readJsonStorage(LOOP_GUARD_KEY) || { target: '', count: 0, firstAt: now };
    if (guard.target !== targetVersion || now - guard.firstAt > LOOP_WINDOW_MS) {
      guard.target = targetVersion;
      guard.count = 1;
      guard.firstAt = now;
    } else {
      guard.count += 1;
    }
    writeJsonStorage(LOOP_GUARD_KEY, guard);
    return guard.count;
  }

  function clearReloadGuard() {
    try { sessionStorage.removeItem(LOOP_GUARD_KEY); } catch { /* ignore */ }
  }

  function isReloadLoopBlocked(targetVersion) {
    const guard = readJsonStorage(LOOP_GUARD_KEY);
    if (!guard || guard.target !== targetVersion) return false;
    if (Date.now() - guard.firstAt > LOOP_WINDOW_MS) return false;
    return guard.count >= MAX_RELOAD_ATTEMPTS;
  }

  function setBannerMode(mode) {
    bannerMode = mode;
    if (!banner) return;
    banner.classList.remove('is-available', 'is-updating', 'is-success', 'is-error');
    if (mode === 'available') banner.classList.add('is-available');
    if (mode === 'updating') banner.classList.add('is-updating');
    if (mode === 'success') banner.classList.add('is-success');
    if (mode === 'error') banner.classList.add('is-error');
    if (bannerIcon) bannerIcon.textContent = BANNER_ICONS[mode] || BANNER_ICONS.idle;
  }

  function setSubtext(text) {
    if (!bannerSubtext) return;
    const value = String(text || '').trim();
    bannerSubtext.textContent = value;
    bannerSubtext.hidden = !value;
  }

  function setActions({ showApply = false, showDismiss = false, showRetry = false } = {}) {
    if (bannerActions) bannerActions.hidden = !(showApply || showDismiss || showRetry);
    if (updateBtn) {
      updateBtn.hidden = !showApply;
      updateBtn.disabled = false;
    }
    if (dismissBtn) {
      dismissBtn.hidden = !showDismiss;
      dismissBtn.disabled = false;
    }
    if (retryBtn) {
      retryBtn.hidden = !showRetry;
      retryBtn.disabled = false;
    }
  }

  function showBanner(message, subtext = '') {
    if (!banner) return;
    if (bannerText) bannerText.textContent = message;
    setSubtext(subtext);
    banner.classList.add('visible');
    banner.setAttribute('aria-hidden', 'false');
  }

  function hideBanner() {
    if (!banner) return;
    banner.classList.remove('visible');
    banner.setAttribute('aria-hidden', 'true');
    clearUpdateTimeout();
    clearSuccessHide();
    reloadOnController = false;
    updateInProgress = false;
    setBannerMode('idle');
    setSubtext('');
    setActions({});
  }

  function prepareReloadForUpdate(version) {
    const target = version || metaBuild;
    writeJsonStorage(UPDATE_PENDING_KEY, {
      version: target,
      previousInstalled: getInstalledVersion(),
      startedAt: Date.now(),
    });
    writeJsonStorage(UPDATE_FEEDBACK_KEY, {
      expectVersion: target,
      previousInstalled: getInstalledVersion(),
    });
  }

  function navigateForUpdate(version) {
    const target = version || pendingVersion || metaBuild;
    recordReloadAttempt(target);
    prepareReloadForUpdate(target);
    const base = window.location.pathname || '/';
    const url = new URL(base, window.location.origin);
    url.searchParams.set('v', target);
    url.hash = window.location.hash || '';
    window.location.replace(url.toString());
  }

  function showUpdateAvailable(version) {
    const target = version || pendingVersion;
    if (!target || target === metaBuild) return;
    if (updateInProgress || bannerMode === 'updating') return;
    if (readDismissedVersion() === target) return;
    if (isReloadLoopBlocked(target)) {
      showInstallFailure(
        'Não foi possível actualizar automaticamente.',
        'Tenta Ctrl+F5 ou limpar a cache do browser.',
      );
      return;
    }
    pendingVersion = target;
    setBannerMode('available');
    const label = formatBuildLabel(target);
    showBanner(
      'Nova versão disponível',
      label ? `Build ${label} — toca em Actualizar quando quiseres continuar a jogar.` : 'Toca em Actualizar quando quiseres continuar a jogar.',
    );
    setActions({ showApply: true, showDismiss: true });
  }

  function showUpdatingState() {
    clearSuccessHide();
    setBannerMode('updating');
    setActions({});
    showBanner('A actualizar o jogo…', 'Isto demora só alguns segundos.');
  }

  function showInstallSuccess(version) {
    clearUpdateTimeout();
    clearReloadGuard();
    reloadOnController = false;
    updateInProgress = false;
    setInstalledVersion(version || metaBuild);
    setDismissedVersion('');
    setBannerMode('success');
    setActions({});
    const label = formatBuildLabel(version || metaBuild);
    showBanner('Jogo actualizado', label ? `Versão ${label} pronta.` : '');
    clearSuccessHide();
    successHideId = setTimeout(() => {
      if (bannerMode === 'success') hideBanner();
    }, SUCCESS_HIDE_MS);
  }

  function showInstallFailure(message, subtext = '') {
    clearUpdateTimeout();
    clearSuccessHide();
    reloadOnController = false;
    updateInProgress = false;
    setBannerMode('error');
    showBanner(message || 'Não foi possível actualizar.', subtext);
    setActions({ showRetry: true, showDismiss: true });
  }

  function processUpdateFeedback() {
    const feedback = readJsonStorage(UPDATE_FEEDBACK_KEY);
    if (feedback) {
      try { sessionStorage.removeItem(UPDATE_FEEDBACK_KEY); } catch { /* ignore */ }
      try { sessionStorage.removeItem(UPDATE_PENDING_KEY); } catch { /* ignore */ }
      const expect = feedback.expectVersion || '';
      const previous = feedback.previousInstalled || '';
      const current = metaBuild;
      if (current === expect || (previous && current !== previous)) {
        requestAnimationFrame(() => showInstallSuccess(current));
        return;
      }
      recordReloadAttempt(expect || current);
      requestAnimationFrame(() => showInstallFailure(
        'A página ainda não reflecte a nova versão.',
        'Tenta Actualizar de novo ou usa Ctrl+F5.',
      ));
      return;
    }

    const pending = readJsonStorage(UPDATE_PENDING_KEY);
    if (!pending) return;
    try { sessionStorage.removeItem(UPDATE_PENDING_KEY); } catch { /* ignore */ }
    const target = pending.version || '';
    const previous = pending.previousInstalled || '';
    const current = metaBuild;
    if (current === target || (previous && current !== previous)) {
      requestAnimationFrame(() => showInstallSuccess(current));
      return;
    }
    recordReloadAttempt(target || current);
    requestAnimationFrame(() => showInstallFailure(
      'A actualização não terminou correctamente.',
      'Tenta Actualizar de novo ou usa Ctrl+F5.',
    ));
  }

  async function fetchRemoteVersion() {
    const response = await fetch('/version.json?t=' + Date.now(), { cache: 'no-store' });
    if (!response.ok) return null;
    const data = await response.json();
    return data?.version || null;
  }

  function hasWaitingWorker() {
    return !!(registration?.waiting && navigator.serviceWorker.controller);
  }

  function applyUpdate() {
    if (updateInProgress && bannerMode === 'updating') return;

    const version = pendingVersion || metaBuild;
    if (isReloadLoopBlocked(version)) {
      showInstallFailure(
        'Demasiadas tentativas seguidas.',
        'Fecha o separador, abre de novo ou usa Ctrl+F5.',
      );
      return;
    }

    updateInProgress = true;
    showUpdatingState();
    reloadOnController = true;

    updateTimeoutId = setTimeout(() => {
      if (bannerMode === 'updating') {
        showInstallFailure(
          'A actualização está a demorar.',
          'Verifica a ligação e tenta de novo.',
        );
      }
    }, UPDATE_TIMEOUT_MS);

    if (hasWaitingWorker()) {
      prepareReloadForUpdate(version);
      registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      return;
    }

    if (registration?.installing) {
      const worker = registration.installing;
      const onStateChange = () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) {
          worker.removeEventListener('statechange', onStateChange);
          if (registration.waiting) {
            prepareReloadForUpdate(version);
            registration.waiting.postMessage({ type: 'SKIP_WAITING' });
            return;
          }
        }
        if (worker.state === 'activated' || worker.state === 'redundant') {
          worker.removeEventListener('statechange', onStateChange);
        }
      };
      worker.addEventListener('statechange', onStateChange);
      registration.update().catch(() => {});
      return;
    }

    clearUpdateTimeout();
    navigateForUpdate(version);
  }

  async function checkForUpdates() {
    if (checkInFlight || updateInProgress) return;
    checkInFlight = true;
    try {
      const remoteVersion = await fetchRemoteVersion();
      if (!remoteVersion) return;

      if (remoteVersion === metaBuild) {
        if (getInstalledVersion() !== remoteVersion) setInstalledVersion(remoteVersion);
        if (readDismissedVersion() && readDismissedVersion() !== remoteVersion) {
          setDismissedVersion('');
        }
        if (hasWaitingWorker() && bannerMode !== 'success') {
          pendingVersion = remoteVersion;
          showUpdateAvailable(remoteVersion);
        }
        return;
      }

      pendingVersion = remoteVersion;
      await registration?.update().catch(() => {});

      if (bannerMode === 'updating' || bannerMode === 'success') return;
      showUpdateAvailable(remoteVersion);
    } catch {
      /* offline ou erro temporário */
    } finally {
      checkInFlight = false;
    }
  }

  async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    try {
      registration = await navigator.serviceWorker.register('/sw.js?v=' + encodeURIComponent(metaBuild), {
        scope: '/',
        updateViaCache: 'none',
      });

      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state !== 'installed' || !navigator.serviceWorker.controller) return;
          const target = pendingVersion || metaBuild;
          if (target !== metaBuild || registration.waiting) {
            showUpdateAvailable(target);
          }
        });
      });

      if (hasWaitingWorker()) {
        const remoteVersion = await fetchRemoteVersion();
        pendingVersion = remoteVersion || metaBuild;
        if (pendingVersion !== metaBuild) showUpdateAvailable(pendingVersion);
      }
    } catch (err) {
      console.warn('[app-update] Service Worker não registado:', err);
    }
  }

  navigator.serviceWorker?.addEventListener('controllerchange', () => {
    if (!reloadOnController) return;
    clearUpdateTimeout();
    const version = pendingVersion || metaBuild;
    prepareReloadForUpdate(version);
    navigateForUpdate(version);
  });

  updateBtn?.addEventListener('click', (event) => {
    event.stopPropagation();
    applyUpdate();
  });

  retryBtn?.addEventListener('click', (event) => {
    event.stopPropagation();
    applyUpdate();
  });

  dismissBtn?.addEventListener('click', (event) => {
    event.stopPropagation();
    if (pendingVersion) setDismissedVersion(pendingVersion);
    hideBanner();
  });

  banner?.addEventListener('click', (event) => {
    if (event.target.closest('button')) return;
    if (bannerMode === 'success') hideBanner();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkForUpdates();
  });

  processUpdateFeedback();
  runWhenIdle(async () => {
    await registerServiceWorker();
    await checkForUpdates();
    setInterval(checkForUpdates, CHECK_INTERVAL_MS);
  });
})();
