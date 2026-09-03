// GET/DELETE /api/reports-admin — Cloudflare Pages. Requer REPORTS_KV + credenciais admin.

const INDEX_KEY = 'reports-index';
const MAX_REPORTS = 2000;

function normalizeReportStatus(status) {
  if (status === 'resolved') return 'resolved';
  if (status === 'cancelled' || status === 'deleted') return 'cancelled';
  return 'open';
}

function isValidReportStatus(status) {
  return ['open', 'resolved', 'cancelled'].includes(normalizeReportStatus(status));
}

function json(statusCode, body) {
  return new Response(JSON.stringify(body), {
    status: statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
    },
  });
}

function formatPortugalDateTime(dateInput) {
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('pt-PT', {
    timeZone: 'Europe/Lisbon',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function parseBasicAuth(authorization) {
  if (!authorization || !authorization.startsWith('Basic ')) return null;
  try {
    const decoded = atob(authorization.slice(6));
    const sep = decoded.indexOf(':');
    if (sep < 0) return { user: decoded, pass: '' };
    return { user: decoded.slice(0, sep), pass: decoded.slice(sep + 1) };
  } catch {
    return null;
  }
}

function validateAdminAuth(request, env) {
  const expectedUser = env.REPORTS_ADMIN_USER;
  const expectedPass = env.REPORTS_ADMIN_PASS;
  if (!expectedUser || !expectedPass) {
    return { ok: false, status: 503, error: 'Painel admin não configurado (falta REPORTS_ADMIN_USER / REPORTS_ADMIN_PASS).' };
  }
  const credentials = parseBasicAuth(request.headers.get('authorization') || '');
  if (!credentials) {
    return { ok: false, status: 401, error: 'Utilizador ou palavra-passe incorretos.' };
  }
  if (credentials.user === expectedUser && credentials.pass === expectedPass) {
    return { ok: true };
  }
  return { ok: false, status: 401, error: 'Utilizador ou palavra-passe incorretos.' };
}

async function readIndex(kv) {
  const raw = await kv.get(INDEX_KEY);
  if (!raw) return { items: [], total: 0 };
  try {
    const index = JSON.parse(raw);
    return index && Array.isArray(index.items) ? index : { items: [], total: 0 };
  } catch {
    return { items: [], total: 0 };
  }
}

function filterIndexItems(items, filters = {}) {
  let filtered = items;
  if (filters.issueType) filtered = filtered.filter((i) => i.issueType === filters.issueType);
  if (filters.ageBand) filtered = filtered.filter((i) => i.ageBand === filters.ageBand);
  if (filters.reporterId) filtered = filtered.filter((i) => i.reporterId === filters.reporterId);
  if (filters.deviceType) filtered = filtered.filter((i) => i.deviceType === filters.deviceType);
  if (filters.status) {
    filtered = filtered.filter((i) => normalizeReportStatus(i.status) === filters.status);
  }
  if (filters.category) {
    const needle = String(filters.category).toLowerCase();
    filtered = filtered.filter((i) => String(i.categoryName || '').toLowerCase().includes(needle));
  }
  if (filters.q) {
    const needle = String(filters.q).toLowerCase();
    filtered = filtered.filter((i) => i.reportId.toLowerCase().includes(needle));
  }
  return filtered;
}

async function listReports(kv, filters = {}) {
  const index = await readIndex(kv);
  const limit = Math.min(Math.max(Number(filters.limit) || 50, 1), 200);
  const offset = Math.max(Number(filters.offset) || 0, 0);
  const filtered = filterIndexItems(index.items, filters);
  const slice = filtered.slice(offset, offset + limit);
  const reports = await Promise.all(
    slice.map(async (item) => {
      const raw = await kv.get(`report:${item.reportId}`);
      return raw ? JSON.parse(raw) : null;
    }),
  );
  return {
    total: filtered.length,
    offset,
    limit,
    reports: reports.filter(Boolean),
    uniqueReporters: new Set(filtered.map((i) => i.reporterId).filter(Boolean)).size,
  };
}

const {
  toLisbonDayKey,
  toLisbonHourKey,
  buildDailySeries,
  buildHourlySeries,
  buildStackedDailySeries,
  buildStackedHourlySeries,
} = require('../../../scripts/lib/lisbon-time');

function sumByIssue(byIssue) {
  return Object.values(byIssue || {}).reduce((sum, value) => sum + value, 0);
}

function computeStatsFromIndex(index, filters = {}) {
  const allItems = index.items || [];
  const filteredAll = filterIndexItems(allItems, filters);
  const openCount = filteredAll.filter((i) => normalizeReportStatus(i.status) === 'open').length;
  const resolvedCount = filteredAll.filter((i) => normalizeReportStatus(i.status) === 'resolved').length;
  const cancelledCount = filteredAll.filter((i) => normalizeReportStatus(i.status) === 'cancelled').length;
  const activeItems = filteredAll.filter((i) => normalizeReportStatus(i.status) !== 'cancelled');
  const allActiveItems = allItems.filter((i) => normalizeReportStatus(i.status) !== 'cancelled');

  const byIssueAll = {};
  for (const item of allActiveItems) {
    byIssueAll[item.issueType] = (byIssueAll[item.issueType] || 0) + 1;
  }

  const byIssue = {};
  const byAge = {};
  const byDevice = {};
  const byCategory = {};
  const byDay = {};
  const byHour = {};
  const byDayByIssue = {};
  const byHourByIssue = {};
  const reporters = new Set();

  for (const item of activeItems) {
    if (item.receivedAt) {
      const day = toLisbonDayKey(item.receivedAt);
      const hour = toLisbonHourKey(item.receivedAt);
      if (!day || !hour) continue;
      if (!byDayByIssue[day]) byDayByIssue[day] = {};
      if (!byHourByIssue[hour]) byHourByIssue[hour] = {};
      byDayByIssue[day][item.issueType] = (byDayByIssue[day][item.issueType] || 0) + 1;
      byHourByIssue[hour][item.issueType] = (byHourByIssue[hour][item.issueType] || 0) + 1;
    }
  }

  for (const item of activeItems) {
    byIssue[item.issueType] = (byIssue[item.issueType] || 0) + 1;
    const age = item.ageBand || '—';
    byAge[age] = (byAge[age] || 0) + 1;
    const device = item.deviceType || '—';
    byDevice[device] = (byDevice[device] || 0) + 1;
    const category = String(item.issueType || '').startsWith('site_')
      ? 'Site/app'
      : String(item.categoryName || '').trim();
    if (category) byCategory[category] = (byCategory[category] || 0) + 1;
    if (item.receivedAt) {
      const day = toLisbonDayKey(item.receivedAt);
      const hour = toLisbonHourKey(item.receivedAt);
      if (!day || !hour) continue;
      byDay[day] = (byDay[day] || 0) + 1;
      byHour[hour] = (byHour[hour] || 0) + 1;
    }
    if (item.reporterId) reporters.add(item.reporterId);
  }

  const topCategories = Object.entries(byCategory)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, count]) => ({ name, count }));

  const timelineSeries = {
    '24h': buildHourlySeries(byHour, 24),
    '3d': buildHourlySeries(byHour, 72),
    '7d': buildDailySeries(byDay, 7),
    '14d': buildDailySeries(byDay, 14),
  };
  const timelineStacked = {
    '24h': buildStackedHourlySeries(byHourByIssue, 24),
    '3d': buildStackedHourlySeries(byHourByIssue, 72),
    '7d': buildStackedDailySeries(byDayByIssue, 7, sumByIssue),
    '14d': buildStackedDailySeries(byDayByIssue, 14, sumByIssue),
  };

  return {
    total: filteredAll.length,
    activeTotal: activeItems.length,
    openCount,
    resolvedCount,
    cancelledCount,
    byStatus: { open: openCount, resolved: resolvedCount, cancelled: cancelledCount },
    uniqueReporters: reporters.size,
    byIssueType: byIssue,
    byIssueTypeAll: byIssueAll,
    byAgeBand: byAge,
    byDeviceType: byDevice,
    topCategories,
    timelineSeries,
    timelineStacked,
    daily: timelineSeries['14d'],
    latestAt: activeItems[0]?.receivedAt || allItems[0]?.receivedAt || null,
  };
}

async function updateReportStatus(kv, reportId, status) {
  const nextStatus = normalizeReportStatus(status);
  if (!isValidReportStatus(nextStatus)) return null;
  const raw = await kv.get(`report:${reportId}`);
  if (!raw) return null;
  const report = JSON.parse(raw);
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
  await kv.put(`report:${report.reportId}`, JSON.stringify(report));
  const index = await readIndex(kv);
  const item = index.items.find((entry) => entry.reportId === reportId);
  if (item) {
    item.status = nextStatus;
    delete item.resolvedAt;
    delete item.resolvedAtPortugal;
    delete item.cancelledAt;
    if (nextStatus === 'resolved') {
      item.resolvedAt = report.resolvedAt;
      item.resolvedAtPortugal = report.resolvedAtPortugal;
    }
    if (nextStatus === 'cancelled') item.cancelledAt = report.cancelledAt;
    await kv.put(INDEX_KEY, JSON.stringify(index));
  }
  return report;
}

async function updateManyReportStatuses(kv, reportIds, status) {
  const ids = [...new Set(reportIds)].filter(Boolean).slice(0, 100);
  const updated = [];
  const reports = [];
  const failed = [];
  for (const reportId of ids) {
    const report = await updateReportStatus(kv, reportId, status);
    if (report) {
      updated.push(reportId);
      reports.push({
        reportId: report.reportId,
        status: report.status,
        resolvedAt: report.resolvedAt || null,
        resolvedAtPortugal: report.resolvedAtPortugal || null,
      });
    } else failed.push(reportId);
  }
  return { updated, reports, failed, status: normalizeReportStatus(status) };
}

async function getStats(kv, filters = {}) {
  const index = await readIndex(kv);
  return computeStatsFromIndex(index, filters);
}

async function deleteReport(kv, reportId) {
  const raw = await kv.get(`report:${reportId}`);
  if (!raw) return { ok: false, error: 'not_found', reportId };
  const report = JSON.parse(raw);
  if (normalizeReportStatus(report.status) !== 'cancelled') {
    return { ok: false, error: 'not_cancelled', reportId };
  }
  await kv.delete(`report:${reportId}`);
  const index = await readIndex(kv);
  index.items = index.items.filter((item) => item.reportId !== reportId);
  index.total = index.items.length;
  await kv.put(INDEX_KEY, JSON.stringify(index));
  return { ok: true, reportId };
}

async function deleteManyReports(kv, reportIds) {
  const ids = [...new Set(reportIds)].filter(Boolean).slice(0, 100);
  const deleted = [];
  const failed = [];
  const skipped = [];
  for (const reportId of ids) {
    const result = await deleteReport(kv, reportId);
    if (result.ok) deleted.push(reportId);
    else if (result.error === 'not_cancelled') skipped.push(reportId);
    else failed.push(reportId);
  }
  return { deleted, failed, skipped };
}

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*' } });
  }

  const auth = validateAdminAuth(context.request, context.env);
  if (!auth.ok) return json(auth.status, { error: auth.error });

  const kv = context.env.REPORTS_KV;
  if (!kv) {
    return json(503, { error: 'Armazenamento não configurado (falta binding REPORTS_KV).' });
  }

  const url = new URL(context.request.url);
  const params = Object.fromEntries(url.searchParams.entries());

  if (context.request.method === 'GET') {
    try {
      if (params.stats === '1') {
        const stats = await getStats(kv, {
          issueType: params.issueType,
          ageBand: params.ageBand,
          category: params.category,
          reporterId: params.reporterId,
          deviceType: params.deviceType,
          status: params.status,
        });
        return json(200, { ok: true, stats });
      }
      const data = await listReports(kv, params);
      return json(200, { ok: true, ...data });
    } catch (err) {
      console.error('[reports-admin] list failed:', err);
      return json(503, { error: 'Não foi possível listar reportes.' });
    }
  }

  if (context.request.method === 'PATCH') {
    let body = {};
    try {
      body = await context.request.json();
    } catch {
      return json(400, { error: 'Corpo JSON inválido.' });
    }
    if (!body.status || !isValidReportStatus(body.status)) {
      return json(400, { error: 'Estado inválido (open, resolved ou cancelled).' });
    }
    const singleId = params.reportId;
    const reportIds = Array.isArray(body.reportIds) && body.reportIds.length
      ? body.reportIds
      : (singleId ? [singleId] : []);
    if (!reportIds.length) {
      return json(400, { error: 'Falta reportId ou reportIds.' });
    }
    try {
      if (reportIds.length === 1) {
        const report = await updateReportStatus(kv, reportIds[0], body.status);
        if (!report) return json(404, { error: 'Reporte não encontrado.' });
        return json(200, { ok: true, report, updated: [reportIds[0]], failed: [] });
      }
      const result = await updateManyReportStatuses(kv, reportIds, body.status);
      return json(200, { ok: true, ...result });
    } catch (err) {
      console.error('[reports-admin] patch failed:', err);
      return json(503, { error: 'Não foi possível atualizar o reporte.' });
    }
  }

  if (context.request.method === 'DELETE') {
    let body = {};
    try {
      body = await context.request.json();
    } catch {
      body = {};
    }
    const singleId = params.reportId;
    const reportIds = Array.isArray(body.reportIds) && body.reportIds.length
      ? body.reportIds
      : (singleId ? [singleId] : []);
    if (!reportIds.length) return json(400, { error: 'Falta reportId ou reportIds.' });
    try {
      if (reportIds.length === 1) {
        const result = await deleteReport(kv, reportIds[0]);
        if (result.error === 'not_found') return json(404, { error: 'Reporte não encontrado.' });
        if (result.error === 'not_cancelled') {
          return json(400, { error: 'Só reportes cancelados podem ser apagados.' });
        }
        return json(200, { ok: true, deleted: [reportIds[0]], failed: [], skipped: [] });
      }
      const result = await deleteManyReports(kv, reportIds);
      return json(200, { ok: true, ...result });
    } catch (err) {
      console.error('[reports-admin] delete failed:', err);
      return json(503, { error: 'Não foi possível apagar o reporte.' });
    }
  }

  return json(405, { error: 'Método não permitido' });
}
