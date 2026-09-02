'use strict';

/**
 * KR-0.3 — política de confiança e fontes (partilhada com import scripts).
 * Espelhada em public/knowledge-repository.js para o browser.
 */

const HIGH_CONFIDENCE_TRUST = 0.92;

/** Confiança mínima por categoria (e opcionalmente por formato). */
const MIN_CONFIDENCE_BY_CATEGORY = {
  20: {
    default: 0.85,
    ADIVINHA: 0.9,
    CURIOSIDADE: 0.85,
    VERDADEIRO_FALSO: 0.85,
  },
};

const DEFAULT_MIN_CONFIDENCE = 0.85;

/** Padrões de fonte permitidos por categoria (match parcial, normalizado). */
const SOURCE_ALLOWLIST_BY_CATEGORY = {
  20: [
    'memoriamedia',
    'memoria media',
    'giacometti',
    'ditos',
    'manual',
    'sample',
    'rtp',
    'ciencia viva',
    'museu',
    'unesco',
    'wikidata',
    'academia',
    'bnp',
    'folclore',
    'pumpkin',
    'santander',
    'brinca',
    'quero bolsa',
    'curadoria',
    'repositorio',
  ],
};

function stripDiacritics(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function normalizeSourceKey(source) {
  return stripDiacritics(String(source || '').toLowerCase())
    .replace(/\s+/g, ' ')
    .trim();
}

function getMinConfidence(categoryN, formatId) {
  const cat = MIN_CONFIDENCE_BY_CATEGORY[Number(categoryN)];
  if (!cat) return DEFAULT_MIN_CONFIDENCE;
  const fmt = String(formatId || '').trim().toUpperCase();
  if (fmt && cat[fmt] != null) return cat[fmt];
  return cat.default ?? DEFAULT_MIN_CONFIDENCE;
}

function getSourceAllowlist(categoryN) {
  return SOURCE_ALLOWLIST_BY_CATEGORY[Number(categoryN)] || [];
}

function isSourceAllowed(record, { categoryN, formatId } = {}) {
  const category = Number(categoryN ?? record?.category ?? record?.category_n ?? 0);
  const src = normalizeSourceKey(record?.source);
  if (!src) return false;

  const allowlist = getSourceAllowlist(category);
  if (allowlist.some((pattern) => src.includes(normalizeSourceKey(pattern)))) {
    return true;
  }

  const confidence = Number(record?.confidence) || 0;
  return confidence >= HIGH_CONFIDENCE_TRUST;
}

function isRecordBlocked(record) {
  if (!record) return true;
  if (record.blocked === true) return true;
  if (record.isActive === false || record.is_active === false) return true;
  const superseded = record.supersededBy || record.superseded_by;
  return !!(superseded && String(superseded).trim());
}

function isRecordHighTrust(record) {
  const src = normalizeSourceKey(record?.source);
  if (
    src.includes('memoriamedia')
    || src.includes('memoria media')
    || src === 'manual'
    || /pumpkin|santander|brinca|ditos\.pt|ditos|quero bolsa/.test(src)
  ) {
    return true;
  }
  return (Number(record?.confidence) || 0) >= HIGH_CONFIDENCE_TRUST;
}

/**
 * Avalia se um registo pode ser usado no jogo/import.
 * @returns {{ ok: boolean, reason?: string }}
 */
function evaluateRecordPolicy(record, { categoryN, formatId } = {}) {
  if (!record) return { ok: false, reason: 'missing_record' };
  if (isRecordBlocked(record)) return { ok: false, reason: 'blocked_or_superseded' };

  const category = Number(categoryN ?? record.category ?? record.category_n ?? 0);
  const minConf = getMinConfidence(category, formatId);
  const confidence = Number(record.confidence) || 0;
  if (confidence < minConf) {
    return { ok: false, reason: 'confidence_below_minimum', minConfidence: minConf, confidence };
  }

  if (!isSourceAllowed(record, { categoryN: category, formatId })) {
    return { ok: false, reason: 'source_not_allowed' };
  }

  return { ok: true };
}

module.exports = {
  HIGH_CONFIDENCE_TRUST,
  MIN_CONFIDENCE_BY_CATEGORY,
  DEFAULT_MIN_CONFIDENCE,
  SOURCE_ALLOWLIST_BY_CATEGORY,
  normalizeSourceKey,
  getMinConfidence,
  getSourceAllowlist,
  isSourceAllowed,
  isRecordBlocked,
  isRecordHighTrust,
  evaluateRecordPolicy,
};
