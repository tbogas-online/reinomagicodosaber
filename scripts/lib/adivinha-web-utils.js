'use strict';

const {
  normalizeText,
  stripHtml,
  clueLeaksAnswer,
} = require('./memoriamedia-adivinhas');
const { collectContentSafetyIssues } = require('./content-safety-node');

const RE_BRASILEIRISMO = /\b(você|voce|ônibus|onibus|trem\b|suco\b|banheiro\b|celular\b|abacaxi\b|ventilador\b|camiseta\b|vocês)\b/i;

function cleanQuestion(text) {
  let q = String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([?.!,;:])/g, '$1')
    .trim();
  q = q.replace(/^(?:qual é a coisa,? ?qual é ela,?|qual a coisa,? ?qual é ela,?)\s*/i, '');
  q = q.replace(/^(?:o que é,? ?o que é\??|adivinhar,? ?adivinhar,?)\s*/i, '');
  q = q.replace(/^que\s+/i, '');
  return q.trim();
}

function cleanAnswer(text) {
  return String(text || '')
    .replace(/^resposta\s*:\s*/i, '')
    .replace(/^o\s+/i, '')
    .replace(/^a\s+/i, '')
    .replace(/^um\s+/i, '')
    .replace(/^uma\s+/i, '')
    .replace(/^os\s+/i, '')
    .replace(/^as\s+/i, '')
    .replace(/\.$/, '')
    .trim();
}

function capitalizeAnswer(answer) {
  const a = String(answer || '').trim();
  if (!a) return a;
  return a.charAt(0).toUpperCase() + a.slice(1);
}

function splitClues(question) {
  const q = cleanQuestion(question);
  const parts = q
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 8);
  if (parts.length >= 2) return parts.slice(0, 6);
  if (parts.length === 1) {
    const single = parts[0];
    const commaSplit = single.split(/,\s+/).map((p) => p.trim()).filter((p) => p.length >= 8);
    if (commaSplit.length >= 2) return commaSplit.slice(0, 6);
    return [single, 'O que sou?'];
  }
  return [q, 'O que sou?'];
}

function buildFact(question) {
  const raw = String(question || '').replace(/\s+/g, ' ').trim();
  const body = cleanQuestion(question);
  if (!body) return '';

  if (/\bo que sou\??$/i.test(raw) || /\bo que é\??$/i.test(raw)) {
    return raw.endsWith('?') ? raw : `${raw}?`;
  }

  let q = body;
  if (!/\?\s*$/.test(q)) q = `${q.replace(/[.!]\s*$/, '')}?`;

  if (/qual é a coisa|qual a coisa|adivinhar,\s*adivinhar|o que é,\s*o que é/i.test(raw)) {
    const lower = q.charAt(0).toLowerCase() + q.slice(1);
    return `O que é que ${lower}`;
  }

  return q;
}

function validateWebItem(item, options = {}) {
  const issues = [];
  const question = cleanQuestion(item.question);
  const answer = capitalizeAnswer(cleanAnswer(item.answer));

  if (!question || question.length < 12) issues.push('question_too_short');
  if (!answer || answer.length < 2) issues.push('missing_answer');
  if (answer.length > 48) issues.push('answer_too_long');

  const clues = splitClues(item.question);
  if (clues.length < 2) issues.push('missing_clues');
  if (clueLeaksAnswer(clues, answer)) issues.push('clue_leaks_answer');

  const fact = buildFact(item.question);
  if (!fact || fact.length < 12) issues.push('fact_too_short');

  if (!options.allowBrasileiro && item.locale === 'pt-BR') {
    issues.push('locale_pt_br');
  }
  if (!options.allowBrasileiro && RE_BRASILEIRISMO.test(question)) {
    issues.push('brasileirismo');
  }

  const safety = collectContentSafetyIssues(fact, answer, [], clues);
  if (safety.length) issues.push('content_safety');

  return { issues, question, answer, clues, fact };
}

function slugify(text) {
  return normalizeText(text)
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 48);
}

function toKnowledgeRecord(item, validated, seq) {
  const sourceSlug = item.sourceSlug;
  const idPart = slugify(validated.answer) || `item-${seq}`;
  return {
    knowledge_id: `knw-cat20-web-${sourceSlug}-${String(seq).padStart(3, '0')}`,
    category_n: 20,
    topic: 'adivinha tradicional',
    subtopic: item.subtopic || 'web',
    fact: validated.fact,
    answer: validated.answer,
    clues: validated.clues,
    source: item.sourceName,
    source_id: `web:${sourceSlug}:${String(seq).padStart(3, '0')}:${idPart}`,
    source_url: item.sourceUrl,
    license: item.license || 'uso educativo — ver URL de origem',
    confidence: item.locale === 'pt-BR' ? 0.78 : 0.88,
    priority_pt: item.locale === 'pt-BR' ? 70 : 82,
    age_bands: ['6-9', '10-15', '15+'],
    allowed_formats: ['ADIVINHA'],
    tags: ['adivinha', 'web', sourceSlug, ...(item.locale === 'pt-BR' ? ['pt-br'] : ['pt-pt'])],
    verified_by: 'import-knowledge-adivinhas-web',
    metadata: {
      source_slug: sourceSlug,
      locale: item.locale || 'pt-PT',
      original_question: item.question,
      original_answer: item.answer,
    },
  };
}

function dedupeAgainstExisting(items, existingRecords = []) {
  const existingFacts = new Set(existingRecords.map((r) => normalizeText(r.fact)));
  const existingAnswers = new Set(existingRecords.map((r) => normalizeText(r.answer)));
  const accepted = [];
  const rejected = [];

  const seen = new Set();
  for (const item of items) {
    const key = `${normalizeText(item.parsed.answer)}|${normalizeText(item.parsed.fact).slice(0, 80)}`;
    if (seen.has(key)) {
      rejected.push({ ...item, issues: ['duplicate_in_batch'] });
      continue;
    }
    seen.add(key);

    const ans = normalizeText(item.parsed.answer);
    const fact = normalizeText(item.parsed.fact);
    if (existingAnswers.has(ans) || existingFacts.has(fact)) {
      rejected.push({ ...item, issues: ['duplicate_repository'] });
      continue;
    }
    accepted.push(item);
  }
  return { accepted, rejected };
}

module.exports = {
  RE_BRASILEIRISMO,
  cleanQuestion,
  cleanAnswer,
  splitClues,
  buildFact,
  validateWebItem,
  toKnowledgeRecord,
  dedupeAgainstExisting,
  stripHtml,
  normalizeText,
};
