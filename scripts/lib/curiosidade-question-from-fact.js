'use strict';

/**
 * Template de pergunta V/F a partir de um facto do repositório.
 * A IA no jogo pode reformular; o import usa só o template (sem LLM).
 */

const { hashQuestionKey } = require('../../netlify/functions/lib/bank-from-knowledge');

const VF_OPTIONS = ['Verdadeiro', 'Falso'];

function expectedAnswer(record) {
  if (record?.is_true === false || record?.isTrue === false) return 'Falso';
  if (record?.is_true === true || record?.isTrue === true) return 'Verdadeiro';
  const answer = String(record?.answer || '').trim();
  if (/^falso$/i.test(answer)) return 'Falso';
  if (/^verdadeiro$/i.test(answer)) return 'Verdadeiro';
  return answer;
}

function factCore(record) {
  return String(record?.fact || '')
    .replace(/^curiosidade:\s*/i, '')
    .replace(/\?+\s*$/, '')
    .replace(/[.!]\s*$/, '')
    .trim();
}

function buildCuriosityQuestion(record, formatId = 'VERDADEIRO_FALSO') {
  const core = factCore(record);
  if (!core) return null;
  const expected = expectedAnswer(record);
  if (expected !== 'Verdadeiro' && expected !== 'Falso') return null;

  const format = String(formatId || 'VERDADEIRO_FALSO').toUpperCase() === 'CURIOSIDADE'
    ? 'CURIOSIDADE'
    : 'VERDADEIRO_FALSO';

  const statement = String(record.statement || '').trim();
  const question = format === 'VERDADEIRO_FALSO' && statement
    ? statement
    : `Sabias que ${core}?`;

  return {
    question,
    correctAnswer: expected,
    options: [...VF_OPTIONS],
    format,
  };
}

function validateCuriosityQuestion(record, built) {
  const issues = [];
  if (!built?.question || !built?.correctAnswer || !Array.isArray(built.options)) {
    issues.push('incomplete_question');
    return issues;
  }
  const expected = expectedAnswer(record);
  if (built.correctAnswer !== expected) issues.push('answer_mismatch');
  const norms = built.options.map((opt) => String(opt || '').trim().toLowerCase());
  if (!norms.includes('verdadeiro') || !norms.includes('falso') || built.options.length !== 2) {
    issues.push('invalid_options');
  }
  const core = factCore(record);
  const qNorm = String(built.question).toLowerCase();
  const snippet = core.slice(0, Math.min(24, core.length)).toLowerCase();
  if (snippet && !qNorm.includes(snippet)) issues.push('fact_not_in_question');
  return issues;
}

function ageBandsOf(record) {
  const bands = Array.isArray(record?.age_bands) ? record.age_bands : record?.ageBands;
  return (bands || []).map(String).filter((band) => ['6-9', '10-15', '15+'].includes(band));
}

function buildCuriosityBankItems(records, { source = 'wikidata-template' } = {}) {
  const items = [];
  const skipped = [];
  for (const record of records || []) {
    const built = buildCuriosityQuestion(record, 'VERDADEIRO_FALSO');
    if (!built) {
      skipped.push({ knowledgeId: record?.knowledge_id, reason: 'template_failed' });
      continue;
    }
    const issues = validateCuriosityQuestion(record, built);
    if (issues.length) {
      skipped.push({ knowledgeId: record.knowledge_id, reason: issues.join(',') });
      continue;
    }
    const bands = ageBandsOf(record);
    if (!bands.length) {
      skipped.push({ knowledgeId: record.knowledge_id, reason: 'no_age_band' });
      continue;
    }
    for (const ageBand of bands) {
      items.push({
        category_n: Number(record.category_n) || 20,
        age_band: ageBand,
        question: built.question,
        correct_answer: built.correctAnswer,
        question_hash: hashQuestionKey(`${built.question}|${built.correctAnswer}|${ageBand}`),
        options: built.options,
        format: built.format,
        knowledge_key: null,
        source,
        knowledge_id: record.knowledge_id,
        source_id: record.source_id || null,
        confidence: record.confidence,
      });
    }
  }
  return { items, skipped };
}

module.exports = {
  VF_OPTIONS,
  expectedAnswer,
  factCore,
  buildCuriosityQuestion,
  validateCuriosityQuestion,
  buildCuriosityBankItems,
};
