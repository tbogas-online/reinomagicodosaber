#!/usr/bin/env node
'use strict';

require('./load-env').loadEnvLocal();

const {
  loadQuestionEngine,
  needsAdivinhaOptionsFix,
  buildFixedAdivinhaOptions,
  parseOptions,
} = require('./lib/adivinha-bank-audit');

async function supabaseRequest(url, key, path, options = {}) {
  const response = await fetch(`${url.replace(/\/$/, '')}/rest/v1${path}`, {
    method: options.method || 'GET',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    body: options.body,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(text || `HTTP ${response.status}`);
  }
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function fetchBankRows(url, key, { categoryN = 20, format = 'ADIVINHA' } = {}) {
  const rows = [];
  const pageSize = 200;
  let offset = 0;
  while (true) {
    const params = new URLSearchParams({
      select: 'id,question_hash,question,correct_answer,options,format,category_n,age_band,source,is_reported',
      order: 'id.asc',
      limit: String(pageSize),
      offset: String(offset),
    });
    if (categoryN) params.set('category_n', `eq.${categoryN}`);
    if (format) params.set('format', `eq.${format}`);
    const batch = await supabaseRequest(url, key, `/question_bank?${params.toString()}`);
    if (!Array.isArray(batch) || !batch.length) break;
    rows.push(...batch);
    if (batch.length < pageSize) break;
    offset += pageSize;
  }
  return rows;
}

async function updateOptions(url, key, questionHash, options) {
  return supabaseRequest(
    url,
    key,
    `/question_bank?question_hash=eq.${encodeURIComponent(questionHash)}`,
    {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ options }),
    },
  );
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Define SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY em .env.local');
    process.exit(1);
  }

  const dryRun = process.argv.includes('--dry-run');
  const categoryN = Number(process.argv.find((a) => a.startsWith('--category='))?.split('=')[1] || 20);
  const QE = loadQuestionEngine();

  console.log(`A auditar banco (cat. ${categoryN}, ADIVINHA)…`);
  const rows = await fetchBankRows(url, key, { categoryN, format: 'ADIVINHA' });
  console.log(`Total no banco: ${rows.length}`);

  const toFix = rows.filter((row) => !row.is_reported && needsAdivinhaOptionsFix(row, QE));
  console.log(`Com opções inválidas: ${toFix.length}`);

  if (!toFix.length) {
    console.log('Nada a corrigir.');
    return;
  }

  let fixed = 0;
  let failed = 0;
  for (const row of toFix) {
    const options = buildFixedAdivinhaOptions(row, QE);
    if (!options) {
      failed += 1;
      console.warn(`  ✗ sem distractores: ${row.question_hash} — ${row.correct_answer}`);
      continue;
    }
    const oldOpts = parseOptions(row.options) || [];
    if (dryRun) {
      console.log(`  ~ ${row.question_hash}`);
      console.log(`    Q: ${String(row.question || '').slice(0, 70)}…`);
      console.log(`    A: ${row.correct_answer}`);
      console.log(`    Antes: ${oldOpts.join(' | ')}`);
      console.log(`    Depois: ${options.join(' | ')}`);
      fixed += 1;
      continue;
    }
    await updateOptions(url, key, row.question_hash, options);
    fixed += 1;
    console.log(`  ✓ ${row.question_hash}`);
  }

  console.log(dryRun
    ? `\nSimulação: ${fixed} corrigível(eis), ${failed} sem distractores.`
    : `\nConcluído: ${fixed} actualizado(s), ${failed} falha(s).`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
