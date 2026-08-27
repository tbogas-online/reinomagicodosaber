const { connectLambda, getStore } = require('@netlify/blobs');
const { formatPortugalDateTime } = require('./report-utils');

const STORE_NAME = 'question-reports';
const INDEX_KEY = 'reports-index';
const MAX_REPORTS = 2000;
const SITE_CATEGORY_NAME = 'Site/app';
const ATTACHMENT_PREFIX = 'attachment:';
const MAX_ATTACHMENT_BYTES = 1.5 * 1024 * 1024;
const ALLOWED_ATTACHMENT_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

function isSiteIssueType(issueType) {
  return String(issueType || '').startsWith('site_');
}

function resolveReportCategoryName(report) {
  if (isSiteIssueType(report?.issueType)) return SITE_CATEGORY_NAME;
  return String(report?.category?.name || '').trim();
}

function resolveIndexCategoryName(item) {
  if (isSiteIssueType(item?.issueType)) return SITE_CATEGORY_NAME;
  return String(item?.categoryName || '').trim();
}

const VALID_STATUSES = new Set(['open', 'resolved', 'cancelled']);

function normalizeReportStatus(status) {
  if (status === 'resolved') return 'resolved';
  if (status === 'cancelled' || status === 'deleted') return 'cancelled';
  return 'open';
}

function isValidReportStatus(status) {
  return VALID_STATUSES.has(normalizeReportStatus(status));
}

function getReportsStore(event) {
  connectLambda(event);
  return getStore(STORE_NAME);
}

function attachmentKey(reportId) {
  return `${ATTACHMENT_PREFIX}${reportId}`;
}

function isValidReportId(reportId) {
  return /^rpt-[a-z0-9-]+$/i.test(String(reportId || '').trim());
}

function isAllowedAttachmentMime(mimeType) {
  return ALLOWED_ATTACHMENT_MIME.has(String(mimeType || '').toLowerCase());
}

async function saveReportAttachment(reportId, data, mimeType, filename, event) {
  if (!isValidReportId(reportId)) {
    throw new Error('invalid_report_id');
  }
  const normalizedMime = String(mimeType || '').toLowerCase();
  if (!isAllowedAttachmentMime(normalizedMime)) {
    throw new Error('invalid_mime');
  }
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (!buffer.length || buffer.length > MAX_ATTACHMENT_BYTES) {
    throw new Error('invalid_size');
  }
  const store = getReportsStore(event);
  await store.set(attachmentKey(reportId), buffer, {
    metadata: {
      contentType: normalizedMime,
      filename: String(filename || 'imagem').slice(0, 120),
      size: String(buffer.length),
    },
  });
  return {
    reportId,
    mimeType: normalizedMime,
    filename: String(filename || 'imagem').slice(0, 120),
    size: buffer.length,
  };
}

async function getReportAttachment(reportId, event) {
  if (!isValidReportId(reportId)) return null;
  const store = getReportsStore(event);
  const blob = await store.get(attachmentKey(reportId), { type: 'blob' });
  if (!blob) return null;
  const metadata = await store.getMetadata(attachmentKey(reportId));
  const buffer = Buffer.from(await blob.arrayBuffer());
  return {
    data: buffer,
    mimeType: metadata?.metadata?.contentType || blob.type || 'application/octet-stream',
    filename: metadata?.metadata?.filename || 'imagem',
    size: buffer.length,
  };
}

async function deleteReportAttachment(reportId, event) {
  if (!isValidReportId(reportId)) return;
  const store = getReportsStore(event);
  await store.delete(attachmentKey(reportId));
}

async function readIndex(store) {
  try {
    const index = await store.get(INDEX_KEY, { type: 'json' });
    return index && Array.isArray(index.items) ? index : { items: [], total: 0 };
  } catch (err) {
    console.error('[reports-store] readIndex failed:', err);
    return { items: [], total: 0 };
  }
}

async function saveReport(report, event) {
  const store = getReportsStore(event);
  await store.setJSON(`report:${report.reportId}`, report);

  const index = await readIndex(store);
  index.items.unshift({
    reportId: report.reportId,
    receivedAt: report.receivedAt,
    issueType: report.issueType,
    ageBand: report.ageBand,
    categoryName: resolveReportCategoryName(report),
    reporterId: report.reporterId || '',
    deviceType: report.device?.type || '',
    status: normalizeReportStatus(report.status),
  });

  if (index.items.length > MAX_REPORTS) {
    const removed = index.items.splice(MAX_REPORTS);
    for (const item of removed) {
      await store.delete(`report:${item.reportId}`);
      await deleteReportAttachment(item.reportId, event);
    }
  }

  index.total = index.items.length;
  await store.setJSON(INDEX_KEY, index);
  return report;
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

async function listReports(filters = {}, event) {
  const store = getReportsStore(event);
  const index = await readIndex(store);
  const limit = Math.min(Math.max(Number(filters.limit) || 50, 1), 200);
  const offset = Math.max(Number(filters.offset) || 0, 0);
  const filtered = filterIndexItems(index.items, filters);
  const slice = filtered.slice(offset, offset + limit);
  const reports = await Promise.all(
    slice.map((item) => store.get(`report:${item.reportId}`, { type: 'json' })),
  );

  return {
    total: filtered.length,
    offset,
    limit,
    reports: reports.filter(Boolean),
    uniqueReporters: new Set(filtered.map((i) => i.reporterId).filter(Boolean)).size,
  };
}

function buildDailySeries(byDay, days = 14) {
  const daily = [];
  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(end.getTime() - i * 86400000);
    const key = d.toISOString().slice(0, 10);
    daily.push({ key, count: byDay[key] || 0 });
  }
  return daily;
}

function sumByIssue(byIssue) {
  return Object.values(byIssue || {}).reduce((sum, value) => sum + value, 0);
}

function buildStackedDailySeries(byDayByIssue, days = 14) {
  const daily = [];
  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(end.getTime() - i * 86400000);
    const key = d.toISOString().slice(0, 10);
    const byIssue = byDayByIssue[key] || {};
    daily.push({ key, byIssue, count: sumByIssue(byIssue) });
  }
  return daily;
}

function buildStackedHourlySeries(byHourByIssue, hours = 24) {
  const series = [];
  const now = new Date();
  const end = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    now.getUTCHours(),
    0,
    0,
    0,
  ));
  for (let i = hours - 1; i >= 0; i -= 1) {
    const d = new Date(end.getTime() - i * 3600000);
    const key = d.toISOString().slice(0, 13);
    const byIssue = byHourByIssue[key] || {};
    series.push({ key, byIssue, count: sumByIssue(byIssue) });
  }
  return series;
}

function buildHourlySeries(byHour, hours = 24) {
  const series = [];
  const now = new Date();
  const end = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    now.getUTCHours(),
    0,
    0,
    0,
  ));
  for (let i = hours - 1; i >= 0; i -= 1) {
    const d = new Date(end.getTime() - i * 3600000);
    const key = d.toISOString().slice(0, 13);
    series.push({ key, count: byHour[key] || 0 });
  }
  return series;
}

function computeStatsFromIndex(index, scope = 'all', filters = {}) {
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

  let chartItems = activeItems;
  if (scope === 'open') chartItems = activeItems.filter((i) => normalizeReportStatus(i.status) === 'open');
  if (scope === 'resolved') chartItems = activeItems.filter((i) => normalizeReportStatus(i.status) === 'resolved');
  if (scope === 'cancelled') chartItems = [];

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
      const day = item.receivedAt.slice(0, 10);
      const hour = item.receivedAt.slice(0, 13);
      if (!byDayByIssue[day]) byDayByIssue[day] = {};
      if (!byHourByIssue[hour]) byHourByIssue[hour] = {};
      byDayByIssue[day][item.issueType] = (byDayByIssue[day][item.issueType] || 0) + 1;
      byHourByIssue[hour][item.issueType] = (byHourByIssue[hour][item.issueType] || 0) + 1;
    }
  }

  for (const item of chartItems) {
    byIssue[item.issueType] = (byIssue[item.issueType] || 0) + 1;
    const age = item.ageBand || '—';
    byAge[age] = (byAge[age] || 0) + 1;
    const device = item.deviceType || '—';
    byDevice[device] = (byDevice[device] || 0) + 1;
    const category = resolveIndexCategoryName(item);
    if (category) byCategory[category] = (byCategory[category] || 0) + 1;
    if (item.receivedAt) {
      const day = item.receivedAt.slice(0, 10);
      byDay[day] = (byDay[day] || 0) + 1;
      const hour = item.receivedAt.slice(0, 13);
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
    '7d': buildStackedDailySeries(byDayByIssue, 7),
    '14d': buildStackedDailySeries(byDayByIssue, 14),
  };

  return {
    total: filteredAll.length,
    activeTotal: activeItems.length,
    openCount,
    resolvedCount,
    cancelledCount,
    scopedTotal: chartItems.length,
    scope,
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

async function getStats(event, scope = 'all', filters = {}) {
  const store = getReportsStore(event);
  const index = await readIndex(store);
  return computeStatsFromIndex(index, scope, filters);
}

async function updateReportStatus(reportId, status, event) {
  const nextStatus = normalizeReportStatus(status);
  if (!VALID_STATUSES.has(nextStatus)) return null;
  const store = getReportsStore(event);
  const report = await store.get(`report:${reportId}`, { type: 'json' });
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
  await store.setJSON(`report:${report.reportId}`, report);
  const index = await readIndex(store);
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
    await store.setJSON(INDEX_KEY, index);
  }
  return report;
}

async function updateManyReportStatuses(reportIds, status, event) {
  const ids = [...new Set(reportIds)].filter(Boolean).slice(0, 100);
  const updated = [];
  const reports = [];
  const failed = [];
  for (const reportId of ids) {
    const report = await updateReportStatus(reportId, status, event);
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

async function getReportStatuses(reportIds, reporterId, event) {
  const store = getReportsStore(event);
  const statuses = {};
  const ids = [...new Set(reportIds)].filter(Boolean).slice(0, 50);
  await Promise.all(ids.map(async (reportId) => {
    const report = await store.get(`report:${reportId}`, { type: 'json' });
    if (!report) return;
    if (reporterId && report.reporterId && report.reporterId !== reporterId) return;
    statuses[reportId] = {
      status: normalizeReportStatus(report.status),
      resolvedAt: report.resolvedAt || null,
      cancelledAt: report.cancelledAt || null,
    };
  }));
  return statuses;
}

async function deleteReport(reportId, event) {
  const store = getReportsStore(event);
  const report = await store.get(`report:${reportId}`, { type: 'json' });
  if (!report) return { ok: false, error: 'not_found', reportId };
  if (normalizeReportStatus(report.status) !== 'cancelled') {
    return { ok: false, error: 'not_cancelled', reportId };
  }
  await store.delete(`report:${reportId}`);
  await deleteReportAttachment(reportId, event);
  const index = await readIndex(store);
  index.items = index.items.filter((item) => item.reportId !== reportId);
  index.total = index.items.length;
  await store.setJSON(INDEX_KEY, index);
  return { ok: true, reportId };
}

async function deleteManyReports(reportIds, event) {
  const ids = [...new Set(reportIds)].filter(Boolean).slice(0, 100);
  const deleted = [];
  const failed = [];
  const skipped = [];
  for (const reportId of ids) {
    const result = await deleteReport(reportId, event);
    if (result.ok) deleted.push(reportId);
    else if (result.error === 'not_cancelled') skipped.push(reportId);
    else failed.push(reportId);
  }
  return { deleted, failed, skipped };
}

module.exports = {
  saveReport,
  saveReportAttachment,
  getReportAttachment,
  deleteReportAttachment,
  listReports,
  getStats,
  updateReportStatus,
  updateManyReportStatuses,
  getReportStatuses,
  deleteReport,
  deleteManyReports,
  normalizeReportStatus,
  MAX_ATTACHMENT_BYTES,
  isValidReportId,
  isAllowedAttachmentMime,
};
