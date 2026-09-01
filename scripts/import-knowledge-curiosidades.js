#!/usr/bin/env node
'use strict';

require('./load-env').loadEnvLocal();

const fs = require('fs');
const path = require('path');
const { normalizeRecord, validateRecord, importBatch } = require('./lib/knowledge-import-core');

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Define SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY em .env.local');
    process.exit(1);
  }

  const queuePath = path.join(__dirname, '..', 'data', 'knowledge-import-queue.json');
  const queue = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
  const records = queue.items
    .filter((item) => item.record?.topic === 'curiosidade surpreendente')
    .map((item) => normalizeRecord(item.record));

  const invalid = records.filter((r) => validateRecord(r).length);
  if (invalid.length) {
    console.error(`${invalid.length} registos inválidos`);
    process.exit(1);
  }

  console.log(`A importar ${records.length} curiosidades…`);
  const result = await importBatch(url, key, records);
  console.log(result);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
