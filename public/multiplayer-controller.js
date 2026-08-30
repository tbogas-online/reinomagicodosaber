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
  const LAST_ROOM_KEY = 'reino_mp_last_room_v1';
  let applyingRemote = false;
  let gameHooks = null;
  let currentMatchId = null;

  function bindGame(hooks) {
    gameHooks = hooks;
  }

  function isInRoom() {
    return !!MP?.isActive();
  }

  function isMultiplayer() {
    return active && MP?.isActive() && !roomPaused;
  }

  function isHost() {
    return isMultiplayer() && MP.getIsHost();
  }

  function canControl() {
    return true;
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
      dice: extra?.dice || null,
      round: extra?.round ?? (GH.getCurrentGame()?.rounds?.length || 0),
      ...extra,
    };
  }

  async function pushState(extra) {
    if (!isMultiplayer()) return;
    const state = buildGameState(extra);
    const json = JSON.stringify(state);
    lastGameStateJson = json;
    MP.setLastGameStateJson(json);
    await MP.updateGameState(state);
  }

  let lastGameStateJson = '';

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
    if (!state || !gameHooks || applyingRemote) return;
    if (!options.resume && state.actorId && state.actorId === MP.getPlayerId()) return;
    applyingRemote = true;
    try {
      const h = gameHooks;
      if (settings && Object.keys(settings).length) {
        h.applySettings?.(settings);
      }
      if (state.gameCategoryMap) {
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
        h.fillCategoryList?.();
        h.resetGameScreenPartial?.();
        if (state.dice) {
          h.showDiceResult?.(state.dice.d1, state.dice.d2, lastCat, state.lastIsSurprise);
        }
        h.showScreen?.('game');
      } else if (state.screen === 'age') {
        h.fillCategoryList?.();
        if (state.dice) {
          h.showDiceResult?.(state.dice.d1, state.dice.d2, lastCat, state.lastIsSurprise);
        }
        h.showScreen?.('age');
      } else if (state.screen === 'question' && state.currentQuestion) {
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
      }
    } finally {
      applyingRemote = false;
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
      mpStorage()?.setItem(LAST_ROOM_KEY, JSON.stringify({
        code: String(code).toUpperCase(),
        paused: !!paused,
        at: Date.now(),
      }));
    } catch { /* ignore */ }
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
    updateContinueButton();
  }

  function canContinueLastRoom() {
    const saved = getLastRoom();
    if (!saved?.code) return false;
    if (isInRoom()) return roomPaused;
    return true;
  }

  function showMpToast(message, ms = 5000) {
    const toast = document.getElementById('mp-share-toast');
    if (!toast) return;
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(showMpToast._timer);
    showMpToast._timer = setTimeout(() => { toast.hidden = true; }, ms);
  }

  async function enterRoomFromJoinResult(result) {
    if (!result) return;
    saveLastRoom(result.code || MP.getRoomCode(), false);
    active = true;
    clearRoomPause();

    if (result.status === 'playing' && result.gameState) {
      await applyRemoteState(result.gameState, result.settings || {}, { resume: true });
      const screen = result.gameState.screen;
      gameHooks?.showScreen?.(
        screen === 'question' ? 'question' : screen === 'age' ? 'age' : 'game'
      );
    } else {
      const codeEl = document.getElementById('mp-room-code');
      if (codeEl) codeEl.textContent = MP.getRoomCode() || '----';
      try {
        renderPlayersUI(await MP.fetchPlayers());
      } catch { /* ignore */ }
      gameHooks?.showScreen?.('mp-lobby');
    }
    updateGameFooter();
    updateContinueButton();
  }

  function clearRoomPause() {
    roomPaused = false;
    updateContinueButton();
  }

  function updateContinueButton() {
    const btn = document.getElementById('btn-continuar');
    if (!btn) return;

    const mpCanContinue = canContinueLastRoom();
    const localCanContinue = !mpCanContinue && !!gameHooks?.canContinueLocal?.();

    if (mpCanContinue) {
      const saved = getLastRoom();
      const code = (MP.getRoomCode() || saved?.code || '----').toUpperCase();
      btn.disabled = false;
      btn.textContent = `📜 Continuar sala ${code}`;
      btn.title = 'Voltar à partida multijogador';
      return;
    }

    if (localCanContinue) {
      btn.disabled = false;
      btn.textContent = '📜 Continuar';
      btn.title = 'Continuar o jogo local';
      return;
    }

    btn.disabled = true;
    btn.textContent = '📜 Continuar';
    btn.title = 'Ainda não há jogo em curso';
  }

  function handleContinue() {
    if (canContinueLastRoom()) {
      resumeRoomSession();
      return;
    }
    gameHooks?.continueLocalGame?.();
  }

  function goToMenuKeepRoom() {
    if (!isInRoom()) {
      gameHooks?.showScreen?.('menu');
      return;
    }
    roomPaused = true;
    active = true;
    saveLastRoom(MP.getRoomCode(), true);
    updateContinueButton();
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
        await enterRoomFromJoinResult(result);
        return;
      }

      await MP.setConnected(true);
      await MP.syncHostFromServer?.();
      const room = await MP.fetchRoom();
      if (!room || room.expired) return;

      saveLastRoom(MP.getRoomCode(), false);
      if (room.status === 'lobby') {
        const codeEl = document.getElementById('mp-room-code');
        if (codeEl) codeEl.textContent = MP.getRoomCode() || '----';
        const players = await MP.fetchPlayers();
        renderPlayersUI(players);
        gameHooks?.showScreen?.('mp-lobby');
      } else if (room.status === 'playing' && room.game_state) {
        await applyRemoteState(room.game_state, room.settings || {}, { resume: true });
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

  function showMpExpiredToast() {
    showMpToast('A sala expirou por inatividade (24 horas).');
  }

  function handleRoomExpired() {
    if (GH.getCurrentGame()?.mode === 'multiplayer') GH.finishGame();
    active = false;
    clearLastRoom();
    clearRoomPause();
    gameHooks?.showScreen?.('menu');
    showMpExpiredToast();
  }

  async function leaveRoomAndMenu() {
    if (GH.getCurrentGame()?.mode === 'multiplayer') GH.finishGame();
    await MP.leaveRoom();
    active = false;
    clearLastRoom();
    clearRoomPause();
    gameHooks?.showScreen?.('menu');
  }

  async function hostStartFromLobby(settings) {
    if (!isHost() || !gameHooks) return;
    gameHooks.assignCategoriesForNewGame?.();
    gameHooks.startGameClock?.();
    currentMatchId = global.crypto?.randomUUID?.() || 'mp-' + Date.now();
    GH.startGame('multiplayer', { roomCode: MP.getRoomCode(), roomId: MP.getRoomId() });
    const state = buildGameState({ screen: 'game', status: 'playing' });
    await MP.startGame(state, settings || {});
    gameHooks.fillCategoryList?.();
    gameHooks.showScreen?.('game');
    renderPlayersUI(await MP.fetchPlayers());
    updateGameFooter();
  }

  async function hostRollDice(d1, d2) {
    if (!canControl()) return false;
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

  async function hostSelectAge(ageBand) {
    if (!canControl()) return false;
    gameHooks.setSelectedAgeBand?.(ageBand);
    if (isMultiplayer()) {
      await pushState({
        screen: 'age',
        selectedAgeBand: ageBand,
        lastCategory: serializeCategory(gameHooks.getLastCategory?.()),
        lastIsSurprise: !!gameHooks.getLastIsSurprise?.(),
      });
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
    gameHooks.resetGameScreen?.();
    if (isMultiplayer()) {
      await pushState({ screen: 'game', dice: null, currentQuestion: null });
    }
    gameHooks.showScreen?.('game');
  }

  function renderPlayersUI(players) {
    MP.syncHostFromPlayers?.(players);
    const hostBadge = document.getElementById('mp-host-badge');
    const startBtn = document.getElementById('mp-btn-start');
    if (hostBadge) hostBadge.hidden = !isHost();
    if (startBtn) startBtn.hidden = !isHost();

    const hostId = MP.getHostPlayerId?.() || null;
    const isPlayerHost = (p) => (hostId ? p.player_id === hostId : !!p.is_host);

    const count = (players || []).length;
    const connected = (players || []).filter((p) => p.is_connected).length;
    const countLabel = buildPlayerCountLabel(count, connected);
    const countEl = document.getElementById('mp-players-count');
    if (countEl) {
      countEl.textContent = count ? `👥 ${countLabel} — toca para ver nomes` : '';
    }

    const gameCountEl = document.getElementById('mp-game-players-count');
    if (gameCountEl) {
      gameCountEl.textContent = `👥 ${countLabel}`;
    }

    const gameList = document.getElementById('mp-game-players-list');
    fillPlayerRows(gameList, players, isPlayerHost);

    const list = document.getElementById('mp-players-list');
    fillPlayerRows(list, players, isPlayerHost);
    if (!list) return;
  }

  const renderLobbyPlayers = renderPlayersUI;

  function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  let lobbyPlayersOpen = false;
  let gamePlayersOpen = false;
  let gameNickOpen = false;

  async function savePlayerNickname(name) {
    const trimmed = String(name || '').trim().slice(0, 24);
    if (!trimmed) {
      showMpToast('Introduz um nome');
      return false;
    }
    try {
      await MP.updateNickname(trimmed);
      global.PlayerNames?.saveNickname?.(trimmed);
      renderPlayersUI(await MP.fetchPlayers());
      const label = document.getElementById('mp-game-nick-label');
      if (label) label.textContent = `✏️ ${trimmed}`;
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
        label.textContent = `✏️ ${nick}`;
        if (input) input.value = nick;
      }
    } catch { /* ignore */ }
  }

  async function confirmLeaveRoomAndMenu() {
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
    (players || []).forEach((p) => {
      const li = document.createElement('li');
      li.className = 'mp-player-row' + (p.is_connected ? '' : ' offline');
      li.innerHTML = `<span>${isPlayerHost(p) ? '👑 ' : ''}${escapeHtml(p.nickname)}</span>`
        + `<span class="mp-player-status">${p.is_connected ? '●' : '○'}</span>`;
      container.appendChild(li);
    });
  }

  function setLobbyPlayersOpen(open) {
    lobbyPlayersOpen = !!open;
    const countEl = document.getElementById('mp-players-count');
    const list = document.getElementById('mp-players-list');
    if (countEl) {
      countEl.classList.toggle('open', lobbyPlayersOpen);
      countEl.setAttribute('aria-expanded', lobbyPlayersOpen ? 'true' : 'false');
    }
    if (list) list.hidden = !lobbyPlayersOpen;
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
    const lobbyCount = document.getElementById('mp-players-count');
    const gameBtn = document.getElementById('mp-game-players-btn');

    const toggleLobby = (e) => {
      e?.preventDefault?.();
      setLobbyPlayersOpen(!lobbyPlayersOpen);
    };
    lobbyCount?.addEventListener('click', toggleLobby);
    lobbyCount?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleLobby(e);
      }
    });

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

  function renderHistoryList(filterMode) {
    const list = document.getElementById('history-games-list');
    if (!list || !GH) return;
    let games = GH.getGames();
    if (filterMode && filterMode !== 'all') {
      games = games.filter((g) => g.mode === filterMode);
    }
    list.innerHTML = '';
    if (!games.length) {
      list.innerHTML = '<p class="subtitle">Ainda não há partidas guardadas.</p>';
      return;
    }
    games.forEach((game) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'history-game-card';
      card.innerHTML = `<strong>${escapeHtml(GH.formatGameTitle(game))}</strong>`
        + `<span>${game.rounds.length} pergunta(s)</span>`;
      card.onclick = () => showHistoryDetail(game.id);
      list.appendChild(card);
    });
  }

  function showHistoryDetail(gameId) {
    const game = GH.getGame(gameId);
    const detail = document.getElementById('history-detail');
    const list = document.getElementById('history-games-list');
    if (!game || !detail) return;
    if (list) list.hidden = true;
    detail.hidden = false;
    detail.innerHTML = `<h3>${escapeHtml(GH.formatGameTitle(game))}</h3>`;
    game.rounds.forEach((r) => {
      const block = document.createElement('div');
      block.className = 'history-round-card';
      const opts = r.options?.length
        ? `<ul>${r.options.map((o) => `<li>${escapeHtml(o)}</li>`).join('')}</ul>`
        : '';
      block.innerHTML = `
        <div class="history-round-meta">#${r.round} · ${escapeHtml(r.category)} · ${escapeHtml(r.ageBand || '')}</div>
        <p class="history-q">${escapeHtml(r.question)}</p>
        <p class="history-a"><strong>Resposta:</strong> ${escapeHtml(r.correctAnswer)}</p>
        ${opts}`;
      detail.appendChild(block);
    });
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'btn secondary';
    back.textContent = '← Voltar à lista';
    back.style.marginTop = '16px';
    back.onclick = () => {
      detail.hidden = true;
      if (list) list.hidden = false;
    };
    detail.appendChild(back);
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
      ['mp-lobby-copy-link', copyJoinLink],
      ['mp-lobby-share-wa', shareViaWhatsApp],
      ['mp-lobby-share-native', shareNative],
      ['mp-game-copy-link', copyJoinLink],
      ['mp-game-share-wa', shareViaWhatsApp],
      ['mp-game-share-native', shareNative],
    ];
    pairs.forEach(([id, handler]) => {
      document.getElementById(id)?.addEventListener('click', (e) => {
        e.preventDefault();
        handler();
      });
    });
  }

  async function maybeJoinFromUrl() {
    const code = getRoomCodeFromUrl();
    if (!code || !MP.isConfigured() || !gameHooks) return;

    const codeInput = document.getElementById('mp-join-code');
    const nickInput = document.getElementById('mp-join-nick');
    if (codeInput) codeInput.value = code;
    if (nickInput && !nickInput.value.trim()) {
      nickInput.value = global.PlayerNames?.getNicknameOrRandom?.() || '';
    }

    try {
      await MP.ensureClient();
      const currentCode = (MP.getRoomCode() || '').toUpperCase();
      if (MP.isActive() && currentCode === code) {
        const players = await MP.fetchPlayers();
        renderPlayersUI(players);
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

  function updateGameFooter() {
    const bar = document.getElementById('mp-game-bar');
    const codeEl = document.getElementById('mp-game-room-code');
    if (!bar) return;
    const code = MP.getRoomCode();
    const show = isMultiplayer() && !!code;
    if (codeEl && code) codeEl.textContent = code;
    if (show && gameHooks?.getCurrentScreenId) {
      const screen = gameHooks.getCurrentScreenId();
      bar.hidden = !['game', 'age', 'question', 'mp-lobby'].includes(screen);
    } else {
      bar.hidden = !show;
    }
    if (show) {
      MP.fetchPlayers()
        .then((players) => renderPlayersUI(players))
        .catch(() => {});
      refreshGameNickLabel().catch(() => {});
    }
  }

  async function initLobbyUI() {
    const codeEl = document.getElementById('mp-room-code');
    const hostBadge = document.getElementById('mp-host-badge');
    const startBtn = document.getElementById('mp-btn-start');
    const errEl = document.getElementById('mp-lobby-error');

    MP.setCallbacks({
      onStateChange: (state, settings, status) => {
        if (status === 'playing') {
          applyRemoteState(state, settings);
        }
      },
      onPlayersChange: renderPlayersUI,
      onHostChange: (nowHost) => {
        if (hostBadge) hostBadge.hidden = !nowHost;
        if (startBtn) startBtn.hidden = !nowHost;
      },
      onRoomExpired: handleRoomExpired,
    });

    if (codeEl) codeEl.textContent = MP.getRoomCode() || '----';
    if (hostBadge) hostBadge.hidden = !isHost();
    if (startBtn) startBtn.hidden = !isHost();
    showMpError(errEl, '');

    try {
      await MP.syncHostFromServer?.();
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
          saveLastRoom(MP.getRoomCode(), false);
          gameHooks?.showScreen?.('game');
        } catch (e) {
          showMpError(errEl, e.message || 'Erro ao iniciar');
        }
      });

      lobbyUiReady = true;
    }
  }

  function wireMenuButtons() {
    document.getElementById('btn-mp-menu')?.addEventListener('click', () => {
      showMpError(document.getElementById('mp-create-error'), '');
      gameHooks?.showScreen?.('mp-menu');
    });

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
    if (GH.getCurrentGame()) GH.finishGame();
    GH.startGame('single', {});
    active = false;
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
    updateContinueButton();
    maybeOpenJoinFromUrl();
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
    hostSelectAge,
    hostQuestionReady,
    hostBackToCategories,
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
    updateContinueButton,
    handleContinue,
    goToMenuKeepRoom,
    resumeRoomSession,
    leaveRoomAndMenu,
    getRoomCodeFromUrl,
  };
})(typeof window !== 'undefined' ? window : global);
