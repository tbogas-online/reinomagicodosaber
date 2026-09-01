/**
 * Heurística de knowledgeKey — computeKnowledgeKey e match (Fase 12).
 */
(function (global) {
  'use strict';

  const KnowledgeKey = global.QuestionEngineKnowledgeKey;
  const Config = global.QuestionEngineConfig;
  const FormatValidators = global.QuestionEngineFormatValidators;
  const RepetitionValidators = global.QuestionEngineRepetitionValidators;
  if (!KnowledgeKey || !Config || !FormatValidators || !RepetitionValidators) {
    throw new Error('knowledge-key-compute: carrega knowledge-key.js, engine-config.js, format-validators.js e repetition-validators.js antes deste módulo');
  }

  const { ENGINE_CONFIG, isGenericTrueFalseAnswer } = Config;
  const { stripFormatLabel } = FormatValidators;
  const { tokenize, stripTrueFalsePromptSuffix } = RepetitionValidators;

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
      RepetitionValidators.jaccardSimilarity,
      ENGINE_CONFIG.KNOWLEDGE_JACCARD_THRESHOLD,
    );
  }

  global.QuestionEngineKnowledgeKeyCompute = {
    KNOWLEDGE_STOPWORDS,
    computeKnowledgeKey,
    knowledgeKeysMatch,
  };
})(typeof window !== 'undefined' ? window : globalThis);
