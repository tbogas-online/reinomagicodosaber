/**
 * Nomes de jogador aleatórios (tema do Reino Mágico) + preferência local opcional.
 */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'reino_magico_player_nickname_v1';
  const RECENT_KEY = 'reino_magico_recent_names_v1';
  const RECENT_MAX = 12;

  const ADJECTIVES = [
    'Corajoso', 'Sábio', 'Astuto', 'Veloz', 'Bravo', 'Curioso', 'Nobre', 'Alegre',
    'Misterioso', 'Destemido', 'Brilhante', 'Sagaz', 'Valente', 'Paciente', 'Audaz',
    'Gentil', 'Feroz', 'Calmo', 'Saltitante', 'Sonhador', 'Risonho', 'Discreto',
    'Intrépido', 'Cauteloso', 'Lendário', 'Pequeno', 'Grande', 'Feliz', 'Ziguezague',
  ];

  const NOUNS = [
    'Explorador', 'Mago', 'Cavaleiro', 'Dragão', 'Fada', 'Guardião', 'Aventureiro',
    'Feiticeiro', 'Elfo', 'Pirata', 'Inventor', 'Herói', 'Oráculo', 'Arqueiro',
    'Bardo', 'Alquimista', 'Domador', 'Navegador', 'Cartógrafo', 'Paladino',
    'Druida', 'Gnomo', 'Fénix', 'Grifo', 'Sereia', 'Trovador', 'Mensageiro',
  ];

  const COLORS = [
    'Azul', 'Dourado', 'Verde', 'Roxo', 'Carmesim', 'Prateado', 'Âmbar', 'Turquesa',
    'Rubi', 'Esmeralda', 'Índigo', 'Coral', 'Violeta', 'Bronze', 'Neve', 'Obsidiana',
  ];

  const PLACES = [
    'do Vale', 'da Torre', 'do Bosque', 'do Castelo', 'da Ilha', 'do Norte',
    'das Estrelas', 'do Lago', 'da Montanha', 'do Portal', 'da Aurora', 'do Reino',
  ];

  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function pickDistinct(arr, count) {
    const copy = arr.slice();
    const out = [];
    while (out.length < count && copy.length) {
      const i = Math.floor(Math.random() * copy.length);
      out.push(copy.splice(i, 1)[0]);
    }
    return out;
  }

  function randomDigits() {
    return String(10 + Math.floor(Math.random() * 990));
  }

  function getRecentNames() {
    try {
      const raw = global.sessionStorage?.getItem(RECENT_KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  function rememberRecentName(name) {
    const n = String(name || '').trim();
    if (!n) return;
    try {
      const list = getRecentNames().filter((x) => x !== n);
      list.unshift(n);
      global.sessionStorage?.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX)));
    } catch { /* ignore */ }
  }

  function generateRandomPlayerName() {
    const recent = new Set(getRecentNames());
    for (let attempt = 0; attempt < 24; attempt++) {
      const style = Math.floor(Math.random() * 6);
      let name;
      if (style === 0) {
        name = `${pick(ADJECTIVES)} ${pick(NOUNS)}`;
      } else if (style === 1) {
        const [a, b] = pickDistinct(ADJECTIVES, 2);
        name = `${a} ${b} ${pick(NOUNS)}`;
      } else if (style === 2) {
        name = `${pick(NOUNS)} ${pick(COLORS)}`;
      } else if (style === 3) {
        name = `${pick(NOUNS)} ${pick(PLACES)}`;
      } else if (style === 4) {
        name = `${pick(ADJECTIVES)} ${pick(NOUNS)} ${randomDigits()}`;
      } else {
        name = `${pick(NOUNS)} ${pick(COLORS)} ${randomDigits()}`;
      }
      name = name.slice(0, 24);
      if (!recent.has(name)) {
        rememberRecentName(name);
        return name;
      }
    }
    const fallback = `${pick(ADJECTIVES)} ${pick(NOUNS)} ${Date.now() % 10000}`;
    const name = fallback.slice(0, 24);
    rememberRecentName(name);
    return name;
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

  /** Sempre gera um nome novo — não reutiliza o guardado automaticamente. */
  function getNicknameOrRandom() {
    return generateRandomPlayerName();
  }

  global.PlayerNames = {
    generateRandomPlayerName,
    getSavedNickname,
    saveNickname,
    getNicknameOrRandom,
    STORAGE_KEY,
  };
})(typeof window !== 'undefined' ? window : global);
