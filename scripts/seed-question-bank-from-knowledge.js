#!/usr/bin/env node
/**
 * Popular question_bank a partir de knowledge_records (cat. 20, ADIVINHA).
 *
 *   node scripts/seed-question-bank-from-knowledge.js --dry-run
 *   node scripts/seed-question-bank-from-knowledge.js
 *   node scripts/seed-question-bank-from-knowledge.js --age-band 6-9 --limit 80
 */
'use strict';

require('./load-env').loadEnvLocal();

const { AGE_BANDS, replenishBankFromKnowledge } = require('./lib/bank-from-knowledge');

async function bumpWebConfidence(url, key, dryRun) {
  const params = new URLSearchParams({
    category_n: 'eq.20',
    confidence: 'eq.0.88',
    select: 'knowledge_id',
  });
  const response = await fetch(`${url.replace(/\/$/, '')}/rest/v1/knowledge_records?${params.toString()}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  const rows = await response.json();
  if (!Array.isArray(rows) || !rows.length) return 0;
  if (dryRun) return rows.length;
  await fetch(`${url.replace(/\/$/, '')}/rest/v1/knowledge_records?${params.toString()}`, {
    method: 'PATCH',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ confidence: 0.9 }),
  });
  return rows.length;
}

async function main() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error('Define SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY em .env.local');
    process.exit(1);
  }

  const dryRun = process.argv.includes('--dry-run');
  const ageBandArg = process.argv.find((a) => a.startsWith('--age-band='))?.split('=')[1];
  const limit = Number(process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1] || 200);
  const ageBands = ageBandArg ? [ageBandArg] : AGE_BANDS;

  const bumped = await bumpWebConfidence(url, key, dryRun);
  if (bumped) console.log(`Confidence actualizada: ${bumped} registos`);

  let totalInserted = 0;
  for (const ageBand of ageBands) {
    console.log(`\n[${ageBand}] A materializar até ${limit} adivinhas…`);
    const result = await replenishBankFromKnowledge(url, key, {
      ageBand,
      limit,
      dryRun,
      source: 'repository-seed',
    });
    console.log(result);
    totalInserted += Number(result.inserted) || 0;
  }

  if (!dryRun) console.log(`\nTotal inserido: ${totalInserted}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
