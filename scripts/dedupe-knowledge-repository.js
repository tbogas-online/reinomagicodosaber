#!/usr/bin/env node
/**
 * Desactiva duplicados no Knowledge Repository (cat. 20).
 *
 * Uso:
 *   node scripts/dedupe-knowledge-repository.js --dry-run
 *   node scripts/dedupe-knowledge-repository.js --apply
 *   node scripts/dedupe-knowledge-repository.js --dry-run --adivinhas
 *   node scripts/dedupe-knowledge-repository.js --dry-run --curiosidades-only
 */
'use strict';

require('./load-env').loadEnvLocal();

const { buildDedupePlan } = require('./lib/knowledge-dedupe');

function parseArgs(argv) {
  return {
    dryRun: !argv.includes('--apply'),
    adivinhas: argv.includes('--adivinhas'),
    curiosidades: !argv.includes('--adivinhas-only'),
    json: argv.includes('--json'),
  };
}

function getAdminConfig() {
  const url = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key) return null;
  return { url, key };
}

async function fetchRecords(cfg) {
  const pageSize = 1000;
  let offset = 0;
  const all = [];

  while (true) {
    const response = await fetch(
      `${cfg.url}/rest/v1/knowledge_records?select=knowledge_id,category_n,topic,fact,answer,source,source_id,is_active,priority_pt&category_n=eq.20&is_active=eq.true&order=knowledge_id.asc`,
      {
        headers: {
          apikey: cfg.key,
          Authorization: `Bearer ${cfg.key}`,
          Range: `${offset}-${offset + pageSize - 1}`,
        },
      },
    );
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`knowledge_records: ${text || response.status}`);
    }
    const rows = await response.json();
    all.push(...rows);
    if (rows.length < pageSize) break;
    offset += pageSize;
  }
  return all;
}

async function disableRecord(cfg, knowledgeId) {
  const response = await fetch(`${cfg.url}/rest/v1/rpc/disable_knowledge_record`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: cfg.key,
      Authorization: `Bearer ${cfg.key}`,
    },
    body: JSON.stringify({ p_knowledge_id: knowledgeId }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const msg = data.message || data.error || `HTTP ${response.status}`;
    throw new Error(`disable_knowledge_record(${knowledgeId}): ${msg}`);
  }
  return data;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cfg = getAdminConfig();
  if (!cfg) {
    console.error('Define SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY em .env.local');
    process.exit(1);
  }

  const records = await fetchRecords(cfg);
  const plan = buildDedupePlan(records, {
    adivinhas: args.adivinhas,
    curiosidades: args.curiosidades,
  });

  if (args.json) {
    console.log(JSON.stringify({ ...plan, dryRun: args.dryRun }, null, 2));
    return;
  }

  console.log('Plano de deduplicação — knowledge_records (cat. 20)\n');
  console.log(`Registos activos analisados: ${records.length}`);
  console.log(`A desactivar: ${plan.stats.planned} (${plan.stats.curiosidades} curiosidades, ${plan.stats.adivinhas} adivinhas)`);
  console.log(`Modo: ${args.dryRun ? 'dry-run' : 'apply'}\n`);

  for (const entry of plan.toDisable.slice(0, 30)) {
    console.log(`  − ${entry.knowledge_id} (${entry.reason}) → manter ${entry.keeper}`);
  }
  if (plan.toDisable.length > 30) {
    console.log(`  … +${plan.toDisable.length - 30} registo(s)`);
  }

  if (args.dryRun || !plan.toDisable.length) {
    if (!plan.toDisable.length) console.log('\n✓ Nada a desactivar.');
    else console.log('\n(dry-run — usa --apply para desactivar no Supabase)');
    return;
  }

  let ok = 0;
  let fail = 0;
  for (const entry of plan.toDisable) {
    try {
      const result = await disableRecord(cfg, entry.knowledge_id);
      if (result?.ok) ok += 1;
      else fail += 1;
    } catch (err) {
      fail += 1;
      console.error(`  Erro ${entry.knowledge_id}: ${err.message}`);
    }
  }
  console.log(`\nConcluído: ${ok} desactivado(s), ${fail} falha(s).`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
