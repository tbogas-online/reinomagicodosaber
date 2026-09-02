#!/usr/bin/env node
/**
 * Audita duplicados em knowledge_records (categoria 20 — adivinhas e curiosidades).
 *
 * Uso:
 *   node scripts/audit-knowledge-duplicates.js
 *   node scripts/audit-knowledge-duplicates.js --json
 *   node scripts/audit-knowledge-duplicates.js --include-inactive
 */
'use strict';

require('./load-env').loadEnvLocal();

const { normalizeText } = require('./lib/memoriamedia-adivinhas');

const JACCARD_THRESHOLD = 0.72;

function tokenSet(s) {
  return new Set(normalizeText(s).split(' ').filter((w) => w.length > 2));
}

function jaccard(a, b) {
  const A = tokenSet(a);
  const B = tokenSet(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  return inter / (A.size + B.size - inter);
}

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

async function fetchRecords(cfg, { includeInactive, category }) {
  const pageSize = 1000;
  let offset = 0;
  const all = [];
  const activeFilter = includeInactive ? '' : '&is_active=eq.true';

  while (true) {
    const response = await fetch(
      `${cfg.url}/rest/v1/knowledge_records?select=knowledge_id,category_n,topic,fact,answer,statement,source,source_id,is_active&category_n=eq.${category}${activeFilter}&order=knowledge_id.asc`,
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

function groupBy(keyFn, records) {
  const map = new Map();
  for (const row of records) {
    const key = keyFn(row);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return [...map.entries()].filter(([, items]) => items.length > 1);
}

function findJaccardDuplicates(records, { textField = 'fact', sameAnswer = true } = {}) {
  const groups = new Map();
  for (const row of records) {
    const ansKey = normalizeText(row.answer);
    if (!ansKey) continue;
    const bucket = sameAnswer ? ansKey : '__all__';
    if (!groups.has(bucket)) groups.set(bucket, []);
    groups.get(bucket).push(row);
  }

  const pairs = [];
  for (const [, items] of groups) {
    if (items.length < 2) continue;
    for (let i = 0; i < items.length; i += 1) {
      for (let j = i + 1; j < items.length; j += 1) {
        const a = items[i];
        const b = items[j];
        if (sameAnswer && normalizeText(a.answer) !== normalizeText(b.answer)) continue;
        const sim = jaccard(a[textField] || '', b[textField] || '');
        if (sim >= JACCARD_THRESHOLD) {
          pairs.push({
            type: 'similar_text',
            field: textField,
            similarity: Math.round(sim * 1000) / 1000,
            a: pickBrief(a),
            b: pickBrief(b),
          });
        }
      }
    }
  }
  return pairs;
}

function pickBrief(row) {
  return {
    knowledge_id: row.knowledge_id,
    source: row.source,
    source_id: row.source_id,
    answer: row.answer,
    fact: String(row.fact || '').slice(0, 120),
    is_active: row.is_active,
  };
}

function auditRecords(records) {
  const adivinhas = records.filter((r) => r.topic === 'adivinha tradicional');
  const curiosidades = records.filter((r) => r.topic === 'curiosidade surpreendente');

  const exactAnswerAdivinhas = groupBy((r) => normalizeText(r.answer), adivinhas);
  const exactFact = groupBy((r) => normalizeText(r.fact), records);
  const exactStatement = groupBy((r) => normalizeText(r.statement), curiosidades);
  const exactSourceId = groupBy((r) => `${r.source}|${r.source_id}`, records);

  const similarAdivinhas = findJaccardDuplicates(adivinhas, { textField: 'fact', sameAnswer: true });
  const similarCuriosidadesFact = findJaccardDuplicates(curiosidades, { textField: 'fact', sameAnswer: false });

  const exactAnswerOnly = exactAnswerAdivinhas
    .map(([answer, items]) => ({
      answer,
      count: items.length,
      items: items.map(pickBrief),
      crossSource: new Set(items.map((i) => i.source)).size > 1,
    }))
    .sort((a, b) => b.count - a.count);

  return {
    summary: {
      total: records.length,
      adivinhas: adivinhas.length,
      curiosidades: curiosidades.length,
      exactAnswerGroups: exactAnswerAdivinhas.length,
      exactAnswerRows: exactAnswerAdivinhas.reduce((n, [, items]) => n + items.length, 0),
      exactFactGroups: exactFact.length,
      exactStatementGroups: exactStatement.length,
      exactSourceIdGroups: exactSourceId.length,
      similarAdivinhasPairs: similarAdivinhas.length,
      similarCuriosidadesPairs: similarCuriosidadesFact.length,
      jaccardThreshold: JACCARD_THRESHOLD,
    },
    exactAnswer: exactAnswerOnly,
    exactFact: exactFact.map(([fact, items]) => ({
      fact: fact.slice(0, 100),
      count: items.length,
      items: items.map(pickBrief),
    })),
    exactStatement: exactStatement.map(([statement, items]) => ({
      statement: statement.slice(0, 100),
      count: items.length,
      items: items.map(pickBrief),
    })),
    exactSourceId: exactSourceId.map(([key, items]) => ({
      key,
      count: items.length,
      items: items.map(pickBrief),
    })),
    similarAdivinhas,
    similarCuriosidades: similarCuriosidadesFact,
  };
}

function printReport(report) {
  const { summary } = report;
  console.log('Auditoria de duplicados — knowledge_records (cat. 20)\n');
  console.log(`Registos activos: ${summary.total} (${summary.adivinhas} adivinhas, ${summary.curiosidades} curiosidades)`);
  console.log(`Limiar Jaccard (import): ${summary.jaccardThreshold}\n`);

  console.log('Resumo:');
  console.log(`  Adivinhas — resposta repetida:  ${summary.exactAnswerGroups} grupo(s), ${summary.exactAnswerRows} registo(s)`);
  console.log(`  Facto exacto repetido:          ${summary.exactFactGroups} grupo(s)`);
  console.log(`  Statement exacto repetido:    ${summary.exactStatementGroups} grupo(s)`);
  console.log(`  source+source_id repetido:    ${summary.exactSourceIdGroups} grupo(s)`);
  console.log(`  Adivinhas similares (Jaccard): ${summary.similarAdivinhasPairs} par(es)`);
  console.log(`  Curiosidades similares:        ${summary.similarCuriosidadesPairs} par(es)\n`);

  if (report.exactAnswer.length) {
    console.log('— Adivinhas: mesma resposta (variantes folclóricas?) —');
    for (const g of report.exactAnswer.slice(0, 15)) {
      console.log(`\n  «${g.answer}» × ${g.count}${g.crossSource ? ' [várias fontes]' : ''}`);
      for (const item of g.items) {
        console.log(`    · ${item.knowledge_id} (${item.source}) — ${item.fact.slice(0, 70)}…`);
      }
    }
    if (report.exactAnswer.length > 15) {
      console.log(`\n  … +${report.exactAnswer.length - 15} grupo(s) (usa --json para lista completa)`);
    }
  }

  if (report.similarAdivinhas.length) {
    console.log('\n— Adivinhas: mesma resposta + facto similar (Jaccard) —');
    for (const p of report.similarAdivinhas.slice(0, 20)) {
      console.log(`\n  sim=${p.similarity} «${p.a.answer}»`);
      console.log(`    A: ${p.a.knowledge_id} (${p.a.source})`);
      console.log(`    B: ${p.b.knowledge_id} (${p.b.source})`);
    }
    if (report.similarAdivinhas.length > 20) {
      console.log(`\n  … +${report.similarAdivinhas.length - 20} par(es)`);
    }
  }

  if (report.exactFact.length) {
    console.log('\n— Facto exacto repetido —');
    for (const g of report.exactFact.slice(0, 10)) {
      console.log(`\n  × ${g.count}: ${g.fact}…`);
      for (const item of g.items) {
        console.log(`    · ${item.knowledge_id} (${item.source})`);
      }
    }
  }

  if (report.similarCuriosidades.length) {
    console.log('\n— Curiosidades: factos muito similares —');
    for (const p of report.similarCuriosidades.slice(0, 10)) {
      console.log(`\n  sim=${p.similarity}`);
      console.log(`    A: ${p.a.knowledge_id} — ${p.a.fact.slice(0, 80)}…`);
      console.log(`    B: ${p.b.knowledge_id} — ${p.b.fact.slice(0, 80)}…`);
    }
  }

  const issues = summary.exactAnswerGroups + summary.exactFactGroups
    + summary.exactStatementGroups + summary.exactSourceIdGroups
    + summary.similarAdivinhasPairs;
  console.log(`\n${issues ? '⚠ Duplicados ou quase-duplicados encontrados.' : '✓ Sem duplicados relevantes detectados.'}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cfg = getAdminConfig();
  if (!cfg) {
    console.error('Define SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY em .env.local');
    process.exit(1);
  }

  const records = await fetchRecords(cfg, args);
  const report = auditRecords(records);

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  printReport(report);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
