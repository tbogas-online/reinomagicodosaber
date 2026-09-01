/**
 * Montagem e baralhamento de opções MC (Fase 11).
 */
(function (global) {
  'use strict';

  const PromptBuilder = global.QuestionEnginePromptBuilder;
  if (!PromptBuilder) {
    throw new Error('mc-assembly: carrega prompt-builder.js antes deste módulo');
  }
  const { fisherYates } = PromptBuilder;

  function resolveMcPositionHistory(mcPositionHistory) {
    return Array.isArray(mcPositionHistory) ? mcPositionHistory : null;
  }

  function recordMcAnswerPosition(positionIndex, mcPositionHistory) {
    if (typeof positionIndex !== 'number' || positionIndex < 0) return;
    const history = resolveMcPositionHistory(mcPositionHistory);
    if (!history) return;
    history.push(positionIndex);
    if (history.length > 24) history.shift();
  }

  function resetMcPositions(mcPositionHistory) {
    const history = resolveMcPositionHistory(mcPositionHistory);
    if (history) history.length = 0;
  }

  function assembleMcOptions(correctAnswer, distractors) {
    const correct = String(correctAnswer || '').trim();
    const wrong = (Array.isArray(distractors) ? distractors : [])
      .map((d) => String(d || '').trim())
      .filter((d) => d && d.toLowerCase() !== correct.toLowerCase())
      .slice(0, 3);
    if (wrong.length < 3) return null;
    return fisherYates([correct, ...wrong]);
  }

  function shuffleMcOptions(options, correctAnswer, normalizeFn, mcPositionHistory) {
    if (!Array.isArray(options) || options.length < 2) return options;
    const norm = normalizeFn || ((s) => String(s || '').trim().toLowerCase());
    const correct = norm(correctAnswer);
    const shuffled = fisherYates(options.slice());
    let pos = shuffled.findIndex((o) => norm(o) === correct);
    if (pos < 0) return shuffled;

    const history = resolveMcPositionHistory(mcPositionHistory);
    const slotCount = Math.min(4, shuffled.length);
    if (history) {
      const posCounts = Array.from({ length: slotCount }, () => 0);
      history.forEach((p) => { if (p >= 0 && p < slotCount) posCounts[p] += 1; });
      const minCount = Math.min(...posCounts);
      const targetCandidates = posCounts
        .map((c, i) => (c === minCount ? i : -1))
        .filter((i) => i >= 0);
      const targetPos = targetCandidates[Math.floor(Math.random() * targetCandidates.length)];
      if (targetPos !== pos) {
        [shuffled[pos], shuffled[targetPos]] = [shuffled[targetPos], shuffled[pos]];
        pos = targetPos;
      }
      recordMcAnswerPosition(pos, history);
    }
    return shuffled;
  }

  global.QuestionEngineMcAssembly = {
    assembleMcOptions,
    shuffleMcOptions,
    recordMcAnswerPosition,
    resetMcPositions,
  };
})(typeof window !== 'undefined' ? window : globalThis);
