#!/usr/bin/env node
/**
 * Verifica quantos reportes existem no Supabase.
 * A migração de Netlify Blobs → Supabase é automática no primeiro pedido admin após deploy
 * (ver maybeMigrateFromBlobs em reports-store.js).
 *
 * Uso: node scripts/migrate-reports-to-supabase.js
 */
'use strict';

require('./load-env').loadEnvLocal();

async function main() {
  const url = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key) {
    console.error('Define SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY em .env.local');
    process.exit(1);
  }

  const response = await fetch(`${url}/rest/v1/question_reports?select=report_id&order=received_at.desc&limit=5`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: 'count=exact',
    },
  });

  if (response.status === 404 || response.status === 406) {
    console.error('Tabela question_reports não existe. Executa supabase/question-reports.sql no Supabase primeiro.');
    process.exit(1);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    console.error(`Supabase HTTP ${response.status}: ${text}`);
    process.exit(1);
  }

  const range = response.headers.get('content-range') || '';
  const total = Number(range.split('/')[1]) || 0;
  const sample = await response.json().catch(() => []);

  console.log(`Reportes no Supabase: ${total}`);
  if (sample.length) {
    console.log('Mais recentes:');
    for (const row of sample) console.log(`  - ${row.report_id}`);
  }
  if (total === 0) {
    console.log('');
    console.log('Se ainda há dados em Netlify Blobs, abre o painel admin (/admin-reports.html)');
    console.log('após deploy — a migração corre automaticamente no primeiro pedido.');
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
