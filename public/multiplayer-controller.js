/**
 * Controlador multijogador + UI de salas e histórico.
 * Regista callbacks do jogo via MultiplayerController.bindGame(hooks).
 */
(function (global) {
  'use strict';

  const MP = global.MultiplayerSync;
  const GH = global.GameHistory;

  let active = false;
  let roomPaused = false;
  let lobbyUiReady = false;
  let pendingLobbyJoin = null;
  let lobbyReadyForGame = false;
  const LAST_ROOM_KEY = 'reino_mp_last_room_v1';
  let gameHooks = null;
  let currentMatchId = null;
  let mpSessionStartedAt = null;

  function getSessionStartedAt() {
    return mpSessionStartedAt || getLastRoom()?.startedAt || null;
  }

  function applySessionStartedAt(ts, options = {}) {
    const n = Number(ts);
    if (!Number.isFinite(n) || n <= 0) return;
    mpSessionStartedAt = n;
    const saved = getLastRoom();
    if (saved?.code) {
      try {
        mpStorage()?.setItem(LAST_ROOM_KEY, JSON.stringify({
          ...saved,
          startedAt: n,
          at: Date.now(),
        }));
      } catch { /* ignore */ }
    }
    if (options.resumeClock !== false) {
      gameHooks?.resumeGameClock?.(n);
    }
  }

  function clearSessionStartedAt() {
    mpSessionStartedAt = null;
  }

  function bindGame(hooks) {
    gameHooks = hooks;
  }

  function isInRoom() {
    return !!MP?.isActive();
  }

  function amRoomHost() {
    const hostId = MP?.getHostPlayerId?.();
    const myId = MP?.getPlayerId?.();
    if (!hostId || !myId) return false;
    return String(hostId) === String(myId);
  }

  function isMultiplayer() {
    return active && MP?.isActive() && !roomPaused;
  }

  function isHost() {
    return isMultiplayer() && amRoomHost();
  }

  function updateHostBadgeUI() {
    const hostBadge = document.getElementById('mp-host-badge');
    if (hostBadge) hostBadge.hidden = !amRoomHost();
  }

  async function finishMultiplayerGame() {
    const game = GH.getCurrentGame();
    if (!game || game.mode !== 'multiplayer') return;
    const matchId = currentMatchId;
    try {
      if (isHost() && matchId && /^[0-9a-f-]{36}$/i.test(matchId)) {
        await MP.insertMatch(matchId, {
          startedAt: game.startedAt,
          finishedAt: new Date().toISOString(),
          roundsCount: Array.isArray(game.rounds) ? game.rounds.length : 0,
          roomCode: MP.getRoomCode(),
          gameId: game.id || null,
        });
      }
    } catch (e) {
      console.warn('[MP] match sync', e?.message || e);
    }
    currentMatchId = null;
    GH.finishGame();
  }

  function canControl() {
    return isMultiplayer();
  }

  function applyDiceVisual(state, lastCat, h) {
    const dice = state?.dice;
    if (!dice) return;
    if (dice.d1 != null && dice.d2 != null) {
      h.showDiceResult?.(dice.d1, dice.d2, lastCat, state.lastIsSurprise);
    } else if (dice.sum != null) {
      h.showCategorySumResult?.(dice.sum, lastCat, state.lastIsSurprise);
    }
  }

  function serializeCategory(cat) {
    if (!cat) return null;
    return { n: cat.n, e: cat.e, name: cat.name, desc: cat.desc || '' };
  }

  function deserializeCategory(cat) {
    if (!cat || !gameHooks?.CATEGORIES) return cat;
    return gameHooks.CATEGORIES.find((c) => c.n === cat.n) || cat;
  }

  function buildGameState(extra) {
    const h = gameHooks;
    if (!h) return {};
    return {
      version: 1,
      status: 'playing',
      actorId: MP.getPlayerId(),
      updatedAt: Date.now(),
      screen: extra?.screen || 'game',
      gameCategoryMap: h.getGameCategoryMap?.() || {},
      remainingCategories: (h.getRemainingCategories?.() || []).map(serializeCategory),
      lastCategory: serializeCategory(h.getLastCategory?.()),
      lastIsSurprise: !!h.getLastIsSurprise?.(),
      selectedAgeBand: h.getSelectedAgeBand?.() || null,
      currentQuestion: h.getCurrentQuestion?.() || null,
      countdownPaused: !!h.getCountdownPaused?.(),
      countdownRemaining: h.getCountdownRemaining?.() ?? null,
      answerRevealed: !!h.getAnswerRevealed?.(),
      selectedAnswer: h.getLastSelectedAnswer?.() ?? null,
      dice: extra && 'dice' in extra ? extra.dice : (h.getLastDiceRoll?.() ?? null),
      round: extra?.round ?? (GH.getCurrentGame()?.rounds?.length || 0),
      ...extra,
      sessionStartedAt: extra?.sessionStartedAt ?? getSessionStartedAt() ?? null,
    };
  }

  let lastGameStateJson = '';
  let lastAppliedStateAt = 0;
  let remoteApplyChain = Promise.resolve();

  function scheduleRemoteState(state, settings, options = {}) {
    remoteApplyChain = remoteApplyChain
      .then(() => applyRemoteState(state, settings, options))
      .catch((e) => console.warn('[MP] applyRemoteState', e));
    return remoteApplyChain;
  }

  function applyAgeScreenState(state, lastCat, h) {
    if (!lastCat?.n) {
      h.showScreen?.('game');
      return;
    }
    if (state?.dice) applyDiceVisual(state, lastCat, h);
    h.updateQuestionCategoryHeader?.(
      lastCat,
      !!state.lastIsSurprise,
      state.selectedAgeBand || null
    );
    h.showScreen?.('age');
    h.focusAgeScreen?.();
  }

  async function pushState(extra) {
    if (!isMultiplayer()) return;
    const state = buildGameState(extra);
    try {
      await MP.updateGameState(state);
      const json = JSON.stringify(state);
      lastGameStateJson = json;
      MP.setLastGameStateJson(json);
      if (state.updatedAt) lastAppliedStateAt = state.updatedAt;
    } catch (e) {
      console.warn('[MP] pushState', e);
      throw e;
    }
  }

  function resolveCategoryFromState(state) {
    let cat = deserializeCategory(state?.lastCategory);
    if (cat?.e && cat?.name) return cat;
    const sum = state?.dice?.sum;
    if (sum != null && state?.gameCategoryMap) {
      const raw = state.gameCategoryMap[String(sum)] ?? state.gameCategoryMap[sum];
      cat = deserializeCategory(raw);
      if (cat?.e && cat?.name) return cat;
    }
    return cat || null;
  }

  async function applyRemoteState(state, settings, options = {}) {
    if (!state || !gameHooks) return;
    if (!options.resume && state.actorId && state.actorId === MP.getPlayerId()) return;
    const remoteTs = Number(state.updatedAt) || 0;
    if (!options.resume && remoteTs && remoteTs < lastAppliedStateAt) return;
    if (remoteTs) lastAppliedStateAt = remoteTs;
    if (state.sessionStartedAt) applySessionStartedAt(state.sessionStartedAt, { resumeClock: false });
    const h = gameHooks;
    if (settings && Object.keys(settings).length) {
      h.applySettings?.(settings);
    }
    if (state.gameCategoryMap && Object.keys(state.gameCategoryMap).length > 0) {
      const map = {};
      Object.keys(state.gameCategoryMap).forEach((k) => {
        map[k] = deserializeCategory(state.gameCategoryMap[k]);
      });
      h.setGameCategoryMap?.(map);
    }
    if (state.remainingCategories) {
      h.setRemainingCategories?.(state.remainingCategories.map(deserializeCategory));
    }
    const lastCat = resolveCategoryFromState(state);
    h.setLastCategory?.(lastCat, !!state.lastIsSurprise);
    h.setSelectedAgeBand?.(state.selectedAgeBand || null);

    if (state.screen === 'game') {
      const backToCategories = !state.dice && !state.currentQuestion;
      if (backToCategories) {
        h.returnToCategoryBoard?.();
      } else {
        h.fillCategoryList?.();
        h.resetGameScreenPartial?.();
        applyDiceVisual(state, lastCat, h);
        h.setCurrentQuestion?.(state.currentQuestion || null);
        h.showScreen?.('game');
      }
      syncGameClockForSession();
      return;
    }

    if (state.screen === 'age') {
      applyAgeScreenState(state, lastCat, h);
      syncGameClockForSession();
      return;
    }

    if (state.screen === 'question' && state.currentQuestion) {
      const sameQ = h.isSameQuestion?.(state.currentQuestion);
      if (!sameQ) {
        h.setCurrentQuestion?.(state.currentQuestion);
        await h.displayQuestion?.(lastCat, state.lastIsSurprise, state.selectedAgeBand, state.currentQuestion);
      } else if (h.getCurrentScreenId?.() !== 'question') {
        h.setCurrentQuestion?.(state.currentQuestion);
        await h.displayQuestion?.(lastCat, state.lastIsSurprise, state.selectedAgeBand, state.currentQuestion);
      }
      if (typeof state.countdownPaused === 'boolean') {
        h.applyCountdownSync?.(state.countdownPaused, state.countdownRemaining);
      }
      if (state.answerRevealed) {
        h.applyAnswerFromRemote?.(state.selectedAnswer || null);
      }
      syncGameClockForSession();
    }
  }

  async function pushCountdownState(paused, remaining) {
    if (!isMultiplayer() || !gameHooks) return;
    const h = gameHooks;
    await pushState({
      screen: 'question',
      currentQuestion: h.getCurrentQuestion?.(),
      lastCategory: serializeCategory(h.getLastCategory?.()),
      lastIsSurprise: !!h.getLastIsSurprise?.(),
      selectedAgeBand: h.getSelectedAgeBand?.() || null,
      countdownPaused: !!paused,
      countdownRemaining: Number.isFinite(remaining) ? remaining : null,
    });
  }

  async function pushAnswerState(selectedAnswer) {
    if (!isMultiplayer() || !gameHooks) return;
    const h = gameHooks;
    await pushState({
      screen: 'question',
      currentQuestion: h.getCurrentQuestion?.(),
      lastCategory: serializeCategory(h.getLastCategory?.()),
      lastIsSurprise: !!h.getLastIsSurprise?.(),
      selectedAgeBand: h.getSelectedAgeBand?.() || null,
      countdownPaused: !!h.getCountdownPaused?.(),
      countdownRemaining: h.getCountdownRemaining?.() ?? null,
      answerRevealed: true,
      selectedAnswer: selectedAnswer || null,
    });
  }

  function recordRoundFromQuestion(q, cat, ageBand) {
    if (!q || !GH) return;
    const round = GH.addRound({
      category: cat?.name || '',
      format: q.formatId || q.format || '',
      difficulty: q.difficulty || '',
      ageBand: ageBand || '',
      question: (q.q || '').replace(/<[^>]*>/g, ''),
      correctAnswer: (q.a || '').replace(/<[^>]*>/g, ''),
      options: q.options || null,
    });
    if (isMultiplayer() && round) {
      MP.insertHistoryRound(round, currentMatchId).catch(() => {});
    }
    return round;
  }

  function mpStorage() {
    try {
      return global.sessionStorage || global.localStorage;
    } catch {
      return null;
    }
  }

  function saveLastRoom(code, paused = false) {
    if (!code) return;
    try {
      const prev = getLastRoom();
      const upper = String(code).toUpperCase();
      const sameRoom = prev?.code === upper;
      const startedAt = mpSessionStartedAt || (sameRoom && prev?.startedAt) || undefined;
      const payload = {
        code: upper,
        paused: !!paused,
        at: Date.now(),
        playerCount: sameRoom ? (prev.playerCount ?? 0) : 0,
        connectedCount: sameRoom ? (prev.connectedCount ?? 0) : 0,
      };
      if (startedAt) payload.startedAt = startedAt;
      mpStorage()?.setItem(LAST_ROOM_KEY, JSON.stringify(payload));
    } catch { /* ignore */ }
  }

  function persistLastRoomPlayers(players) {
    const saved = getLastRoom();
    if (!saved?.code) return;
    const count = (players || []).length;
    const connected = (players || []).filter((p) => p.is_connected).length;
    try {
      mpStorage()?.setItem(LAST_ROOM_KEY, JSON.stringify({
        ...saved,
        playerCount: count,
        connectedCount: connected,
        at: Date.now(),
      }));
    } catch { /* ignore */ }
  }

  function formatMpContinueMeta(code, playerCount, connectedCount) {
    const parts = [code];
    if (playerCount > 0) {
      parts.push(buildPlayerCountLabel(playerCount, connectedCount ?? playerCount));
    }
    return parts.join(' · ');
  }

  function getLastRoom() {
    try {
      const raw = mpStorage()?.getItem(LAST_ROOM_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      return data?.code ? data : null;
    } catch {
      return null;
    }
  }

  function clearLastRoom() {
    try { mpStorage()?.removeItem(LAST_ROOM_KEY); } catch { /* ignore */ }
    clearSessionStartedAt();
    updateContinueButton();
  }

  function canContinueLastRoom() {
    const saved = getLastRoom();
    if (!saved?.code) return false;
    if (isInRoom() && !roomPaused) {
      const screen = gameHooks?.getCurrentScreenId?.();
      const menuLike = ['menu', 'history', 'settings', 'continue', 'mp-menu'].includes(screen);
      if (!menuLike) return false;
    }
    return true;
  }

  function markLastRoomGameStarted() {
    applySessionStartedAt(Date.now(), { resumeClock: false });
  }

  function syncGameClockForSession() {
    const startedAt = getSessionStartedAt();
    if (startedAt) gameHooks?.resumeGameClock?.(startedAt);
    else gameHooks?.startGameClock?.();
  }

  function formatSessionStartedAt(ts) {
    if (!ts) return '';
    const date = new Date(ts);
    if (Number.isNaN(date.getTime())) return '';
    const d = date.toLocaleDateString('pt-PT');
    const t = date.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
    return `${d} ${t}`;
  }

  function formatSessionElapsed(ts) {
    if (!ts) return '';
    const elapsed = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    const h = Math.floor(elapsed / 3600);
    const m = Math.floor((elapsed % 3600) / 60);
    const s = elapsed % 60;
    const pad = (n) => String(n).padStart(2, '0');
    const text = h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
    return `⏱ ${text}`;
  }

  function getResumableSessions() {
    const sessions = [];
    if (canContinueLastRoom()) {
      const saved = getLastRoom();
      const code = (MP.getRoomCode() || saved?.code || '----').toUpperCase();
      sessions.push({
        id: 'mp-' + code,
        type: 'multiplayer',
        title: 'Sala multijogador',
        code,
        meta: formatMpContinueMeta(code, saved?.playerCount || 0, saved?.connectedCount),
        when: formatSessionStartedAt(saved?.startedAt || saved?.at),
        elapsed: formatSessionElapsed(saved?.startedAt || saved?.at),
        playerCount: saved?.playerCount || 0,
        connectedCount: saved?.connectedCount,
        icon: '👥',
      });
    }
    if (gameHooks?.hasLocalGamePause?.()) {
      const localStartedAt = gameHooks?.getLocalGameStartedAt?.();
      sessions.push({
        id: 'local',
        type: 'local',
        title: 'Jogo local / privado',
        meta: 'Neste dispositivo',
        when: formatSessionStartedAt(localStartedAt),
        elapsed: formatSessionElapsed(localStartedAt),
        icon: '✨',
      });
    }
    return sessions;
  }

  function refreshContinueScreen() {
    const sessions = getResumableSessions();
    updateContinueButton();
    const onContinueScreen = document.getElementById('screen-continue')?.classList.contains('active');
    if (!sessions.length) {
      if (onContinueScreen) gameHooks?.showScreen?.('menu');
      return;
    }
    if (onContinueScreen) renderContinuePicker(sessions);
  }

  async function endMultiplayerSession(session) {
    const code = session?.code || session?.meta || 'esta sala';
    if (!global.confirm(`Terminar a sala multijogador (${code})?\n\nDeixarás de a poder retomar.`)) return;
    try {
      if (isInRoom()) {
        await finishMultiplayerGame();
        await MP.leaveRoom();
      }
    } catch (e) {
      console.warn('[MP] end session', e?.message || e);
    }
    active = false;
    clearLastRoom();
    clearRoomPause();
    gameHooks?.stopGameClock?.();
    gameHooks?.clearJoinQueryFromUrl?.();
    refreshContinueScreen();
  }

  function endLocalSession() {
    if (!global.confirm('Terminar o jogo local?\n\nO progresso guardado será apagado.')) return;
    gameHooks?.endLocalGamePause?.();
    refreshContinueScreen();
  }

  async function renderContinuePicker(sessions) {
    const list = document.getElementById('continue-session-list');
    if (!list) return;
    list.innerHTML = '';
    if (!sessions.length) {
      list.innerHTML = '<p class="subtitle">Não há partidas para retomar.</p>';
      gameHooks?.showScreen?.('continue');
      return;
    }
    sessions.forEach((session) => {
      const row = document.createElement('div');
      row.className = 'continue-session-row';
      if (session.type === 'multiplayer') row.dataset.sessionCode = session.code || '';

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn secondary continue-session-btn';
      btn.innerHTML = `
        <span class="continue-session-icon" aria-hidden="true">${session.icon}</span>
        <span class="continue-session-body">
          <span class="continue-session-title">${session.title}</span>
          <span class="continue-session-meta">${escapeHtml(session.meta)}</span>
          ${session.when ? `<span class="continue-session-when">${escapeHtml(session.when)}${session.elapsed ? ` · ${escapeHtml(session.elapsed)}` : ''}</span>` : (session.elapsed ? `<span class="continue-session-when">${escapeHtml(session.elapsed)}</span>` : '')}
        </span>`;
      btn.addEventListener('click', async () => {
        if (session.type === 'multiplayer') {
          await resumeRoomSession();
        } else {
          gameHooks?.resumeLocalGame?.();
        }
      });

      const endBtn = document.createElement('button');
      endBtn.type = 'button';
      endBtn.className = 'continue-session-end';
      endBtn.setAttribute('aria-label', `Terminar ${session.title}`);
      endBtn.title = 'Terminar esta partida';
      endBtn.textContent = '×';
      endBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (session.type === 'multiplayer') endMultiplayerSession(session);
        else endLocalSession();
      });

      row.appendChild(btn);
      row.appendChild(endBtn);
      list.appendChild(row);
    });
    gameHooks?.showScreen?.('continue');

    const mpSession = sessions.find((s) => s.type === 'multiplayer');
    if (!mpSession || !isInRoom() || !MP.isConfigured()) return;
    try {
      await MP.ensureClient();
      const players = await MP.fetchPlayers();
      persistLastRoomPlayers(players);
      const count = players.length;
      const connected = players.filter((p) => p.is_connected).length;
      mpSession.playerCount = count;
      mpSession.connectedCount = connected;
      mpSession.meta = formatMpContinueMeta(mpSession.code, count, connected);
      const row = list.querySelector(`[data-session-code="${mpSession.code}"]`);
      const metaEl = row?.querySelector('.continue-session-meta');
      if (metaEl) metaEl.textContent = mpSession.meta;
    } catch { /* usar contagem guardada */ }
  }

  function setContinueButtonLabel(btn, sessions) {
    btn.textContent = '';
    if (sessions.length === 1 && sessions[0].type === 'multiplayer') {
      btn.append('📜 Continuar sala ');
      const codeEl = document.createElement('span');
      codeEl.className = 'btn-room-code';
      codeEl.textContent = sessions[0].code || sessions[0].meta;
      btn.append(codeEl);
      const meta = sessions[0].meta;
      btn.title = meta
        ? `Retomar sala ${sessions[0].code} (${meta})`
        : `Retomar sala ${sessions[0].code}`;
      return;
    }
    if (sessions.length === 1 && sessions[0].type === 'local') {
      btn.textContent = '📜 Continuar jogo local';
      btn.title = 'Retomar o jogo local / privado';
      return;
    }
    btn.textContent = `📜 Continuar (${sessions.length})`;
    btn.title = 'Escolher partida a retomar';
  }

  function showMpToast(message, ms = 5000) {
    const toast = document.getElementById('mp-share-toast');
    if (!toast) return;
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(showMpToast._timer);
    showMpToast._timer = setTimeout(() => { toast.hidden = true; }, ms);
  }

  function updateLobbyActionButtons(status) {
    const startBtn = document.getElementById('mp-btn-start');
    const joinBtn = document.getElementById('mp-btn-join-game');
    const isPlaying = status === 'playing';
    if (startBtn) startBtn.hidden = !amRoomHost() || isPlaying;
    if (joinBtn) joinBtn.hidden = !isPlaying;
  }

  async function enterGameFromLobby() {
    const errEl = document.getElementById('mp-lobby-error');
    showMpError(errEl, '');
    lobbyReadyForGame = true;
    let payload = pendingLobbyJoin;
    try {
      const room = await MP.fetchRoom();
      if (room?.status === 'playing' && room.game_state) {
        payload = { gameState: room.game_state, settings: room.settings || {} };
      }
    } catch { /* fallback ao estado em cache */ }
    if (!payload?.gameState) {
      showMpError(errEl, 'O jogo ainda não começou');
      return;
    }
    pendingLobbyJoin = null;
    try {
      await applyRemoteState(payload.gameState, payload.settings, { resume: true });
      syncGameClockForSession();
      const screen = payload.gameState.screen;
      gameHooks?.showScreen?.(
        screen === 'question' ? 'question' : screen === 'age' ? 'age' : 'game'
      );
      updateGameFooter();
    } catch (e) {
      showMpError(errEl, e.message || 'Erro ao entrar no jogo');
    }
  }

  async function enterRoomFromJoinResult(result, options = {}) {
    if (!result) return;
    const resumeSession = !!options.resumeSession;
    saveLastRoom(result.code || MP.getRoomCode(), false);
    active = true;
    clearRoomPause();
    if (result.gameState?.sessionStartedAt) {
      applySessionStartedAt(result.gameState.sessionStartedAt, { resumeClock: false });
    }

    if (resumeSession && result.status === 'playing' && result.gameState) {
      lobbyReadyForGame = true;
      pendingLobbyJoin = null;
      await applyRemoteState(result.gameState, result.settings || {}, { resume: true });
      syncGameClockForSession();
      const screen = result.gameState.screen;
      gameHooks?.showScreen?.(
        screen === 'question' ? 'question' : screen === 'age' ? 'age' : 'game'
      );
    } else {
      lobbyReadyForGame = result.status !== 'playing';
      pendingLobbyJoin = (result.status === 'playing' && result.gameState)
        ? { gameState: result.gameState, settings: result.settings || {} }
        : null;
      try {
        renderPlayersUI(await MP.fetchPlayers());
      } catch { /* ignore */ }
      updateLobbyActionButtons(result.status || 'lobby');
      gameHooks?.showScreen?.('mp-lobby');
    }
    updateGameFooter();
    updateContinueButton();
    gameHooks?.clearJoinQueryFromUrl?.();
  }

  function clearRoomPause() {
    roomPaused = false;
    updateContinueButton();
  }

  function updateContinueButton() {
    const btn = document.getElementById('btn-continuar');
    if (!btn) return;

    const sessions = getResumableSessions();

    if (!sessions.length) {
      btn.disabled = true;
      btn.textContent = '📜 Continuar';
      btn.title = 'Ainda não há jogo em curso';
      return;
    }

    btn.disabled = false;
    setContinueButtonLabel(btn, sessions);
  }

  function handleContinue() {
    const sessions = getResumableSessions();
    if (!sessions.length) return;
    renderContinuePicker(sessions);
  }

  function goToMenuKeepRoom() {
    gameHooks?.saveLocalGamePause?.();
    if (!isInRoom()) {
      gameHooks?.showScreen?.('menu');
      refreshContinueScreen();
      return;
    }
    roomPaused = true;
    active = true;
    saveLastRoom(MP.getRoomCode(), true);
    gameHooks?.showScreen?.('menu');
  }

  async function resumeRoomSession() {
    const saved = getLastRoom();
    if (!isInRoom() && !saved?.code) return;

    roomPaused = false;
    active = true;

    try {
      if (!isInRoom()) {
        if (!MP.isConfigured()) {
          showMpToast('Configura o multijogador em supabase-config.js');
          return;
        }
        await MP.ensureClient();
        const name = global.PlayerNames?.getNicknameOrRandom?.() || '';
        const result = await MP.joinRoom(saved.code, name);
        if (!lobbyUiReady) {
          await initLobbyUI();
          lobbyUiReady = true;
        }
        await enterRoomFromJoinResult(result, { resumeSession: true });
        return;
      }

      await MP.setConnected(true);
      await MP.syncHostFromServer?.();
      const room = await MP.fetchRoom();
      if (!room || room.expired) return;

      saveLastRoom(MP.getRoomCode(), false);
      if (room.status === 'lobby') {
        const players = await MP.fetchPlayers();
        renderPlayersUI(players);
        gameHooks?.showScreen?.('mp-lobby');
      } else if (room.status === 'playing' && room.game_state) {
        await applyRemoteState(room.game_state, room.settings || {}, { resume: true });
        syncGameClockForSession();
        const screen = room.game_state.screen;
        if (screen === 'question' || screen === 'age') {
          gameHooks?.showScreen?.(screen);
        } else {
          gameHooks?.showScreen?.('game');
        }
      } else {
        gameHooks?.showScreen?.('mp-lobby');
      }
      updateGameFooter();
    } catch (e) {
      const msg = e.message || '';
      console.warn('[MP] resume', msg || e);
      if (/expirada|não encontrada|not found/i.test(msg)) {
        clearLastRoom();
        showMpToast(
          msg.includes('expirada')
            ? 'A sala expirou por inatividade (24 horas).'
            : 'A última sala já não está disponível.'
        );
      }
      active = false;
      roomPaused = false;
      gameHooks?.showScreen?.('menu');
    }
    updateContinueButton();
  }

  function showMpExpiredToast(message) {
    showMpToast(message || 'A sala expirou por inatividade (24 horas).');
  }

  function handleRoomExpired(message) {
    finishMultiplayerGame().catch(() => {});
    gameHooks?.clearJoinQueryFromUrl?.();
    active = false;
    clearLastRoom();
    clearRoomPause();
    gameHooks?.showScreen?.('menu');
    showMpExpiredToast(message);
  }

  async function leaveRoomAndMenu() {
    await finishMultiplayerGame();
    await MP.leaveRoom();
    gameHooks?.clearJoinQueryFromUrl?.();
    active = false;
    pendingLobbyJoin = null;
    lobbyReadyForGame = false;
    clearLastRoom();
    clearRoomPause();
    gameHooks?.stopGameClock?.();
    gameHooks?.showScreen?.('menu');
  }

  function formatPlayerNickLabel(nick) {
    const name = String(nick || '').trim();
    if (!name) return isHost() ? '👑 Nome' : '✏️ Nome';
    return `${isHost() ? '👑' : '✏️'} ${name}`;
  }

  function showHostLeaveDialog(otherCount) {
    return new Promise((resolve) => {
      const overlay = document.getElementById('mp-host-leave-overlay');
      const msg = document.getElementById('mp-host-leave-msg');
      if (!overlay) {
        resolve(null);
        return;
      }
      if (msg) {
        const label = otherCount === 1 ? '1 jogador' : `${otherCount} jogadores`;
        msg.textContent = `Há ${label} na sala. Queres terminar o jogo para todos ou passar o anfitrião e sair?`;
      }
      overlay.hidden = false;
      overlay.classList.add('open');

      const finishBtn = document.getElementById('mp-host-leave-finish');
      const transferBtn = document.getElementById('mp-host-leave-transfer');
      const cancelBtn = document.getElementById('mp-host-leave-cancel');

      const cleanup = (result) => {
        overlay.classList.remove('open');
        overlay.hidden = true;
        overlay.removeEventListener('click', onOverlayClick);
        finishBtn?.removeEventListener('click', onFinish);
        transferBtn?.removeEventListener('click', onTransfer);
        cancelBtn?.removeEventListener('click', onCancel);
        resolve(result);
      };

      const onCancel = () => cleanup(null);
      const onFinish = () => cleanup('finish');
      const onTransfer = () => cleanup('transfer');
      const onOverlayClick = (e) => {
        if (e.target === overlay) onCancel();
      };

      finishBtn?.addEventListener('click', onFinish);
      transferBtn?.addEventListener('click', onTransfer);
      cancelBtn?.addEventListener('click', onCancel);
      overlay.addEventListener('click', onOverlayClick);
    });
  }

  async function hostLeaveRoomAndMenu(action) {
    try {
      const result = await MP.hostLeaveRoom(action);
      await finishMultiplayerGame();
      gameHooks?.clearJoinQueryFromUrl?.();
      active = false;
      clearLastRoom();
      clearRoomPause();
      gameHooks?.showScreen?.('menu');
      if (result?.action === 'transfer') {
        showMpToast('Saíste da sala. Novo anfitrião atribuído.');
      } else {
        showMpToast('Sala terminada para todos.');
      }
    } catch (e) {
      showMpToast(e.message || 'Erro ao sair da sala');
    }
  }

  async function hostStartFromLobby(settings) {
    if (!isHost() || !gameHooks) return;
    await finishMultiplayerGame();
    gameHooks.assignCategoriesForNewGame?.();
    const now = Date.now();
    applySessionStartedAt(now, { resumeClock: false });
    gameHooks.startGameClock?.(now, true);
    currentMatchId = global.crypto?.randomUUID?.() || 'mp-' + Date.now();
    GH.startGame('multiplayer', { roomCode: MP.getRoomCode(), roomId: MP.getRoomId() });
    const state = buildGameState({ screen: 'game', status: 'playing', sessionStartedAt: now });
    await MP.startGame(state, settings || {});
    gameHooks.fillCategoryList?.();
    gameHooks.showScreen?.('game');
    renderPlayersUI(await MP.fetchPlayers());
    updateGameFooter();
  }

  async function hostRollDice(d1, d2) {
    if (!isMultiplayer() || !gameHooks) return false;
    const h = gameHooks;
    const sum = d1 + d2;
    let lastCat;
    let surprise = false;
    if (sum === 12) {
      const rem = h.getRemainingCategories?.() || [];
      lastCat = rem[Math.floor(Math.random() * rem.length)];
      surprise = true;
    } else {
      const map = h.getGameCategoryMap?.() || {};
      lastCat = map[sum];
    }
    h.setLastCategory?.(lastCat, surprise);
    h.setSelectedAgeBand?.(null);
    h.showDiceResult?.(d1, d2, lastCat, surprise);
    if (isMultiplayer()) {
      await pushState({
        screen: 'game',
        dice: { d1, d2, sum },
        lastCategory: serializeCategory(lastCat),
        lastIsSurprise: surprise,
      });
    }
    return true;
  }

  async function syncCategoryPick(sum) {
    if (!isMultiplayer() || !gameHooks) return false;
    const h = gameHooks;
    const picked = h.pickCategoryBySum?.(sum);
    if (!picked?.cat) return false;
    try {
      const state = {
        screen: 'age',
        dice: picked.dice || { d1: null, d2: null, sum },
        lastCategory: serializeCategory(picked.cat),
        lastIsSurprise: !!picked.surprise,
        selectedAgeBand: null,
        currentQuestion: null,
      };
      await pushState(state);
      applyAgeScreenState(state, picked.cat, h);
      return true;
    } catch (e) {
      showMpToast('Aviso: não foi possível sincronizar com a sala.');
      return false;
    }
  }

  async function hostGoToAgeSelection() {
    if (!gameHooks) return false;
    const h = gameHooks;
    const cat = h.getLastCategory?.();
    if (!cat) return false;
    if (!isMultiplayer()) {
      h.showScreen?.('age');
      return true;
    }
    try {
      const state = {
        screen: 'age',
        lastCategory: serializeCategory(cat),
        lastIsSurprise: !!h.getLastIsSurprise?.(),
        dice: h.getLastDiceRoll?.() || null,
        selectedAgeBand: null,
        currentQuestion: null,
      };
      await pushState(state);
      applyAgeScreenState(state, cat, h);
    } catch (e) {
      showMpToast('Aviso: não foi possível sincronizar com a sala.');
      h.showScreen?.('age');
    }
    return true;
  }

  async function hostSelectAge(ageBand) {
    if (!canControl()) return false;
    gameHooks.setSelectedAgeBand?.(ageBand);
    if (isMultiplayer()) {
      try {
        await pushState({
          screen: 'age',
          selectedAgeBand: ageBand,
          lastCategory: serializeCategory(gameHooks.getLastCategory?.()),
          lastIsSurprise: !!gameHooks.getLastIsSurprise?.(),
          dice: gameHooks.getLastDiceRoll?.() || null,
        });
      } catch (e) {
        showMpToast('Aviso: não foi possível sincronizar com a sala.');
      }
    }
    return true;
  }

  async function hostQuestionReady(cat, isSurprise, ageBand, question) {
    gameHooks.setCurrentQuestion?.(question);
    recordRoundFromQuestion(question, cat, ageBand);
    if (isMultiplayer()) {
      await pushState({
        screen: 'question',
        selectedAgeBand: ageBand,
        lastCategory: serializeCategory(cat),
        lastIsSurprise: isSurprise,
        currentQuestion: question,
        answerRevealed: false,
        selectedAnswer: null,
        countdownPaused: false,
        countdownRemaining: null,
      });
    }
  }

  async function hostBackToCategories() {
    if (!canControl()) return;
    try {
      if (isMultiplayer()) {
        await pushState({
          screen: 'game',
          dice: null,
          currentQuestion: null,
          lastCategory: null,
          lastIsSurprise: false,
          selectedAgeBand: null,
          answerRevealed: false,
          selectedAnswer: null,
          countdownPaused: false,
          countdownRemaining: null,
        });
      }
    } catch (e) {
      showMpToast('Aviso: não foi possível sincronizar com a sala.');
    }
    gameHooks.returnToCategoryBoard?.();
  }

  async function hostBackToDiceResult() {
    if (!canControl()) return;
    gameHooks.abortQuestionFlow?.();
    const h = gameHooks;
    const cat = h.getLastCategory?.();
    if (!cat?.n) {
      h.showScreen?.('game');
      return;
    }
    h.setSelectedAgeBand?.(null);
    try {
      if (isMultiplayer()) {
        await pushState({
          screen: 'game',
          currentQuestion: null,
          selectedAgeBand: null,
          lastCategory: serializeCategory(cat),
          lastIsSurprise: !!h.getLastIsSurprise?.(),
          dice: h.getLastDiceRoll?.() || null,
          answerRevealed: false,
          selectedAnswer: null,
          countdownPaused: false,
          countdownRemaining: null,
        });
      }
    } catch (e) {
      showMpToast('Aviso: não foi possível sincronizar com a sala.');
    }
    h.showScreen?.('game');
  }

  function renderPlayersUI(players) {
    updateHostBadgeUI();

    const snapshot = playersSnapshot(players);
    if (snapshot === lastPlayersSnapshot) return;
    lastPlayersSnapshot = snapshot;

    persistLastRoomPlayers(players);
    const startBtn = document.getElementById('mp-btn-start');
    const hostId = MP.getHostPlayerId?.() || null;
    if (startBtn) startBtn.hidden = !amRoomHost();

    const isPlayerHost = (p) => !!(hostId && String(p.player_id) === String(hostId));

    const count = (players || []).length;
    const connected = (players || []).filter((p) => p.is_connected).length;
    const countLabel = buildPlayerCountLabel(count, connected);
    const countEl = document.getElementById('mp-players-count');
    if (countEl) {
      countEl.textContent = count ? `👥 ${countLabel}` : '';
    }

    const gameCountEl = document.getElementById('mp-game-players-count');
    if (gameCountEl) {
      gameCountEl.textContent = `👥 ${countLabel}`;
    }

    const gameList = document.getElementById('mp-game-players-list');
    fillPlayerRows(gameList, players, isPlayerHost);

    const list = document.getElementById('mp-players-list');
    fillPlayerRows(list, players, isPlayerHost);
    if (list) list.hidden = count === 0;

    if (gameHooks?.getCurrentScreenId?.() === 'mp-lobby') {
      MP.fetchRoom()
        .then((room) => updateLobbyActionButtons(room?.status || 'lobby'))
        .catch(() => {});
    }
  }

  const renderLobbyPlayers = renderPlayersUI;

  function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  let gamePlayersOpen = false;
  let gameNickOpen = false;
  let lastPlayersSnapshot = '';

  function playersSnapshot(players) {
    const hostId = MP.getHostPlayerId?.() || '';
    const rows = (players || []).map((p) => ({
      id: String(p.player_id || ''),
      n: String(p.nickname || ''),
      c: !!p.is_connected,
    }));
    return JSON.stringify({ hostId, rows });
  }

  async function savePlayerNickname(name) {
    const trimmed = String(name || '').trim().slice(0, 24);
    if (!trimmed) {
      showMpToast('Introduz um nome');
      return false;
    }
    try {
      await MP.updateNickname(trimmed);
      global.PlayerNames?.saveNickname?.(trimmed);
      lastPlayersSnapshot = '';
      await MP.refreshPlayers?.();
      const label = document.getElementById('mp-game-nick-label');
      if (label) label.textContent = formatPlayerNickLabel(trimmed);
      const lobbyInput = document.getElementById('mp-lobby-nick');
      if (lobbyInput) lobbyInput.value = trimmed;
      const gameInput = document.getElementById('mp-game-nick-input');
      if (gameInput) gameInput.value = trimmed;
      return true;
    } catch (e) {
      showMpToast(e.message || 'Erro ao guardar nome');
      return false;
    }
  }

  async function refreshGameNickLabel() {
    const label = document.getElementById('mp-game-nick-label');
    const input = document.getElementById('mp-game-nick-input');
    if (!label || !isInRoom()) return;
    try {
      const nick = await MP.getMyNickname();
      if (nick) {
        label.textContent = formatPlayerNickLabel(nick);
        if (input) input.value = nick;
      }
    } catch { /* ignore */ }
  }

  async function confirmLeaveRoomAndMenu() {
    if (!isInRoom()) return;

    let players = [];
    try {
      players = await MP.fetchPlayers();
    } catch { /* ignore */ }

    const myId = MP.getPlayerId?.();
    const others = (players || []).filter((p) => String(p.player_id) !== String(myId));

    if (isHost() && others.length > 0) {
      const choice = await showHostLeaveDialog(others.length);
      if (!choice) return;
      await hostLeaveRoomAndMenu(choice);
      return;
    }

    if (!global.confirm('Queres terminar e sair da sala?')) return;
    await leaveRoomAndMenu();
  }

  function buildPlayerCountLabel(count, connected) {
    const countLabel = count === 1 ? '1 jogador' : `${count} jogadores`;
    if (connected < count) {
      return `${countLabel} (${connected} ligado${connected === 1 ? '' : 's'})`;
    }
    return countLabel;
  }

  function fillPlayerRows(container, players, isPlayerHost) {
    if (!container) return;
    container.innerHTML = '';
    const myId = MP.getPlayerId?.() || null;
    const sorted = [...(players || [])].sort((a, b) => {
      const ah = isPlayerHost(a) ? 0 : 1;
      const bh = isPlayerHost(b) ? 0 : 1;
      return ah - bh;
    });
    sorted.forEach((p) => {
      const host = isPlayerHost(p);
      const isMe = !!(myId && String(p.player_id) === String(myId));
      const li = document.createElement('li');
      li.className = 'mp-player-row'
        + (p.is_connected ? '' : ' offline')
        + (host ? ' is-host' : '')
        + (isMe ? ' is-me' : '');
      if (isMe) li.setAttribute('aria-current', 'true');
      li.innerHTML = `<span>${host ? '<span class="mp-host-crown" aria-hidden="true">👑</span>' : ''}${escapeHtml(p.nickname)}</span>`
        + `<span class="mp-player-status">${p.is_connected ? '●' : '○'}</span>`;
      container.appendChild(li);
    });
  }

  function setGameNickOpen(open) {
    gameNickOpen = !!open;
    const btn = document.getElementById('mp-game-nick-btn');
    const pop = document.getElementById('mp-game-nick-popover');
    if (btn) {
      btn.classList.toggle('open', gameNickOpen);
      btn.setAttribute('aria-expanded', gameNickOpen ? 'true' : 'false');
    }
    if (pop) pop.hidden = !gameNickOpen;
    if (gameNickOpen) {
      refreshGameNickLabel().catch(() => {});
      setTimeout(() => document.getElementById('mp-game-nick-input')?.focus(), 0);
    }
  }

  function setGamePlayersOpen(open) {
    gamePlayersOpen = !!open;
    const btn = document.getElementById('mp-game-players-btn');
    const list = document.getElementById('mp-game-players-list');
    if (btn) {
      btn.classList.toggle('open', gamePlayersOpen);
      btn.setAttribute('aria-expanded', gamePlayersOpen ? 'true' : 'false');
    }
    if (list) list.hidden = !gamePlayersOpen;
  }

  function wirePlayersToggle() {
    const gameBtn = document.getElementById('mp-game-players-btn');

    gameBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      setGameNickOpen(false);
      setGamePlayersOpen(!gamePlayersOpen);
    });

    const nickBtn = document.getElementById('mp-game-nick-btn');
    const nickSave = document.getElementById('mp-game-nick-save');
    const nickInput = document.getElementById('mp-game-nick-input');

    nickBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      setGamePlayersOpen(false);
      setGameNickOpen(!gameNickOpen);
    });

    nickSave?.addEventListener('click', async (e) => {
      e.stopPropagation();
      const ok = await savePlayerNickname(nickInput?.value);
      if (ok) setGameNickOpen(false);
    });

    nickInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        nickSave?.click();
      }
    });

    document.addEventListener('click', (e) => {
      const playersWrap = document.getElementById('mp-game-players-wrap');
      if (gamePlayersOpen && playersWrap && !playersWrap.contains(e.target)) {
        setGamePlayersOpen(false);
      }
      const nickWrap = document.getElementById('mp-game-nick-wrap');
      if (gameNickOpen && nickWrap && !nickWrap.contains(e.target)) {
        setGameNickOpen(false);
      }
    });
  }

  function collapseAllHistoryItems(list) {
    if (!list) return;
    list.querySelectorAll('.history-game-item').forEach((item) => {
      item.querySelector('.history-game-card')?.classList.remove('is-expanded');
      const panel = item.querySelector('.history-game-detail');
      if (panel) {
        panel.hidden = true;
        panel.innerHTML = '';
      }
    });
  }

  function renderHistoryRounds(game, panel) {
    panel.innerHTML = '';
    if (!game.rounds.length) {
      panel.innerHTML = '<p class="subtitle" style="margin:0; font-size:0.9rem;">Sem perguntas registadas nesta partida.</p>';
      return;
    }
    game.rounds.forEach((r) => {
      const block = document.createElement('div');
      block.className = 'history-round-card';
      const correctNorm = String(r.correctAnswer || '').replace(/<[^>]*>/g, '').trim().toLowerCase();
      let opts = '';
      if (r.options?.length) {
        const items = r.options.map((o) => {
          const plain = String(o).replace(/<[^>]*>/g, '').trim();
          const isCorrect = plain.toLowerCase() === correctNorm;
          return `<li class="${isCorrect ? 'is-correct' : ''}">${escapeHtml(plain)}</li>`;
        }).join('');
        opts = `<ul class="history-options">${items}</ul>`;
      }
      const question = String(r.question || '').replace(/<[^>]*>/g, '').trim();
      const answer = String(r.correctAnswer || '').replace(/<[^>]*>/g, '').trim();
      block.innerHTML = `
        <div class="history-round-meta">Pergunta ${r.round} · ${escapeHtml(r.category || '—')}${r.ageBand ? ` · ${escapeHtml(r.ageBand)}` : ''}</div>
        <p class="history-q">${escapeHtml(question)}</p>
        <p class="history-a"><strong>Resposta:</strong> ${escapeHtml(answer)}</p>
        ${opts}`;
      panel.appendChild(block);
    });
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'btn secondary history-back-btn';
    back.textContent = '← Voltar à lista';
    back.addEventListener('click', (e) => {
      e.stopPropagation();
      const item = panel.closest('.history-game-item');
      if (item) {
        item.querySelector('.history-game-card')?.classList.remove('is-expanded');
        panel.hidden = true;
        panel.innerHTML = '';
      }
    });
    panel.appendChild(back);
  }

  function toggleHistoryDetail(gameId, list) {
    const item = list.querySelector(`.history-game-item[data-game-id="${gameId}"]`);
    if (!item) return;
    const card = item.querySelector('.history-game-card');
    const panel = item.querySelector('.history-game-detail');
    if (!card || !panel) return;

    const willOpen = panel.hidden;
    collapseAllHistoryItems(list);
    if (!willOpen) return;

    const game = GH.getGame(gameId);
    if (!game) return;

    card.classList.add('is-expanded');
    panel.hidden = false;
    renderHistoryRounds(game, panel);
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function renderHistoryList(filterMode) {
    const list = document.getElementById('history-games-list');
    if (!list || !GH) return;
    let games = GH.getGames().filter((g) => (g.rounds?.length || 0) > 0);
    if (filterMode && filterMode !== 'all') {
      games = games.filter((g) => g.mode === filterMode);
    }
    list.innerHTML = '';
    if (!games.length) {
      list.innerHTML = '<p class="subtitle">Ainda não há partidas guardadas.</p>';
      return;
    }
    games.forEach((game) => {
      const item = document.createElement('div');
      item.className = 'history-game-item';
      item.dataset.gameId = game.id;

      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'history-game-card';
      card.innerHTML = `<strong>${escapeHtml(GH.formatGameTitle(game))}</strong>`
        + `<span>${game.rounds.length} pergunta(s)</span>`
        + `<span class="history-game-caret" aria-hidden="true">▾</span>`;
      card.addEventListener('click', () => toggleHistoryDetail(game.id, list));

      const panel = document.createElement('div');
      panel.className = 'history-game-detail';
      panel.hidden = true;

      item.appendChild(card);
      item.appendChild(panel);
      list.appendChild(item);
    });
  }

  function showMpError(el, msg) {
    if (!el) return;
    el.textContent = msg || '';
    el.hidden = !msg;
  }

  function getRoomCodeFromUrl() {
    try {
      const params = new URLSearchParams(global.location.search);
      return (params.get('sala') || params.get('room') || '').trim().toUpperCase();
    } catch {
      return '';
    }
  }

  function buildJoinUrl(code) {
    const roomCode = String(code || MP.getRoomCode() || '').trim().toUpperCase();
    if (!roomCode) return '';
    try {
      const url = new URL(global.location.href);
      url.searchParams.set('sala', roomCode);
      url.hash = '';
      return url.toString();
    } catch {
      return `${global.location.origin}${global.location.pathname}?sala=${encodeURIComponent(roomCode)}`;
    }
  }

  function getShareMessage(code) {
    const roomCode = String(code || MP.getRoomCode() || '').trim().toUpperCase();
    const link = buildJoinUrl(roomCode);
    return `Junta-te à minha partida no Reino Mágico do Saber! 🏰\nCódigo da sala: ${roomCode}\n${link}`;
  }

  let shareToastTimer = null;

  function showShareToast(message) {
    const toast = document.getElementById('mp-share-toast');
    if (!toast) return;
    toast.textContent = message || 'Link copiado!';
    toast.hidden = false;
    if (shareToastTimer) clearTimeout(shareToastTimer);
    shareToastTimer = setTimeout(() => {
      toast.hidden = true;
    }, 2200);
  }

  async function copyJoinLink() {
    const link = buildJoinUrl();
    if (!link) return false;
    try {
      await global.navigator.clipboard.writeText(link);
      showShareToast('Link copiado!');
      return true;
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = link;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        showShareToast('Link copiado!');
        return true;
      } catch {
        showShareToast('Não foi possível copiar');
        return false;
      }
    }
  }

  function shareViaWhatsApp() {
    const text = getShareMessage();
    if (!text) return;
    const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
    global.open(url, '_blank', 'noopener,noreferrer');
  }

  function shareViaSms() {
    const text = getShareMessage();
    if (!text) return;
    global.location.href = `sms:?body=${encodeURIComponent(text)}`;
  }

  async function shareNative() {
    const code = MP.getRoomCode();
    const link = buildJoinUrl(code);
    if (!link) return;
    if (global.navigator.share) {
      try {
        await global.navigator.share({
          title: 'Reino Mágico do Saber',
          text: `Junta-te à minha partida! Código: ${code}`,
          url: link,
        });
        return;
      } catch (err) {
        if (err?.name === 'AbortError') return;
      }
    }
    const copied = await copyJoinLink();
    if (!copied) shareViaWhatsApp();
  }

  function wireShareButtons() {
    const pairs = [
      ['mp-game-copy-link', copyJoinLink],
      ['mp-game-share-wa', shareViaWhatsApp],
      ['mp-game-share-native', shareNative],
      ['mp-lobby-copy-link', copyJoinLink],
      ['mp-lobby-share-wa', shareViaWhatsApp],
      ['mp-lobby-share-native', shareNative],
    ];
    pairs.forEach(([id, handler]) => {
      document.getElementById(id)?.addEventListener('click', (e) => {
        e.preventDefault();
        handler();
      });
    });
  }

  function fillRandomNickname(input) {
    if (!input) return;
    const next = global.PlayerNames?.generateRandomPlayerName?.() || '';
    if (next) input.value = next;
  }

  function wireNickRefreshButtons() {
    document.getElementById('mp-lobby-nick-refresh')?.addEventListener('click', () => {
      fillRandomNickname(document.getElementById('mp-lobby-nick'));
    });
    document.getElementById('mp-join-nick-refresh')?.addEventListener('click', () => {
      fillRandomNickname(document.getElementById('mp-join-nick'));
    });
    document.getElementById('mp-game-nick-refresh')?.addEventListener('click', () => {
      fillRandomNickname(document.getElementById('mp-game-nick-input'));
    });
  }

  function wireJoinCodeInput() {
    const codeInput = document.getElementById('mp-join-code');
    if (!codeInput || codeInput.dataset.mpJoinWired) return;
    codeInput.dataset.mpJoinWired = '1';
    codeInput.addEventListener('focus', () => {
      if (codeInput.dataset.prefilled !== '1') return;
      codeInput.value = '';
      delete codeInput.dataset.prefilled;
    });
  }

  async function maybeJoinFromUrl() {
    const code = getRoomCodeFromUrl();
    if (!code || !MP.isConfigured() || !gameHooks) return;

    const codeInput = document.getElementById('mp-join-code');
    const nickInput = document.getElementById('mp-join-nick');
    if (codeInput) {
      codeInput.value = code;
      codeInput.dataset.prefilled = '1';
    }
    if (nickInput && !nickInput.value.trim()) {
      nickInput.value = global.PlayerNames?.getNicknameOrRandom?.() || '';
    }

    try {
      await MP.ensureClient();
      const currentCode = (MP.getRoomCode() || '').toUpperCase();
      if (MP.isActive() && currentCode === code) {
        const players = await MP.fetchPlayers();
        renderPlayersUI(players);
        try {
          const room = await MP.fetchRoom();
          updateLobbyActionButtons(room?.status || 'lobby');
          if (room?.status === 'playing' && room.game_state) {
            lobbyReadyForGame = false;
            pendingLobbyJoin = { gameState: room.game_state, settings: room.settings || {} };
          }
        } catch { /* ignore */ }
      gameHooks?.showScreen?.('mp-lobby');
      gameHooks?.clearJoinQueryFromUrl?.();
      return;
      }
      if (MP.isActive()) {
        await MP.leaveRoom();
        active = false;
        clearRoomPause();
      }

      const name = global.PlayerNames?.getNicknameOrRandom?.() || '';
      const result = await MP.joinRoom(code, name);
      await initLobbyUI();
      await enterRoomFromJoinResult(result);
    } catch (e) {
      console.warn('[MP] auto-join', e.message || e);
      gameHooks?.showScreen?.('mp-join');
      const err = document.getElementById('mp-join-error');
      if (err) {
        err.textContent = e.message || 'Não foi possível entrar na sala';
        err.hidden = false;
      }
    }
  }

  function maybeOpenJoinFromUrl() {
    maybeJoinFromUrl();
  }

  function updateLobbyRoomChrome() {
    const wrap = document.getElementById('mp-lobby-room');
    const codeEl = document.getElementById('mp-lobby-room-code');
    const code = MP.getRoomCode();
    const onLobby = gameHooks?.getCurrentScreenId?.() === 'mp-lobby' && isInRoom();
    if (wrap) wrap.hidden = !onLobby || !code;
    if (codeEl && code) codeEl.textContent = code;
  }

  function updateGameFooter() {
    const bar = document.getElementById('mp-game-bar');
    const codeEl = document.getElementById('mp-game-room-code');
    if (!bar) return;
    const code = MP.getRoomCode();
    const show = isMultiplayer() && !!code;
    if (codeEl && code) codeEl.textContent = code;
    if (show && gameHooks?.getCurrentScreenId) {
      const screen = gameHooks.getCurrentScreenId();
      bar.hidden = !['game', 'age', 'question'].includes(screen);
    } else {
      bar.hidden = !show;
    }
    updateLobbyRoomChrome();
    if (show) {
      refreshPlayersUI().catch(() => {});
      refreshGameNickLabel().catch(() => {});
    }
  }

  function wireRealtimeCallbacks() {
    if (wireRealtimeCallbacks._ready) return;
    wireRealtimeCallbacks._ready = true;
    MP.setCallbacks({
      onStateChange: (state, settings, status) => {
        if (state?.sessionStartedAt) {
          applySessionStartedAt(state.sessionStartedAt, { resumeClock: false });
        }
        if (status === 'playing') {
          if (gameHooks?.getCurrentScreenId?.() === 'mp-lobby' && !lobbyReadyForGame) {
            pendingLobbyJoin = { gameState: state, settings: settings || {} };
            updateLobbyActionButtons('playing');
            return;
          }
          scheduleRemoteState(state, settings);
        }
      },
      onPlayersChange: renderPlayersUI,
      onHostChange: (nowHost) => {
        lastPlayersSnapshot = '';
        updateHostBadgeUI();
        MP.fetchRoom()
          .then((room) => updateLobbyActionButtons(room?.status || 'lobby'))
          .catch(() => updateLobbyActionButtons('lobby'));
        refreshGameNickLabel().catch(() => {});
        MP.refreshPlayers?.().catch(() => {});
        if (nowHost) showMpToast('👑 Agora és o anfitrião da sala.');
      },
      onRoomExpired: handleRoomExpired,
    });
  }

  async function refreshPlayersUI() {
    if (!isInRoom()) return;
    lastPlayersSnapshot = '';
    try {
      await MP.refreshPlayers?.();
    } catch { /* ignore */ }
  }

  async function initLobbyUI() {
    const startBtn = document.getElementById('mp-btn-start');
    const errEl = document.getElementById('mp-lobby-error');

    wireRealtimeCallbacks();

    updateHostBadgeUI();
    updateLobbyActionButtons('lobby');
    showMpError(errEl, '');

    try {
      await MP.syncHostFromServer?.();
      updateHostBadgeUI();
      lastPlayersSnapshot = '';
      const players = await MP.fetchPlayers();
      renderPlayersUI(players);
      const nickInput = document.getElementById('mp-lobby-nick');
      if (nickInput) {
        const myNick = await MP.getMyNickname();
        nickInput.value = myNick || global.PlayerNames?.generateRandomPlayerName?.() || '';
      }
    } catch (e) {
      showMpError(errEl, e.message);
    }

    updateLobbyRoomChrome();

    if (!lobbyUiReady) {
      document.getElementById('mp-btn-save-nick')?.addEventListener('click', async () => {
        const nickInput = document.getElementById('mp-lobby-nick');
        showMpError(errEl, '');
        const ok = await savePlayerNickname(nickInput?.value);
        if (!ok) showMpError(errEl, 'Introduz um nome');
      });

      startBtn?.addEventListener('click', async () => {
        showMpError(errEl, '');
        try {
          const settings = gameHooks?.getSettingsSnapshot?.() || {};
          await hostStartFromLobby(settings);
          active = true;
          lobbyReadyForGame = true;
          pendingLobbyJoin = null;
          saveLastRoom(MP.getRoomCode(), false);
          gameHooks?.showScreen?.('game');
        } catch (e) {
          showMpError(errEl, e.message || 'Erro ao iniciar');
        }
      });

      document.getElementById('mp-btn-join-game')?.addEventListener('click', () => {
        enterGameFromLobby();
      });

      lobbyUiReady = true;
    }
  }

  function wireMenuButtons() {
    document.getElementById('btn-mp-create')?.addEventListener('click', async () => {
      const err = document.getElementById('mp-create-error');
      showMpError(err, '');
      if (!MP.isConfigured()) {
        showMpError(err, 'Configura Supabase em supabase-config.js');
        gameHooks?.showScreen?.('mp-config');
        return;
      }
      try {
        await MP.ensureClient();
        if (MP.isActive()) {
          await MP.leaveRoom();
          clearRoomPause();
        }
        const settings = gameHooks?.getSettingsSnapshot?.() || {};
        const nick = global.PlayerNames?.getNicknameOrRandom?.() || '';
        await MP.createRoom(settings, nick);
        saveLastRoom(MP.getRoomCode(), false);
        active = true;
        clearRoomPause();
        await initLobbyUI();
        gameHooks?.showScreen?.('mp-lobby');
      } catch (e) {
        showMpError(err, e.message);
        gameHooks?.showScreen?.('mp-menu');
      }
    });

    document.getElementById('btn-mp-join')?.addEventListener('click', async () => {
      if (MP.isActive()) {
        await MP.leaveRoom();
        clearRoomPause();
      }
      active = false;
      const nickInput = document.getElementById('mp-join-nick');
      const codeInput = document.getElementById('mp-join-code');
      if (codeInput) {
        codeInput.value = '';
        delete codeInput.dataset.prefilled;
      }
      if (nickInput && !nickInput.value.trim()) {
        nickInput.value = global.PlayerNames?.getNicknameOrRandom?.() || '';
      }
      gameHooks?.showScreen?.('mp-join');
    });

    document.getElementById('btn-history')?.addEventListener('click', () => {
      renderHistoryList(document.getElementById('history-filter')?.value || 'all');
      gameHooks?.showScreen?.('history');
    });

    document.getElementById('mp-join-submit')?.addEventListener('click', async () => {
      const code = document.getElementById('mp-join-code')?.value?.trim();
      const nick = document.getElementById('mp-join-nick')?.value?.trim();
      const err = document.getElementById('mp-join-error');
      showMpError(err, '');
      if (!code) {
        showMpError(err, 'Introduz o código da sala');
        return;
      }
      if (!MP.isConfigured()) {
        showMpError(err, 'Configura Supabase em supabase-config.js');
        return;
      }
      try {
        await MP.ensureClient();
        if (MP.isActive()) {
          await MP.leaveRoom();
          clearRoomPause();
        }
        const name = nick || global.PlayerNames?.getNicknameOrRandom?.() || '';
        const result = await MP.joinRoom(code, name);
        await initLobbyUI();
        await enterRoomFromJoinResult(result);
      } catch (e) {
        showMpError(err, e.message || 'Sala não encontrada');
      }
    });

    document.getElementById('history-filter')?.addEventListener('change', (e) => {
      renderHistoryList(e.target.value);
    });

    document.querySelectorAll('[data-mp-back]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (isInRoom()) goToMenuKeepRoom();
        else gameHooks?.showScreen?.('menu');
      });
    });

    document.querySelectorAll('[data-mp-back-menu]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (isInRoom()) goToMenuKeepRoom();
        else gameHooks?.showScreen?.('menu');
      });
    });

    document.querySelectorAll('[data-mp-back-mp]').forEach((btn) => {
      btn.addEventListener('click', () => {
        gameHooks?.showScreen?.('mp-menu');
      });
    });

    document.getElementById('mp-btn-leave')?.addEventListener('click', () => {
      confirmLeaveRoomAndMenu();
    });

    document.getElementById('mp-game-menu-btn')?.addEventListener('click', () => {
      goToMenuKeepRoom();
    });

    document.getElementById('mp-game-leave-btn')?.addEventListener('click', () => {
      confirmLeaveRoomAndMenu();
    });
  }

  function onSinglePlayerStart() {
    if (isInRoom()) {
      saveLastRoom(MP.getRoomCode(), true);
      roomPaused = true;
    }
    if (GH.getCurrentGame()?.mode === 'multiplayer') {
      finishMultiplayerGame().catch(() => {});
    } else if (GH.getCurrentGame()) {
      GH.finishGame();
    }
    GH.startGame('single', {});
    active = false;
    updateContinueButton();
  }

  function onAnswerRevealed() {
    const h = gameHooks;
    const q = h?.getCurrentQuestion?.();
    const cat = h?.getLastCategory?.();
    const age = h?.getSelectedAgeBand?.();
    if (!q || !cat) return;
    const cur = GH.getCurrentGame();
    const last = cur?.rounds?.[cur.rounds.length - 1];
    const qPlain = (q.q || '').replace(/<[^>]*>/g, '');
    if (!last || last.question !== qPlain) {
      recordRoundFromQuestion(q, cat, age);
    }
  }

  function init() {
    wireMenuButtons();
    wireShareButtons();
    wirePlayersToggle();
    wireJoinCodeInput();
    wireNickRefreshButtons();
    wireRealtimeCallbacks();
    updateContinueButton();
    maybeOpenJoinFromUrl();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && isInRoom()) {
        refreshPlayersUI().catch(() => {});
      }
    });
  }

  global.MultiplayerController = {
    bindGame,
    init,
    isInRoom,
    isMultiplayer,
    isHost,
    canControl,
    onSinglePlayerStart,
    onAnswerRevealed,
    hostRollDice,
    syncCategoryPick,
    hostGoToAgeSelection,
    hostSelectAge,
    hostQuestionReady,
    hostBackToCategories,
    hostBackToDiceResult,
    recordRoundFromQuestion,
    applyRemoteState,
    pushState,
    buildGameState,
    serializeCategory,
    deserializeCategory,
    pushCountdownState,
    pushAnswerState,
    buildJoinUrl,
    copyJoinLink,
    shareViaWhatsApp,
    shareViaSms,
    shareNative,
    updateGameFooter,
    refreshPlayersUI,
    updateContinueButton,
    refreshContinueScreen,
    handleContinue,
    goToMenuKeepRoom,
    resumeRoomSession,
    leaveRoomAndMenu,
    getRoomCodeFromUrl,
  };
})(typeof window !== 'undefined' ? window : global);
