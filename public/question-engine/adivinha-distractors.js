/**
 * Distractores de adivinhas — pool MemóriaMedia + validação MC.
 */
(function (global) {
  'use strict';

  const Issues = global.QuestionEngineIssues;
  const Pool = global.QuestionEngineAdivinhaAnswerPool;
  const ContentSafety = global.QuestionEngineContentSafety || global.QuestionEngineFamilySafeWords;
  if (!Issues) {
    throw new Error('adivinha-distractors: carrega issue-codes.js antes deste módulo');
  }

  const { mkIssue, ISSUE_LAYER } = Issues;

  const FALLBACK_NOUNS = Object.freeze([
    'Serra', 'Martelo', 'Chave', 'Vela', 'Relógio', 'Espelho', 'Pente', 'Anel', 'Agulha',
    'Gato', 'Cão', 'Rato', 'Pássaro', 'Peixe', 'Coelho', 'Abelha', 'Formiga', 'Girafa',
    'Sol', 'Lua', 'Estrela', 'Nuvem', 'Chuva', 'Vento', 'Fogo', 'Água', 'Neve',
    'Livro', 'Mesa', 'Cadeira', 'Porta', 'Janela', 'Cama', 'Colher', 'Faca', 'Garfo',
    'Barco', 'Comboio', 'Carro', 'Bicicleta', 'Árvore', 'Flor', 'Maçã', 'Pão', 'Ovo',
    'Noz', 'Sino', 'Cabra', 'Remo', 'Ginja', 'Carta', 'Cebola', 'Pinhões',
  ]);

  const BAD_OPTION_PATTERN = /\d|%|cerca de|aproximadamente|vértebra|vertebra|percentagem|milhões|milhoes|bilhões|bilhoes|graus celsius/i;

  function defaultNormalize(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  }

  function isPlausibleAdivinhaAnswer(text) {
    const t = String(text || '').trim();
    if (!t || t.length > 48) return false;
    if (BAD_OPTION_PATTERN.test(t)) return false;
    if (ContentSafety?.isOffensiveWord?.(t) || ContentSafety?.containsOffensiveLanguage?.(t)) return false;
    const words = t.split(/\s+/).filter(Boolean);
    if (words.length > 6) return false;
    if (words.length >= 4 && /,/.test(t)) return false;
    return true;
  }

  function isBadAdivinhaMcOption(text) {
    return !isPlausibleAdivinhaAnswer(text);
  }

  function wordCount(text) {
    return String(text || '').trim().split(/\s+/).filter(Boolean).length;
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function getAnswerPool() {
    const fromExport = Array.isArray(Pool) ? Pool.filter(isPlausibleAdivinhaAnswer) : [];
    const seen = new Set(fromExport.map((a) => defaultNormalize(a)));
    const merged = fromExport.slice();
    for (const item of FALLBACK_NOUNS) {
      const n = defaultNormalize(item);
      if (!n || seen.has(n)) continue;
      seen.add(n);
      merged.push(item);
    }
    return merged;
  }

  function buildAdivinhaDistractors(correctAnswer, options = {}) {
    const normalizeFn = typeof options.normalizeFn === 'function' ? options.normalizeFn : defaultNormalize;
    const correctNorm = normalizeFn(correctAnswer);
    if (!correctNorm) return null;

    const correctWords = wordCount(correctAnswer);
    const preferShort = correctWords <= 2;
    const candidates = getAnswerPool()
      .filter((item) => normalizeFn(item) !== correctNorm)
      .sort((a, b) => {
        const da = Math.abs(wordCount(a) - correctWords);
        const db = Math.abs(wordCount(b) - correctWords);
        if (preferShort && da !== db) return da - db;
        return a.length - b.length;
      });

    const picked = [];
    const seen = new Set([correctNorm]);
    for (const item of shuffle(candidates)) {
      const norm = normalizeFn(item);
      if (!norm || seen.has(norm) || !isPlausibleAdivinhaAnswer(item)) continue;
      seen.add(norm);
      picked.push(item);
      if (picked.length >= 3) break;
    }
    return picked.length >= 3 ? picked : null;
  }

  function validateAdivinhaMcDistractors(options, correctAnswer, stripTags) {
    const issues = [];
    const strip = typeof stripTags === 'function' ? stripTags : (s) => String(s || '').replace(/<[^>]*>/g, '').trim();
    const correct = strip(correctAnswer).trim().toLowerCase();
    const wrong = (options || [])
      .map((o) => strip(o).trim())
      .filter((o) => o.toLowerCase() !== correct);
    const bad = wrong.filter(isBadAdivinhaMcOption);
    if (bad.length) {
      issues.push(mkIssue(
        'ADIVINHA_MC_BAD_DISTRACTORS',
        ISSUE_LAYER.mcOptions,
        'distratores de adivinha inválidos — devem ser objectos ou palavras plausíveis, não números nem factos científicos',
      ));
    }
    return issues;
  }

  function hasBadAdivinhaMcOptions(options, correctAnswer, stripTags) {
    return validateAdivinhaMcDistractors(options, correctAnswer, stripTags).length > 0;
  }

  global.QuestionEngineAdivinhaDistractors = Object.freeze({
    BAD_OPTION_PATTERN,
    isPlausibleAdivinhaAnswer,
    isBadAdivinhaMcOption,
    buildAdivinhaDistractors,
    validateAdivinhaMcDistractors,
    hasBadAdivinhaMcOptions,
    getAnswerPool,
  });
})(typeof window !== 'undefined' ? window : globalThis);
