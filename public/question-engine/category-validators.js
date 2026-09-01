/**
 * Validadores de categoria — adequação tema×categoria (Fase 7f).
 */
(function (global) {
  'use strict';

  const Issues = global.QuestionEngineIssues;
  const Config = global.QuestionEngineConfig;
  if (!Issues || !Config) {
    throw new Error('category-validators: carrega issue-codes.js e engine-config.js antes deste módulo');
  }
  const { mkIssue, ISSUE_LAYER } = Issues;
  const { getAgeLimits, RE_TECH_TRANSPORT, RE_TECH_SPACE } = Config;

  function pushIssue(issues, code, layer, message) {
    issues.push(mkIssue(code, layer, message));
  }

  function pushCategoryMismatch(issues, message) {
    pushIssue(issues, 'CATEGORY_MISMATCH', ISSUE_LAYER.category, message);
  }

  function pushAgeHardIssue(issues, message) {
    pushIssue(issues, 'AGE_TOO_HARD', ISSUE_LAYER.age, message);
  }

function validateCategoryTopicFit(q, categoryN, ageBandKey) {
  const issues = [];
  const lim = getAgeLimits(ageBandKey);
  if (categoryN === 2 && /\b(homem|pessoa|astronauta).{0,40}\blua\b|\bprimeira\s+vez.{0,30}\blua\b|\bprimeiro\s+homem\b.*\blua\b/i.test(q)) {
    pushCategoryMismatch(issues, 'missão à Lua é Espaço/História, não Geografia');
  }
  if (categoryN === 17) {
    if (RE_TECH_TRANSPORT.test(q)) {
      pushCategoryMismatch(issues, 'veículos/transportes são Categoria 19 (Transportes), não Tecnologia');
    }
    if (RE_TECH_SPACE.test(q)) {
      pushCategoryMismatch(issues, 'espaço/foguetões são Categoria 6 (Espaço), não Tecnologia');
    }
  }
  if (lim.rejectMoonMission && /\b(homem|pessoa).{0,25}\blua\b|\bfoi\s+à\s+lua\b/i.test(q)) {
    pushAgeHardIssue(issues, 'missão à Lua demasiado avançada para 6–9');
  }
  if (categoryN === 5 && /\b(solidifica[çc][ãa]o|congelamento|fundir|derreter|evapora[çc][ãa]o|estados?\s+(f[íi]sicos?|da\s+mat[ée]ria)|l[íi]quido\s+ao\s+s[óo]lido)\b/i.test(q)) {
    pushCategoryMismatch(issues, 'fenómenos físicos da água/matéria são Ciência (4), não Natureza (5)');
  }
  return issues;
}
  global.QuestionEngineCategoryValidators = Object.freeze({
    validateCategoryTopicFit,
  });
})(typeof window !== 'undefined' ? window : globalThis);
