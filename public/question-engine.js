/**
 * Motor de perguntas — fachada pública (modularização Fases 7–16).
 */
(function (global) {
  'use strict';

  const Issues = global.QuestionEngineIssues;
  const KnowledgeKey = global.QuestionEngineKnowledgeKey;
  const KnowledgeKeyCompute = global.QuestionEngineKnowledgeKeyCompute;
  const Retry = global.QuestionEngineRetry;
  const Telemetry = global.QuestionEngineTelemetry;
  const KnownFacts = global.QuestionEngineKnownFacts;
  const FactualVerify = global.QuestionEngineFactualVerify;
  const AdivinhaVerify = global.QuestionEngineAdivinhaVerify;
  const DifficultyEstimate = global.QuestionEngineDifficultyEstimate;
  const Config = global.QuestionEngineConfig;
  const FormatValidators = global.QuestionEngineFormatValidators;
  const AgeValidators = global.QuestionEngineAgeValidators;
  const PersistentHistory = global.QuestionEnginePersistentHistory;
  const PromptBuilder = global.QuestionEnginePromptBuilder;
  const McAssembly = global.QuestionEngineMcAssembly;
  const QuestionScoring = global.QuestionEngineQuestionScoring;

  if (!Issues || !KnowledgeKey || !KnowledgeKeyCompute || !Retry || !Telemetry || !KnownFacts
    || !FactualVerify || !AdivinhaVerify || !DifficultyEstimate || !Config || !FormatValidators
    || !AgeValidators || !PersistentHistory || !PromptBuilder || !McAssembly || !QuestionScoring) {
    throw new Error('QuestionEngine: carrega todos os módulos question-engine/*.js antes de question-engine.js');
  }

  const {
    mkIssue, issueMessage, issueCode, buildRetryHintFromIssues, ISSUE_LAYER,
  } = Issues;
  const {
    ENGINE_CONFIG,
    LAYER_WEIGHTS,
    TRUE_FALSE_CHANCE,
    TRUE_FALSE_MIN_GAP,
    FORMAT_MAX_CONSECUTIVE,
    FORMAT_IDS,
    FORMAT_LABELS,
    DIFFICULTY_RANGE,
    DIFFICULTY_LABELS,
    AGE_LIMITS,
    getAgeLimits,
    CATEGORIES,
    getCategoryDef,
    filterFormatsForContext,
    defaultFormatForAnswerMode,
    isGenericTrueFalseAnswer,
  } = Config;
  const { validateByFormat, validateAdivinhaClues } = FormatValidators;
  const { validateAgeAppropriate } = AgeValidators;
  const {
    buildGlobalRules,
    buildFormatRules,
    chooseDifficulty,
    chooseSubtopic,
    getAllowedFormats,
    chooseFormat,
    buildPrompt,
  } = PromptBuilder;
  const {
    assembleMcOptions,
    shuffleMcOptions,
    recordMcAnswerPosition,
    resetMcPositions,
  } = McAssembly;
  const {
    scoreQuestion,
    validateSemanticQuality,
    validateQuestion,
  } = QuestionScoring;
  const { computeKnowledgeKey, knowledgeKeysMatch } = KnowledgeKeyCompute;
  const {
    getPersistentSlice,
    persistQuestion,
    PERSISTENT_HISTORY_KEY,
  } = PersistentHistory;

  function buildRetryHint(issues, formatId, ageBandKey) {
    return buildRetryHintFromIssues(issues, formatId, ageBandKey, { FORMAT_LABELS, getAgeLimits });
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
    buildAdaptiveRetryHint: (issues, formatId, ageBandKey, attempt, opts) => Retry.buildAdaptiveRetryHint(
      issues, formatId, ageBandKey, attempt, { FORMAT_LABELS, getAgeLimits, issueDetails: opts?.issueDetails },
    ),
    shouldRotateSubtopicForRetry: Retry.shouldRotateSubtopic,
    recordGenerationTelemetry: Telemetry.recordGenerationEvent,
    getGenerationTelemetrySummary: Telemetry.getTelemetrySummary,
    clearGenerationTelemetry: Telemetry.clearTelemetry,
    validateByFormat,
    validateAgeAppropriate,
    validateSemanticQuality,
    validateQuestion,
    validateFactualConsistency: KnownFacts.validateFactualConsistency,
    shouldRequestFactualVerify: FactualVerify.shouldRequestFactualVerify,
    buildFactualVerifyPrompt: FactualVerify.buildFactualVerifyPrompt,
    parseFactualVerifyResponse: FactualVerify.parseFactualVerifyResponse,
    shouldRequestAdivinhaVerify: AdivinhaVerify.shouldRequestAdivinhaVerify,
    buildAdivinhaVerifyPrompt: AdivinhaVerify.buildAdivinhaVerifyPrompt,
    parseAdivinhaVerifyResponse: AdivinhaVerify.parseAdivinhaVerifyResponse,
    parseAdivinhaClues: AdivinhaVerify.parseAdivinhaClues,
    validateAdivinhaClues,
    estimateDifficulty: DifficultyEstimate.estimateDifficulty,
    validateDifficultyMatch: DifficultyEstimate.validateDifficultyMatch,
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
