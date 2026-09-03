const { getSupabaseAdmin } = require('./rooms-store');
const { formatPortugalDateTime } = require('./report-utils');

const TABLE = 'question_reports';
const MAX_REPORTS = 2000;
const INDEX_SELECT = 'report_id,received_at,status,resolved_at,resolved_at_portugal,cancelled_at,issue_type,age_band,category_name,reporter_id,device_type';
const FULL_SELECT = `${INDEX_SELECT},payload`;

function isConfigured() {
  return !!getSupabaseAdmin();
}

async function supabaseRequest(path, options = {}) {
  const cfg = getSupabaseAdmin();
  if (!cfg) {
    const err = new Error('Supabase admin não configurado (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).');
    err.code = 'NOT_CONFIGURED';
    throw err;
  }

  const headers = {
    apikey: cfg.key,
    Authorization: `Bearer ${cfg.key}`,
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  if (!options.headers?.Prefer && options.method !== 'GET' && options.method !== 'HEAD') {
    headers.Prefer = options.prefer || 'return=minimal';
  }

  const response = await fetch(`${cfg.url}/rest/v1${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const err = new Error(text || `Supabase HTTP ${response.status}`);
    err.status = response.status;
    throw err;
  }

  if (response.status === 204) return null;
  const text = await response.text();
  if (!text) return null;
  return JSON.parse(text);
}

async function supabaseRpc(functionName, body = {}) {
  const cfg = getSupabaseAdmin();
  if (!cfg) {
    const err = new Error('Supabase admin não configurado (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).');
    err.code = 'NOT_CONFIGURED';
    throw err;
  }

  const response = await fetch(`${cfg.url}/rest/v1/rpc/${functionName}`, {
    method: 'POST',
    headers: {
      apikey: cfg.key,
      Authorization: `Bearer ${cfg.key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const err = new Error(text || `Supabase RPC HTTP ${response.status}`);
    err.status = response.status;
    throw err;
  }

  const text = await response.text();
  if (!text) return null;
  return JSON.parse(text);
}

function reportToRow(report, helpers) {
  const categoryName = helpers.resolveReportCategoryName(report);
  return {
    report_id: report.reportId,
    received_at: report.receivedAt || new Date().toISOString(),
    status: helpers.normalizeReportStatus(report.status),
    resolved_at: report.resolvedAt || null,
    resolved_at_portugal: report.resolvedAtPortugal || null,
    cancelled_at: report.cancelledAt || null,
    issue_type: report.issueType,
    issue_label: report.issueLabel || null,
    age_band: report.ageBand || null,
    category_name: categoryName || null,
    category_n: report.category?.n != null ? Number(report.category.n) : null,
    reporter_id: report.reporterId || null,
    device_type: report.device?.type || null,
    question_hash: helpers.questionHashFromReport(report) || null,
    knowledge_id: report.knowledgeId || null,
    question_text: report.question || null,
    comment: report.comment || null,
    suggestion: report.suggestion || null,
    payload: report,
  };
}

function rowToReport(row) {
  const payload = row?.payload && typeof row.payload === 'object' ? { ...row.payload } : {};
  return {
    ...payload,
    reportId: row.report_id || payload.reportId,
    receivedAt: row.received_at || payload.receivedAt,
    status: row.status || payload.status,
    resolvedAt: row.resolved_at || payload.resolvedAt || null,
    resolvedAtPortugal: row.resolved_at_portugal || payload.resolvedAtPortugal || null,
    cancelledAt: row.cancelled_at || payload.cancelledAt || null,
    issueType: row.issue_type || payload.issueType,
    ageBand: row.age_band || payload.ageBand,
    reporterId: row.reporter_id || payload.reporterId,
    knowledgeId: row.knowledge_id || payload.knowledgeId,
    question: row.question_text || payload.question,
    comment: row.comment ?? payload.comment,
    suggestion: row.suggestion ?? payload.suggestion,
  };
}

function rowToIndexItem(row) {
  return {
    reportId: row.report_id,
    receivedAt: row.received_at,
    issueType: row.issue_type,
    ageBand: row.age_band,
    categoryName: row.category_name,
    reporterId: row.reporter_id,
    deviceType: row.device_type,
    status: row.status,
    resolvedAt: row.resolved_at,
    resolvedAtPortugal: row.resolved_at_portugal,
    cancelledAt: row.cancelled_at,
  };
}

function buildFilterQuery(filters = {}, helpers) {
  const params = new URLSearchParams();
  const andParts = [];

  if (filters.issueType) params.set('issue_type', `eq.${filters.issueType}`);
  if (filters.ageBand) params.set('age_band', `eq.${filters.ageBand}`);
  if (filters.reporterId) params.set('reporter_id', `eq.${filters.reporterId}`);
  if (filters.deviceType) params.set('device_type', `eq.${filters.deviceType}`);
  if (filters.status) params.set('status', `eq.${helpers.normalizeReportStatus(filters.status)}`);
  if (filters.category) {
    const needle = encodeURIComponent(`*${String(filters.category).trim()}*`);
    params.set('category_name', `ilike.${needle}`);
  }
  if (filters.dateFrom && helpers.isValidDateFilter(filters.dateFrom)) {
    andParts.push(`received_at.gte.${filters.dateFrom}T00:00:00.000Z`);
  }
  if (filters.dateTo && helpers.isValidDateFilter(filters.dateTo)) {
    andParts.push(`received_at.lte.${filters.dateTo}T23:59:59.999Z`);
  }
  if (andParts.length) params.set('and', `(${andParts.join(',')})`);

  return params;
}

async function countRows(filters = {}, helpers) {
  const cfg = getSupabaseAdmin();
  if (!cfg) return 0;
  const params = buildFilterQuery(filters, helpers);
  params.set('select', 'report_id');
  const response = await fetch(`${cfg.url}/rest/v1/${TABLE}?${params.toString()}`, {
    method: 'HEAD',
    headers: {
      apikey: cfg.key,
      Authorization: `Bearer ${cfg.key}`,
      Prefer: 'count=exact',
      Range: '0-0',
    },
  });
  if (!response.ok) return 0;
  const range = response.headers.get('content-range') || '';
  const total = range.split('/')[1];
  return Number(total) || 0;
}

async function fetchIndexRows(filters = {}, helpers) {
  const params = buildFilterQuery(filters, helpers);
  params.set('select', INDEX_SELECT);
  params.set('order', 'received_at.desc');
  params.set('limit', String(MAX_REPORTS));
  const rows = await supabaseRequest(`/${TABLE}?${params.toString()}`);
  return (rows || []).map(rowToIndexItem);
}

async function fetchReports(filters = {}, helpers) {
  const searchNeedle = filters.q ? String(filters.q).toLowerCase().trim() : '';
  const baseFilters = searchNeedle ? { ...filters, q: '' } : filters;
  const params = buildFilterQuery(baseFilters, helpers);
  params.set('select', FULL_SELECT);
  params.set('order', 'received_at.desc');
  params.set('limit', String(MAX_REPORTS));
  const rows = await supabaseRequest(`/${TABLE}?${params.toString()}`);
  let reports = (rows || []).map(rowToReport);
  if (searchNeedle) {
    reports = reports.filter((report) => helpers.reportMatchesSearch(report, searchNeedle));
  }
  return reports;
}

async function saveReport(report, helpers) {
  const row = reportToRow(report, helpers);
  await supabaseRequest(`/${TABLE}?on_conflict=report_id`, {
    method: 'POST',
    body: JSON.stringify(row),
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
  });
  try {
    await supabaseRpc('trim_question_reports', { p_max: MAX_REPORTS });
  } catch (err) {
    console.warn('[reports-store-supabase] trim failed:', err.message || err);
  }
  return report;
}

async function upsertManyReports(reports, helpers) {
  if (!reports.length) return 0;
  const rows = reports.map((report) => reportToRow(report, helpers));
  await supabaseRequest(`/${TABLE}?on_conflict=report_id`, {
    method: 'POST',
    body: JSON.stringify(rows),
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
  });
  try {
    await supabaseRpc('trim_question_reports', { p_max: MAX_REPORTS });
  } catch (err) {
    console.warn('[reports-store-supabase] trim failed:', err.message || err);
  }
  return rows.length;
}

async function getReport(reportId, helpers) {
  const rows = await supabaseRequest(`/${TABLE}?report_id=eq.${encodeURIComponent(reportId)}&select=${FULL_SELECT}&limit=1`);
  if (!Array.isArray(rows) || !rows[0]) return null;
  return rowToReport(rows[0]);
}

async function listReports(filters = {}, helpers) {
  const limit = Math.min(Math.max(Number(filters.limit) || 50, 1), 200);
  const offset = Math.max(Number(filters.offset) || 0, 0);
  const reports = await fetchReports(filters, helpers);
  const slice = reports.slice(offset, offset + limit);
  return {
    total: reports.length,
    offset,
    limit,
    reports: slice,
    uniqueReporters: new Set(reports.map((r) => r.reporterId).filter(Boolean)).size,
  };
}

async function getStats(scope = 'all', filters = {}, helpers) {
  const items = await fetchIndexRows(filters, helpers);
  const base = helpers.computeStatsFromIndex({ items, total: items.length }, scope, filters);
  try {
    const reports = await fetchReports({ ...filters, limit: MAX_REPORTS }, helpers);
    if (helpers.aggregateDiagnosisStats) {
      base.diagnosis = helpers.aggregateDiagnosisStats(reports);
    }
  } catch (err) {
    console.warn('[reports-store-supabase] diagnosis stats failed:', err.message || err);
  }
  return base;
}

async function updateReportStatus(reportId, status, helpers, extras = {}) {
  const nextStatus = helpers.normalizeReportStatus(status);
  if (!helpers.VALID_STATUSES.has(nextStatus)) return null;
  const report = await getReport(reportId, helpers);
  if (!report) return null;
  const now = new Date().toISOString();
  report.status = nextStatus;
  delete report.resolvedAt;
  delete report.resolvedAtPortugal;
  delete report.cancelledAt;
  if (nextStatus === 'resolved') {
    report.resolvedAt = now;
    report.resolvedAtPortugal = formatPortugalDateTime(now);
  }
  if (nextStatus === 'cancelled') report.cancelledAt = now;
  if (extras.reviewDecision && typeof extras.reviewDecision === 'object') {
    report.reviewDecision = extras.reviewDecision;
    report.reviewedAt = now;
    report.reviewedAtPortugal = formatPortugalDateTime(now);
    if (extras.reviewDecision.appliedCorrection) {
      helpers.applyCorrectionToReport(report, extras.reviewDecision.appliedCorrection);
    }
  }
  await saveReport(report, helpers);
  return report;
}

async function getReportStatuses(reportIds, reporterId, helpers) {
  const statuses = {};
  const ids = [...new Set(reportIds)].filter(Boolean).slice(0, 50);
  if (!ids.length) return statuses;
  const inList = ids.map((id) => encodeURIComponent(id)).join(',');
  const rows = await supabaseRequest(`/${TABLE}?report_id=in.(${inList})&select=report_id,status,resolved_at,cancelled_at,reporter_id,payload`);
  for (const row of rows || []) {
    const report = rowToReport(row);
    if (reporterId && report.reporterId && report.reporterId !== reporterId) continue;
    statuses[report.reportId] = {
      status: helpers.normalizeReportStatus(report.status),
      resolvedAt: report.resolvedAt || null,
      cancelledAt: report.cancelledAt || null,
    };
  }
  return statuses;
}

async function deleteReport(reportId, helpers) {
  const report = await getReport(reportId, helpers);
  if (!report) return { ok: false, error: 'not_found', reportId };
  if (helpers.normalizeReportStatus(report.status) !== 'cancelled') {
    return { ok: false, error: 'not_cancelled', reportId };
  }
  await supabaseRequest(`/${TABLE}?report_id=eq.${encodeURIComponent(reportId)}`, {
    method: 'DELETE',
  });
  return { ok: true, reportId };
}

async function getQuestionHashesByReportStatus(helpers) {
  const rows = await supabaseRequest(`/${TABLE}?select=question_hash,status,issue_type&question_hash=not.is.null&limit=${MAX_REPORTS}`);
  const open = new Set();
  const resolved = new Set();
  const any = new Set();

  for (const row of rows || []) {
    if (helpers.isSiteIssueType(row.issue_type)) continue;
    const hash = String(row.question_hash || '').trim();
    if (!hash) continue;
    const status = helpers.normalizeReportStatus(row.status);
    if (status === 'cancelled') continue;
    any.add(hash);
    if (status === 'open') open.add(hash);
    if (status === 'resolved') resolved.add(hash);
  }

  return {
    open: [...open],
    resolved: [...resolved],
    any: [...any],
  };
}

async function getRowCount() {
  const cfg = getSupabaseAdmin();
  if (!cfg) return 0;
  const response = await fetch(`${cfg.url}/rest/v1/${TABLE}?select=report_id`, {
    method: 'HEAD',
    headers: {
      apikey: cfg.key,
      Authorization: `Bearer ${cfg.key}`,
      Prefer: 'count=exact',
      Range: '0-0',
    },
  });
  if (!response.ok) return 0;
  const range = response.headers.get('content-range') || '';
  const total = range.split('/')[1];
  return Number(total) || 0;
}

module.exports = {
  TABLE,
  MAX_REPORTS,
  isConfigured,
  saveReport,
  upsertManyReports,
  getReport,
  listReports,
  getStats,
  updateReportStatus,
  getReportStatuses,
  deleteReport,
  getQuestionHashesByReportStatus,
  getRowCount,
  reportToRow,
  rowToReport,
  rowToIndexItem,
};
