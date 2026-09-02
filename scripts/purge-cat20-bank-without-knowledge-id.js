#!/usr/bin/env node
/**
 * Remove do question_bank (cat. 20) entradas legadas sem knowledge_id.
 *
 *   node scripts/purge-cat20-bank-without-knowledge-id.js --dry-run
 *   node scripts/purge-cat20-bank-without-knowledge-id.js --apply
 */
'use strict';

require('./load-env').loadEnvLocal();

const { CAT20_REPO_FORMATS } = require('./lib/kr1-cat20-guards');

const CATEGORY = 20;
const BATCH_SIZE = 150;
const FORMATS = [...CAT20_REPO_FORMATS];

function parseArgs(argv) {
  return {
    dryRun: !argv.includes('--apply'),
    block: argv.includes('--block'),
    includeReported: argv.includes('--include-reported'),
  };
}

function getConfig() {
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';
  if (!url || !key) return null;
  return { url, key };
}

async function fetchLegacyHashes(cfg, opts) {
  const pageSize = 1000;
  let offset = 0;
  const hashes = [];

  const reportedFilter = opts.includeReported ? '' : '&is_reported=eq.false';
  const formatFilter = `&format=in.(${FORMATS.join(',')})`;
  const kidFilter = '&or=(knowledge_id.is.null,knowledge_id.eq.)';

  while (true) {
    const response = await fetch(
      `${cfg.url}/rest/v1/question_bank?select=question_hash,format,knowledge_id,source`
      + `&category_n=eq.${CATEGORY}${kidFilter}${formatFilter}${reportedFilter}`
      + `&order=question_hash.asc`,
      {
        headers: {
          apikey: cfg.key,
          Authorization: `Bearer ${cfg.key}`,
          Range: `${offset}-${offset + pageSize - 1}`,
        },
      },
    );
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`HTTP ${response.status} ao listar question_bank: ${body.slice(0, 200)}`);
    }
    const rows = await response.json();
    if (!Array.isArray(rows) || !rows.length) break;
    for (const row of rows) {
      if (row?.question_hash) hashes.push(String(row.question_hash));
    }
    if (rows.length < pageSize) break;
    offset += pageSize;
  }

  return hashes;
}

async function deleteBatch(cfg, hashes, block) {
  const response = await fetch(`${cfg.url}/rest/v1/rpc/delete_questions_from_bank`, {
    method: 'POST',
    headers: {
      apikey: cfg.key,
      Authorization: `Bearer ${cfg.key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      p_hashes: hashes,
      p_block: !!block,
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`RPC delete_questions_from_bank falhou: HTTP ${response.status} — ${body.slice(0, 300)}`);
  }
  return response.json();
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const cfg = getConfig();
  if (!cfg) {
    console.error('Define SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY em .env.local');
    process.exit(2);
  }

  console.log('Purge question_bank cat.20 — sem knowledge_id\n');
  console.log(`Formatos: ${FORMATS.join(', ')}`);
  console.log(`Modo: ${opts.dryRun ? 'dry-run' : 'APPLY'}`);
  console.log(`Bloquear hashes: ${opts.block ? 'sim' : 'não'}\n`);

  const hashes = await fetchLegacyHashes(cfg, opts);
  console.log(`Encontradas: ${hashes.length} entradas legadas`);

  if (!hashes.length) {
    console.log('Nada a apagar.');
    return;
  }

  if (opts.dryRun) {
    console.log('\nAmostra (10):', hashes.slice(0, 10).join(', '));
    console.log('\nCorre com --apply para apagar.');
    return;
  }

  let deleted = 0;
  let blocked = 0;
  let reuseRemoved = 0;

  for (let i = 0; i < hashes.length; i += BATCH_SIZE) {
    const batch = hashes.slice(i, i + BATCH_SIZE);
    const result = await deleteBatch(cfg, batch, opts.block);
    deleted += Number(result?.deleted) || 0;
    blocked += Number(result?.blocked) || 0;
    reuseRemoved += Number(result?.reuseEventsRemoved) || 0;
    process.stdout.write(`\rApagadas ${Math.min(i + batch.length, hashes.length)}/${hashes.length}…`);
  }

  console.log(`\n\nConcluído:`);
  console.log(`  deleted: ${deleted}`);
  console.log(`  blocked: ${blocked}`);
  console.log(`  reuseEventsRemoved: ${reuseRemoved}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
