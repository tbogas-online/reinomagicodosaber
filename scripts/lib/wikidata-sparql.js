'use strict';

/**
 * Cliente SPARQL (WDQS) — conjuntos de factos, não um item isolado.
 * Detalhe de um Q-id: usar wikidata-rest.js (Wikibase REST v1).
 */

const SPARQL_ENDPOINT = 'https://query.wikidata.org/sparql';
const USER_AGENT = 'ReinoMagicoDoSaber/1.0 (knowledge-import; educational quiz)';
const DEFAULT_TIMEOUT_MS = 12000;
/** Preferir rótulos PT-PT; `pt` (muitas vezes PT-BR) e inglês só como reserva. */
const LABEL_LANGUAGES = 'pt-pt,pt,en';

function qidFromUri(uri) {
  const match = String(uri || '').match(/\/(Q\d+)$/i);
  return match ? match[1].toUpperCase() : '';
}

/** Aceita Q123, Q123:unesco-t, URLs /wiki/Q123, etc. */
function extractQid(...values) {
  for (const value of values) {
    const match = String(value || '').match(/\bQ\d+\b/i);
    if (match) return match[0].toUpperCase();
  }
  return '';
}

function bindValue(binding, key) {
  return String(binding?.[key]?.value || '').trim();
}

function parseSparqlBindings(data) {
  return Array.isArray(data?.results?.bindings) ? data.results.bindings : [];
}

function isUsableLabel(label) {
  const text = String(label || '').trim();
  if (text.length < 3 || text.length > 80) return false;
  if (/^Q\d+$/i.test(text)) return false;
  if (/[()]/.test(text)) return false;
  if (!/[a-záàâãéêíóôõúç]/i.test(text)) return false;
  return true;
}

async function fetchSparql(query, { fetchFn = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const url = `${SPARQL_ENDPOINT}?${new URLSearchParams({
    query,
    format: 'json',
  }).toString()}`;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetchFn(url, {
      method: 'GET',
      headers: {
        Accept: 'application/sparql-results+json',
        'User-Agent': USER_AGENT,
      },
      signal: controller?.signal,
    });
    if (!response?.ok) throw new Error(`Wikidata SPARQL HTTP ${response?.status || 0}`);
    return parseSparqlBindings(await response.json());
  } finally {
    if (timer) clearTimeout(timer);
  }
}

module.exports = {
  SPARQL_ENDPOINT,
  USER_AGENT,
  DEFAULT_TIMEOUT_MS,
  LABEL_LANGUAGES,
  qidFromUri,
  extractQid,
  bindValue,
  parseSparqlBindings,
  isUsableLabel,
  fetchSparql,
};
