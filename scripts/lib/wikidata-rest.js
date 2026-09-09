'use strict';

/**
 * Cliente Wikibase REST v1 — um item, propriedade ou statement de cada vez.
 * Conjuntos de factos: usar SPARQL/WDQS (wikidata-sparql.js).
 * Docs: https://www.wikidata.org/w/rest.php/wikibase/v1
 */

const { extractQid } = require('./wikidata-sparql');

const REST_BASE = 'https://www.wikidata.org/w/rest.php/wikibase/v1';
const USER_AGENT = 'ReinoMagicoDoSaber/1.0 (knowledge-import; educational quiz)';
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_FIELDS = ['labels', 'descriptions', 'aliases', 'statements'];
const PT_LANGS = ['pt', 'pt-pt', 'pt-br', 'en'];

function itemUrl(qid, fields = DEFAULT_FIELDS) {
  const id = String(qid || '').trim().toUpperCase();
  const params = new URLSearchParams();
  if (fields?.length) params.set('_fields', fields.join(','));
  const query = params.toString();
  return `${REST_BASE}/entities/items/${id}${query ? `?${query}` : ''}`;
}

function statementsUrl(qid, propertyId) {
  const id = String(qid || '').trim().toUpperCase();
  const prop = String(propertyId || '').trim().toUpperCase();
  if (prop) return `${REST_BASE}/entities/items/${id}/statements/${prop}`;
  return `${REST_BASE}/entities/items/${id}/statements`;
}

async function fetchJson(url, { fetchFn = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetchFn(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
      },
      signal: controller?.signal,
    });
    if (!response?.ok) throw new Error(`Wikidata REST HTTP ${response?.status || 0}`);
    return await response.json();
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function fetchItem(qid, opts = {}) {
  const id = String(qid || '').trim().toUpperCase();
  if (!/^Q\d+$/.test(id)) throw new Error(`Q-id inválido: ${qid}`);
  return fetchJson(itemUrl(id, opts.fields || DEFAULT_FIELDS), opts);
}

function langValue(bag, langs = PT_LANGS) {
  if (!bag || typeof bag !== 'object') return '';
  for (const lang of langs) {
    const raw = bag[lang];
    if (raw == null) continue;
    if (typeof raw === 'string' && raw.trim()) return raw.trim();
    if (typeof raw === 'object' && !Array.isArray(raw) && raw.value) return String(raw.value).trim();
    if (Array.isArray(raw) && raw[0]) {
      const first = raw[0];
      if (typeof first === 'string') return first.trim();
      if (first?.value) return String(first.value).trim();
    }
  }
  return '';
}

function pickLabel(item, langs = PT_LANGS) {
  return langValue(item?.labels, langs);
}

function pickDescription(item, langs = PT_LANGS) {
  return langValue(item?.descriptions, langs);
}

function statementContentToString(content) {
  if (content == null) return '';
  if (typeof content === 'string' || typeof content === 'number') return String(content);
  if (typeof content === 'object') {
    if (content.id) return String(content.id);
    if (content.amount != null) return String(content.amount).replace(/^\+/, '');
    if (content.time) return String(content.time);
    if (content.text) return String(content.text);
  }
  return '';
}

function statementContents(item, propertyId) {
  const prop = String(propertyId || '').trim().toUpperCase();
  const groups = item?.statements?.[prop];
  if (!Array.isArray(groups)) return [];
  return groups
    .map((stmt) => statementContentToString(stmt?.value?.content ?? stmt?.value))
    .map((text) => String(text || '').trim())
    .filter(Boolean);
}

function attachRestMetadata(record, item) {
  if (!record) return record;
  const label = pickLabel(item);
  const description = pickDescription(item);
  return {
    ...record,
    verified_by: record.verified_by
      ? `${record.verified_by}+rest`
      : 'wikidata-rest-v1',
    metadata: {
      ...(record.metadata && typeof record.metadata === 'object' ? record.metadata : {}),
      restId: item?.id || null,
      restLabel: label || null,
      restDescription: description || null,
    },
  };
}

function buildVerifiedAiInput(record, item) {
  const qid = extractQid(record?.source_id, record?.sourceId, record?.metadata?.qid, item?.id);
  const fact = String(record?.fact || '').trim();
  const answer = record?.is_true === false || record?.isTrue === false
    ? 'Falso'
    : (record?.is_true === true || record?.isTrue === true
      ? 'Verdadeiro'
      : String(record?.answer || '').trim());
  return {
    knowledgeId: record?.knowledge_id || record?.knowledgeId || '',
    qid,
    fact,
    answer,
    label: pickLabel(item) || '',
    description: pickDescription(item) || String(record?.metadata?.restDescription || ''),
    source: 'Wikidata',
    sourceId: qid,
    sourceUrl: qid ? `https://www.wikidata.org/wiki/${qid}` : String(record?.source_url || record?.sourceUrl || ''),
    instruction: 'NÃO inventes factos. Formula a pergunta só a partir deste facto verificado.',
  };
}

async function enrichRecordsWithRest(records, {
  fetchFn,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  concurrency = 5,
  fields = ['labels', 'descriptions', 'aliases'],
} = {}) {
  const out = [];
  for (let i = 0; i < records.length; i += concurrency) {
    const chunk = records.slice(i, i + concurrency);
    const enriched = await Promise.all(chunk.map(async (record) => {
      const qid = extractQid(record?.source_id, record?.sourceId, record?.metadata?.qid, record?.source_url, record?.sourceUrl);
      if (!qid) return record;
      try {
        const item = await fetchItem(qid, { fetchFn, timeoutMs, fields });
        return attachRestMetadata(record, item);
      } catch {
        return record;
      }
    }));
    out.push(...enriched);
  }
  return out;
}

module.exports = {
  REST_BASE,
  USER_AGENT,
  DEFAULT_FIELDS,
  PT_LANGS,
  itemUrl,
  statementsUrl,
  fetchItem,
  langValue,
  pickLabel,
  pickDescription,
  statementContents,
  attachRestMetadata,
  buildVerifiedAiInput,
  enrichRecordsWithRest,
};
