'use strict';

/**
 * Normalização PT-PT para import (KR-1.1).
 * Heurísticas AO1990 + variantes comuns em fontes folclóricas — sem API Priberam.
 */

function applyCase(template, sample) {
  const t = String(template || '');
  const s = String(sample || '');
  if (!s) return t;
  if (s === s.toUpperCase()) return t.toUpperCase();
  if (s[0] === s[0].toUpperCase()) {
    return t.charAt(0).toUpperCase() + t.slice(1);
  }
  return t;
}

const WORD_REPLACEMENTS = [
  [/\bvoce\b/gi, (m) => applyCase('você', m)],
  [/\bnao\b/gi, (m) => applyCase('não', m)],
  [/\btambem\b/gi, (m) => applyCase('também', m)],
  [/\bja\b/gi, (m) => applyCase('já', m)],
  [/\bso\b/gi, (m) => applyCase('só', m)],
  [/\bacao\b/gi, (m) => applyCase('ação', m)],
  [/\bcoracao\b/gi, (m) => applyCase('coração', m)],
  [/\bsituacao\b/gi, (m) => applyCase('situação', m)],
  [/\binformacao\b/gi, (m) => applyCase('informação', m)],
  [/\baviao\b/gi, (m) => applyCase('avião', m)],
  [/\bpao\b/gi, (m) => applyCase('pão', m)],
  [/\barvore\b/gi, (m) => applyCase('árvore', m)],
  [/\bninguem\b/gi, (m) => applyCase('ninguém', m)],
  [/\balem\b/gi, (m) => applyCase('além', m)],
  [/\bportugues\b/gi, (m) => applyCase('português', m)],
  [/\balemao\b/gi, (m) => applyCase('alemão', m)],
  [/\bfrances\b/gi, (m) => applyCase('francês', m)],
  [/\bingles\b/gi, (m) => applyCase('inglês', m)],
  [/\boculos\b/gi, (m) => applyCase('óculos', m)],
  [/\btenis\b/gi, (m) => applyCase('ténis', m)],
  [/\blampada\b/gi, (m) => applyCase('lâmpada', m)],
  [/\bacucar\b/gi, (m) => applyCase('açúcar', m)],
  [/\bchocolate\b/gi, (m) => applyCase('chocolate', m)],
  [/\bcrianca\b/gi, (m) => applyCase('criança', m)],
  [/\bcriancas\b/gi, (m) => applyCase('crianças', m)],
  [/\bmae\b/gi, (m) => applyCase('mãe', m)],
];

function collapseWhitespace(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function normalizePtPtText(text) {
  let out = collapseWhitespace(text);
  if (!out) return out;
  for (const [pattern, replacer] of WORD_REPLACEMENTS) {
    out = out.replace(pattern, replacer);
  }
  return out;
}

function normalizePtPtRecord(fields) {
  const src = fields || {};
  return {
    fact: normalizePtPtText(src.fact),
    answer: normalizePtPtText(src.answer),
    clues: Array.isArray(src.clues)
      ? src.clues.map((c) => normalizePtPtText(c)).filter(Boolean)
      : [],
  };
}

module.exports = {
  normalizePtPtText,
  normalizePtPtRecord,
};
