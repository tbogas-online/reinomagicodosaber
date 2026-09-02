#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const EXPORT_PATH = path.join(__dirname, '..', 'data', 'exports', 'memoriamedia-adivinhas.json');
const OUT_PUBLIC = path.join(__dirname, '..', 'public', 'question-engine', 'adivinha-answer-pool.js');
const OUT_LIB = path.join(__dirname, '..', 'scripts', 'lib', 'adivinha-answer-pool-data.js');

const BAD_PATTERN = /\d|%|cerca de|aproximadamente|vértebra|vertebra|percentagem|milhões|milhoes|bilhões|bilhoes/i;

function normalize(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

function isPlausibleAdivinhaAnswer(text) {
  const t = String(text || '').trim();
  if (!t || t.length > 48) return false;
  if (BAD_PATTERN.test(t)) return false;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length > 6) return false;
  if (words.length >= 4 && /,/.test(t)) return false;
  return true;
}

function buildPool() {
  const raw = JSON.parse(fs.readFileSync(EXPORT_PATH, 'utf8'));
  const seen = new Set();
  const pool = [];
  for (const item of raw.items || []) {
    const answer = String(item.answer || '').trim();
    if (!isPlausibleAdivinhaAnswer(answer)) continue;
    const n = normalize(answer);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    pool.push(answer);
  }
  pool.sort((a, b) => a.localeCompare(b, 'pt-PT'));
  return pool;
}

function writePoolFile(targetPath, pool, format) {
  const body = format === 'cjs'
    ? `'use strict';\n\nmodule.exports = ${JSON.stringify(pool, null, 2)};\n`
    : `(function (global) {
  'use strict';
  global.QuestionEngineAdivinhaAnswerPool = Object.freeze(${JSON.stringify(pool, null, 2)});
})(typeof window !== 'undefined' ? window : globalThis);
`;
  fs.writeFileSync(targetPath, body, 'utf8');
}

const pool = buildPool();
writePoolFile(OUT_PUBLIC, pool, 'browser');
writePoolFile(OUT_LIB, pool, 'cjs');
console.log(`Pool adivinhas: ${pool.length} respostas → ${OUT_PUBLIC}`);
