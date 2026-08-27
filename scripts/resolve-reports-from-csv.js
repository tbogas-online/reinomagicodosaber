#!/usr/bin/env node
/**
 * Marca reportes como "resolved" via API admin.
 *
 * Uso:
 *   set REPORTS_ADMIN_USER=admin
 *   set REPORTS_ADMIN_PASS=...
 *   node scripts/resolve-reports-from-csv.js "C:\caminho\reportes.csv"
 *
 * Ou só com IDs:
 *   node scripts/resolve-reports-from-csv.js --ids rpt-abc,rpt-def
 */

const fs = require('fs');
const path = require('path');

require('./load-env').loadEnvLocal();

const DEFAULT_BASE = 'https://reinomagicodosaber.netlify.app';

function parseCsvReportIds(csvText) {
  const lines = csvText.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const header = lines[0].split(',').map((h) => h.replace(/^"|"$/g, '').trim().toLowerCase());
  const idIndex = header.indexOf('reportid');
  if (idIndex < 0) throw new Error('Coluna reportId não encontrada no CSV.');
  const ids = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = lines[i].match(/("([^"]|"")*"|[^,]*)(,|$)/g);
    if (!cols || !cols[idIndex]) continue;
    const raw = cols[idIndex].replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"').trim();
    if (raw) ids.push(raw);
  }
  return [...new Set(ids)];
}

function parseArgs(argv) {
  const args = { file: '', ids: [], baseUrl: process.env.REPORTS_BASE_URL || DEFAULT_BASE };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--ids') {
      args.ids.push(...String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean));
    } else if (arg === '--base') {
      args.baseUrl = argv[++i] || args.baseUrl;
    } else if (!arg.startsWith('--') && !args.file) {
      args.file = arg;
    }
  }
  return args;
}

async function resolveReports(reportIds, baseUrl, user, pass) {
  const auth = Buffer.from(`${user}:${pass}`, 'utf8').toString('base64');
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/reports-admin`, {
    method: 'PATCH',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ reportIds, status: 'resolved' }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  return data;
}

async function main() {
  const args = parseArgs(process.argv);
  let reportIds = args.ids;
  if (args.file) {
    const csvPath = path.resolve(args.file);
    if (!fs.existsSync(csvPath)) {
      console.error('Ficheiro não encontrado:', csvPath);
      process.exit(1);
    }
    reportIds = parseCsvReportIds(fs.readFileSync(csvPath, 'utf8'));
  } else if (!reportIds.length) {
    console.error('Indica um CSV ou --ids rpt-abc,rpt-def');
    process.exit(1);
  }
  reportIds = [...new Set(reportIds.filter(Boolean))];
  if (!reportIds.length) {
    console.error('Nenhum reportId encontrado.');
    process.exit(1);
  }

  const user = process.env.REPORTS_ADMIN_USER;
  const pass = process.env.REPORTS_ADMIN_PASS;
  if (!user || !pass) {
    console.error('Define REPORTS_ADMIN_USER e REPORTS_ADMIN_PASS (credenciais do painel admin).');
    process.exit(1);
  }

  console.log(`A marcar ${reportIds.length} reporte(s) como resolvido(s) em ${args.baseUrl}…`);
  const result = await resolveReports(reportIds, args.baseUrl, user, pass);
  const updated = result.updated || [];
  const reports = result.reports || (result.report ? [{
    reportId: result.report.reportId,
    resolvedAtPortugal: result.report.resolvedAtPortugal,
    resolvedAt: result.report.resolvedAt,
  }] : []);
  const failed = result.failed || [];
  console.log(`Atualizados: ${updated.length}`);
  if (reports.length) {
    reports.forEach((report) => {
      const when = report.resolvedAtPortugal || report.resolvedAt || '';
      console.log(`  ✓ ${report.reportId}${when ? ` — resolvidoEm: ${when}` : ''}`);
    });
  } else if (updated.length) {
    updated.forEach((id) => console.log(`  ✓ ${id}`));
  }
  if (failed.length) {
    console.log(`Falharam: ${failed.length}`);
    failed.forEach((id) => console.log(`  ✗ ${id}`));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Erro:', err.message || err);
  process.exit(1);
});
