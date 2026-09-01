#!/usr/bin/env node
'use strict';

require('./load-env').loadEnvLocal();

const fs = require('fs');
const path = require('path');
const { normalizeRecord, validateRecord, importBatch } = require('./lib/knowledge-import-core');
const { buildBatch50Records } = require('./lib/curiosidades-batch-50-build');

function loadQueueRecords() {
  const queuePath = path.join(__dirname, '..', 'data', 'knowledge-import-queue.json');
  const queue = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
  return queue.items
    .filter((item) => item.record?.topic === 'curiosidade surpreendente')
    .map((item) => normalizeRecord(item.record));
}

function loadBatch50Records() {
  return buildBatch50Records().map((record) => normalizeRecord(record));
}

function writeBatch50Export(records) {
  const exportPath = path.join(__dirname, '..', 'data', 'knowledge-curiosidades-batch-50.json');
  const payload = {
    exportedAt: new Date().toISOString(),
    count: records.length,
    items: records,
  };
  fs.writeFileSync(exportPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return exportPath;
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Define SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY em .env.local');
    process.exit(1);
  }

  const useBatch50 = process.argv.includes('--batch-50');
  const dryRun = process.argv.includes('--dry-run');

  const records = useBatch50 ? loadBatch50Records() : loadQueueRecords();
  const invalid = records.filter((r) => validateRecord(r).length);
  if (invalid.length) {
    console.error(`${invalid.length} registos inválidos`);
    invalid.slice(0, 3).forEach((r) => {
      console.error(`  ${r.knowledge_id}:`, validateRecord(r));
    });
    process.exit(1);
  }

  if (useBatch50) {
    const exportPath = writeBatch50Export(records);
    console.log(`Export: ${exportPath}`);
  }

  const label = useBatch50 ? 'batch-50' : 'fila';
  console.log(`A importar ${records.length} curiosidades (${label})…`);

  if (dryRun) {
    console.log({ ok: true, dryRun: true, count: records.length });
    return;
  }

  const result = await importBatch(url, key, records);
  console.log(result);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
