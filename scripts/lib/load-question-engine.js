'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadQuestionEngine(options = {}) {
  const publicDir = options.publicDir || path.join(__dirname, '..', '..', 'public');
  const manifestSrc = fs.readFileSync(path.join(publicDir, 'question-engine/manifest.js'), 'utf8');
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
  stripTags,
  normalizeQ,
};
