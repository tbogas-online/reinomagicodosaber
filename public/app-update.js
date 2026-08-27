(() => {
  const STORAGE_KEY = 'reino_installed_version';
  const UPDATE_PENDING_KEY = 'reino_update_pending';
  const UPDATE_FEEDBACK_KEY = 'reino_update_feedback';
  const CHECK_INTERVAL_MS = 5 * 60 * 1000;
  const UPDATE_TIMEOUT_MS = 15000;
  const STARTUP_DELAY_MS = 3500;
  const SUCCESS_HIDE_MS = 2500;
  const metaBuild = document.querySelector('meta[name="app-build"]')?.getAttribute('content') || 'dev';

  const banner = document.getElementById('app-update-banner');
  const updateBtn = document.getElementById('app-update-btn');
  const bannerText = document.getElementById('app-update-text');
  const bannerActions = banner?.querySelector('.app-update-actions');

  let registration = null;
  let pendingVersion = '';
  let reloadOnController = false;
  let updateTimeoutId = null;
  let successHideId = null;
  let updateInProgress = false;
  let bannerMode = 'idle';

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

  function setBannerMode(mode) {
    bannerMode = mode;
    if (!banner) return;
    banner.classList.remove('is-updating', 'is-success', 'is-error');
    if (mode === 'updating') banner.classList.add('is-updating');
    if (mode === 'success') banner.classList.add('is-success');
    if (mode === 'error') banner.classList.add('is-error');
  }

  function setRetryVisible(visible) {
    if (bannerActions) bannerActions.hidden = !visible;
    if (!updateBtn) return;
    updateBtn.hidden = !visible;
    updateBtn.disabled = false;
  }

  function showBanner(message) {
    if (!banner) return;
    if (bannerText) bannerText.textContent = message;
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
    setRetryVisible(false);
  }

  function prepareReloadForUpdate(version) {
    const target = version || metaBuild;
    try {
      sessionStorage.setItem(UPDATE_PENDING_KEY, JSON.stringify({
        version: target,
        previousInstalled: getInstalledVersion(),
        startedAt: Date.now(),
      }));
      sessionStorage.setItem(UPDATE_FEEDBACK_KEY, JSON.stringify({
        expectVersion: target,
        previousInstalled: getInstalledVersion(),
      }));
    } catch { /* ignore */ }
  }

  function showUpdatingState() {
    clearSuccessHide();
    setBannerMode('updating');
    setRetryVisible(false);
    showBanner('A actualizar…');
  }

  function showInstallSuccess(version) {
    clearUpdateTimeout();
    reloadOnController = false;
    updateInProgress = false;
    setInstalledVersion(version || metaBuild);
    setBannerMode('success');
    setRetryVisible(false);
    showBanner('Jogo actualizado');
    clearSuccessHide();
    successHideId = setTimeout(() => {
      if (bannerMode === 'success') hideBanner();
    }, SUCCESS_HIDE_MS);
  }

  function showInstallFailure(message) {
    clearUpdateTimeout();
    clearSuccessHide();
    reloadOnController = false;
    updateInProgress = false;
    setBannerMode('error');
    showBanner(message || 'Não foi possível actualizar.');
    setRetryVisible(true);
  }

  function processUpdateFeedback() {
    try {
      const feedbackRaw = sessionStorage.getItem(UPDATE_FEEDBACK_KEY);
      if (feedbackRaw) {
        sessionStorage.removeItem(UPDATE_FEEDBACK_KEY);
        sessionStorage.removeItem(UPDATE_PENDING_KEY);
        const feedback = JSON.parse(feedbackRaw);
        const current = metaBuild;
        const expect = feedback.expectVersion || '';
        const previous = feedback.previousInstalled || '';
        if (current === expect || (previous && current !== previous)) {
          requestAnimationFrame(() => showInstallSuccess(current));
          return;
        }
        requestAnimationFrame(() => showInstallFailure('Não foi possível actualizar.'));
        return;
      }
    } catch { /* ignore */ }

    try {
      const raw = sessionStorage.getItem(UPDATE_PENDING_KEY);
      if (!raw) return;
      sessionStorage.removeItem(UPDATE_PENDING_KEY);
      const pending = JSON.parse(raw);
      const target = pending.version || '';
      const previous = pending.previousInstalled || '';
      const current = metaBuild;
      if (current === target || (previous && current !== previous)) {
        requestAnimationFrame(() => showInstallSuccess(current));
        return;
      }
      requestAnimationFrame(() => showInstallFailure('Não foi possível actualizar.'));
    } catch { /* ignore */ }
  }

  async function fetchRemoteVersion() {
    const response = await fetch('/version.json?t=' + Date.now(), { cache: 'no-store' });
    if (!response.ok) return null;
    const data = await response.json();
    return data?.version || null;
  }

  function reloadForUpdate(version) {
    prepareReloadForUpdate(version);
    setInstalledVersion(version || metaBuild);
    window.location.reload();
  }

  function applyUpdate() {
    if (updateInProgress && bannerMode === 'updating') return;

    const version = pendingVersion || metaBuild;
    updateInProgress = true;
    showUpdatingState();
    reloadOnController = true;

    updateTimeoutId = setTimeout(() => {
      if (bannerMode === 'updating') {
        showInstallFailure('A actualização está a demorar.');
      }
    }, UPDATE_TIMEOUT_MS);

    if (registration?.waiting) {
      prepareReloadForUpdate(version);
      registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      return;
    }

    clearUpdateTimeout();
    reloadForUpdate(version);
  }

  function scheduleAutoUpdate(version) {
    if (updateInProgress) return;
    pendingVersion = version || pendingVersion || metaBuild;
    applyUpdate();
  }

  async function checkForUpdates() {
    try {
      const remoteVersion = await fetchRemoteVersion();
      if (!remoteVersion) return;

      const installedVersion = getInstalledVersion();

      if (remoteVersion === metaBuild) {
        if (installedVersion !== remoteVersion) {
          setInstalledVersion(remoteVersion);
        }
        if (registration?.waiting && navigator.serviceWorker.controller) {
          scheduleAutoUpdate(remoteVersion);
        }
        return;
      }

      pendingVersion = remoteVersion;
      await registration?.update().catch(() => {});

      if (registration?.waiting && navigator.serviceWorker.controller) {
        scheduleAutoUpdate(remoteVersion);
        return;
      }

      scheduleAutoUpdate(remoteVersion);
    } catch {
      /* offline ou erro temporário */
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
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            scheduleAutoUpdate(pendingVersion || metaBuild);
          }
        });
      });

      if (registration.waiting && navigator.serviceWorker.controller) {
        const remoteVersion = await fetchRemoteVersion();
        scheduleAutoUpdate(remoteVersion || metaBuild);
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
    window.location.reload();
  });

  updateBtn?.addEventListener('click', () => {
    if (bannerMode === 'error') applyUpdate();
  });

  banner?.addEventListener('click', (event) => {
    if (event.target === updateBtn) return;
    if (bannerMode === 'success' || bannerMode === 'error') hideBanner();
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
