#!/usr/bin/env node
/**
 * KR-1.4 — audita knowledgeId em knowledge_records e question_bank (categoria 20).
 *
 * Uso:
 *   node scripts/audit-cat20-knowledge-ids.js
 *   node scripts/audit-cat20-knowledge-ids.js --json
 */
'use strict';

require('./load-env').loadEnvLocal();

const { cat20RequiresKnowledgeId } = require('./lib/kr1-cat20-guards');

function parseArgs(argv) {
  return {
    json: argv.includes('--json'),
    includeInactive: argv.includes('--include-inactive'),
    category: 20,
  };
}

function getAdminConfig() {
  const url = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key) return null;
  return { url, key };
}

async function fetchPaged(cfg, table, select, filter, orderCol) {
  const pageSize = 1000;
  let offset = 0;
  const all = [];

  while (true) {
    const response = await fetch(
      `${cfg.url}/rest/v1/${table}?select=${select}${filter}&order=${orderCol}.asc`,
      {
        headers: {
          apikey: cfg.key,
          Authorization: `Bearer ${cfg.key}`,
          Range: `${offset}-${offset + pageSize - 1}`,
        },
      },
    );
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} em ${table}`);
    }
    const batch = await response.json();
    if (!Array.isArray(batch) || !batch.length) break;
    all.push(...batch);
    if (batch.length < pageSize) break;
    offset += pageSize;
  }

  return all;
}

async function audit(cfg, opts) {
  const activeFilter = opts.includeInactive ? '' : '&is_active=eq.true';
  const knowledgeRows = await fetchPaged(
    cfg,
    'knowledge_records',
    'knowledge_id,category_n,topic,allowed_formats,is_active',
    `&category_n=eq.${opts.category}${activeFilter}`,
    'knowledge_id',
  );

  const bankReportedFilter = opts.includeInactive ? '' : '&is_reported=eq.false';
  const bankRows = await fetchPaged(
    cfg,
    'question_bank',
    'question_hash,category_n,format,knowledge_id,is_reported',
    `&category_n=eq.${opts.category}${bankReportedFilter}`,
    'question_hash',
  );

  const knowledgeMissing = knowledgeRows.filter((row) => !String(row.knowledge_id || '').trim());
  const bankMissing = bankRows.filter((row) => {
    if (!cat20RequiresKnowledgeId(row.category_n, row.format)) return false;
    return !String(row.knowledge_id || '').trim();
  });

  return {
    category: opts.category,
    knowledge: {
      total: knowledgeRows.length,
      missingKnowledgeId: knowledgeMissing.length,
      samples: knowledgeMissing.slice(0, 10).map((r) => r.knowledge_id || '(vazio)'),
    },
    questionBank: {
      total: bankRows.length,
      missingKnowledgeId: bankMissing.length,
      samples: bankMissing.slice(0, 10).map((r) => ({
        hash: r.question_hash,
        format: r.format,
      })),
    },
    ok: knowledgeMissing.length === 0 && bankMissing.length === 0,
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const cfg = getAdminConfig();
  if (!cfg) {
    console.error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY em falta (.env.local).');
    process.exit(2);
  }

  const report = await audit(cfg, opts);

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log('KR-1.4 — auditoria knowledgeId (categoria 20)\n');
    console.log(`knowledge_records: ${report.knowledge.total} activos, ${report.knowledge.missingKnowledgeId} sem knowledge_id`);
    console.log(`question_bank: ${report.questionBank.total} activos, ${report.questionBank.missingKnowledgeId} sem knowledge_id (ADIVINHA/CURIOSIDADE/VF)`);
    if (!report.ok) {
      if (report.knowledge.samples.length) {
        console.log('\nAmostras knowledge_records:', report.knowledge.samples.join(', '));
      }
      if (report.questionBank.samples.length) {
        console.log('Amostras question_bank:', report.questionBank.samples.map((s) => `${s.hash} (${s.format})`).join(', '));
      }
    } else {
      console.log('\n✓ Critério KR-1.4 satisfeito: 0 registos sem knowledgeId.');
    }
  }

  process.exit(report.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
