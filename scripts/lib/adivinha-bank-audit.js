'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const { buildAdivinhaDistractors, hasBadAdivinhaMcOptions } = require('./adivinha-distractors-node');

function loadQuestionEngine() {
  const publicDir = path.join(__dirname, '..', '..', 'public');
  const manifestSrc = fs.readFileSync(path.join(publicDir, 'question-engine/manifest.js'), 'utf8');
  const manifestSandbox = { globalThis: {} };
  vm.createContext(manifestSandbox);
  vm.runInContext(manifestSrc, manifestSandbox);
  const engineScripts = manifestSandbox.globalThis.QuestionEngineManifest.ENGINE_SCRIPT_PATHS;
  const sandbox = { globalThis: {}, window: {} };
  sandbox.window = sandbox.globalThis;
  vm.createContext(sandbox);
  for (const rel of engineScripts) {
    vm.runInContext(fs.readFileSync(path.join(publicDir, rel), 'utf8'), sandbox);
  }
  return sandbox.globalThis.QuestionEngine;
}

function stripTags(str) {
  return String(str || '').replace(/<[^>]*>/g, '').trim();
}

function normalizeQ(str) {
  return stripTags(str).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function parseOptions(raw) {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map(String) : null;
    } catch {
      return null;
    }
  }
  return null;
}

function needsAdivinhaOptionsFix(row, QE = null) {
  const engine = QE || loadQuestionEngine();
  const format = String(row.format || '').trim();
  const categoryN = Number(row.category_n);
  if (format !== 'ADIVINHA' && categoryN !== 20) return false;

  const options = parseOptions(row.options);
  const answer = String(row.correct_answer || row.correctAnswer || '').trim();
  if (!answer || !options || options.length !== 4) return true;
  if (hasBadAdivinhaMcOptions(options, answer, stripTags)) return true;

  const parsed = { q: row.question || row.q || '', a: answer, options };
  const check = engine.validateQuestion(parsed, {
    formatId: engine.FORMAT_IDS.ADIVINHA,
    ageBandKey: row.age_band || '10-15',
    categoryNumber: categoryN || 20,
    difficulty: 2,
    usedQuestions: [],
    usedAnswers: [],
    usedKnowledgeKeys: [],
    persistentKnowledgeKeys: [],
    isMC: true,
    stripTags,
    normalizeFn: normalizeQ,
    helpers: { stripTags, validateTrueFalseQuestion: () => ({ ok: true, issues: [] }), ageBandKey: row.age_band || '10-15' },
  });
  return !check.ok;
}

function buildFixedAdivinhaOptions(row, QE = null) {
  const engine = QE || loadQuestionEngine();
  const answer = String(row.correct_answer || row.correctAnswer || '').trim();
  const distractors = buildAdivinhaDistractors(answer, { normalizeFn: normalizeQ })
    || engine.buildAdivinhaDistractors?.(answer, { normalizeFn: normalizeQ });
  if (!distractors) return null;
  return engine.assembleMcOptions(answer, distractors);
}

module.exports = {
  loadQuestionEngine,
  stripTags,
  normalizeQ,
  parseOptions,
  needsAdivinhaOptionsFix,
  buildFixedAdivinhaOptions,
};
