#!/usr/bin/env node
'use strict';

/**
 * Gera public/game-stats-engine.js e public/game-stats-adapters.js
 * a partir dos módulos Node em scripts/lib/.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ENGINE_SRC = path.join(ROOT, 'scripts/lib/game-stats-engine.js');
const ADAPTERS_SRC = path.join(ROOT, 'scripts/lib/game-stats-adapters.js');
const ENGINE_OUT = path.join(ROOT, 'public/game-stats-engine.js');
const ADAPTERS_OUT = path.join(ROOT, 'public/game-stats-adapters.js');

const ENGINE_EXPORTS = [
  'DEFAULT_PLAYER_ID',
  'normalizeText',
  'questionKey',
  'normalizeRound',
  'normalizeGame',
  'normalizeGames',
  'computeGameStats',
  'computeGamesSummary',
  'computePlayerStats',
  'computeCategoryStats',
  'computeAgeBandStats',
  'computeQuestionStats',
  'computeQuestionDifficulty',
  'computeStreaks',
  'computeMatchInsights',
  'computeGlobalInsights',
  'computeAllStats',
  'formatMatchLabel',
  'formatGameDateLabel',
  'resolvePlayerDisplayName',
  'buildPlayerNicknameMap',
];

function stripModuleExports(src) {
  return src
    .replace(/^#!.*\n/, '')
    .replace(/^'use strict';\s*\n/, '')
    .replace(/\nmodule\.exports\s*=\s*\{[\s\S]*\};\s*$/, '\n');
}

function buildEngine() {
  const body = stripModuleExports(fs.readFileSync(ENGINE_SRC, 'utf8'));
  const assign = ENGINE_EXPORTS.map((name) => `    ${name}`).join(',\n');
  return `/**
 * Game Stats Engine (V1) — browser bundle.
 * Gerado por scripts/build-game-stats-browser.js — não editar à mão.
 */
(function (global) {
'use strict';
${body}
  global.GameStatsEngine = {
${assign}
  };
})(typeof window !== 'undefined' ? window : global);
`;
}

function buildAdapters() {
  let body = stripModuleExports(fs.readFileSync(ADAPTERS_SRC, 'utf8'));
  body = body.replace(
    /const\s*\{[^}]+\}\s*=\s*require\('\.\/game-stats-engine'\);\s*\n/,
    'const { normalizeGames, DEFAULT_PLAYER_ID, normalizeText } = global.GameStatsEngine || {};\n',
  );
  body = body.replace(/\nmodule\.exports\s*=\s*\{[\s\S]*\};\s*$/, '\n');
  return `/**
 * Game Stats Adapters — browser bundle.
 * Gerado por scripts/build-game-stats-browser.js — não editar à mão.
 */
(function (global) {
'use strict';
${body}
  global.GameStatsAdapters = {
    fromGameHistory,
    fromSupabaseRows,
    fromSupabasePayload,
    mergeAnswerEventsIntoGames,
    enrichGamesWithAnswerEvents,
  };
})(typeof window !== 'undefined' ? window : global);
`;
}

fs.writeFileSync(ENGINE_OUT, buildEngine());
fs.writeFileSync(ADAPTERS_OUT, buildAdapters());
console.log('Game stats browser bundles escritos em public/');
