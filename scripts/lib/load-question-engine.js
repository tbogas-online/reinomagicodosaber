'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const MANIFEST_REL = path.join('question-engine', 'manifest.js');

function hasEngineManifest(publicDir) {
  return Boolean(publicDir) && fs.existsSync(path.join(publicDir, MANIFEST_REL));
}

function walkForPublicDir(start) {
  let dir = path.resolve(start);
  for (let i = 0; i < 16; i += 1) {
    const candidate = path.join(dir, 'public');
    if (hasEngineManifest(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Resolve public/ even when Netlify copies the function into
 * .netlify/functions-serve/<name>/ (so __dirname is no longer scripts/lib).
 */
function resolvePublicDir(explicit) {
  if (hasEngineManifest(explicit)) return path.resolve(explicit);
  const starts = [];
  if (explicit) starts.push(explicit);
  starts.push(__dirname, process.cwd());
  if (process.env.LAMBDA_TASK_ROOT) starts.push(process.env.LAMBDA_TASK_ROOT);
  const seen = new Set();
  for (const start of starts) {
    const resolved = path.resolve(start);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    const found = walkForPublicDir(resolved);
    if (found) return found;
  }
  throw new Error(
    'Não encontrei public/question-engine/manifest.js (netlify functions-serve muda o __dirname).',
  );
}

function loadQuestionEngine(options = {}) {
  const publicDir = resolvePublicDir(options.publicDir);
  const manifestSrc = fs.readFileSync(path.join(publicDir, MANIFEST_REL), 'utf8');
  const manifestSandbox = { globalThis: {} };
  vm.createContext(manifestSandbox);
  vm.runInContext(manifestSrc, manifestSandbox);
  const engineScripts = manifestSandbox.globalThis.QuestionEngineManifest.ENGINE_SCRIPT_PATHS;
  const memStore = {};
  const sandbox = {
    globalThis: {},
    window: {},
    localStorage: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(memStore, k) ? memStore[k] : null),
      setItem: (k, v) => { memStore[k] = String(v); },
    },
  };
  sandbox.window = sandbox.globalThis;
  vm.createContext(sandbox);
  for (const rel of engineScripts) {
    vm.runInContext(fs.readFileSync(path.join(publicDir, rel), 'utf8'), sandbox);
  }
  vm.runInContext(
    fs.readFileSync(path.join(publicDir, 'question-engine/report-diagnosis.js'), 'utf8'),
    sandbox,
  );
  return {
    QE: sandbox.globalThis.QuestionEngine,
    Learning: sandbox.globalThis.QuestionEngineLearning,
    ReportDiagnosis: sandbox.globalThis.QuestionEngineReportDiagnosis,
  };
}

function stripTags(value) {
  return String(value || '').replace(/<[^>]*>/g, '').trim();
}

function normalizeQ(value) {
  return stripTags(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

module.exports = {
  loadQuestionEngine,
  resolvePublicDir,
  stripTags,
  normalizeQ,
};
