'use strict';

const { normalizeRecord, validateRecord, importBatch } = require('./knowledge-import-core');
const { filterNewRecords } = require('./knowledge-dedupe');
const { buildBatch50Records } = require('./curiosidades-batch-50-build');
const { buildBatch50BRecords } = require('./curiosidades-batch-50-b-build');
const { buildBatch50CRecords } = require('./curiosidades-batch-50-c-build');

const BATCH_DEFS = {
  a: { id: 'a', label: 'Lote A', expected: 50, build: buildBatch50Records },
  b: { id: 'b', label: 'Lote B', expected: 50, build: buildBatch50BRecords },
  c: { id: 'c', label: 'Lote C', expected: 48, build: buildBatch50CRecords },
};

function resolveBatchIds(batch) {
  const key = String(batch || 'all').trim().toLowerCase();
  if (key === 'all' || key === 'abc') return ['a', 'b', 'c'];
  if (BATCH_DEFS[key]) return [key];
  const err = new Error('Lote inválido. Usa a, b, c ou all.');
  err.code = 'INVALID_BATCH';
  throw err;
}

function listImportSources() {
  return [
    {
      id: 'all',
      kind: 'curiosidades-batch',
      label: 'Curiosidades — lotes A+B+C (148, curadoria manual)',
      source: 'manual',
    },
    {
      id: 'a',
      kind: 'curiosidades-batch',
      label: 'Curiosidades — lote A (50)',
      source: 'manual',
    },
    {
      id: 'b',
      kind: 'curiosidades-batch',
      label: 'Curiosidades — lote B (50)',
      source: 'manual',
    },
    {
      id: 'c',
      kind: 'curiosidades-batch',
      label: 'Curiosidades — lote C (48)',
      source: 'manual',
    },
  ];
}

function buildRecords(batch) {
  const records = [];
  for (const id of resolveBatchIds(batch)) {
    records.push(...BATCH_DEFS[id].build().map((row) => normalizeRecord(row)));
  }
  return records;
}

async function fetchExistingCuriosidades(cfg) {
  const pageSize = 1000;
  let offset = 0;
  const all = [];
  while (true) {
    const response = await fetch(
      `${cfg.url.replace(/\/$/, '')}/rest/v1/knowledge_records?select=knowledge_id,topic,fact,answer,is_active&category_n=eq.20&topic=eq.curiosidade+surpreendente&is_active=eq.true`,
      {
        headers: {
          apikey: cfg.key,
          Authorization: `Bearer ${cfg.key}`,
          Range: `${offset}-${offset + pageSize - 1}`,
        },
      },
    );
    if (!response.ok) throw new Error(`knowledge_records: HTTP ${response.status}`);
    const rows = await response.json();
    all.push(...rows);
    if (rows.length < pageSize) break;
    offset += pageSize;
  }
  return all;
}

async function importCuriosidadesBatches(cfg, { batch = 'all', dryRun = false } = {}) {
  if (!cfg?.url || !cfg?.key) {
    const err = new Error('Supabase admin não configurado (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).');
    err.code = 'NOT_CONFIGURED';
    throw err;
  }

  const batchIds = resolveBatchIds(batch);
  const records = buildRecords(batch);
  const invalid = records
    .map((record) => ({ knowledgeId: record.knowledge_id, missing: validateRecord(record) }))
    .filter((row) => row.missing.length);

  if (invalid.length) {
    const err = new Error(`${invalid.length} registo(s) inválido(s) no lote.`);
    err.code = 'INVALID_RECORD';
    err.details = invalid.slice(0, 5);
    throw err;
  }

  const existing = await fetchExistingCuriosidades(cfg);
  const { accepted, skipped } = filterNewRecords(records, existing);
  const labels = batchIds.map((id) => BATCH_DEFS[id].label).join(' + ');

  const summary = {
    ok: true,
    action: 'import-source',
    source: 'curiosidades-batch',
    batch: batchIds.join('+'),
    labels,
    dryRun: !!dryRun,
    total: records.length,
    newCount: accepted.length,
    skipped: skipped.length,
    imported: 0,
    skippedPreview: skipped.slice(0, 8).map((item) => ({
      knowledgeId: item.record?.knowledge_id,
      reason: item.reason,
      of: item.of,
    })),
  };

  if (dryRun) {
    summary.message = `Simulação (${labels}): ${accepted.length} novo(s), ${skipped.length} já no repositório.`;
    return summary;
  }

  if (!accepted.length) {
    summary.message = `Nada a importar (${labels}) — todos os factos deste lote já estão no repositório.`;
    return summary;
  }

  const result = await importBatch(cfg.url, cfg.key, accepted);
  summary.imported = accepted.length;
  summary.result = result;
  summary.message = `Importados ${accepted.length} facto(s) de ${labels} (${skipped.length} ignorado(s) por duplicado).`;
  return summary;
}

module.exports = {
  BATCH_DEFS,
  resolveBatchIds,
  listImportSources,
  buildRecords,
  fetchExistingCuriosidades,
  importCuriosidadesBatches,
};
