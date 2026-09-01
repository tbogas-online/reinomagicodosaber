/**
 * knowledgeKey estruturado — Fase 2 modularização do QuestionEngine.
 * Formato: dominio|entidade|conceito|relação
 */
(function (global) {
  'use strict';

  const DOMAIN_BY_CATEGORY = Object.freeze({
    1: 'cultura_geral',
    2: 'geografia',
    3: 'historia',
    4: 'ciencia',
    5: 'natureza',
    6: 'espaco',
    7: 'matematica',
    8: 'literatura',
    9: 'portugues',
    10: 'arte',
    11: 'cinema',
    12: 'musica',
    13: 'moda',
    14: 'gastronomia',
    15: 'desporto',
    16: 'jogos',
    17: 'tecnologia',
    18: 'culturas_mundo',
    19: 'transportes',
    20: 'adivinhas',
  });

  const STRUCTURED_KEY_PARTS = 4;

  function defaultNormalize(s) {
    return String(s || '').trim().toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ');
  }

  function pickString(obj, keys) {
    if (!obj || typeof obj !== 'object') return '';
    for (const k of keys) {
      const v = obj[k];
      if (v != null && String(v).trim()) return String(v).trim();
    }
    return '';
  }

  /** Extrai metadados de conhecimento de payloads IA (Groq, OpenAI, Anthropic). */
  function parseKnowledgeMeta(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const nested = raw.knowledge || raw.conhecimento || raw.k || null;
    const entity = pickString(nested, ['entity', 'entidade', 'ent'])
      || pickString(raw, ['entity', 'entidade', 'k_entity', 'k_entidade']);
    const concept = pickString(nested, ['concept', 'conceito', 'con'])
      || pickString(raw, ['concept', 'conceito', 'k_concept', 'k_conceito']);
    const relation = pickString(nested, ['relation', 'relacao', 'relação', 'rel'])
      || pickString(raw, ['relation', 'relacao', 'relação', 'k_relation', 'k_relacao']);
    if (!entity || !concept) return null;
    return { entity, concept, relation: relation || '' };
  }

  function isStructuredKey(key) {
    const parts = String(key || '').split('|');
    return parts.length >= 3 && parts.every((p) => p.trim().length > 0);
  }

  function parseStructuredKey(key, normalizeFn) {
    const norm = normalizeFn || defaultNormalize;
    const parts = String(key || '').split('|').map((p) => norm(p)).filter(Boolean);
    if (parts.length < 3) return null;
    return {
      domain: parts[0],
      entity: parts[1],
      concept: parts[2],
      relation: parts[3] || '',
    };
  }

  function buildStructuredKey(meta, categoryNumber, normalizeFn) {
    const norm = normalizeFn || defaultNormalize;
    const entity = norm(meta?.entity);
    const concept = norm(meta?.concept);
    if (!entity || !concept) return null;
    const domain = DOMAIN_BY_CATEGORY[Number(categoryNumber)] || 'geral';
    const relation = norm(meta?.relation || '');
    return `${domain}|${entity}|${concept}|${relation}`;
  }

  function structuredKeysMatch(sa, sb) {
    if (!sa || !sb) return false;
    if (sa.domain === sb.domain && sa.entity === sb.entity && sa.concept === sb.concept) return true;
    if (sa.entity === sb.entity && sa.concept === sb.concept) return true;
    return false;
  }

  function legacyKeyMatchesStructured(legacyKey, structured, normalizeFn) {
    const norm = normalizeFn || defaultNormalize;
    const legacy = norm(legacyKey);
    if (!legacy || !structured) return false;
    if (legacy === structured.entity || legacy === `${structured.concept} ${structured.entity}`) return true;
    if (legacy.includes(structured.entity) && legacy.includes(structured.concept)) return true;
    return false;
  }

  function legacyKeysMatch(a, b, jaccardFn, threshold) {
    const normA = String(a || '').trim();
    const normB = String(b || '').trim();
    if (!normA || !normB) return false;
    if (normA === normB) return true;
    const short = normA.length <= normB.length ? normA : normB;
    const long = normA.length <= normB.length ? normB : normA;
    if (long.includes(short)) {
      const shortTokens = short.split(/\s+/).filter(Boolean);
      if (shortTokens.length === 1 && short.length >= 4) {
        return jaccardFn(short, long) >= threshold;
      }
      return true;
    }
    return jaccardFn(normA, normB) >= threshold;
  }

  function knowledgeKeysMatch(keyA, keyB, normalizeFn, jaccardFn, jaccardThreshold) {
    const sa = parseStructuredKey(keyA, normalizeFn);
    const sb = parseStructuredKey(keyB, normalizeFn);
    if (sa && sb) return structuredKeysMatch(sa, sb);
    if (sa && !sb) return legacyKeyMatchesStructured(keyB, sa, normalizeFn);
    if (!sa && sb) return legacyKeyMatchesStructured(keyA, sb, normalizeFn);
    if (typeof jaccardFn === 'function' && jaccardThreshold != null) {
      return legacyKeysMatch(keyA, keyB, jaccardFn, jaccardThreshold);
    }
    const a = (normalizeFn || defaultNormalize)(keyA);
    const b = (normalizeFn || defaultNormalize)(keyB);
    if (a === b) return true;
    if (a.includes(b) || b.includes(a)) return true;
    return false;
  }

  global.QuestionEngineKnowledgeKey = Object.freeze({
    DOMAIN_BY_CATEGORY,
    STRUCTURED_KEY_PARTS,
    parseKnowledgeMeta,
    isStructuredKey,
    parseStructuredKey,
    buildStructuredKey,
    knowledgeKeysMatch,
    structuredKeysMatch,
  });
})(typeof window !== 'undefined' ? window : globalThis);
