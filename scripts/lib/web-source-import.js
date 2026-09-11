'use strict';

const { parseBriefing, MAX_LIMIT } = require('./knowledge-import-briefing');
const { collectRtpRecords, listRtpImportSources } = require('./rtp-ensina-collect');
const { collectCienciaVivaRecords, listCienciaVivaImportSources } = require('./ciencia-viva-collect');
const { persistWikidataRecords } = require('./wikidata-curiosidades-import');
const {
  applyKnowledgeIdFilter,
  coerceImportRecords,
} = require('./wikidata-keyword-search');

function listWebImportSources() {
  return [...listRtpImportSources(), ...listCienciaVivaImportSources()];
}

function collectorUnavailableError(err, label) {
  const msg = String(err?.message || err || '');
  if (err?.name === 'AbortError' || /aborted|abortado/i.test(msg)) {
    const wrapped = new Error(`${label} demorou demasiado. Tenta simular outra vez daqui a um momento.`);
    wrapped.code = 'COLLECTOR_FETCH';
    return wrapped;
  }
  const wrapped = new Error(`${label} indisponível: ${msg}`);
  wrapped.code = 'COLLECTOR_FETCH';
  return wrapped;
}

async function importWebSourceFromOptions(cfg, {
  source,
  dryRun = false,
  fetchFn,
  categoryN,
  words,
  knowledgeIds,
  records,
  excludeKnowledgeIds,
  rejectedRecords,
  briefing = null,
} = {}) {
  if (!cfg?.url || !cfg?.key) {
    const err = new Error('Supabase admin não configurado (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).');
    err.code = 'NOT_CONFIGURED';
    throw err;
  }

  const kind = String(source || '').trim();
  const parsed = parseBriefing({
    ...(briefing && typeof briefing === 'object' ? briefing : {}),
    source: kind,
    categoryN: briefing?.categoryN ?? categoryN,
    words: briefing?.words ?? words,
  });
  const labels = kind === 'rtp' ? 'RTP Ensina' : 'Ciência Viva';
  const fromPreview = applyKnowledgeIdFilter(
    coerceImportRecords(Array.isArray(records) ? records : []),
    knowledgeIds,
  ).records;

  let raw;
  try {
    if (!dryRun && fromPreview.length) {
      raw = fromPreview;
    } else if (kind === 'rtp') {
      raw = await collectRtpRecords({
        categoryN: parsed.briefing.categoryN,
        words: parsed.briefing.words,
        limit: parsed.briefing.limit || MAX_LIMIT,
        fetchFn,
      });
    } else {
      raw = await collectCienciaVivaRecords({
        categoryN: parsed.briefing.categoryN,
        words: parsed.briefing.words,
        limit: parsed.briefing.limit || MAX_LIMIT,
        fetchFn,
      });
    }
  } catch (err) {
    throw collectorUnavailableError(err, labels);
  }

  return persistWikidataRecords(cfg, raw, {
    dryRun,
    fetchFn,
    materializeQuestions: false,
    labels,
    collectorId: kind,
    knowledgeIds,
    excludeKnowledgeIds,
    rejectedRecords,
    briefing: parsed.briefing,
  });
}

module.exports = {
  listWebImportSources,
  importWebSourceFromOptions,
};
