#!/usr/bin/env node
/**
 * Corrige registos do repositório de conhecimento com base nos reportes abertos.
 * Uso: node scripts/patch-knowledge-reports-batch.js [--dry-run]
 */
'use strict';

require('./load-env').loadEnvLocal();

const PATCHES = [
  { knowledge_id: 'knw-cat20-mm-0143', answer: 'Pulga', is_active: true },
  { knowledge_id: 'knw-cat20-mm-0139', is_active: false },
  { knowledge_id: 'knw-cat20-mm-0034', is_active: false },
  { knowledge_id: 'knw-cat20-mm-0129', is_active: false },
];

async function supabasePatch(url, key, knowledgeId, body) {
  const response = await fetch(
    `${url.replace(/\/$/, '')}/rest/v1/knowledge_records?knowledge_id=eq.${encodeURIComponent(knowledgeId)}`,
    {
      method: 'PATCH',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({ ...body, updated_at: new Date().toISOString() }),
    },
  );
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`${knowledgeId}: ${text || response.status}`);
  }
  const rows = await response.json();
  return Array.isArray(rows) ? rows[0] : rows;
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Define SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY em .env.local');
    process.exit(1);
  }
  const dryRun = process.argv.includes('--dry-run');
  for (const patch of PATCHES) {
    const { knowledge_id: kid, ...body } = patch;
    if (dryRun) {
      console.log(`[dry-run] ${kid}`, body);
      continue;
    }
    const row = await supabasePatch(url, key, kid, body);
    console.log(`✓ ${kid}`, {
      answer: row?.answer,
      is_active: row?.is_active,
    });
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
