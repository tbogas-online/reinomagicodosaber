#!/usr/bin/env node
'use strict';

require('./load-env').loadEnvLocal();

const fs = require('fs');
const path = require('path');
const { normalizeRecord, validateRecord, importBatch } = require('./lib/knowledge-import-core');
const { buildBatch50Records } = require('./lib/curiosidades-batch-50-build');
const { buildBatch50BRecords } = require('./lib/curiosidades-batch-50-b-build');
const { buildBatch50CRecords } = require('./lib/curiosidades-batch-50-c-build');
const { filterNewRecords } = require('./lib/knowledge-dedupe');

const BATCH_LOADERS = [
  { flag: '--batch-50-c', build: buildBatch50CRecords, label: 'batch-50-c' },
  { flag: '--batch-50-b', build: buildBatch50BRecords, label: 'batch-50-b' },
  { flag: '--batch-50', build: buildBatch50Records, label: 'batch-50' },
];

function loadQueueRecords() {
  const queuePath = path.join(__dirname, '..', 'data', 'knowledge-import-queue.json');
  const queue = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
  return queue.items
    .filter((item) => item.record?.topic === 'curiosidade surpreendente')
    .map((item) => normalizeRecord(item.record));
}

function loadBatchRecords(argv) {
  const batch = BATCH_LOADERS.find((entry) => argv.includes(entry.flag));
  if (batch) return batch.build();
  return loadQueueRecords();
}

function exportLabel(argv) {
  const batch = BATCH_LOADERS.find((entry) => argv.includes(entry.flag));
  return batch ? batch.label : 'fila';
}

function writeExport(records, label) {
  const exportPath = path.join(__dirname, '..', 'data', `knowledge-curiosidades-${label}.json`);
  const payload = {
    exportedAt: new Date().toISOString(),
    count: records.length,
    items: records,
  };
  fs.writeFileSync(exportPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return exportPath;
}

async function fetchExisting(cfg) {
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

async function main() {
  const argv = process.argv.slice(2);
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Define SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY em .env.local');
    process.exit(1);
  }

  const dryRun = argv.includes('--dry-run');
  const label = exportLabel(argv);
  const records = loadBatchRecords(argv).map((record) => normalizeRecord(record));

  const invalid = records.filter((r) => validateRecord(r).length);
  if (invalid.length) {
    console.error(`${invalid.length} registos inválidos`);
    invalid.slice(0, 3).forEach((r) => {
      console.error(`  ${r.knowledge_id}:`, validateRecord(r));
    });
    process.exit(1);
  }

  if (label.startsWith('batch')) {
    console.log(`Export: ${writeExport(records, label)}`);
  }

  const existing = await fetchExisting({ url, key });
  const { accepted, skipped } = filterNewRecords(records, existing);

  console.log(`Curiosidades (${label}): ${records.length} no lote, ${skipped.length} duplicado(s), ${accepted.length} novo(s).`);

  if (skipped.length) {
    skipped.slice(0, 5).forEach((s) => {
      console.log(`  ignorado ${s.record.knowledge_id} (${s.reason}) — já existe ${s.of}`);
    });
    if (skipped.length > 5) console.log(`  … +${skipped.length - 5} ignorado(s)`);
  }

  if (dryRun) {
    console.log({ ok: true, dryRun: true, import: accepted.length, skipped: skipped.length });
    return;
  }

  if (!accepted.length) {
    console.log('Nada a importar.');
    return;
  }

  const result = await importBatch(url, key, accepted);
  console.log(result);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
