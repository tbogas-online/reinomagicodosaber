/**
 * Ordem de carregamento dos módulos do QuestionEngine (Fase 16).
 * Usado pelo harness de testes; no browser, index.html mantém <script> explícitos com cache-bust.
 */
(function (global) {
  'use strict';

  const ENGINE_SCRIPT_PATHS = Object.freeze([
    'question-engine/engine-config.js',
    'question-engine/issue-codes.js',
    'question-engine/knowledge-key.js',
    'question-engine/retry-strategy.js',
    'question-engine/telemetry.js',
    'question-engine/known-facts.js',
    'question-engine/factual-verify.js',
    'question-engine/adivinha-verify.js',
    'question-engine/adivinha-answer-pool.js',
    'question-engine/adivinha-distractors.js',
    'question-engine/difficulty-estimate.js',
    'question-engine/pt-pt-validators.js',
    'question-engine/format-validators.js',
    'question-engine/mc-validators.js',
    'question-engine/age-validators.js',
    'question-engine/category-validators.js',
    'question-engine/semantic-validators.js',
    'question-engine/reported-content.js',
    'question-engine/repetition-validators.js',
    'question-engine/knowledge-key-compute.js',
    'question-engine/persistent-history.js',
    'question-engine/prompt-builder.js',
    'question-engine/mc-assembly.js',
    'question-engine/question-scoring.js',
    'question-engine.js',
  ]);

  global.QuestionEngineManifest = {
    ENGINE_SCRIPT_PATHS,
  };
})(typeof window !== 'undefined' ? window : globalThis);
