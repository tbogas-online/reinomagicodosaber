/**
 * Validadores de repetição — knowledgeKey, perguntas e respostas (Fase 7g).
 */
(function (global) {
  'use strict';

  const Issues = global.QuestionEngineIssues;
  const Config = global.QuestionEngineConfig;
  const KnowledgeKey = global.QuestionEngineKnowledgeKey;
  const FormatValidators = global.QuestionEngineFormatValidators;
  if (!Issues || !Config || !KnowledgeKey || !FormatValidators) {
    throw new Error('repetition-validators: carrega issue-codes.js, engine-config.js, knowledge-key.js e format-validators.js antes deste módulo');
  }
  const { mkIssue, ISSUE_LAYER } = Issues;
  const { FORMAT_IDS, ENGINE_CONFIG, isGenericTrueFalseAnswer, filterKnowledgeAnswers } = Config;
  const { stripFormatLabel } = FormatValidators;

  function pushIssue(issues, code, layer, message) {
    issues.push(mkIssue(code, layer, message));
  }

  function stripTagsInternal(text) {
    return String(text || '').replace(/<[^>]*>/g, '').trim();
  }

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9àáâãäåèéêëìíîïòóôõöùúûüçñ\s-]/gi, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

function jaccardSimilarity(a, b) {
  const sa = new Set(tokenize(a));
  const sb = new Set(tokenize(b));
  if (!sa.size || !sb.size) return 0;
  let inter = 0;
  for (const w of sa) if (sb.has(w)) inter++;
  return inter / (sa.size + sb.size - inter);
}

function stripTrueFalsePromptSuffix(q) {
  return String(q || '')
    .replace(/\s*\.?\s*verdadeiro\s+ou\s+falso\s*\??\s*$/i, '')
    .trim();
}

function normalizeForRepetitionCheck(q, formatId) {
  const body = stripFormatLabel(stripTagsInternal(q || ''));
  if (formatId === FORMAT_IDS.VERDADEIRO_FALSO) {
    return stripTrueFalsePromptSuffix(body);
  }
  return body;
}

function normalizeKnowledgeKeyForMatch(key, normalizeFn) {
  const norm = normalizeFn || ((s) => String(s || '').trim().toLowerCase());
  return norm(stripTrueFalsePromptSuffix(norm(key)));
}

function collectRepetitionIssues(q, a, formatId, ctx, normalizeFn) {
  const issues = [];
  const knowledgeMeta = ctx.knowledgeMeta || KnowledgeKey.parseKnowledgeMeta(ctx.parsed) || null;
  const keyOpts = {
    knowledgeMeta,
    categoryNumber: ctx.categoryNumber,
  };
  const knowledgeKey = ctx.knowledgeKey || (typeof ctx.computeKnowledgeKey === 'function' ? ctx.computeKnowledgeKey(q, a, formatId, normalizeFn, keyOpts) : '');
  const recentKeys = [...(ctx.usedKnowledgeKeys || []), ...(ctx.persistentKnowledgeKeys || [])];
  if (typeof ctx.knowledgeKeysMatch === 'function' && recentKeys.some((k) => ctx.knowledgeKeysMatch(k, knowledgeKey, normalizeFn))) {
    pushIssue(issues, 'KNOWLEDGE_REPEATED', ISSUE_LAYER.repetition, 'conhecimento já testado recentemente (knowledgeKey)');
  }
  const recentKnowledgeIds = [...(ctx.usedKnowledgeIds || []), ...(ctx.persistentKnowledgeIds || [])]
    .map((id) => String(id || '').trim())
    .filter(Boolean);
  const recordId = String(ctx.repositoryRecord?.knowledgeId || ctx.parsed?.knowledgeId || '').trim();
  if (recordId && recentKnowledgeIds.includes(recordId)) {
    pushIssue(issues, 'KNOWLEDGE_ID_REPEATED', ISSUE_LAYER.repetition, 'facto do repositório já usado recentemente (knowledgeId)');
  }
  const blockedKnowledgeIds = (ctx.blockedKnowledgeIds || [])
    .map((id) => String(id || '').trim())
    .filter(Boolean);
  if (recordId && blockedKnowledgeIds.includes(recordId)) {
    pushIssue(issues, 'KNOWLEDGE_REPORTED', ISSUE_LAYER.repetition, 'facto reportado — só pode voltar após correcção');
  }
  const blockedHashes = (ctx.blockedQuestionHashes || [])
    .map((h) => String(h || '').trim())
    .filter(Boolean);
  const questionHash = String(ctx.questionHash || '').trim();
  if (questionHash && blockedHashes.includes(questionHash)) {
    pushIssue(issues, 'QUESTION_REPORTED', ISSUE_LAYER.repetition, 'pergunta reportada — só pode voltar após correcção');
  }
  const blockedNorms = (ctx.blockedQuestionNorms || [])
    .map((n) => String(n || '').trim())
    .filter(Boolean);
  const qNormForReport = normalizeFn
    ? normalizeFn(normalizeForRepetitionCheck(q, formatId))
    : normalizeForRepetitionCheck(q, formatId).toLowerCase();
  if (qNormForReport && blockedNorms.includes(qNormForReport)) {
    pushIssue(issues, 'QUESTION_REPORTED', ISSUE_LAYER.repetition, 'pergunta reportada — só pode voltar após correcção');
  }
  for (const prev of (ctx.usedQuestions || []).slice(-8)) {
    const qNorm = normalizeForRepetitionCheck(q, formatId);
    const prevNorm = normalizeForRepetitionCheck(prev, formatId);
    if (jaccardSimilarity(qNorm, prevNorm) >= ENGINE_CONFIG.QUESTION_JACCARD_THRESHOLD) {
      pushIssue(issues, 'QUESTION_SIMILAR', ISSUE_LAYER.repetition, 'pergunta semelhante a uma recente');
      break;
    }
  }
  const skipAnswerHistory = formatId === FORMAT_IDS.VERDADEIRO_FALSO || isGenericTrueFalseAnswer(a, normalizeFn);
  if (!skipAnswerHistory) {
    const normA = normalizeFn ? normalizeFn(a) : a.toLowerCase();
    const recentA = filterKnowledgeAnswers(ctx.usedAnswers || [], normalizeFn)
      .map((x) => (normalizeFn ? normalizeFn(x) : x.toLowerCase()));
    if (normA && recentA.includes(normA)) {
      pushIssue(issues, 'ANSWER_REPEATED', ISSUE_LAYER.repetition, 'resposta já usada recentemente');
    }
  }
  return { issues, knowledgeKey };
}
  global.QuestionEngineRepetitionValidators = Object.freeze({
    tokenize,
    jaccardSimilarity,
    stripTrueFalsePromptSuffix,
    normalizeForRepetitionCheck,
    normalizeKnowledgeKeyForMatch,
    collectRepetitionIssues,
  });
})(typeof window !== 'undefined' ? window : globalThis);
