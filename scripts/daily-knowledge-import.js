#!/usr/bin/env node
/**
 * Importação diária para o Knowledge Repository — 1 registo por faixa etária.
 * Estado e fila guardados no Supabase (não em ficheiros locais).
 */
'use strict';

require('./load-env').loadEnvLocal();

const supa = require('./lib/knowledge-import-supabase');

function parseArgs(argv) {
  return {
    dryRun: argv.includes('--dry-run'),
    force: argv.includes('--force'),
    syncOnly: argv.includes('--sync-only'),
  };
}

async function main() {
  const { dryRun, force, syncOnly } = parseArgs(process.argv.slice(2));
  const cfg = supa.getAdminConfig();
  if (!cfg) {
    console.error('Define SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY em .env.local');
    process.exit(1);
  }

  if (syncOnly) {
    const sync = await supa.syncSeedQueue(cfg);
    console.log(sync.message);
    console.log(`Pendentes: ${sync.summary?.pending ?? '?'}`);
    process.exit(0);
  }

  const result = await supa.runDailyImport(cfg, { dryRun, force });
  if (result.skipped) {
    console.log(result.message || 'Importação ignorada.');
    process.exit(0);
  }

  if (result.dryRun) {
    console.log('Simulação:');
    for (const row of result.plan || []) {
      console.log(`  · ${row.band} → ${row.knowledgeId} (${row.topic})`);
    }
    process.exit(0);
  }

  console.log(`Importados ${result.plan?.length || 0} registo(s).`);
  console.log(`Supabase: ${JSON.stringify(result.result)}`);
  console.log(`Pendentes na fila: ${result.summary?.pending ?? '?'}`);
}

main().catch((err) => {
  if (err.code === 'SCHEMA_MISSING') {
    console.error(`${err.message}`);
    process.exit(1);
  }
  console.error(err.message || err);
  process.exit(1);
});
