/**
 * Motor de perguntas — formatos, matriz categoria×formato, prompts em camadas e validação.
 */
(function (global) {
  'use strict';

  const Issues = global.QuestionEngineIssues;
  const KnowledgeKey = global.QuestionEngineKnowledgeKey;
  const Retry = global.QuestionEngineRetry;
  const Telemetry = global.QuestionEngineTelemetry;
  const KnownFacts = global.QuestionEngineKnownFacts;
  const FactualVerify = global.QuestionEngineFactualVerify;
  const AdivinhaVerify = global.QuestionEngineAdivinhaVerify;
  const DifficultyEstimate = global.QuestionEngineDifficultyEstimate;
  if (!Issues || !KnowledgeKey || !Retry || !Telemetry || !KnownFacts || !FactualVerify || !AdivinhaVerify || !DifficultyEstimate) {
    throw new Error('QuestionEngine: carrega issue-codes.js, knowledge-key.js, retry-strategy.js, telemetry.js, known-facts.js, factual-verify.js, adivinha-verify.js e difficulty-estimate.js antes de question-engine.js');
  }
  const {
    mkIssue, issueMessage, issueCode, normalizeIssues, issueMessages,
    buildRetryHintFromIssues, ISSUE_LAYER,
  } = Issues;

  function pushIssue(arr, code, layer, message) {
    arr.push(mkIssue(code, layer, message));
  }

  function pushAgeHardIssue(issues, message) {
    pushIssue(issues, 'AGE_TOO_HARD', ISSUE_LAYER.age, message);
  }

  function pushPtBrIssue(issues, message) {
    pushIssue(issues, 'PT_BRASILISM', ISSUE_LAYER.ptPt, message);
  }



  function pushFormatViolation(issues, message) {
    pushIssue(issues, 'FORMAT_VIOLATION', ISSUE_LAYER.format, message);
  }

  const Config = global.QuestionEngineConfig;
  if (!Config) {
    throw new Error('QuestionEngine: carrega engine-config.js antes de question-engine.js');
  }
  const {
    ENGINE_CONFIG,
    LAYER_WEIGHTS,
    TRUE_FALSE_CHANCE,
    TRUE_FALSE_MIN_GAP,
    FORMAT_MAX_CONSECUTIVE,
    FORMAT_IDS,
    FORMAT_LABELS,
    FORMAT_AGE_EXCLUDED,
    ANSWER_MODE_OPEN_ONLY,
    ANSWER_MODE_MC_ONLY,
    DIFFICULTY_RANGE,
    DIFFICULTY_LABELS,
    AGE_LIMITS_BASE,
    AGE_LIMITS,
    getAgeLimits,
    isHardHistoricalWhenQuestion,
    CATEGORIES_RAW,
    CATEGORIES,
    getCategoryDef,
    filterFormatsForContext,
    defaultFormatForAnswerMode,
    isGenericTrueFalseAnswer,
    filterKnowledgeAnswers,
    RE_CJK,
    RE_CYRILLIC,
    RE_ARABIC,
    RE_MIXED_LATIN_CJK,
    RE_MIXED_WORD,
    RE_BRASILEIRISMO,
    RE_TECH_TRANSPORT,
    RE_TECH_SPACE,
  } = Config;
  const PtPt = global.QuestionEnginePtPt;
  if (!PtPt) {
    throw new Error('QuestionEngine: carrega pt-pt-validators.js antes de question-engine.js');
  }
  const {
    hasInvalidScript,
    validateCountryNamesPt,
    validatePortugueseNotEnglish,
    validatePortugueseText,
    collectPtPtIssues,
  } = PtPt;

  const FormatValidators = global.QuestionEngineFormatValidators;
  if (!FormatValidators) {
    throw new Error('QuestionEngine: carrega format-validators.js antes de question-engine.js');
  }
  const {
    stripFormatLabel,
    looksLikeWhenQuestion,
    validateByFormat,
    validateAdivinhaClues,
  } = FormatValidators;

  const McValidators = global.QuestionEngineMcValidators;
  if (!McValidators) {
    throw new Error('QuestionEngine: carrega mc-validators.js antes de question-engine.js');
  }
  const {
    collapseOptionKey,
    validateMcOptionsQuality,
    collectMcIssues: collectMcIssuesCore,
  } = McValidators;

  const AgeValidators = global.QuestionEngineAgeValidators;
  if (!AgeValidators) {
    throw new Error('QuestionEngine: carrega age-validators.js antes de question-engine.js');
  }
  const {
    validateAgeAppropriate,
    validateObscureCharacter,
  } = AgeValidators;

  const CategoryValidators = global.QuestionEngineCategoryValidators;
  if (!CategoryValidators) {
    throw new Error('QuestionEngine: carrega category-validators.js antes de question-engine.js');
  }
  const { validateCategoryTopicFit } = CategoryValidators;

  const SemanticValidators = global.QuestionEngineSemanticValidators;
  if (!SemanticValidators) {
    throw new Error('QuestionEngine: carrega semantic-validators.js antes de question-engine.js');
  }
  const {
    validateAdivinhaMcAmbiguity,
    collectSemanticIssues: collectSemanticIssuesCore,
  } = SemanticValidators;

  const RepetitionValidators = global.QuestionEngineRepetitionValidators;
  if (!RepetitionValidators) {
    throw new Error('QuestionEngine: carrega repetition-validators.js antes de question-engine.js');
  }
  const {
    tokenize,
    jaccardSimilarity,
    stripTrueFalsePromptSuffix,
    normalizeKnowledgeKeyForMatch,
    collectRepetitionIssues: collectRepetitionIssuesCore,
  } = RepetitionValidators;

  const PersistentHistory = global.QuestionEnginePersistentHistory;
  if (!PersistentHistory) {
    throw new Error('QuestionEngine: carrega persistent-history.js antes de question-engine.js');
  }

  const PromptBuilder = global.QuestionEnginePromptBuilder;
  if (!PromptBuilder) {
    throw new Error('QuestionEngine: carrega prompt-builder.js antes de question-engine.js');
  }
  const {
    buildGlobalRules,
    buildFormatRules,
    fisherYates,
    chooseDifficulty,
    chooseSubtopic,
    getAllowedFormats,
    chooseFormat,
    buildPrompt,
  } = PromptBuilder;

  const QuestionScoring = global.QuestionEngineQuestionScoring;
  if (!QuestionScoring) {
    throw new Error('QuestionEngine: carrega question-scoring.js antes de question-engine.js');
  }
  const {
    scoreQuestion,
    validateSemanticQuality,
    validateQuestion,
  } = QuestionScoring;

  function collectRepetitionIssues(q, a, formatId, ctx, normalizeFn) {
    return collectRepetitionIssuesCore(q, a, formatId, {
      ...ctx,
      computeKnowledgeKey,
      knowledgeKeysMatch,
    }, normalizeFn);
  }

  function collectSemanticIssues(parsed, ctx) {
    return collectSemanticIssuesCore(parsed, {
      ...ctx,
      runReportedFactRules,
      validateObscureCharacter,
    });
  }

  function collectMcIssues(parsed, ctx) {
    return collectMcIssuesCore(parsed, {
      ...ctx,
      adivinhaMcAmbiguity: validateAdivinhaMcAmbiguity,
    });
  }

  const KNOWLEDGE_STOPWORDS = new Set([
    'qual', 'quais', 'que', 'quem', 'como', 'onde', 'quando', 'porque', 'porquê',
    'o', 'a', 'os', 'as', 'um', 'uma', 'uns', 'umas', 'de', 'do', 'da', 'dos', 'das',
    'em', 'no', 'na', 'nos', 'nas', 'por', 'para', 'com', 'sem', 'sobre', 'entre',
    'ser', 'são', 'foi', 'foram', 'está', 'estão', 'mais', 'menos', 'muito', 'nome',
    'chama', 'significa', 'país', 'pais', 'cidade', 'planeta', 'verdadeiro', 'falso',
    'tipo',
  ]);

  function stripTagsInternal(text) {
    return String(text || '').replace(/<[^>]*>/g, '').trim();
  }

  function computeKnowledgeKey(q, a, formatId, normalizeFn, opts) {
    const options = opts && typeof opts === 'object' ? opts : {};
    const knowledgeMeta = options.knowledgeMeta || options.knowledge || null;
    const categoryNumber = options.categoryNumber;
    if (knowledgeMeta?.entity && knowledgeMeta?.concept) {
      const structured = KnowledgeKey.buildStructuredKey(knowledgeMeta, categoryNumber, normalizeFn);
      if (structured) return structured;
    }
    const norm = normalizeFn || ((s) => String(s || '').trim().toLowerCase());
    const answer = stripTagsInternal(a || '').trim();
    const question = stripFormatLabel(stripTagsInternal(q || '').trim());
    if (isGenericTrueFalseAnswer(answer, norm)) {
      const statement = stripTrueFalsePromptSuffix(question);
      return norm(statement).slice(0, 80);
    }
    const answerKey = norm(answer).replace(/\s+/g, ' ').trim();
    const aTokens = tokenize(answer).filter((w) => !KNOWLEDGE_STOPWORDS.has(w));

    if (/\bcapital\b/i.test(question) && aTokens.length <= 3) {
      return `capital ${answerKey}`;
    }
    if (/\b(planeta|rio|montanha|oceano|país|pais)\b/i.test(question) && aTokens.length <= 3) {
      return `${aTokens[0] || answerKey} ${tokenize(question).filter((w) => !KNOWLEDGE_STOPWORDS.has(w)).slice(0, 2).join(' ')}`.trim();
    }
    if (aTokens.length <= 2 && answerKey.length >= 3) {
      return answerKey;
    }

    const qTokens = tokenize(question).filter((w) => !KNOWLEDGE_STOPWORDS.has(w));
    const core = [...new Set([...aTokens, ...qTokens.slice(0, 3)])].slice(0, 5).join(' ');
    return core || answerKey || norm(question).slice(0, 60);
  }

  function knowledgeKeysMatch(keyA, keyB, normalizeFn) {
    return KnowledgeKey.knowledgeKeysMatch(
      keyA,
      keyB,
      normalizeFn,
      jaccardSimilarity,
      ENGINE_CONFIG.KNOWLEDGE_JACCARD_THRESHOLD,
    );
  }

  PersistentHistory.configure({ computeKnowledgeKey, knowledgeKeysMatch });
  QuestionScoring.configure({ computeKnowledgeKey, knowledgeKeysMatch });
  const {
    getPersistentSlice,
    persistQuestion,
    PERSISTENT_HISTORY_KEY,
  } = PersistentHistory;

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

  /** Factos reportados — ver question-engine/known-facts.js */
  function runReportedFactRules(q, a, options, formatId) {
    return KnownFacts.runReportedFactRules(q, a, options, formatId, mkIssue);
  }
  const CONFUSING_FACT_PREFIXES = ['pergunta confusa', 'formulação', 'resposta ambígua — asfalto', 'pergunta circular'];

  function isConfusingFactIssue(issue) {
    const code = issueCode(issue);
    if (code && KnownFacts.CONFUSING_FACT_CODES.has(code)) return true;
    return CONFUSING_FACT_PREFIXES.some((prefix) => issueMessage(issue).startsWith(prefix));
  }









  function validateFactualConsistency(q, a) {
    return runReportedFactRules(q, a, [], null)
      .filter((i) => !isConfusingFactIssue(i) && !issueMessage(i).startsWith('pergunta ambígua'));
  }

  function shouldRequestFactualVerify(ctx) {
    return FactualVerify.shouldRequestFactualVerify(ctx);
  }

  function buildFactualVerifyPrompt(parsed, ctx) {
    return FactualVerify.buildFactualVerifyPrompt(parsed, ctx);
  }

  function parseFactualVerifyResponse(text) {
    return FactualVerify.parseFactualVerifyResponse(text);
  }

  function shouldRequestAdivinhaVerify(ctx) {
    return AdivinhaVerify.shouldRequestAdivinhaVerify(ctx);
  }

  function buildAdivinhaVerifyPrompt(parsed, ctx) {
    return AdivinhaVerify.buildAdivinhaVerifyPrompt(parsed, ctx);
  }

  function parseAdivinhaVerifyResponse(text) {
    return AdivinhaVerify.parseAdivinhaVerifyResponse(text);
  }

  function parseAdivinhaClues(raw) {
    return AdivinhaVerify.parseAdivinhaClues(raw);
  }

  function estimateDifficulty(q, a, ctx) {
    return DifficultyEstimate.estimateDifficulty(q, a, ctx);
  }

  function validateDifficultyMatch(requested, estimation, ageBandKey) {
    return DifficultyEstimate.validateDifficultyMatch(requested, estimation, ageBandKey);
  }

  function buildRetryHint(issues, formatId, ageBandKey) {
    return buildRetryHintFromIssues(issues, formatId, ageBandKey, { FORMAT_LABELS, getAgeLimits });
  }

  function buildAdaptiveRetryHint(issues, formatId, ageBandKey, attempt, opts) {
    return Retry.buildAdaptiveRetryHint(issues, formatId, ageBandKey, attempt, {
      FORMAT_LABELS,
      getAgeLimits,
      issueDetails: opts?.issueDetails,
    });
  }

  function shouldRotateSubtopicForRetry(issueDetails, attempt) {
    return Retry.shouldRotateSubtopic(issueDetails, attempt);
  }

  function recordGenerationTelemetry(event) {
    return Telemetry.recordGenerationEvent(event);
  }

  function getGenerationTelemetrySummary() {
    return Telemetry.getTelemetrySummary();
  }

  function clearGenerationTelemetry() {
    return Telemetry.clearTelemetry();
  }


  global.QuestionEngine = {
    ENGINE_CONFIG,
    LAYER_WEIGHTS,
    FORMAT_IDS: Object.freeze({ ...FORMAT_IDS }),
    FORMAT_LABELS: Object.freeze({ ...FORMAT_LABELS }),
    CATEGORIES,
    getCategoryDef,
    AGE_LIMITS,
    getAgeLimits,
    CATEGORY_FORMAT_MATRIX: Object.freeze(Object.fromEntries(
      Object.entries(CATEGORIES).map(([n, def]) => [n, def.formats]),
    )),
    CATEGORY_SUBTOPICS: Object.freeze(Object.fromEntries(
      Object.entries(CATEGORIES).map(([n, def]) => [n, def.subtopics]),
    )),
    CATEGORY_RULES: Object.freeze(Object.fromEntries(
      Object.entries(CATEGORIES).map(([n, def]) => [n, def.rules]),
    )),
    CATEGORY_WEIGHT_BOOST: Object.freeze(Object.fromEntries(
      Object.entries(CATEGORIES).filter(([, def]) => def.weightBoost).map(([n, def]) => [n, def.weightBoost]),
    )),
    DIFFICULTY_RANGE: Object.freeze({ ...DIFFICULTY_RANGE }),
    DIFFICULTY_LABELS: Object.freeze({ ...DIFFICULTY_LABELS }),
    TRUE_FALSE_CHANCE,
    TRUE_FALSE_MIN_GAP,
    FORMAT_MAX_CONSECUTIVE,
    getAllowedFormats,
    filterFormatsForContext,
    defaultFormatForAnswerMode,
    chooseFormat,
    chooseDifficulty,
    chooseSubtopic,
    buildPrompt,
    buildRetryHint,
    buildAdaptiveRetryHint,
    shouldRotateSubtopicForRetry,
    recordGenerationTelemetry,
    getGenerationTelemetrySummary,
    clearGenerationTelemetry,
    validateByFormat,
    validateAgeAppropriate,
    validateSemanticQuality,
    validateQuestion,
    validateFactualConsistency,
    shouldRequestFactualVerify,
    buildFactualVerifyPrompt,
    parseFactualVerifyResponse,
    shouldRequestAdivinhaVerify,
    buildAdivinhaVerifyPrompt,
    parseAdivinhaVerifyResponse,
    parseAdivinhaClues,
    validateAdivinhaClues,
    estimateDifficulty,
    validateDifficultyMatch,
    scoreQuestion,
    computeKnowledgeKey,
    knowledgeKeysMatch,
    parseKnowledgeMeta: KnowledgeKey.parseKnowledgeMeta,
    buildStructuredKnowledgeKey: KnowledgeKey.buildStructuredKey,
    isStructuredKnowledgeKey: KnowledgeKey.isStructuredKey,
    KNOWLEDGE_JSON_HINT: ',"knowledge":{"entity":"entidade principal (país, pessoa, obra)","concept":"conhecimento testado (capital, inventor, data)","relation":"relação opcional (é, venceu, descobriu)"}',
    ADIVINHA_CLUES_JSON_HINT: ',"clues":["pista curta 1","pista curta 2"]',
    assembleMcOptions,
    shuffleMcOptions,
    recordMcAnswerPosition,
    resetMcPositions,
    getPersistentSlice,
    persistQuestion,
    PERSISTENT_HISTORY_KEY,
    isGenericTrueFalseAnswer,
    buildGlobalRules,
    buildFormatRules,
    ISSUE_LAYER,
    mkIssue,
    issueMessage,
    issueCode,
  };
})(typeof window !== 'undefined' ? window : globalThis);
