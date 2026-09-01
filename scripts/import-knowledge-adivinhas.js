#!/usr/bin/env node
/**
 * KR-1.1 — Extrair adivinhas do Adivinhário MemóriaMedia (Fundo Michel Giacometti).
 *
 * Fonte JSON (Fabrik/Joomla, sem scraping de HTML):
 *   https://www.memoriamedia.net/index.php/adivinhario-base-de-dados/list/5?format=json
 *
 * Uso:
 *   node scripts/import-knowledge-adivinhas.js
 *   node scripts/import-knowledge-adivinhas.js --dry-run
 *   node scripts/import-knowledge-adivinhas.js --max 30 --include-malicious
 *   node scripts/import-knowledge-adivinhas.js --write-queue
 *   node scripts/import-knowledge-adivinhas.js --import   # requer .env.local + Supabase
 */
'use strict';

const fs = require('fs');
const path = require('path');
const {
  fetchAllMemoriaMediaRows,
  transformRows,
} = require('./lib/memoriamedia-adivinhas');
const { normalizeRecord, validateRecord, importBatch } = require('./lib/knowledge-import-core');

require('./load-env');

const ROOT = path.join(__dirname, '..');
const EXPORT_DIR = path.join(ROOT, 'data', 'exports');
const EXPORT_JSON = path.join(EXPORT_DIR, 'memoriamedia-adivinhas.json');
const QUEUE_JSON = path.join(ROOT, 'data', 'knowledge-import-memoriamedia-queue.json');

function parseArgs(argv) {
  const args = {
    dryRun: false,
    writeQueue: false,
    doImport: false,
    includeMalicious: false,
    maxRows: 0,
    delayMs: 250,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--write-queue') args.writeQueue = true;
    else if (a === '--import') args.doImport = true;
    else if (a === '--include-malicious') args.includeMalicious = true;
    else if (a === '--max') { args.maxRows = Number(argv[++i] || 0); }
    else if (a === '--delay-ms') { args.delayMs = Number(argv[++i] || 250); }
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

function printHelp() {
  console.log(`MemóriaMedia → Knowledge Repository (categoria 20)

Opções:
  --dry-run              Só mostra estatísticas (não grava ficheiros)
  --write-queue          Grava ${path.relative(ROOT, QUEUE_JSON)}
  --import               Importa para Supabase (import_knowledge_batch)
  --include-malicious    Inclui classificação 6 (adivinhas maliciosas)
  --max N                Limita registos obtidos da API (debug)
  --delay-ms N           Pausa entre páginas (default 250)
`);
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }

  console.log('[memoriamedia] A obter adivinhas (JSON Fabrik)…');
  const rows = await fetchAllMemoriaMediaRows({
    maxRows: args.maxRows || Infinity,
    delayMs: args.delayMs,
  });
  console.log(`[memoriamedia] ${rows.length} registos brutos`);

  const result = transformRows(rows, { includeMalicious: args.includeMalicious });
  const { stats } = result;

  console.log('\nEstatísticas:');
  console.log(`  Obtidos:              ${stats.fetched}`);
  console.log(`  Validados:            ${stats.validated}`);
  console.log(`  Rejeitados validação: ${stats.rejectedValidation}`);
  console.log(`  Rejeitados duplicado: ${stats.rejectedDuplicate}`);
  console.log(`  Prontos para fila:    ${stats.queued}`);

  if (result.rejected.length) {
    const byIssue = {};
    for (const r of result.rejected) {
      for (const issue of r.issues) byIssue[issue] = (byIssue[issue] || 0) + 1;
    }
    console.log('\nMotivos de rejeição:');
    for (const [issue, count] of Object.entries(byIssue).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${issue}: ${count}`);
    }
  }

  if (args.dryRun) {
    console.log('\n(dry-run — nada gravado)');
    if (result.queueItems[0]) {
      console.log('\nExemplo aceite:');
      console.log(JSON.stringify(result.queueItems[0].record, null, 2));
    }
    return;
  }

  if (!fs.existsSync(EXPORT_DIR)) fs.mkdirSync(EXPORT_DIR, { recursive: true });

  const exportPayload = {
    exportedAt: new Date().toISOString(),
    source: 'MemóriaMedia Adivinhário',
    sourceListUrl: 'https://www.memoriamedia.net/index.php/adivinhario-base-de-dados',
    stats,
    items: result.queueItems.map((q) => q.record),
    rejected: result.rejected,
  };
  fs.writeFileSync(EXPORT_JSON, `${JSON.stringify(exportPayload, null, 2)}\n`, 'utf8');
  console.log(`\nExport: ${path.relative(ROOT, EXPORT_JSON)}`);

  if (args.writeQueue || args.doImport) {
    const queue = {
      description: 'Fila gerada a partir do Adivinhário MemóriaMedia (Fundo Michel Giacometti).',
      items: result.queueItems,
    };
    fs.writeFileSync(QUEUE_JSON, `${JSON.stringify(queue, null, 2)}\n`, 'utf8');
    console.log(`Fila:   ${path.relative(ROOT, QUEUE_JSON)}`);
  }

  if (args.doImport) {
    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
    if (!url || !key) {
      throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY necessários em .env.local');
    }
    const records = result.queueItems.map((q) => normalizeRecord(q.record));
    const invalid = records.filter((r) => validateRecord(r).length);
    if (invalid.length) {
      throw new Error(`${invalid.length} registos inválidos antes do import`);
    }
    const batch = await importBatch(url, key, records);
    console.log('\nImport Supabase:', batch);
  }
}

main().catch((err) => {
  console.error('[memoriamedia] Erro:', err.message || err);
  process.exit(1);
});
