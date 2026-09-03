/**
 * Diagnóstico automático de perguntas reportadas — Question Engine.
 */
(function (global) {
  'use strict';

  const DIAGNOSIS_VERSION = 2;

  const PLAYER_MC_ISSUE_TYPES = new Set(['bad_options', 'multiple_correct', 'confusing']);

  const MC_DISTRACTOR_POOLS = Object.freeze({
    ice_sport: ['Patinagem artística', 'Curling', 'Bobsleigh', 'Patinagem de velocidade'],
    water_sport: ['Natação', 'Remo', 'Mergulho', 'Surf', 'Polo aquático'],
    field_sport: ['Futebol', 'Rugby', 'Andebol', 'Atletismo'],
  });

  const CATEGORIES = Object.freeze({
    factual_error: { id: 'factual_error', emoji: '❌', label: 'Erro factual', defaultSeverity: 'high' },
    ambiguity: { id: 'ambiguity', emoji: '⚠️', label: 'Ambiguidade', defaultSeverity: 'high' },
    bad_formulation: { id: 'bad_formulation', emoji: '✏️', label: 'Má formulação', defaultSeverity: 'medium' },
    incomplete: { id: 'incomplete', emoji: '📝', label: 'Informação incompleta', defaultSeverity: 'medium' },
    pt_pt: { id: 'pt_pt', emoji: '🇵🇹', label: 'Problemas de PT-PT', defaultSeverity: 'medium' },
    valid: { id: 'valid', emoji: '✅', label: 'Pergunta válida', defaultSeverity: 'low' },
  });

  const PLAYER_ISSUE_TO_CATEGORY = Object.freeze({
    wrong_answer: 'factual_error',
    confusing: 'ambiguity',
    multiple_correct: 'ambiguity',
    bad_options: 'bad_formulation',
    portuguese: 'pt_pt',
    outdated: 'factual_error',
    wrong_category: 'bad_formulation',
    repeated: 'bad_formulation',
    other: 'bad_formulation',
  });

  const SEVERITY_LABELS = Object.freeze({
    low: 'Baixa',
    medium: 'Média',
    high: 'Alta',
  });

  const ACTION_LABELS = Object.freeze({
    validate: 'Validar',
    correct: 'Corrigir',
    reject: 'Rejeitar reporte',
    regenerate: 'Regenerar',
    review: 'Rever manualmente',
  });

  const SEVERITY_RANK = { low: 1, medium: 2, high: 3 };

  function categoryForIssueCode(code) {
    const c = String(code || '').toUpperCase();
    if (!c) return 'bad_formulation';
    if (/^FACT_|FACTUAL_|AI_REJECT|OUTDATED|CONTENT_BLOCKED/.test(c)) return 'factual_error';
    if (/^PT_/.test(c)) return 'pt_pt';
    if (/AMBIGU|MULTIPLE_ANSWER|MULTIPLE_CORRECT|MC_MULTIPLE|ANSWER_AMBIGUOUS/.test(c)) return 'ambiguity';
    if (/STRUCTURE_|MISSING_|INSUFFICIENT|INCOMPLETE/.test(c)) return 'incomplete';
    return 'bad_formulation';
  }

  function isSiteReport(report) {
    return String(report?.source) === 'site'
      || String(report?.format) === 'SITE'
      || String(report?.issueType || '').startsWith('site_');
  }

  function defaultStripTags(value) {
    return String(value || '').replace(/<[^>]*>/g, '').trim();
  }

  function defaultNormalizeQ(value) {
    return defaultStripTags(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  function shouldValidateAsMc(report) {
    const options = Array.isArray(report?.options) ? report.options : [];
    if (options.length >= 2) return true;
    return PLAYER_MC_ISSUE_TYPES.has(report?.issueType);
  }

  function resolveFormatId(report, QE) {
    const options = Array.isArray(report?.options) ? report.options : [];
    if (options.length >= 2 || PLAYER_MC_ISSUE_TYPES.has(report?.issueType)) {
      return QE.FORMAT_IDS.ESCOLHA_MULTIPLA;
    }
    const raw = String(report?.format || '').trim().toUpperCase();
    if (raw && QE?.FORMAT_IDS?.[raw]) return QE.FORMAT_IDS[raw];
    const categoryN = Number(report?.category?.n);
    if (categoryN && QE?.chooseFormat) {
      try {
        return QE.chooseFormat(categoryN, report?.ageBand || '10-15', 'mc', []);
      } catch { /* ignore */ }
    }
    return QE.FORMAT_IDS.CURIOSIDADE;
  }

  function buildReportValidationCtx(report, QE, helpers = {}) {
    const stripTags = helpers.stripTags || defaultStripTags;
    const normalizeFn = helpers.normalizeFn || defaultNormalizeQ;
    const formatId = resolveFormatId(report, QE);
    const options = Array.isArray(report?.options) ? report.options.map(stripTags).filter(Boolean) : [];
    const isMC = shouldValidateAsMc(report)
      || formatId === QE.FORMAT_IDS.ESCOLHA_MULTIPLA
      || formatId === QE.FORMAT_IDS.VERDADEIRO_FALSO;
    const categoryNumber = Number(report?.category?.n) || 0;
    return {
      ...(QE.getReportedContentValidationCtx?.(normalizeFn) || {}),
      formatId,
      ageBandKey: report?.ageBand || '10-15',
      categoryNumber,
      difficulty: 3,
      minQualityScore: 0,
      usedQuestions: [],
      usedAnswers: [],
      usedKnowledgeKeys: [],
      persistentKnowledgeKeys: [],
      isMC,
      skipRepetition: true,
      stripTags,
      normalizeFn,
      helpers: {
        stripTags,
        validateTrueFalseQuestion: helpers.validateTrueFalseQuestion || (() => ({ ok: true, issues: [] })),
        ageBandKey: report?.ageBand || '10-15',
      },
    };
  }

  function buildProblems(issueDetails) {
    const seen = new Set();
    const problems = [];
    for (const detail of issueDetails || []) {
      const code = detail?.code || detail?.message || 'UNSPECIFIED';
      const category = categoryForIssueCode(code);
      const key = `${category}:${code}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const meta = CATEGORIES[category] || CATEGORIES.bad_formulation;
      problems.push({
        category,
        emoji: meta.emoji,
        label: meta.label,
        code: String(code),
        message: String(detail?.message || detail?.code || '').trim(),
        severity: meta.defaultSeverity,
      });
    }
    return problems;
  }

  function pickPrimaryCategory(problems, validationOk) {
    if (validationOk || !problems.length) return 'valid';
    let best = problems[0].category;
    let bestRank = SEVERITY_RANK[problems[0].severity] || 2;
    for (const problem of problems.slice(1)) {
      const rank = SEVERITY_RANK[problem.severity] || 2;
      if (rank > bestRank) {
        best = problem.category;
        bestRank = rank;
      }
    }
    return best;
  }

  function computeSeverity(primaryCategory, qualityScore, problems) {
    if (primaryCategory === 'valid') return 'low';
    if (primaryCategory === 'factual_error' || primaryCategory === 'ambiguity') {
      return qualityScore < 55 ? 'high' : 'medium';
    }
    if ((problems || []).length >= 3) return 'high';
    return CATEGORIES[primaryCategory]?.defaultSeverity || 'medium';
  }

  function computeConfidence(validation, playerIssueType, primaryCategory) {
    const playerCategory = PLAYER_ISSUE_TO_CATEGORY[playerIssueType] || null;
    const engineOk = !!validation?.ok;
    const issueCount = (validation?.issueDetails || []).length;

    if (engineOk) {
      if (playerIssueType && playerIssueType !== 'suggestion') {
        return { confidence: 38, alignsWithPlayerReport: false };
      }
      return { confidence: 93, alignsWithPlayerReport: true };
    }

    if (playerCategory && playerCategory === primaryCategory) {
      return {
        confidence: Math.min(98, 84 + Math.min(issueCount, 4) * 3),
        alignsWithPlayerReport: true,
      };
    }

    if (!playerCategory) {
      return {
        confidence: Math.min(90, 72 + Math.min(issueCount, 5) * 3),
        alignsWithPlayerReport: null,
      };
    }

    return {
      confidence: Math.max(45, 62 + Math.min(issueCount, 3) * 2),
      alignsWithPlayerReport: false,
    };
  }

  function recommendAction(primaryCategory, confidence, alignsWithPlayerReport, playerIssueType) {
    if (primaryCategory === 'valid' && confidence >= 70) return 'validate';
    if (primaryCategory === 'valid') return 'review';
    if (playerIssueType === 'suggestion') return 'review';
    if (alignsWithPlayerReport === false && confidence < 55) return 'review';
    if (primaryCategory === 'factual_error' || primaryCategory === 'ambiguity') return 'correct';
    if (alignsWithPlayerReport) return 'correct';
    return 'correct';
  }

  function detectDistractorPool(question, correctAnswer) {
    const McValidators = global.QuestionEngineMcValidators;
    const surface = McValidators?.detectSportSurfaceContext
      ? McValidators.detectSportSurfaceContext(question)
      : null;
    if (surface === 'ice') return 'ice_sport';
    if (surface === 'water') return 'water_sport';
    if (surface === 'field') return 'field_sport';
    if (/\b(capital|continente|país|pais|cidade)\b/i.test(question)) return null;
    return null;
  }

  function proposeMcDistractors(question, correctAnswer, currentOptions, stripTags) {
    const poolId = detectDistractorPool(question, correctAnswer);
    if (!poolId) return null;
    const pool = MC_DISTRACTOR_POOLS[poolId] || [];
    const norm = (s) => stripTags(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const correctNorm = norm(correctAnswer);
    const currentNorms = new Set((currentOptions || []).map(norm));
    const picked = [];
    for (const candidate of pool) {
      if (picked.length >= 3) break;
      const cNorm = norm(candidate);
      if (cNorm === correctNorm || currentNorms.has(cNorm)) continue;
      picked.push(candidate);
    }
    if (picked.length < 3) return null;
    const options = [stripTags(correctAnswer).trim(), ...picked.slice(0, 3)];
    return options;
  }

  function optionsChanged(before, after, stripTags) {
    const norm = (arr) => (arr || []).map((o) => stripTags(o).toLowerCase()).sort().join('|');
    return norm(before) !== norm(after);
  }

  function buildSuggestedChanges(report, correction, stripTags) {
    const changes = [];
    const origQ = stripTags(report?.question || '');
    const origA = stripTags(report?.correctAnswer || '');
    const origOpts = Array.isArray(report?.options) ? report.options : [];
    if (correction.question && correction.question !== origQ) {
      changes.push({ field: 'question', from: origQ, to: correction.question });
    }
    if (correction.answer && correction.answer !== origA) {
      changes.push({ field: 'answer', from: origA, to: correction.answer });
    }
    if (Array.isArray(correction.options) && correction.options.length >= 2
      && optionsChanged(origOpts, correction.options, stripTags)) {
      changes.push({
        field: 'options',
        from: origOpts,
        to: correction.options,
      });
    }
    if (correction.format && correction.format !== report?.format) {
      changes.push({ field: 'format', from: report?.format || '', to: correction.format });
    }
    return changes;
  }

  function buildCorrectionPreview(correction, report, QE, helpers) {
    if (!correction?.question || !correction?.answer || !QE?.validateQuestion) return null;
    const stripTags = helpers.stripTags || defaultStripTags;
    const parsed = { q: correction.question, a: correction.answer };
    if (Array.isArray(correction.options) && correction.options.length >= 2) {
      parsed.options = correction.options.map(stripTags).filter(Boolean);
    }
    const previewReport = {
      ...report,
      question: correction.question,
      correctAnswer: correction.answer,
      options: correction.options || report?.options,
      format: correction.format || (parsed.options?.length >= 2 ? 'ESCOLHA_MULTIPLA' : report?.format),
    };
    const ctx = buildReportValidationCtx(previewReport, QE, helpers);
    const validation = QE.validateQuestion(parsed, ctx);
    return {
      ok: !!validation.ok,
      qualityScore: Math.round(Number(validation.score) || 0),
      issueCount: (validation.issueDetails || []).length,
      issues: (validation.issues || []).slice(0, 4),
    };
  }

  function buildSuggestedCorrection(report, validation, QE, ctx, helpers = {}) {
    const stripTags = helpers.stripTags || defaultStripTags;
    const hint = validation?.issues?.length && QE?.buildRetryHint
      ? QE.buildRetryHint(validation.issues, ctx.formatId, ctx.ageBandKey)
      : '';
    const notes = [hint, report?.comment, report?.suggestion].filter(Boolean).join('\n\n');
    const question = String(report?.question || '').trim();
    const answer = String(report?.correctAnswer || '').trim();
    let options = Array.isArray(report?.options) ? [...report.options] : [];
    let format = ctx.formatId === QE.FORMAT_IDS.ESCOLHA_MULTIPLA ? 'ESCOLHA_MULTIPLA' : (report?.format || null);

    const mcProblems = (validation?.issueDetails || []).filter((d) => /^MC_/.test(d?.code || ''));
    const shouldProposeOptions = mcProblems.length > 0
      || (PLAYER_MC_ISSUE_TYPES.has(report?.issueType) && options.length >= 2 && validation?.ok);
    if (shouldProposeOptions && options.length >= 2) {
      const proposed = proposeMcDistractors(question, answer, options, stripTags);
      if (proposed && optionsChanged(options, proposed, stripTags)) {
        options = proposed;
        format = 'ESCOLHA_MULTIPLA';
      }
    }

    const correction = { question, answer, options, format, notes };
    correction.suggestedChanges = buildSuggestedChanges(report, correction, stripTags);
    return correction;
  }

  function diagnoseReport(report, QE, helpers = {}) {
    if (!report || !QE?.validateQuestion || isSiteReport(report)) return null;

    const stripTags = helpers.stripTags || defaultStripTags;
    const question = stripTags(report.question);
    const answer = stripTags(report.correctAnswer);
    if (!question || !answer) return null;

    const parsed = { q: question, a: answer };
    const options = Array.isArray(report.options) ? report.options.map(stripTags).filter(Boolean) : [];
    if (options.length >= 2) parsed.options = options;

    const ctx = buildReportValidationCtx(report, QE, helpers);
    const validation = QE.validateQuestion(parsed, ctx);
    const problems = buildProblems(validation.issueDetails);
    const primaryCategory = pickPrimaryCategory(problems, validation.ok);
    const categoryMeta = CATEGORIES[primaryCategory] || CATEGORIES.valid;
    const qualityScore = Math.round(Number(validation.score) || 0);
    const { confidence, alignsWithPlayerReport } = computeConfidence(
      validation,
      report.issueType,
      primaryCategory,
    );
    const severity = computeSeverity(primaryCategory, qualityScore, problems);
    const recommendedAction = recommendAction(
      primaryCategory,
      confidence,
      alignsWithPlayerReport,
      report.issueType,
    );
    const suggestedCorrection = buildSuggestedCorrection(report, validation, QE, ctx, helpers);
    const correctionPreview = buildCorrectionPreview(suggestedCorrection, report, QE, helpers);

    return {
      version: DIAGNOSIS_VERSION,
      analyzedAt: new Date().toISOString(),
      qualityScore,
      verdict: primaryCategory,
      verdictLabel: categoryMeta.label,
      verdictEmoji: categoryMeta.emoji,
      confidence,
      severity,
      severityLabel: SEVERITY_LABELS[severity] || SEVERITY_LABELS.medium,
      recommendedAction,
      recommendedActionLabel: ACTION_LABELS[recommendedAction] || ACTION_LABELS.review,
      alignsWithPlayerReport,
      playerIssueType: report.issueType || null,
      problems,
      suggestedCorrection,
      suggestedChanges: suggestedCorrection.suggestedChanges || [],
      correctionPreview,
      engineValidation: {
        ok: !!validation.ok,
        score: qualityScore,
        issueCodes: (validation.issueDetails || []).map((d) => d?.code).filter(Boolean),
        issues: validation.issues || [],
      },
    };
  }

  function aggregateDiagnosisStats(reports) {
    const byVerdict = {};
    const byIssueCode = {};
    const byPlayerIssue = {};
    let withDiagnosis = 0;
    let aligns = 0;
    let mismatches = 0;
    let qualitySum = 0;
    let openWithProblems = 0;

    for (const report of reports || []) {
      const d = report?.engineDiagnosis;
      if (!d) continue;
      withDiagnosis += 1;
      qualitySum += Number(d.qualityScore) || 0;
      byVerdict[d.verdict] = (byVerdict[d.verdict] || 0) + 1;
      if (d.alignsWithPlayerReport === true) aligns += 1;
      if (d.alignsWithPlayerReport === false) mismatches += 1;
      if (report.status === 'open' && d.verdict !== 'valid') openWithProblems += 1;
      if (report.issueType) byPlayerIssue[report.issueType] = (byPlayerIssue[report.issueType] || 0) + 1;
      for (const code of d.engineValidation?.issueCodes || []) {
        byIssueCode[code] = (byIssueCode[code] || 0) + 1;
      }
    }

    const topEngineFailures = Object.entries(byIssueCode)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([code, count]) => ({ code, count }));

    return {
      withDiagnosis,
      avgQualityScore: withDiagnosis ? Math.round(qualitySum / withDiagnosis) : null,
      alignsWithPlayer: aligns,
      mismatchesWithPlayer: mismatches,
      openWithEngineProblems: openWithProblems,
      byVerdict,
      byPlayerIssue,
      topEngineFailures,
    };
  }

  function enrichReportDiagnosis(report, QE, helpers = {}) {
    if (!report) return null;
    if (report.engineDiagnosis?.version === DIAGNOSIS_VERSION && !helpers.force) {
      return report.engineDiagnosis;
    }
    const diagnosis = diagnoseReport(report, QE, helpers);
    if (diagnosis) report.engineDiagnosis = diagnosis;
    return diagnosis;
  }

  global.QuestionEngineReportDiagnosis = {
    DIAGNOSIS_VERSION,
    CATEGORIES,
    SEVERITY_LABELS,
    ACTION_LABELS,
    categoryForIssueCode,
    buildReportValidationCtx,
    shouldValidateAsMc,
    proposeMcDistractors,
    buildSuggestedChanges,
    buildCorrectionPreview,
    diagnoseReport,
    enrichReportDiagnosis,
    aggregateDiagnosisStats,
    isSiteReport,
  };
})(typeof window !== 'undefined' ? window : globalThis);
