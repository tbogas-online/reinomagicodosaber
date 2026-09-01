/**
 * Estratégia de retry adaptativo — Fase 3 (usa issue codes da Fase 1).
 */
(function (global) {
  'use strict';

  const Issues = global.QuestionEngineIssues;
  if (!Issues) {
    throw new Error('QuestionEngineRetry: carrega question-engine/issue-codes.js antes de retry-strategy.js');
  }

  const {
    normalizeIssues, buildRetryHintFromIssues, ISSUE_LAYER, issueCode,
  } = Issues;

  const REPETITION_CODES = new Set([
    'KNOWLEDGE_REPEATED',
    'QUESTION_SIMILAR',
    'ANSWER_REPEATED',
    'QUESTION_REPEATED',
  ]);

  const STRUCTURE_CODES = new Set([
    'STRUCTURE_INCOMPLETE',
    'STRUCTURE_MISSING_Q',
    'STRUCTURE_MISSING_A',
  ]);

  function hasRepetitionFailure(details) {
    return details.some((d) => REPETITION_CODES.has(d.code) || d.layer === ISSUE_LAYER.repetition);
  }

  function hasStructureFailure(details) {
    return details.some((d) => STRUCTURE_CODES.has(d.code) || d.layer === ISSUE_LAYER.structural);
  }

  function hasMcFailure(details) {
    return details.some((d) => d.layer === ISSUE_LAYER.mcOptions || /^MC_/.test(d.code || ''));
  }

  function shouldRotateSubtopic(issueDetails, attempt) {
    if (attempt < 2) return false;
    return hasRepetitionFailure(normalizeIssues(issueDetails));
  }

  function buildAdaptiveRetryHint(issues, formatId, ageBandKey, attempt, deps) {
    const base = buildRetryHintFromIssues(issues, formatId, ageBandKey, deps);
    const details = normalizeIssues(deps?.issueDetails || issues);
    const extras = [];

    if (attempt >= 2 && hasRepetitionFailure(details)) {
      extras.push(`TENTATIVA ${attempt}: escolhe outro SUBTÓPICO dentro da mesma categoria.`);
    }
    if (attempt >= 3 && hasRepetitionFailure(details)) {
      extras.push('Muda completamente de conhecimento — usa entity e concept diferentes no campo knowledge.');
    }
    if (attempt >= 2 && hasMcFailure(details)) {
      extras.push('Regenera os 3 distractores — mantém a resposta correcta mas muda todas as opções erradas.');
    }
    if (attempt >= 4 && details.some((d) => d.layer === ISSUE_LAYER.format || d.layer === ISSUE_LAYER.category)) {
      extras.push('Reformula com outro ângulo dentro da categoria; evita repetir a mesma estrutura.');
    }
    if (attempt >= 2 && hasStructureFailure(details)) {
      extras.push('Devolve JSON completo e válido — não omitas campos obrigatórios.');
    }

    if (!extras.length) return base;
    return `${base}\n${extras.join('\n')}`;
  }

  global.QuestionEngineRetry = Object.freeze({
    REPETITION_CODES,
    hasRepetitionFailure,
    shouldRotateSubtopic,
    buildAdaptiveRetryHint,
  });
})(typeof window !== 'undefined' ? window : globalThis);
