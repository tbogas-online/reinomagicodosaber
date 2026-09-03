const { connectLambda, getStore } = require('@netlify/blobs');
const { formatPortugalDateTime } = require('./report-utils');
const supabaseStore = require('./reports-store-supabase');
const { aggregateDiagnosisStats } = require('./report-diagnosis');

const STORE_NAME = 'question-reports';
const INDEX_KEY = 'reports-index';
const MAX_REPORTS = 2000;
const SITE_CATEGORY_NAME = 'Site/app';
const ATTACHMENT_PREFIX = 'attachment:';
const MAX_ATTACHMENT_BYTES = 1.5 * 1024 * 1024;
const ALLOWED_ATTACHMENT_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

const {
  categoryNameFromN,
  normalizeCategoryNs,
  normalizeAgeBands,
  normalizeReportCategoryNs,
  normalizeReportAgeBands,
  arraysEqual,
} = require('./question-taxonomy');

function isSiteIssueType(issueType) {
  return String(issueType || '').startsWith('site_');
}

function hashQuestionKey(text) {
  const s = String(text || '');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function parseGameQuestionId(value) {
  const m = String(value || '').trim().match(/^rmq-(\d{1,2})-(.+)-([a-z0-9]{4,12})$/i);
  if (!m) return null;
  const categoryN = Number(m[1]);
  const hash = String(m[3] || '').trim();
  if (!categoryN || categoryN < 1 || categoryN > 20 || !hash) return null;
  return { categoryN, ageBand: String(m[2] || '').trim(), hash };
}

function questionHashFromReport(report) {
  const fromId = parseGameQuestionId(report?.questionId);
  if (fromId?.hash) return fromId.hash;
  const q = String(report?.question || '').trim();
  const a = String(report?.correctAnswer || '').trim();
  if (q && a) return hashQuestionKey(`${q}|${a}`);
  const qid = String(report?.questionId || '').trim();
  if (/^[a-z0-9]{4,12}$/i.test(qid)) return qid;
  return '';
}

function applyCorrectionToReport(report, correction) {
  if (!report || !correction || typeof correction !== 'object') return false;
  const strip = (value) => String(value || '').trim();
  let changed = false;

  const nextQuestion = strip(correction.question);
  const nextAnswer = strip(correction.answer);
  const currentQuestion = strip(report.question);
  const currentAnswer = strip(report.correctAnswer);

  if (nextQuestion && nextQuestion !== currentQuestion) {
    if (!report.originalQuestion) report.originalQuestion = currentQuestion;
    report.question = nextQuestion;
    changed = true;
  }
  if (nextAnswer && nextAnswer !== currentAnswer) {
    if (!report.originalCorrectAnswer) report.originalCorrectAnswer = currentAnswer;
    report.correctAnswer = nextAnswer;
    changed = true;
  }

  if (Array.isArray(correction.options) && correction.options.length >= 2) {
    const nextOptions = correction.options.map(strip).filter(Boolean);
    const normOpts = (arr) => (arr || []).map(strip).join('\n');
    if (normOpts(nextOptions) !== normOpts(report.options)) {
      if (!report.originalOptions) report.originalOptions = Array.isArray(report.options) ? [...report.options] : [];
      report.options = nextOptions;
      changed = true;
    }
  }

  const nextFormat = strip(correction.format);
  if (nextFormat && nextFormat !== strip(report.format)) {
    if (!report.originalFormat) report.originalFormat = report.format || null;
    report.format = nextFormat;
    changed = true;
  } else if (Array.isArray(correction.options) && correction.options.length >= 2
    && strip(report.format) !== 'ESCOLHA_MULTIPLA') {
    if (!report.originalFormat) report.originalFormat = report.format || null;
    report.format = 'ESCOLHA_MULTIPLA';
    changed = true;
  }

  if (changed) {
    report.correctedAt = new Date().toISOString();
    report.questionHash = questionHashFromReport(report);
  }
  return changed;
}

function applyTaxonomyToReport(report, taxonomy = {}) {
  if (!report) return false;
  const categoryNs = normalizeCategoryNs(
    taxonomy.categoryNs,
    taxonomy.categoryN,
    { category_ns: report.categoryNs, category_n: report.category?.n },
  );
  const ageBands = normalizeAgeBands(
    taxonomy.ageBands,
    taxonomy.ageBand,
    { age_bands: report.ageBands, age_band: report.ageBand },
  );
  if (!categoryNs.length || !ageBands.length) return false;

  const prevCats = normalizeReportCategoryNs(report);
  const prevAges = normalizeReportAgeBands(report);
  if (arraysEqual(prevCats, categoryNs) && arraysEqual(prevAges, ageBands)) return false;

  if (!report.originalCategoryNs && prevCats.length) report.originalCategoryNs = [...prevCats];
  if (!report.originalAgeBands && prevAges.length) report.originalAgeBands = [...prevAges];
  if (!report.originalCategory && report.category?.n != null) {
    report.originalCategory = { ...report.category };
  }
  if (!report.originalAgeBand && report.ageBand) report.originalAgeBand = report.ageBand;

  report.categoryNs = categoryNs;
  report.categories = categoryNs.map((n) => ({
    n,
    name: categoryNameFromN(n),
    desc: report.category?.desc || '',
  }));
  report.category = report.categories[0];
  report.ageBands = ageBands;
  report.ageBand = ageBands[0];

  const parsed = parseGameQuestionId(report.questionId);
  if (parsed?.hash) {
    report.questionId = `rmq-${categoryNs[0]}-${ageBands[0]}-${parsed.hash}`;
  }

  report.taxonomyUpdatedAt = new Date().toISOString();
  return true;
}

function applyCategoryToReport(report, categoryN) {
  const ageBands = normalizeReportAgeBands(report);
  return applyTaxonomyToReport(report, {
    categoryNs: [Number(categoryN)],
    ageBands: ageBands.length ? ageBands : ['10-15'],
  });
}

async function getReportById(reportId, event) {
  if (useSupabase()) {
    await maybeMigrateFromBlobs(event);
    return supabaseStore.getReport(reportId, storeHelpers);
  }
  const store = getReportsStore(event);
  try {
    return await store.get(`report:${reportId}`, { type: 'json' });
  } catch {
    return null;
  }
}

async function updateReportTaxonomy(reportId, taxonomy, event, options = {}) {
  const report = await getReportById(reportId, event);
  if (!report) {
    const err = new Error('Reporte não encontrado.');
    err.code = 'NOT_FOUND';
    throw err;
  }
  if (isSiteIssueType(report.issueType) || report.source === 'site') {
    const err = new Error('Reportes de site não têm categoria de pergunta.');
    err.code = 'INVALID_REPORT';
    throw err;
  }

  const categoryNs = normalizeCategoryNs(
    taxonomy?.categoryNs,
    taxonomy?.categoryN,
    { category_ns: report.categoryNs, category_n: report.category?.n },
  );
  const ageBands = normalizeAgeBands(
    taxonomy?.ageBands,
    taxonomy?.ageBand,
    { age_bands: report.ageBands, age_band: report.ageBand },
  );
  if (!categoryNs.length) {
    const err = new Error('Indica pelo menos uma categoria (1–20).');
    err.code = 'INVALID_CATEGORY';
    throw err;
  }
  if (!ageBands.length) {
    const err = new Error('Indica pelo menos uma faixa etária.');
    err.code = 'INVALID_AGE_BAND';
    throw err;
  }

  const previousCategoryNs = normalizeReportCategoryNs(report);
  const previousAgeBands = normalizeReportAgeBands(report);
  const changed = applyTaxonomyToReport(report, { categoryNs, ageBands });
  if (!changed) {
    return {
      ok: true,
      action: 'unchanged',
      report,
      categoryNs,
      ageBands,
      previousCategoryNs,
      previousAgeBands,
      bank: null,
    };
  }

  await saveReport(report, event);

  let bank = null;
  if (options.updateBank !== false) {
    const hash = questionHashFromReport(report);
    if (hash) {
      try {
        const { updateQuestionBankTaxonomy } = require('./question-bank-store');
        bank = await updateQuestionBankTaxonomy(hash, { categoryNs, ageBands });
      } catch (err) {
        bank = { ok: false, error: err.message || String(err), code: err.code || null };
      }
    }
  }

  return {
    ok: true,
    action: 'updated',
    report,
    categoryNs,
    ageBands,
    previousCategoryNs,
    previousAgeBands,
    bank,
  };
}

async function updateReportCategory(reportId, categoryN, event, options = {}) {
  const report = await getReportById(reportId, event);
  const ageBands = normalizeReportAgeBands(report || {});
  return updateReportTaxonomy(reportId, {
    categoryNs: [Number(categoryN)],
    ageBands: ageBands.length ? ageBands : ['10-15'],
  }, event, options);
}

/**
 * Hashes de perguntas com reportes activos (não cancelados), por estado.
 */
async function getQuestionHashesByReportStatus(event) {
  if (useSupabase()) {
    await maybeMigrateFromBlobs(event);
    return supabaseStore.getQuestionHashesByReportStatus(storeHelpers);
  }
  const store = getReportsStore(event);
  const index = await readIndex(store);
  const open = new Set();
  const resolved = new Set();
  const any = new Set();

  for (const item of index.items || []) {
    const status = normalizeReportStatus(item.status);
    if (status === 'cancelled' || isSiteIssueType(item.issueType)) continue;

    let report;
    try {
      report = await store.get(`report:${item.reportId}`, { type: 'json' });
    } catch {
      continue;
    }
    if (!report?.question) continue;

    const hash = questionHashFromReport(report);
    if (!hash) continue;

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

function resolveReportCategoryName(report) {
  if (isSiteIssueType(report?.issueType)) return SITE_CATEGORY_NAME;
  return String(report?.category?.name || '').trim();
}

function resolveIndexCategoryName(item) {
  if (isSiteIssueType(item?.issueType)) return SITE_CATEGORY_NAME;
  return String(item?.categoryName || '').trim();
}

const VALID_STATUSES = new Set(['open', 'resolved', 'cancelled']);
let blobMigrationAttempted = false;

const storeHelpers = {
  VALID_STATUSES,
  normalizeReportStatus,
  resolveReportCategoryName,
  questionHashFromReport,
  applyCorrectionToReport,
  isValidDateFilter,
  reportMatchesSearch,
  computeStatsFromIndex,
  isSiteIssueType,
  aggregateDiagnosisStats,
};

function useSupabase() {
  return supabaseStore.isConfigured();
}

async function maybeMigrateFromBlobs(event) {
  if (blobMigrationAttempted || !useSupabase()) return;
  blobMigrationAttempted = true;
  try {
    const existing = await supabaseStore.getRowCount();
    if (existing > 0) return;
    const store = getReportsStore(event);
    const index = await readIndex(store);
    if (!index.items?.length) return;
    const reports = [];
    for (const item of index.items) {
      try {
        const report = await store.get(`report:${item.reportId}`, { type: 'json' });
        if (report) reports.push(report);
      } catch {
        /* ignore */
      }
    }
    if (!reports.length) return;
    await supabaseStore.upsertManyReports(reports, storeHelpers);
    console.log(`[reports-store] migrated ${reports.length} reportes de Blobs para Supabase`);
  } catch (err) {
    console.warn('[reports-store] blob migration failed:', err.message || err);
  }
}

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
  if (useSupabase()) {
    await maybeMigrateFromBlobs(event);
    return supabaseStore.saveReport(report, storeHelpers);
  }
  const store = getReportsStore(event);
  await store.setJSON(`report:${report.reportId}`, report);

  const index = await readIndex(store);
  const indexEntry = {
    reportId: report.reportId,
    receivedAt: report.receivedAt,
    issueType: report.issueType,
    ageBand: report.ageBand,
    categoryName: resolveReportCategoryName(report),
    reporterId: report.reporterId || '',
    deviceType: report.device?.type || '',
    status: normalizeReportStatus(report.status),
  };
  const existingIdx = index.items.findIndex((entry) => entry.reportId === report.reportId);
  if (existingIdx >= 0) {
    index.items[existingIdx] = { ...index.items[existingIdx], ...indexEntry };
  } else {
    index.items.unshift(indexEntry);
  }

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

function isValidDateFilter(value) {
  if (!value || typeof value !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function reportDayKey(item) {
  return item?.receivedAt ? item.receivedAt.slice(0, 10) : null;
}

function resolveCustomDateRange(dateFrom, dateTo, byDay = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const sortedDays = Object.keys(byDay).sort();
  const earliest = sortedDays[0] || today;
  let from = dateFrom || earliest;
  let to = dateTo || today;
  if (from > to) {
    const swap = from;
    from = to;
    to = swap;
  }
  return { from, to };
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
  if (filters.dateFrom && isValidDateFilter(filters.dateFrom)) {
    filtered = filtered.filter((i) => {
      const day = reportDayKey(i);
      return day && day >= filters.dateFrom;
    });
  }
  if (filters.dateTo && isValidDateFilter(filters.dateTo)) {
    filtered = filtered.filter((i) => {
      const day = reportDayKey(i);
      return day && day <= filters.dateTo;
    });
  }
  if (filters.q) {
    const needle = String(filters.q).toLowerCase();
    filtered = filtered.filter((i) => i.reportId.toLowerCase().includes(needle));
  }
  return filtered;
}

function reportMatchesSearch(report, needle) {
  if (!needle) return true;
  const haystack = [
    report?.reportId,
    report?.question,
    report?.comment,
    report?.suggestion,
    report?.correctAnswer,
    report?.selectedAnswer,
    report?.issueLabel,
    report?.issueType,
    report?.category?.name,
    report?.categoryName,
  ].filter(Boolean).join(' ').toLowerCase();
  return haystack.includes(needle);
}

async function listReports(filters = {}, event) {
  if (useSupabase()) {
    await maybeMigrateFromBlobs(event);
    return supabaseStore.listReports(filters, storeHelpers);
  }
  const store = getReportsStore(event);
  const index = await readIndex(store);
  const limit = Math.min(Math.max(Number(filters.limit) || 50, 1), 200);
  const offset = Math.max(Number(filters.offset) || 0, 0);
  const searchNeedle = filters.q ? String(filters.q).toLowerCase().trim() : '';
  const filtered = filterIndexItems(index.items, searchNeedle ? { ...filters, q: '' } : filters);

  if (searchNeedle) {
    const reports = (await Promise.all(
      filtered.map((item) => store.get(`report:${item.reportId}`, { type: 'json' })),
    )).filter(Boolean);
    const matched = reports.filter((report) => reportMatchesSearch(report, searchNeedle));
    return {
      total: matched.length,
      offset,
      limit,
      reports: matched.slice(offset, offset + limit),
      uniqueReporters: new Set(matched.map((r) => r.reporterId).filter(Boolean)).size,
    };
  }

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

function buildDailySeriesBetween(byDay, dateFrom, dateTo) {
  const daily = [];
  const start = new Date(`${dateFrom}T00:00:00.000Z`);
  const end = new Date(`${dateTo}T00:00:00.000Z`);
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const key = d.toISOString().slice(0, 10);
    daily.push({ key, count: byDay[key] || 0 });
  }
  return daily;
}

function buildStackedDailySeriesBetween(byDayByIssue, dateFrom, dateTo) {
  const daily = [];
  const start = new Date(`${dateFrom}T00:00:00.000Z`);
  const end = new Date(`${dateTo}T00:00:00.000Z`);
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
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

  const hasDateFilter = isValidDateFilter(filters.dateFrom) || isValidDateFilter(filters.dateTo);
  let dateRange = null;
  if (hasDateFilter) {
    const range = resolveCustomDateRange(
      isValidDateFilter(filters.dateFrom) ? filters.dateFrom : null,
      isValidDateFilter(filters.dateTo) ? filters.dateTo : null,
      byDay,
    );
    dateRange = range;
    timelineSeries.custom = buildDailySeriesBetween(byDay, range.from, range.to);
    timelineStacked.custom = buildStackedDailySeriesBetween(byDayByIssue, range.from, range.to);
  }

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
    dateRange,
    latestAt: activeItems[0]?.receivedAt || allItems[0]?.receivedAt || null,
  };
}

async function getStats(event, scope = 'all', filters = {}) {
  if (useSupabase()) {
    await maybeMigrateFromBlobs(event);
    return supabaseStore.getStats(scope, filters, storeHelpers);
  }
  const store = getReportsStore(event);
  const index = await readIndex(store);
  return computeStatsFromIndex(index, scope, filters);
}

async function updateReportStatus(reportId, status, event, extras = {}) {
  if (useSupabase()) {
    await maybeMigrateFromBlobs(event);
    return supabaseStore.updateReportStatus(reportId, status, storeHelpers, extras);
  }
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
  if (extras.reviewDecision && typeof extras.reviewDecision === 'object') {
    report.reviewDecision = extras.reviewDecision;
    report.reviewedAt = now;
    report.reviewedAtPortugal = formatPortugalDateTime(now);
    if (extras.reviewDecision.appliedCorrection) {
      helpers.applyCorrectionToReport(report, extras.reviewDecision.appliedCorrection);
    }
  }
  await store.setJSON(`report:${report.reportId}`, report);
  const index = await readIndex(store);
  let updatedAny = false;
  for (const item of index.items) {
    if (item.reportId !== reportId) continue;
    updatedAny = true;
    item.status = nextStatus;
    delete item.resolvedAt;
    delete item.resolvedAtPortugal;
    delete item.cancelledAt;
    if (nextStatus === 'resolved') {
      item.resolvedAt = report.resolvedAt;
      item.resolvedAtPortugal = report.resolvedAtPortugal;
    }
    if (nextStatus === 'cancelled') item.cancelledAt = report.cancelledAt;
  }
  if (updatedAny) await store.setJSON(INDEX_KEY, index);
  return report;
}

async function updateManyReportStatuses(reportIds, status, event, extras = {}) {
  const ids = [...new Set(reportIds)].filter(Boolean).slice(0, 100);
  const updated = [];
  const reports = [];
  const failed = [];
  for (const reportId of ids) {
    const report = await updateReportStatus(reportId, status, event, extras);
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
  if (useSupabase()) {
    await maybeMigrateFromBlobs(event);
    return supabaseStore.getReportStatuses(reportIds, reporterId, storeHelpers);
  }
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
  if (useSupabase()) {
    await maybeMigrateFromBlobs(event);
    const result = await supabaseStore.deleteReport(reportId, storeHelpers);
    if (result.ok) await deleteReportAttachment(reportId, event);
    return result;
  }
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
  updateReportTaxonomy,
  updateReportCategory,
  updateManyReportStatuses,
  getReportStatuses,
  deleteReport,
  deleteManyReports,
  normalizeReportStatus,
  getQuestionHashesByReportStatus,
  hashQuestionKey,
  questionHashFromReport,
  applyCorrectionToReport,
  applyTaxonomyToReport,
  applyCategoryToReport,
  MAX_ATTACHMENT_BYTES,
  isValidReportId,
  isAllowedAttachmentMime,
};
