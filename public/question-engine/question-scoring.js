/**
 * Pontuação e validação — scoreQuestion, validateQuestion (Fase 10).
 */
(function (global) {
  'use strict';

  const Issues = global.QuestionEngineIssues;
  const Config = global.QuestionEngineConfig;
  const KnowledgeKey = global.QuestionEngineKnowledgeKey;
  const KnownFacts = global.QuestionEngineKnownFacts;
  const DifficultyEstimate = global.QuestionEngineDifficultyEstimate;
  const FormatValidators = global.QuestionEngineFormatValidators;
  const AgeValidators = global.QuestionEngineAgeValidators;
  const CategoryValidators = global.QuestionEngineCategoryValidators;
  const PtPt = global.QuestionEnginePtPt;
  const SemanticValidators = global.QuestionEngineSemanticValidators;
  const McValidators = global.QuestionEngineMcValidators;
  const RepetitionValidators = global.QuestionEngineRepetitionValidators;
  const KnowledgeKeyCompute = global.QuestionEngineKnowledgeKeyCompute;
  if (!Issues || !Config || !KnowledgeKey || !KnownFacts || !DifficultyEstimate
    || !FormatValidators || !AgeValidators || !CategoryValidators || !PtPt
    || !SemanticValidators || !McValidators || !RepetitionValidators || !KnowledgeKeyCompute) {
    throw new Error('question-scoring: carrega issue-codes, engine-config, knowledge-key, knowledge-key-compute, known-facts, difficulty-estimate e validadores antes deste módulo');
  }

  const {
    mkIssue, issueMessage, issueCode, normalizeIssues, issueMessages, ISSUE_LAYER,
  } = Issues;
  const { LAYER_WEIGHTS, DIFFICULTY_RANGE, getAgeLimits } = Config;
  const { computeKnowledgeKey, knowledgeKeysMatch } = KnowledgeKeyCompute;
  const { validateByFormat } = FormatValidators;
  const { validateAgeAppropriate, validateObscureCharacter } = AgeValidators;
  const { validateCategoryTopicFit } = CategoryValidators;
  const { collectPtPtIssues } = PtPt;
  const {
    validateAdivinhaMcAmbiguity,
    collectSemanticIssues: collectSemanticIssuesCore,
  } = SemanticValidators;
  const { collectMcIssues: collectMcIssuesCore } = McValidators;
  const { collectRepetitionIssues: collectRepetitionIssuesCore } = RepetitionValidators;

  function pushIssue(issues, code, layer, message) {
    issues.push(mkIssue(code, layer, message));
  }

  function pushAgeHardIssue(issues, message) {
    pushIssue(issues, 'AGE_TOO_HARD', ISSUE_LAYER.age, message);
  }

  function runReportedFactRules(q, a, options, formatId) {
    return KnownFacts.runReportedFactRules(q, a, options, formatId, mkIssue);
  }

  function collectSemanticIssues(parsed, ctx) {
    return collectSemanticIssuesCore(parsed, {
      ...ctx,
      runReportedFactRules,
      validateObscureCharacter,
    });
  }

  function collectRepetitionIssues(q, a, formatId, ctx, normalizeFn) {
    return collectRepetitionIssuesCore(q, a, formatId, {
      ...ctx,
      computeKnowledgeKey,
      knowledgeKeysMatch,
    }, normalizeFn);
  }

  function collectMcIssues(parsed, ctx) {
    return collectMcIssuesCore(parsed, {
      ...ctx,
      adivinhaMcAmbiguity: validateAdivinhaMcAmbiguity,
    });
  }

  function validateDifficultyFit(difficulty, ageBandKey, q, a) {
    const issues = [];
    const lim = getAgeLimits(ageBandKey);
    const range = DIFFICULTY_RANGE[ageBandKey] || DIFFICULTY_RANGE['15+'];
    const diff = Number(difficulty) || range.min;
    if (diff < range.min || diff > range.max) {
      pushIssue(issues, 'DIFFICULTY_OUT_OF_RANGE', ISSUE_LAYER.difficulty, `dificuldade ${diff} incompatível com faixa ${ageBandKey}`);
    }
    if (lim.rejectDifficultyGte != null && diff >= lim.rejectDifficultyGte) {
      pushAgeHardIssue(issues, 'demasiado difícil para 6–9');
    }
    if (lim.rejectTrivialAtHighDiff && diff >= 4) {
      const tooEasy = /\b(planeta onde vivemos|cor do céu|quantos dedos|quantas pernas tem um cão)\b/i;
      if (tooEasy.test(q)) pushIssue(issues, 'AGE_TOO_EASY', ISSUE_LAYER.difficulty, 'demasiado fácil para +15 nível exigente');
    }
    if (lim.rejectEasyDifficultyLte != null && diff <= lim.rejectEasyDifficultyLte) {
      const tooHard = /\b(teorema|algoritmo|revolução industrial|segunda guerra)\b/i;
      if (tooHard.test(q)) pushAgeHardIssue(issues, 'demasiado difícil para 6–9');
    }
    const estimation = DifficultyEstimate.estimateDifficulty(q, a, { ageBandKey });
    const mismatch = DifficultyEstimate.validateDifficultyMatch(diff, estimation, ageBandKey);
    for (const item of mismatch) {
      pushIssue(issues, item.code, ISSUE_LAYER.difficulty, item.message);
    }
    return issues;
  }

  function layerScore(points, layerIssues) {
    return layerIssues.length ? 0 : points;
  }

  function scoreQuestion(parsed, ctx) {
    const {
      formatId, ageBandKey, categoryNumber, isMC, stripTags, normalizeFn, helpers, difficulty,
    } = ctx;
    const q = stripTags(parsed?.q || '').trim();
    const a = stripTags(parsed?.a || '').trim();
    const options = Array.isArray(parsed?.options) ? parsed.options : [];
    const issues = [];
    const layers = {};

    if (!q || !a) {
      const issueDetails = [mkIssue('STRUCTURE_INCOMPLETE', ISSUE_LAYER.structural, 'estrutura incompleta')];
      return {
        score: 0,
        issues: issueMessages(issueDetails),
        issueDetails,
        layers: { structural: 0 },
        knowledgeKey: '',
      };
    }

    if (ctx.repositoryRecord?.answer) {
      const norm = normalizeFn || ((s) => String(s || '').toLowerCase());
      const expected = norm(stripTags(ctx.repositoryRecord.answer));
      const got = norm(stripTags(a));
      if (expected !== got) {
        pushIssue(
          issues,
          'REPOSITORY_ANSWER_MISMATCH',
          ISSUE_LAYER.structural,
          'resposta deve coincidir exactamente com o registo verificado do repositório',
        );
      }
    }

    const structuralRepoIssues = issues.filter((i) => issueCode(i) === 'REPOSITORY_ANSWER_MISMATCH');
    layers.structural = layerScore(LAYER_WEIGHTS.structural, structuralRepoIssues);

    const formatCheck = validateByFormat(parsed, formatId, {
      ...(helpers || {}),
      ageBandKey,
      stripTags,
      validateTrueFalseQuestion: helpers?.validateTrueFalseQuestion,
    });
    layers.format = layerScore(LAYER_WEIGHTS.format, formatCheck.issues);
    issues.push(...formatCheck.issues);

    const ageCheck = validateAgeAppropriate(parsed, ageBandKey, stripTags, formatId);
    layers.age = layerScore(LAYER_WEIGHTS.age, ageCheck.issues);
    issues.push(...ageCheck.issues);

    const diffIssues = validateDifficultyFit(difficulty, ageBandKey, q, a);
    layers.difficulty = layerScore(LAYER_WEIGHTS.difficulty, diffIssues);
    issues.push(...diffIssues);

    const catIssues = categoryNumber ? validateCategoryTopicFit(q, categoryNumber, ageBandKey) : [];
    layers.category = layerScore(LAYER_WEIGHTS.category, catIssues);
    issues.push(...catIssues);

    const ptIssues = collectPtPtIssues(q, a, options, ageBandKey, Array.isArray(parsed?.clues) ? parsed.clues : []);
    layers.ptPt = layerScore(LAYER_WEIGHTS.ptPt, ptIssues);
    issues.push(...ptIssues);

    const semanticIssues = collectSemanticIssues(parsed, { ...ctx, stripTags, normalizeFn, formatId, isMC });
    layers.semantic = layerScore(LAYER_WEIGHTS.semantic, semanticIssues);
    issues.push(...semanticIssues);

    const { issues: repetitionIssues, knowledgeKey } = collectRepetitionIssues(q, a, formatId, {
      ...ctx,
      parsed,
      knowledgeMeta: KnowledgeKey.parseKnowledgeMeta(parsed),
    }, normalizeFn);
    layers.repetition = layerScore(LAYER_WEIGHTS.repetition, repetitionIssues);
    issues.push(...repetitionIssues);

    const mcIssues = collectMcIssues(parsed, { ...ctx, stripTags, normalizeFn, ageBandKey, isMC });
    layers.mcOptions = isMC ? layerScore(LAYER_WEIGHTS.mcOptions, mcIssues) : LAYER_WEIGHTS.mcOptions;
    issues.push(...mcIssues);

    const factualOnly = semanticIssues.filter((i) => /facto|factual|errad|incorret|ortográfico/i.test(issueMessage(i)));
    layers.factual = layerScore(LAYER_WEIGHTS.semantic, factualOnly);

    const score = Object.keys(LAYER_WEIGHTS).reduce((sum, key) => sum + (Number(layers[key]) || 0), 0);
    const normalized = normalizeIssues(issues);
    const seen = new Set();
    const issueDetails = normalized.filter((i) => {
      const m = issueMessage(i);
      if (seen.has(m)) return false;
      seen.add(m);
      return true;
    });
    return {
      score,
      issues: issueMessages(issueDetails),
      issueDetails,
      layers,
      knowledgeKey,
    };
  }

  function validateSemanticQuality(parsed, ctx) {
    const { stripTags, normalizeFn, formatId, skipRepetition } = ctx;
    const q = stripTags(parsed?.q || '').trim();
    const a = stripTags(parsed?.a || '').trim();
    const issues = [
      ...collectSemanticIssues(parsed, ctx),
      ...collectMcIssues(parsed, ctx),
    ];
    if (!skipRepetition) {
      issues.push(...collectRepetitionIssues(q, a, formatId, ctx, normalizeFn).issues);
    }
    return { ok: !issues.length, issues: [...new Set(issues)] };
  }

  function validateQuestion(parsed, ctx) {
    const scored = scoreQuestion(parsed, ctx);
    if (scored.issues.length > 0) {
      return {
        ok: false,
        issues: scored.issues,
        issueDetails: scored.issueDetails,
        score: scored.score,
        layers: scored.layers,
        knowledgeKey: scored.knowledgeKey,
      };
    }
    return {
      ok: true,
      issues: [],
      issueDetails: [],
      score: scored.score,
      layers: scored.layers,
      knowledgeKey: scored.knowledgeKey,
    };
  }

  global.QuestionEngineQuestionScoring = {
    layerScore,
    scoreQuestion,
    validateSemanticQuality,
    validateQuestion,
  };
})(typeof window !== 'undefined' ? window : globalThis);
