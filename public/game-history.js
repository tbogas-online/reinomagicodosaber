/**
 * Histórico de partidas visível ao jogador (separado do histórico interno do QuestionEngine).
 * Single-player: localStorage. Multiplayer: também espelhado no Supabase via MultiplayerSync.
 */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'reino_magico_game_history_v1';
  const MAX_GAMES = 60;

  function storage() {
    try { return global.localStorage; } catch { return null; }
  }

  function loadAll() {
    const s = storage();
    if (!s) return [];
    try {
      const raw = s.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function saveAll(games) {
    const s = storage();
    if (!s) return;
    try {
      s.setItem(STORAGE_KEY, JSON.stringify(games.slice(0, MAX_GAMES)));
    } catch { /* quota */ }
  }

  let currentGame = null;

  function newId() {
    if (global.crypto?.randomUUID) return global.crypto.randomUUID();
    return 'gh-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);
  }

  function startGame(mode, meta) {
    if (currentGame && !currentGame.finishedAt) {
      finishGame();
    }
    currentGame = {
      id: newId(),
      mode: mode === 'multiplayer' ? 'multiplayer' : 'single',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      roomCode: meta?.roomCode || null,
      roomId: meta?.roomId || null,
      rounds: [],
    };
    return currentGame;
  }

  function getCurrentGame() {
    return currentGame;
  }

  function addRound(round) {
    if (!currentGame) return null;
    const entry = {
      round: currentGame.rounds.length + 1,
      category: round.category || '',
      format: round.format || '',
      difficulty: round.difficulty || '',
      ageBand: round.ageBand || '',
      question: round.question || '',
      correctAnswer: round.correctAnswer || '',
      options: Array.isArray(round.options) ? round.options.slice() : null,
    };
    currentGame.rounds.push(entry);
    return entry;
  }

  function finishGame() {
    if (!currentGame) return null;
    if (currentGame.finishedAt) return currentGame;
    currentGame.finishedAt = new Date().toISOString();
    const games = loadAll();
    games.unshift({ ...currentGame, rounds: currentGame.rounds.slice() });
    saveAll(games);
    const done = currentGame;
    currentGame = null;
    return done;
  }

  function getGames() {
    return loadAll();
  }

  function getGame(id) {
    return loadAll().find((g) => g.id === id) || null;
  }

  function formatRoundSummary(round) {
    const q = (round.question || '').replace(/<[^>]*>/g, '');
    return q.length > 80 ? q.slice(0, 77) + '…' : q;
  }

  function formatGameTitle(game) {
    const date = game.startedAt ? new Date(game.startedAt) : new Date();
    const d = date.toLocaleDateString('pt-PT');
    const t = date.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
    const mode = game.mode === 'multiplayer' ? 'Multijogador' : 'Individual';
    const code = game.roomCode ? ` · ${game.roomCode}` : '';
    return `${mode}${code} · ${d} ${t}`;
  }

  global.GameHistory = {
    STORAGE_KEY,
    startGame,
    getCurrentGame,
    addRound,
    finishGame,
    getGames,
    getGame,
    formatRoundSummary,
    formatGameTitle,
  };
})(typeof window !== 'undefined' ? window : global);
