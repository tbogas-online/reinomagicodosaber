'use strict';

const pool = require('./adivinha-answer-pool-data');
const { isOffensiveWord, containsOffensiveLanguage } = require('./family-safe-words-node');

const BAD_OPTION_PATTERN = /\d|%|cerca de|aproximadamente|vértebra|vertebra|percentagem|milhões|milhoes|bilhões|bilhoes|graus celsius/i;

const FALLBACK_NOUNS = [
  'Serra', 'Martelo', 'Chave', 'Vela', 'Relógio', 'Espelho', 'Pente', 'Anel', 'Agulha',
  'Gato', 'Cão', 'Rato', 'Pássaro', 'Peixe', 'Coelho', 'Abelha', 'Formiga', 'Girafa',
  'Noz', 'Sino', 'Cabra', 'Remo', 'Ginja', 'Carta', 'Cebola', 'Pinhões',
];

function defaultNormalize(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

function isPlausibleAdivinhaAnswer(text) {
  const t = String(text || '').trim();
  if (!t || t.length > 48) return false;
  if (BAD_OPTION_PATTERN.test(t)) return false;
  if (isOffensiveWord(t) || containsOffensiveLanguage(t)) return false;
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
  const fromExport = Array.isArray(pool) ? pool.filter(isPlausibleAdivinhaAnswer) : [];
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

function hasBadAdivinhaMcOptions(options, correctAnswer, stripTags) {
  const strip = typeof stripTags === 'function' ? stripTags : (s) => String(s || '').replace(/<[^>]*>/g, '').trim();
  const correct = strip(correctAnswer).trim().toLowerCase();
  const wrong = (options || [])
    .map((o) => strip(o).trim())
    .filter((o) => o.toLowerCase() !== correct);
  return wrong.some(isBadAdivinhaMcOption);
}

function assembleMcOptions(correctAnswer, distractors) {
  const correct = String(correctAnswer || '').trim();
  const wrong = (Array.isArray(distractors) ? distractors : [])
    .map((d) => String(d || '').trim())
    .filter((d) => d && defaultNormalize(d) !== defaultNormalize(correct))
    .slice(0, 3);
  if (wrong.length < 3) return null;
  const opts = [correct, ...wrong];
  for (let i = opts.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [opts[i], opts[j]] = [opts[j], opts[i]];
  }
  return opts;
}

module.exports = {
  buildAdivinhaDistractors,
  hasBadAdivinhaMcOptions,
  isPlausibleAdivinhaAnswer,
  assembleMcOptions,
};
