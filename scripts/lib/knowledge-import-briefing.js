'use strict';

/**
 * Briefing de curadoria para Importar fontes.
 * Contrata o colector da fonte (SPARQL/API/fila). Não é um prompt de LLM:
 * o Question Engine formula perguntas só depois do facto estar no repositório.
 */

const { getCategoryTopic } = require('./wikidata-category-topics');

const GOALS = ['fill-gaps', 'theme', 'discover'];
const AGE_BANDS = ['6-9', '10-15', '15+'];
const SCOPES = ['portugal', 'europa', 'world'];
const CONTENT_TYPES = ['place', 'person', 'animal', 'event', 'object', 'date', 'record', 'curiosity'];
const FORMATS = [
  'RESPOSTA_DIRETA',
  'ESCOLHA_MULTIPLA',
  'VERDADEIRO_FALSO',
  'ONDE_FICA',
  'CURIOSIDADE',
  'ADIVINHA',
];
const LIMITS = [5, 10, 20];
const MAX_LIMIT = 20;

const COLLECTORS = [
  {
    id: 'curiosidades-batch',
    status: 'active',
    usesBriefing: false,
    label: 'Curiosidades — lotes manuais',
  },
  {
    id: 'wikidata',
    status: 'active',
    usesBriefing: true,
    label: 'Wikidata',
  },
  { id: 'rtp', status: 'unavailable', usesBriefing: true, label: 'RTP / RTP Ensina' },
  { id: 'ciencia-viva', status: 'unavailable', usesBriefing: true, label: 'Ciência Viva' },
  { id: 'bnp', status: 'unavailable', usesBriefing: true, label: 'Biblioteca Nacional' },
  { id: 'arquivo-pt', status: 'unavailable', usesBriefing: true, label: 'Arquivo.pt' },
];

function listCollectors() {
  return COLLECTORS.map((row) => ({ ...row }));
}

function getCollector(source) {
  const id = String(source || '').trim();
  return COLLECTORS.find((row) => row.id === id) || null;
}

function requireCollector(source) {
  const collector = getCollector(source);
  if (!collector) {
    const err = new Error('Fonte de importação desconhecida. Usa «curiosidades-batch» ou «wikidata».');
    err.code = 'INVALID_SOURCE';
    throw err;
  }
  if (collector.status !== 'active') {
    const err = new Error(`${collector.label} ainda não tem colector. Usa Wikidata ou os lotes manuais.`);
    err.code = 'COLLECTOR_UNAVAILABLE';
    throw err;
  }
  return collector;
}

function defaultAgeBands(categoryN) {
  return Number(categoryN) === 20 ? ['10-15', '15+'] : [...AGE_BANDS];
}

function defaultFormats(categoryN) {
  const n = Number(categoryN);
  if (n === 20) return ['CURIOSIDADE', 'VERDADEIRO_FALSO'];
  if (n === 2) return ['RESPOSTA_DIRETA', 'ESCOLHA_MULTIPLA', 'VERDADEIRO_FALSO', 'ONDE_FICA'];
  return ['RESPOSTA_DIRETA', 'ESCOLHA_MULTIPLA', 'VERDADEIRO_FALSO'];
}

function pickAllowed(value, allowed, fallback) {
  const key = String(value || '').trim();
  return allowed.includes(key) ? key : fallback;
}

function uniqueAllowed(list, allowed, fallback) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const key = String(raw || '').trim();
    if (!allowed.includes(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out.length ? out : [...fallback];
}

function clampLimit(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 10;
  if (LIMITS.includes(n)) return n;
  return Math.min(MAX_LIMIT, Math.max(5, Math.round(n / 5) * 5));
}

function parseBriefing(input = {}) {
  const errors = [];
  const source = String(input.source || input.kind || 'wikidata').trim() || 'wikidata';
  const categoryN = Number(input.categoryN) || 20;
  if (!Number.isInteger(categoryN) || categoryN < 1 || categoryN > 20) {
    errors.push('categoria');
  }
  const topic = String(input.topic || getCategoryTopic(categoryN)?.topic || '').trim();
  const subtopic = String(input.subtopic || '').trim();
  const focus = String(input.focus || '').trim();
  const goal = pickAllowed(input.goal, GOALS, 'theme');
  const scope = pickAllowed(input.scope, SCOPES, 'world');
  const contentType = pickAllowed(input.contentType, CONTENT_TYPES, categoryN === 5 ? 'animal' : (categoryN === 2 ? 'place' : 'curiosity'));
  const limit = clampLimit(input.limit);
  const ageBands = uniqueAllowed(input.ageBands, AGE_BANDS, defaultAgeBands(categoryN));
  const allowedFormats = uniqueAllowed(
    input.allowedFormats,
    FORMATS,
    defaultFormats(categoryN),
  );
  const words = Array.isArray(input.words) ? input.words.map((w) => String(w || '').trim()).filter(Boolean) : [];
  const preset = String(input.preset || '').trim();

  const briefing = {
    source,
    goal,
    categoryN: Number.isInteger(categoryN) && categoryN >= 1 && categoryN <= 20 ? categoryN : 20,
    topic,
    subtopic,
    focus,
    ageBands,
    contentType,
    scope,
    words,
    preset,
    limit,
    allowedFormats,
  };

  return { briefing, errors };
}

function applyBriefingToRecords(records, briefing) {
  if (!briefing) return records || [];
  return (records || []).map((row) => {
    const metadata = { ...(row.metadata && typeof row.metadata === 'object' ? row.metadata : {}) };
    metadata.briefing = {
      goal: briefing.goal,
      scope: briefing.scope,
      contentType: briefing.contentType,
      limit: briefing.limit,
      categoryN: briefing.categoryN,
      subtopic: briefing.subtopic || null,
      focus: briefing.focus || null,
    };
    const subtopicPath = [briefing.subtopic, briefing.focus].filter(Boolean).join(' · ');
    return {
      ...row,
      topic: briefing.topic || row.topic,
      subtopic: subtopicPath || row.subtopic || null,
      age_bands: [...briefing.ageBands],
      allowed_formats: [...briefing.allowedFormats],
      metadata,
    };
  });
}

function briefingSummary(briefing) {
  if (!briefing) return '';
  const ages = (briefing.ageBands || []).join(', ');
  const scopeLabel = briefing.scope === 'portugal' ? 'Portugal' : (briefing.scope === 'europa' ? 'Europa' : 'Mundial');
  const path = [briefing.subtopic, briefing.focus].filter(Boolean).join(' · ');
  return `cat. ${briefing.categoryN}${path ? ` · ${path}` : ''} · ${scopeLabel} · ${briefing.contentType} · ${briefing.limit} · ${ages}`;
}

module.exports = {
  GOALS,
  AGE_BANDS,
  SCOPES,
  CONTENT_TYPES,
  FORMATS,
  LIMITS,
  MAX_LIMIT,
  listCollectors,
  getCollector,
  requireCollector,
  defaultAgeBands,
  defaultFormats,
  parseBriefing,
  applyBriefingToRecords,
  briefingSummary,
};
