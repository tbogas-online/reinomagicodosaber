#!/usr/bin/env node
/**
 * Importação diária para o Knowledge Repository — 1 registo por faixa etária.
 *
 * Lê a fila em data/knowledge-import-queue.json, importa até 3 factos
 * (6-9, 10-15, 15+) e marca como importados.
 *
 * Uso:
 *   node scripts/daily-knowledge-import.js
 *   node scripts/daily-knowledge-import.js --dry-run
 *   node scripts/daily-knowledge-import.js --force
 *
 * Credenciais (.env.local ou variáveis de ambiente):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */
'use strict';

const fs = require('fs');
const path = require('path');
const core = require('./lib/knowledge-import-core');

require('./load-env').loadEnvLocal();

const ROOT = path.join(__dirname, '..');
const QUEUE_PATH = path.join(ROOT, 'data', 'knowledge-import-queue.json');
const STATE_PATH = path.join(ROOT, 'data', 'knowledge-import-state.json');

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function parseArgs(argv) {
  return {
    dryRun: argv.includes('--dry-run'),
    force: argv.includes('--force'),
  };
}

async function main() {
  const { dryRun, force } = parseArgs(process.argv.slice(2));
  const supabaseUrl = (process.env.SUPABASE_URL || '').trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

  if (!dryRun && (!supabaseUrl || !serviceKey)) {
    console.error('Define SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY em .env.local');
    process.exit(1);
  }

  const queue = readJson(QUEUE_PATH, { items: [] });
  const state = readJson(STATE_PATH, { lastRunDate: null, runs: [] });

  if (!force && state.lastRunDate === core.todayPt()) {
    console.log(`Já corrido hoje (${state.lastRunDate}). Usa --force para repetir.`);
    process.exit(0);
  }

  const picked = core.pickItemsForToday(queue.items || []);
  if (!picked.length) {
    console.log('Fila vazia — não há registos pendentes para nenhuma faixa etária.');
    console.log(`Adiciona entradas em ${path.relative(ROOT, QUEUE_PATH)}`);
    process.exit(0);
  }

  const records = [];
  for (const { band, item, record } of picked) {
    const missing = core.validateRecord(record);
    if (missing.length) {
      console.error(`Registo inválido (${item.queueId}, ${band}): falta ${missing.join(', ')}`);
      process.exit(1);
    }
    records.push(record);
  }

  console.log(`Importação diária — ${core.todayPt()} — ${records.length} registo(s):`);
  for (const { band, record } of picked) {
    console.log(`  · ${band} → ${record.knowledge_id} (${record.topic})`);
  }

  if (dryRun) {
    console.log('\n[dry-run] Nada foi enviado ao Supabase.');
    process.exit(0);
  }

  const result = await core.importBatch(supabaseUrl, serviceKey, records);
  console.log(`\nSupabase: ${JSON.stringify(result)}`);

  if (!result?.ok) {
    process.exit(1);
  }

  const importedAt = new Date().toISOString();
  const importedIds = records.map((r) => r.knowledge_id);

  for (const { item } of picked) {
    const entry = queue.items.find((i) => i.queueId === item.queueId);
    if (entry) {
      entry.status = 'imported';
      entry.importedAt = importedAt;
    }
  }

  state.lastRunDate = core.todayPt();
  state.runs = [
    {
      date: core.todayPt(),
      importedAt,
      knowledgeIds: importedIds,
      upserted: result.upserted ?? records.length,
      skipped: result.skipped ?? 0,
      source: 'script',
    },
    ...(state.runs || []).slice(0, 29),
  ];

  writeJson(QUEUE_PATH, queue);
  writeJson(STATE_PATH, state);

  const pending = (queue.items || []).filter((i) => i.status === 'pending').length;
  console.log(`Fila actualizada — ${pending} pendente(s).`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
