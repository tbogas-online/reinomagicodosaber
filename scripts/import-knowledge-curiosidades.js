#!/usr/bin/env node
'use strict';

require('./load-env').loadEnvLocal();

const fs = require('fs');
const path = require('path');
const { normalizeRecord, validateRecord, importBatch } = require('./lib/knowledge-import-core');
const { filterNewRecords } = require('./lib/knowledge-dedupe');
const {
  buildRecords,
  fetchExistingCuriosidades,
  importCuriosidadesBatches,
} = require('./lib/curiosidades-batch-import');

function batchFromArgv(argv) {
  if (argv.includes('--batch-50-c')) return 'c';
  if (argv.includes('--batch-50-b')) return 'b';
  if (argv.includes('--batch-50')) return 'a';
  return null;
}

function loadQueueRecords() {
  const queuePath = path.join(__dirname, '..', 'data', 'knowledge-import-queue.json');
  const queue = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
  return queue.items
    .filter((item) => item.record?.topic === 'curiosidade surpreendente')
    .map((item) => normalizeRecord(item.record));
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

async function importQueue({ url, key, dryRun }) {
  const records = loadQueueRecords();
  const invalid = records.filter((r) => validateRecord(r).length);
  if (invalid.length) {
    console.error(`${invalid.length} registos inválidos`);
    invalid.slice(0, 3).forEach((r) => {
      console.error(`  ${r.knowledge_id}:`, validateRecord(r));
    });
    process.exit(1);
  }

  const existing = await fetchExistingCuriosidades({ url, key });
  const { accepted, skipped } = filterNewRecords(records, existing);
  console.log(`Curiosidades (fila): ${records.length} no lote, ${skipped.length} duplicado(s), ${accepted.length} novo(s).`);

  if (dryRun) {
    console.log({ ok: true, dryRun: true, import: accepted.length, skipped: skipped.length });
    return;
  }
  if (!accepted.length) {
    console.log('Nada a importar.');
    return;
  }
  console.log(await importBatch(url, key, accepted));
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
  const batch = batchFromArgv(argv);

  if (batch) {
    const records = buildRecords(batch);
    const exportName = batch === 'a' ? 'batch-50' : batch === 'b' ? 'batch-50-b' : 'batch-50-c';
    console.log(`Export: ${writeExport(records, exportName)}`);
    const summary = await importCuriosidadesBatches({ url, key }, { batch, dryRun });
    console.log(summary.message);
    if (summary.skippedPreview?.length) {
      summary.skippedPreview.slice(0, 5).forEach((row) => {
        console.log(`  ignorado ${row.knowledgeId} (${row.reason}) — já existe ${row.of}`);
      });
    }
    return;
  }

  await importQueue({ url, key, dryRun });
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
