/**
 * Nomes de jogador aleatórios (tema do Reino Mágico) + preferência local.
 */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'reino_magico_player_nickname_v1';

  const ADJECTIVES = [
    'Corajoso', 'Sábio', 'Astuto', 'Veloz', 'Bravo', 'Curioso', 'Nobre', 'Alegre',
    'Misterioso', 'Destemido', 'Brilhante', 'Sagaz', 'Valente', 'Paciente',
  ];

  const NOUNS = [
    'Explorador', 'Mago', 'Cavaleiro', 'Dragão', 'Fada', 'Sábio', 'Guardião',
    'Aventureiro', 'Feiticeiro', 'Elfo', 'Pirata', 'Inventor', 'Herói', 'Oráculo',
  ];

  const COLORS = [
    'Azul', 'Dourado', 'Verde', 'Roxo', 'Carmesim', 'Prateado', 'Âmbar', 'Turquesa',
  ];

  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function generateRandomPlayerName() {
    const style = Math.floor(Math.random() * 4);
    if (style === 0) return `${pick(ADJECTIVES)} ${pick(NOUNS)}`;
    if (style === 1) return `${pick(NOUNS)} ${pick(COLORS)}`;
    if (style === 2) return `${pick(NOUNS)} ${100 + Math.floor(Math.random() * 900)}`;
    return `Aventureiro ${pick(COLORS)}`;
  }

  function getSavedNickname() {
    try {
      return (global.localStorage?.getItem(STORAGE_KEY) || '').trim();
    } catch {
      return '';
    }
  }

  function saveNickname(name) {
    const n = String(name || '').trim().slice(0, 24);
    if (!n) return '';
    try { global.localStorage?.setItem(STORAGE_KEY, n); } catch { /* ignore */ }
    return n;
  }

  function getNicknameOrRandom() {
    return getSavedNickname() || generateRandomPlayerName();
  }

  global.PlayerNames = {
    generateRandomPlayerName,
    getSavedNickname,
    saveNickname,
    getNicknameOrRandom,
    STORAGE_KEY,
  };
})(typeof window !== 'undefined' ? window : global);
