/**
 * @deprecated Usa QuestionEngineContentSafety — mantido para compatibilidade de carregamento.
 */
(function (global) {
  'use strict';
  if (!global.QuestionEngineContentSafety) {
    throw new Error('family-safe-words: carrega content-safety.js antes deste módulo');
  }
  global.QuestionEngineFamilySafeWords = global.QuestionEngineContentSafety;
})(typeof window !== 'undefined' ? window : globalThis);
