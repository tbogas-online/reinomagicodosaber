'use strict';

function stripHtml(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#0*39;/g, "'")
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function normalizeText(s) {
  return stripHtml(s)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const GENERIC_ANSWERS = new Set([
  'coisa',
  'uma coisa',
  'isto',
  'aquilo',
  'algo',
  'objecto',
  'objeto',
  'nada',
  'nao sei',
  'desconhecido',
  'varios',
]);

const HARD_WORDS_69 = /\b(epistemologia|imperialismo|mitocondria|algoritmo|quantico|burocracia|constituicao|hegel|nietzsche|versalhes|holocausto|genocidio|fenomenologia|dodecafonismo)\b/i;

const ADULT_ADIVINHA_TERMS = /\b(verga|pindureza|guedelho|carne crua|mentolia|panascudo|maliciosa)\b/i;

const VAGUE_NOUNS = new Set(['agua', 'fogo', 'vento', 'sol', 'lua', 'dia', 'noite']);

function validateAgeVocabulary(parsed, ageBands) {
  const issues = [];
  if (!Array.isArray(ageBands) || !ageBands.includes('6-9')) return issues;

  const blob = normalizeText(
    `${parsed.fact || ''} ${parsed.answer || ''} ${(parsed.clues || []).join(' ')}`,
  );
  if (HARD_WORDS_69.test(blob)) issues.push('vocab_too_hard_69');
  if (ADULT_ADIVINHA_TERMS.test(blob)) issues.push('adult_vocab');

  const longWords = blob.split(' ').filter((w) => w.length > 14);
  if (longWords.length >= 2) issues.push('vocab_too_hard_69');

  return issues;
}

function detectAmbiguousAdivinha(parsed) {
  const issues = [];
  const q = normalizeText(parsed.fact || '');
  const a = normalizeText(parsed.answer || '');
  const clues = (parsed.clues || []).map(normalizeText);

  if (GENERIC_ANSWERS.has(a)) issues.push('ambiguous_answer');
  if (a.length <= 2) issues.push('ambiguous_answer');
  if (VAGUE_NOUNS.has(a) && clues.length < 3) issues.push('ambiguous_answer');

  if (/\bpenas\b/.test(q) && /\bnao e um passaro\b/.test(q) && /\baviao\b/.test(a)) {
    issues.push('incoherent_adivinha');
  }
  if (/\bdentes\b/.test(q) && /\bnao mord/.test(q) && /\brelogio\b/.test(a) && !/\bpente\b/.test(a)) {
    issues.push('incoherent_adivinha');
  }
  if (/\bcomer me qu.*rias\b/.test(q) && /\bcabra\b/.test(a) && /\b(milho|centeio|trigo)\b/.test(a)) {
    issues.push('ambiguous_folklore');
  }
  if (/\bcostas\b/.test(q) && /\bnao tenho corpo\b/.test(q) && /\balfinete\b/.test(a)) {
    issues.push('incoherent_adivinha');
  }

  return issues;
}

function validateAdivinhaImport(parsed, ageBands) {
  return [
    ...validateAgeVocabulary(parsed, ageBands),
    ...detectAmbiguousAdivinha(parsed),
  ];
}

module.exports = {
  normalizeText,
  validateAgeVocabulary,
  detectAmbiguousAdivinha,
  validateAdivinhaImport,
};
