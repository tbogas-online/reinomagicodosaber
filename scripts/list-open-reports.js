#!/usr/bin/env node
/**
 * Lista reportes por tratar via API admin.
 * Uso: REPORTS_ADMIN_USER=... REPORTS_ADMIN_PASS=... node scripts/list-open-reports.js
 */
'use strict';

require('./load-env').loadEnvLocal();

const DEFAULT_BASE = 'https://reinomagicodosaber.netlify.app';

async function main() {
  const user = process.env.REPORTS_ADMIN_USER;
  const pass = process.env.REPORTS_ADMIN_PASS;
  const baseUrl = (process.env.REPORTS_BASE_URL || DEFAULT_BASE).replace(/\/$/, '');
  if (!user || !pass) {
    console.error('Define REPORTS_ADMIN_USER e REPORTS_ADMIN_PASS.');
    process.exit(1);
  }
  const auth = Buffer.from(`${user}:${pass}`, 'utf8').toString('base64');
  const url = `${baseUrl}/api/reports-admin?status=open&limit=50`;
  const response = await fetch(url, {
    headers: { Authorization: `Basic ${auth}` },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error(data.error || `HTTP ${response.status}`);
    process.exit(1);
  }
  const reports = data.reports || [];
  console.log(`Por tratar: ${reports.length} (total servidor: ${data.total ?? '?'})`);
  for (const r of reports) {
    console.log('---');
    console.log(`ID: ${r.reportId}`);
    console.log(`Problema: ${r.issueType || r.issueLabel || '—'}`);
    console.log(`Pergunta: ${r.question || '—'}`);
    console.log(`Resposta: ${r.correctAnswer || r.answer || '—'}`);
    console.log(`Categoria: ${r.categoryName || r.category || '—'} | Idade: ${r.ageBand || '—'}`);
    if (r.comment) console.log(`Comentário: ${r.comment}`);
    if (r.suggestion) console.log(`Sugestão: ${r.suggestion}`);
  }
  if (!reports.length) process.exit(0);
  console.log('---');
  console.log('IDs:', reports.map((r) => r.reportId).join(', '));
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
