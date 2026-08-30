/**
 * Controlador multijogador + UI de salas e histórico.
 * Regista callbacks do jogo via MultiplayerController.bindGame(hooks).
 */
(function (global) {
  'use strict';

  const MP = global.MultiplayerSync;
  const GH = global.GameHistory;

  let active = false;
  let applyingRemote = false;
  let gameHooks = null;
  let currentMatchId = null;

  function bindGame(hooks) {
    gameHooks = hooks;
  }

  function isMultiplayer() {
    return active && MP?.isActive();
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

  async function applyRemoteState(state, settings) {
    if (!state || !gameHooks || applyingRemote) return;
    if (state.actorId && state.actorId === MP.getPlayerId()) return;
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
      const lastCat = deserializeCategory(state.lastCategory);
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
        h.setCurrentQuestion?.(state.currentQuestion);
        await h.displayQuestion?.(lastCat, state.lastIsSurprise, state.selectedAgeBand, state.currentQuestion);
      }
    } finally {
      applyingRemote = false;
    }
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
    renderLobbyPlayers(await MP.fetchPlayers());
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

  function renderLobbyPlayers(players) {
    const list = document.getElementById('mp-players-list');
    if (!list) return;
    list.innerHTML = '';
    (players || []).forEach((p) => {
      const li = document.createElement('li');
      li.className = 'mp-player-row' + (p.is_connected ? '' : ' offline');
      li.innerHTML = `<span>${p.is_host ? '👑 ' : ''}${escapeHtml(p.nickname)}</span>`
        + `<span class="mp-player-status">${p.is_connected ? '●' : '○'}</span>`;
      list.appendChild(li);
    });
  }

  function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
      onPlayersChange: renderLobbyPlayers,
      onHostChange: (nowHost) => {
        if (hostBadge) hostBadge.hidden = !nowHost;
        if (startBtn) startBtn.hidden = !nowHost;
      },
    });

    if (codeEl) codeEl.textContent = MP.getRoomCode() || '----';
    if (hostBadge) hostBadge.hidden = !isHost();
    if (startBtn) startBtn.hidden = !isHost();
    showMpError(errEl, '');

    try {
      const players = await MP.fetchPlayers();
      renderLobbyPlayers(players);
      const nickInput = document.getElementById('mp-lobby-nick');
      if (nickInput) {
        const myNick = await MP.getMyNickname();
        nickInput.value = myNick || global.PlayerNames?.getNicknameOrRandom?.() || '';
      }
    } catch (e) {
      showMpError(errEl, e.message);
    }

    document.getElementById('mp-btn-save-nick')?.addEventListener('click', async () => {
      const nickInput = document.getElementById('mp-lobby-nick');
      const name = nickInput?.value?.trim();
      if (!name) {
        showMpError(errEl, 'Introduz um nome');
        return;
      }
      showMpError(errEl, '');
      try {
        await MP.updateNickname(name);
        global.PlayerNames?.saveNickname?.(name);
        const players = await MP.fetchPlayers();
        renderLobbyPlayers(players);
      } catch (e) {
        showMpError(errEl, e.message || 'Erro ao guardar nome');
      }
    }, { once: false });

    startBtn?.addEventListener('click', async () => {
      showMpError(errEl, '');
      try {
        const settings = gameHooks?.getSettingsSnapshot?.() || {};
        await hostStartFromLobby(settings);
        active = true;
        gameHooks?.showScreen?.('game');
      } catch (e) {
        showMpError(errEl, e.message || 'Erro ao iniciar');
      }
    }, { once: false });
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
        const settings = gameHooks?.getSettingsSnapshot?.() || {};
        const nick = global.PlayerNames?.getNicknameOrRandom?.() || '';
        await MP.createRoom(settings, nick);
        global.PlayerNames?.saveNickname?.(nick);
        active = true;
        await initLobbyUI();
        gameHooks?.showScreen?.('mp-lobby');
      } catch (e) {
        showMpError(err, e.message);
        gameHooks?.showScreen?.('mp-menu');
      }
    });

    document.getElementById('btn-mp-join')?.addEventListener('click', () => {
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
        const name = nick || global.PlayerNames?.getNicknameOrRandom?.() || '';
        global.PlayerNames?.saveNickname?.(name);
        const result = await MP.joinRoom(code, name);
        active = true;
        await initLobbyUI();
        if (result.status === 'playing') {
          await applyRemoteState(result.gameState, result.settings);
          gameHooks?.showScreen?.(result.gameState?.screen === 'question' ? 'question' : 'game');
        } else {
          gameHooks?.showScreen?.('mp-lobby');
        }
      } catch (e) {
        showMpError(err, e.message || 'Sala não encontrada');
      }
    });

    document.getElementById('history-filter')?.addEventListener('change', (e) => {
      renderHistoryList(e.target.value);
    });

    document.querySelectorAll('[data-mp-back]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (MP.isActive()) await MP.leaveRoom();
        active = false;
        gameHooks?.showScreen?.('menu');
      });
    });

    document.querySelectorAll('[data-mp-back-menu]').forEach((btn) => {
      btn.addEventListener('click', () => {
        gameHooks?.showScreen?.('menu');
      });
    });

    document.querySelectorAll('[data-mp-back-mp]').forEach((btn) => {
      btn.addEventListener('click', () => {
        gameHooks?.showScreen?.('mp-menu');
      });
    });

    document.getElementById('mp-btn-leave')?.addEventListener('click', async () => {
      if (GH.getCurrentGame()?.mode === 'multiplayer') GH.finishGame();
      await MP.leaveRoom();
      active = false;
      gameHooks?.showScreen?.('menu');
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
    if (isMultiplayer()) {
      if (isHost()) recordRoundFromQuestion(q, cat, age);
    } else {
      const cur = GH.getCurrentGame();
      const last = cur?.rounds?.[cur.rounds.length - 1];
      const qPlain = (q.q || '').replace(/<[^>]*>/g, '');
      if (!last || last.question !== qPlain) {
        recordRoundFromQuestion(q, cat, age);
      }
    }
  }

  function init() {
    wireMenuButtons();
  }

  global.MultiplayerController = {
    bindGame,
    init,
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
  };
})(typeof window !== 'undefined' ? window : global);
