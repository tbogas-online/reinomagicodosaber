#!/usr/bin/env node
/**
 * Revalida reportes resolvidos com o motor e aplica correcções no banco Supabase.
 *
 * Uso:
 *   node scripts/revalidate-resolved-reports.js --dry-run
 *   node scripts/revalidate-resolved-reports.js --limit 30
 *   node scripts/revalidate-resolved-reports.js --ids rpt-abc,rpt-def
 *   node scripts/revalidate-resolved-reports.js --apply-suggestions
 *
 * Requer .env.local: REPORTS_ADMIN_USER, REPORTS_ADMIN_PASS,
 * SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (para gravar no banco).
 */
'use strict';

require('./load-env').loadEnvLocal();

const { loadQuestionEngine, stripTags, normalizeQ } = require('./lib/load-question-engine');
const {
  applyReportCorrectionToBank,
  searchQuestionBank,
  parseGameQuestionId,
  hashQuestionKey,
} = require('../netlify/functions/lib/question-bank-store');

const DEFAULT_BASE = 'https://reinomagicodosaber.netlify.app';

function parseArgs(argv) {
  const args = {
    dryRun: false,
    limit: 100,
    offset: 0,
    ids: [],
    baseUrl: process.env.REPORTS_BASE_URL || DEFAULT_BASE,
    applySuggestions: false,
    status: 'resolved',
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--apply-suggestions') args.applySuggestions = true;
    else if (arg === '--limit') args.limit = Math.max(1, Number(argv[++i]) || 100);
    else if (arg === '--offset') args.offset = Math.max(0, Number(argv[++i]) || 0);
    else if (arg === '--base') args.baseUrl = argv[++i] || args.baseUrl;
    else if (arg === '--ids') {
      args.ids.push(...String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean));
    } else if (arg === '--help' || arg === '-h') {
      console.log(`Uso: node scripts/revalidate-resolved-reports.js [opções]

  --dry-run              Simular sem gravar no banco
  --limit N              Máximo de reportes (default 100)
  --offset N             Paginação
  --ids id1,id2          Só estes reportes
  --apply-suggestions    Aplicar sugestões do motor (não só appliedCorrection)
  --base URL             API (default produção)
`);
      process.exit(0);
    }
  }
  return args;
}

function authHeader(user, pass) {
  return `Basic ${Buffer.from(`${user}:${pass}`, 'utf8').toString('base64')}`;
}

async function fetchReports(args, user, pass) {
  if (args.ids.length) {
    const reports = [];
    for (const id of args.ids) {
      const url = `${args.baseUrl.replace(/\/$/, '')}/api/reports-admin?reportId=${encodeURIComponent(id)}&limit=1`;
      const response = await fetch(url, { headers: { Authorization: authHeader(user, pass) } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status} ao ler ${id}`);
      const list = data.reports || (data.report ? [data.report] : []);
      reports.push(...list);
    }
    return reports;
  }

  const params = new URLSearchParams({
    status: args.status,
    limit: String(args.limit),
    offset: String(args.offset),
  });
  const url = `${args.baseUrl.replace(/\/$/, '')}/api/reports-admin?${params.toString()}`;
  const response = await fetch(url, { headers: { Authorization: authHeader(user, pass) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data.reports || [];
}

function isSiteReport(report) {
  return String(report?.source) === 'site'
    || String(report?.format) === 'SITE'
    || String(report?.issueType || '').startsWith('site_');
}

function bankHashFromReport(report) {
  const parsed = parseGameQuestionId(report?.questionId);
  if (parsed?.hash) return parsed.hash;
  const q = String(report?.originalQuestion || report?.question || '').trim();
  const a = String(report?.originalCorrectAnswer || report?.correctAnswer || '').trim();
  if (q && a) return hashQuestionKey(`${q}|${a}`);
  return '';
}

function normOpts(arr) {
  return (arr || []).map((o) => String(o || '').trim()).filter(Boolean).join('\n');
}

function buildCorrectionForReport(report, diagnosis, { applySuggestions } = {}) {
  const applied = report.reviewDecision?.appliedCorrection;
  if (applied?.question && applied?.answer) {
    return {
      source: 'reviewDecision',
      question: applied.question,
      answer: applied.answer,
      options: applied.options,
      format: applied.format || (applied.options?.length >= 2 ? 'ESCOLHA_MULTIPLA' : undefined),
    };
  }

  const action = report.reviewDecision?.action;
  if (action === 'delete_bank' || action === 'reject') return null;

  const suggested = diagnosis?.suggestedCorrection;
  const hasSuggestionChanges = (diagnosis?.suggestedChanges || suggested?.suggestedChanges || []).length > 0;
  if (applySuggestions && suggested?.question && suggested?.answer
    && (diagnosis?.recommendedAction === 'correct' || hasSuggestionChanges)) {
    return {
      source: 'diagnosis',
      question: suggested.question,
      answer: suggested.answer,
      options: suggested.options,
      format: suggested.format || (suggested.options?.length >= 2 ? 'ESCOLHA_MULTIPLA' : undefined),
    };
  }

  if (action === 'correct' || action === 'validate') {
    const question = String(report.question || '').trim();
    const answer = String(report.correctAnswer || '').trim();
    if (!question || !answer) return null;
    return {
      source: 'report_fields',
      question,
      answer,
      options: Array.isArray(report.options) ? report.options : undefined,
      format: report.format || (report.options?.length >= 2 ? 'ESCOLHA_MULTIPLA' : undefined),
    };
  }

  return null;
}

async function main() {
  const args = parseArgs(process.argv);
  const user = process.env.REPORTS_ADMIN_USER;
  const pass = process.env.REPORTS_ADMIN_PASS;
  if (!user || !pass) {
    console.error('Define REPORTS_ADMIN_USER e REPORTS_ADMIN_PASS em .env.local');
    process.exit(1);
  }

  if (!args.dryRun && !process.env.SUPABASE_URL) {
    console.error('Para gravar no banco, define SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY em .env.local');
    process.exit(1);
  }

  const { QE, ReportDiagnosis: RD } = loadQuestionEngine();
  const helpers = {
    stripTags,
    normalizeFn: normalizeQ,
    validateTrueFalseQuestion: () => ({ ok: true, issues: [] }),
  };

  console.log(`A carregar reportes resolvidos (${args.baseUrl})…`);
  const reports = await fetchReports(args, user, pass);
  const candidates = reports.filter((r) => r && !isSiteReport(r) && r.question && r.correctAnswer);

  console.log(`Analisados: ${reports.length} · candidatos: ${candidates.length}${args.dryRun ? ' · DRY-RUN' : ''}\n`);

  const summary = { skipped: 0, applied: 0, failed: 0, unchanged: 0 };

  for (const report of candidates) {
    const diagnosis = RD.diagnoseReport(report, QE, helpers);
    const correction = buildCorrectionForReport(report, diagnosis, {
      applySuggestions: args.applySuggestions,
    });

    if (!correction) {
      summary.skipped += 1;
      console.log(`⊘ ${report.reportId} — sem correcção aplicável (${report.reviewDecision?.action || '—'})`);
      continue;
    }

    const lookupHash = bankHashFromReport(report);
    if (!lookupHash) {
      summary.skipped += 1;
      console.log(`⊘ ${report.reportId} — hash desconhecido`);
      continue;
    }

    const categoryN = report.category?.n;
    const ageBand = report.ageBand;
    if (!categoryN || !ageBand) {
      summary.skipped += 1;
      console.log(`⊘ ${report.reportId} — falta categoria ou idade`);
      continue;
    }

    let existing = null;
    try {
      const search = await searchQuestionBank({ hash: lookupHash, limit: 1 });
      existing = search.rows?.[0] || null;
    } catch {
      /* ignore */
    }

    const needsUpdate = !existing
      || String(existing.question || '').trim() !== String(correction.question || '').trim()
      || String(existing.correct_answer || '').trim() !== String(correction.answer || '').trim()
      || normOpts(existing.options) !== normOpts(correction.options);

    if (!needsUpdate) {
      summary.unchanged += 1;
      console.log(`= ${report.reportId} — banco já actualizado (hash ${lookupHash})`);
      continue;
    }

    const preview = diagnosis
      ? `motor: ${diagnosis.verdict} (${diagnosis.qualityScore}/100) · acção ${diagnosis.recommendedAction}`
      : '';
    console.log(`→ ${report.reportId} [${correction.source}] hash ${lookupHash}`);
    console.log(`  Q: ${(correction.question || '').slice(0, 90)}…`);
    console.log(`  A: ${correction.answer || '—'}`);
    if (correction.options?.length) console.log(`  Opções: ${correction.options.join(' · ')}`);
    if (preview) console.log(`  ${preview}`);
    if (existing) {
      console.log(`  Banco: actualizar (${existing.is_reported ? 'reportada' : 'ok'})`);
    } else {
      console.log('  Banco: inserir (não existia)');
    }

    if (args.dryRun) continue;

    try {
      const result = await applyReportCorrectionToBank(lookupHash, correction, {
        categoryN,
        ageBand,
        knowledgeId: report.knowledgeId || null,
        source: report.source === 'bank' ? 'bank' : 'corrected',
      });
      summary.applied += 1;
      console.log(`  ✓ ${result.action || 'ok'} → hash ${result.questionHash}${result.previousHash ? ` (era ${result.previousHash})` : ''}`);
    } catch (err) {
      summary.failed += 1;
      console.log(`  ✗ ${err.message || err}`);
    }
  }

  console.log('\n---');
  console.log(`Inseridos/actualizados: ${summary.applied}`);
  console.log(`Já correctos: ${summary.unchanged}`);
  console.log(`Ignorados: ${summary.skipped}`);
  console.log(`Falhas: ${summary.failed}`);
  if (args.dryRun) console.log('(dry-run — nada foi gravado)');

  if (summary.failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Erro:', err.message || err);
  process.exit(1);
});
