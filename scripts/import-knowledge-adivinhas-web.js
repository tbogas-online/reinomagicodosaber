#!/usr/bin/env node
/**
 * Importar adivinhas de artigos web (PT-PT + opcional PT-BR).
 *
 * Fontes:
 *   - pumpkin.pt
 *   - santander.pt/salto
 *   - brincacomigo.pt
 *   - ditos.pt
 *   - querobolsa.com.br (excluída por defeito — PT-BR)
 *
 * Uso:
 *   node scripts/import-knowledge-adivinhas-web.js --dry-run
 *   node scripts/import-knowledge-adivinhas-web.js --write-queue
 *   node scripts/import-knowledge-adivinhas-web.js --import
 *   node scripts/import-knowledge-adivinhas-web.js --include-br --import
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { SOURCES, fetchAllSources } = require('./lib/web-adivinhas-sources');
const {
  validateWebItem,
  toKnowledgeRecord,
  dedupeAgainstExisting,
} = require('./lib/adivinha-web-utils');
const { normalizeRecord, validateRecord, importBatch } = require('./lib/knowledge-import-core');

require('./load-env').loadEnvLocal();

const ROOT = path.join(__dirname, '..');
const EXPORT_DIR = path.join(ROOT, 'data', 'exports');
const EXPORT_JSON = path.join(EXPORT_DIR, 'web-adivinhas.json');
const QUEUE_JSON = path.join(ROOT, 'data', 'knowledge-import-web-adivinhas-queue.json');
const MM_EXPORT = path.join(EXPORT_DIR, 'memoriamedia-adivinhas.json');

function parseArgs(argv) {
  const args = {
    dryRun: false,
    writeQueue: false,
    doImport: false,
    includeBr: false,
    sources: null,
    delayMs: 400,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--write-queue') args.writeQueue = true;
    else if (a === '--import') args.doImport = true;
    else if (a === '--include-br') args.includeBr = true;
    else if (a === '--source') args.sources = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--delay-ms') args.delayMs = Number(argv[++i] || 400);
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

function printHelp() {
  console.log(`Web → Knowledge Repository (categoria 20)

Opções:
  --dry-run       Só estatísticas
  --write-queue   Grava fila JSON
  --import        Upsert Supabase (import_knowledge_batch)
  --include-br    Inclui querobolsa.com.br (PT-BR)
  --source a,b    Só fontes indicadas (${SOURCES.map((s) => s.slug).join(', ')})
  --delay-ms N    Pausa entre pedidos HTTP
`);
}

function loadExistingRecords() {
  if (!fs.existsSync(MM_EXPORT)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(MM_EXPORT, 'utf8'));
    return Array.isArray(data.items) ? data.items : [];
  } catch {
    return [];
  }
}

function transformItems(rawItems, options = {}) {
  const accepted = [];
  const rejected = [];

  for (const item of rawItems) {
    if (!options.includeBr && item.locale === 'pt-BR') continue;
    const validated = validateWebItem(item, { allowBrasileiro: options.includeBr });
    if (validated.issues.length) {
      rejected.push({
        source: item.sourceSlug,
        question: item.question,
        answer: item.answer,
        issues: validated.issues,
      });
      continue;
    }
    accepted.push({
      raw: item,
      parsed: {
        fact: validated.fact,
        answer: validated.answer,
        clues: validated.clues,
        question: validated.question,
      },
    });
  }

  const existing = loadExistingRecords();
  const deduped = dedupeAgainstExisting(accepted, existing);
  const queueItems = deduped.accepted.map((entry, idx) => ({
    queueId: `q-web-${entry.raw.sourceSlug}-${String(idx + 1).padStart(3, '0')}`,
    status: 'pending',
    record: toKnowledgeRecord(entry.raw, entry.parsed, idx + 1),
  }));

  return {
    stats: {
      fetched: rawItems.length,
      validated: accepted.length,
      rejectedValidation: rejected.length,
      rejectedDuplicate: deduped.rejected.length,
      queued: queueItems.length,
      skippedBr: options.includeBr ? 0 : rawItems.filter((i) => i.locale === 'pt-BR').length,
    },
    queueItems,
    rejected: [
      ...rejected,
      ...deduped.rejected.map((r) => ({
        source: r.raw.sourceSlug,
        question: r.raw.question,
        answer: r.raw.answer,
        issues: r.issues,
      })),
    ],
  };
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }

  const sourceSlugs = args.sources || SOURCES
    .filter((s) => args.includeBr || s.locale !== 'pt-BR')
    .map((s) => s.slug);

  console.log(`[web-adivinhas] A obter de: ${sourceSlugs.join(', ')}`);
  const rawItems = await fetchAllSources({ sources: sourceSlugs, delayMs: args.delayMs });
  console.log(`[web-adivinhas] ${rawItems.length} pares brutos`);

  const result = transformItems(rawItems, { includeBr: args.includeBr });
  const { stats } = result;

  console.log('\nEstatísticas:');
  console.log(`  Obtidos:              ${stats.fetched}`);
  console.log(`  Ignorados PT-BR:      ${stats.skippedBr}`);
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
    source: 'Web adivinhas',
    sources: sourceSlugs,
    stats,
    items: result.queueItems.map((q) => q.record),
    rejected: result.rejected,
  };
  fs.writeFileSync(EXPORT_JSON, `${JSON.stringify(exportPayload, null, 2)}\n`, 'utf8');
  console.log(`\nExport: ${path.relative(ROOT, EXPORT_JSON)}`);

  if (args.writeQueue || args.doImport) {
    const queue = {
      description: 'Fila gerada a partir de artigos web (adivinhas infantis).',
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
  console.error('[web-adivinhas] Erro:', err.message || err);
  process.exit(1);
});
