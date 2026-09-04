const { getQuarantineStats } = require('./quarantine-store');
const { getSupabaseAdmin } = require('./rooms-store');

const LISBON_TZ = 'Europe/Lisbon';

const AI_SOURCES = new Set(['ai', 'test-page']);

const MANUAL_VALIDATION_SOURCES = new Set([
  'corrected',
  'pending-review',
  'telemetry-accepted',
  'report_fields',
  'report-corrected',
  'manual',
]);

function isManualValidationSource(source) {
  return MANUAL_VALIDATION_SOURCES.has(String(source || '').trim().toLowerCase());
}

function hashQuestionKey(text) {
  const s = String(text || '');
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/** ID de jogo: rmq-{categoria}-{faixa}-{hash} — ex. rmq-15-15+-7yhneo */
function parseGameQuestionId(value) {
  const raw = String(value || '').trim();
  const m = raw.match(/^rmq-(\d{1,2})-(.+)-([a-z0-9]{4,12})$/i);
  if (!m) return null;
  const categoryN = Number(m[1]);
  const ageBand = String(m[2] || '').trim();
  const hash = String(m[3] || '').trim();
  if (!categoryN || categoryN < 1 || categoryN > 20 || !hash) return null;
  return { categoryN, ageBand, hash, questionId: raw };
}

function resolveBankSearchKeys({ query = '', hash = '' } = {}) {
  let queryTrim = String(query || '').trim();
  let hashTrim = String(hash || '').trim();
  let categoryN = null;
  let ageBand = '';

  const fromQuery = parseGameQuestionId(queryTrim);
  if (fromQuery) {
    hashTrim = fromQuery.hash;
    queryTrim = '';
    categoryN = fromQuery.categoryN;
    ageBand = fromQuery.ageBand;
  } else if (!hashTrim) {
    const fromHash = parseGameQuestionId(hashTrim);
    if (fromHash) {
      hashTrim = fromHash.hash;
      categoryN = fromHash.categoryN;
      ageBand = fromHash.ageBand;
    }
  }

  return { queryTrim, hashTrim, categoryN, ageBand };
}

const TIMELINE_RANGE_CONFIG = {
  '1h': { lookbackMs: 60 * 60 * 1000, bucketMinutes: 5 },
  '3h': { lookbackMs: 3 * 60 * 60 * 1000, bucketMinutes: 15 },
  '6h': { lookbackMs: 6 * 60 * 60 * 1000, bucketMinutes: 30 },
  '12h': { lookbackMs: 12 * 60 * 60 * 1000, bucketMinutes: 60 },
  '24h': { lookbackMs: 24 * 60 * 60 * 1000, bucketHours: 1 },
  '3d': { lookbackMs: 3 * 24 * 60 * 60 * 1000, bucketHours: 1 },
  '7d': { lookbackMs: 7 * 24 * 60 * 60 * 1000, bucketDays: 1 },
  total: { all: true, bucketDays: 1, maxDays: 120 },
};

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
  if (!options.headers?.Prefer && options.method !== 'GET') {
    headers.Prefer = 'return=minimal';
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

const BANK_SELECT_CORE = 'id,question_hash,question,correct_answer,options,format,category_n,age_band,source,is_reported,created_at';
const BANK_SELECT_BASE = `${BANK_SELECT_CORE},difficulty,difficulty_by_age_band`;
const BANK_SELECT_FULL = `${BANK_SELECT_BASE},category_ns,age_bands,knowledge_id`;

let bankTaxonomyColumnsAvailable = null;
let bankDifficultyColumnAvailable = null;
let bankDifficultyByAgeColumnAvailable = null;

async function queryBankRows(buildParams) {
  const buildSelect = (useTaxonomy, useDifficulty, useDifficultyByAge) => {
    let select = BANK_SELECT_CORE;
    if (useDifficulty) select += ',difficulty';
    if (useDifficultyByAge) select += ',difficulty_by_age_band';
    if (useTaxonomy) select += ',category_ns,age_bands,knowledge_id';
    return select;
  };

  const run = async (useTaxonomy, useDifficulty, useDifficultyByAge) => {
    const params = new URLSearchParams();
    buildParams(params, buildSelect(useTaxonomy, useDifficulty, useDifficultyByAge), useTaxonomy);
    return supabaseRequest(`/question_bank?${params.toString()}`);
  };

  const tryQuery = async () => {
    if (bankTaxonomyColumnsAvailable !== false) {
      try {
        const rows = await run(
          true,
          bankDifficultyColumnAvailable !== false,
          bankDifficultyByAgeColumnAvailable !== false,
        );
        bankTaxonomyColumnsAvailable = true;
        if (bankDifficultyColumnAvailable !== false) bankDifficultyColumnAvailable = true;
        if (bankDifficultyByAgeColumnAvailable !== false) bankDifficultyByAgeColumnAvailable = true;
        return { rows: Array.isArray(rows) ? rows : [], taxonomyColumns: true };
      } catch (err) {
        const msg = String(err?.message || err);
        if (bankDifficultyByAgeColumnAvailable !== false
          && (msg.includes('difficulty_by_age_band') || msg.includes('42703'))) {
          bankDifficultyByAgeColumnAvailable = false;
          return tryQuery();
        }
        if (bankDifficultyColumnAvailable !== false
          && (msg.includes('difficulty') || msg.includes('42703'))) {
          bankDifficultyColumnAvailable = false;
          return tryQuery();
        }
        if (msg.includes('category_ns') || msg.includes('age_bands') || msg.includes('42703')) {
          bankTaxonomyColumnsAvailable = false;
        } else {
          throw err;
        }
      }
    }

    try {
      const rows = await run(
        false,
        bankDifficultyColumnAvailable !== false,
        bankDifficultyByAgeColumnAvailable !== false,
      );
      if (bankDifficultyColumnAvailable !== false) bankDifficultyColumnAvailable = true;
      if (bankDifficultyByAgeColumnAvailable !== false) bankDifficultyByAgeColumnAvailable = true;
      return { rows: Array.isArray(rows) ? rows : [], taxonomyColumns: false };
    } catch (err) {
      const msg = String(err?.message || err);
      if (bankDifficultyByAgeColumnAvailable !== false
        && (msg.includes('difficulty_by_age_band') || msg.includes('42703'))) {
        bankDifficultyByAgeColumnAvailable = false;
        return tryQuery();
      }
      if (bankDifficultyColumnAvailable !== false
        && (msg.includes('difficulty') || msg.includes('42703'))) {
        bankDifficultyColumnAvailable = false;
        return tryQuery();
      }
      throw err;
    }
  };

  return tryQuery();
}

function applyBankCategoryParam(params, categoryN, taxonomyColumns) {
  const cat = Number(categoryN);
  if (!cat || cat < 1 || cat > 20) return;
  if (taxonomyColumns) {
    params.set('or', `(category_ns.cs.{${cat}},category_n.eq.${cat})`);
  } else {
    params.set('category_n', `eq.${cat}`);
  }
}

function toLisbonDayKey(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('sv-SE', { timeZone: LISBON_TZ });
}

function toLisbonHourKey(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: LISBON_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}T${map.hour}`;
}

function toLisbonBucketKey(date, bucketMinutes) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: LISBON_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  let minute = Number(map.minute) || 0;
  if (bucketMinutes > 1) {
    minute = Math.floor(minute / bucketMinutes) * bucketMinutes;
  }
  return `${map.year}-${map.month}-${map.day}T${map.hour}:${String(minute).padStart(2, '0')}`;
}

function floorToBucket(date, bucketMinutes) {
  const d = new Date(date);
  if (bucketMinutes >= 60) {
    d.setMinutes(0, 0, 0);
    return d;
  }
  const m = d.getMinutes();
  d.setMinutes(Math.floor(m / bucketMinutes) * bucketMinutes, 0, 0);
  return d;
}

function floorToHour(date) {
  const d = new Date(date);
  d.setMinutes(0, 0, 0);
  return d;
}

function floorToDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function isAiSource(source) {
  return AI_SOURCES.has(String(source || 'ai').toLowerCase());
}

function splitRows(rows) {
  const saved = rows || [];
  const ai = saved.filter((row) => isAiSource(row.source));
  const manual = saved.filter((row) => isManualValidationSource(row.source));
  return { saved, ai, manual };
}

function buildMinuteSeries(rows, dateField, lookbackMs, bucketMinutes) {
  const now = new Date();
  const end = floorToBucket(now, bucketMinutes);
  const start = new Date(end.getTime() - lookbackMs + bucketMinutes * 60 * 1000);
  const counts = new Map();
  for (let t = floorToBucket(start, bucketMinutes).getTime(); t <= end.getTime(); t += bucketMinutes * 60 * 1000) {
    const key = toLisbonBucketKey(new Date(t), bucketMinutes);
    if (key) counts.set(key, 0);
  }
  (rows || []).forEach((row) => {
    const key = toLisbonBucketKey(row[dateField], bucketMinutes);
    if (key && counts.has(key)) counts.set(key, (counts.get(key) || 0) + 1);
  });
  return [...counts.entries()].map(([t, v]) => ({ t, v }));
}

function buildHourSeries(rows, dateField, lookbackMs) {
  const now = new Date();
  const end = floorToHour(now);
  const hours = Math.max(1, Math.ceil(lookbackMs / (60 * 60 * 1000)));
  const start = new Date(end.getTime() - (hours - 1) * 60 * 60 * 1000);
  const counts = new Map();
  for (let i = 0; i < hours; i += 1) {
    const d = new Date(start.getTime() + i * 60 * 60 * 1000);
    const key = toLisbonHourKey(d.toISOString());
    if (key) counts.set(key, 0);
  }
  (rows || []).forEach((row) => {
    const key = toLisbonHourKey(row[dateField]);
    if (key && counts.has(key)) counts.set(key, (counts.get(key) || 0) + 1);
  });
  return [...counts.entries()].map(([t, v]) => ({ t, v }));
}

function buildDaySeries(rows, dateField, days) {
  const counts = new Map();
  const now = new Date();
  const start = floorToDay(now);
  start.setDate(start.getDate() - (days - 1));
  for (let i = 0; i < days; i += 1) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const key = toLisbonDayKey(d.toISOString());
    if (key) counts.set(key, 0);
  }
  (rows || []).forEach((row) => {
    const key = toLisbonDayKey(row[dateField]);
    if (key && counts.has(key)) counts.set(key, (counts.get(key) || 0) + 1);
  });
  return [...counts.entries()].map(([t, v]) => ({ t, v }));
}

function buildAllDaySeries(rows, dateField, maxDays = 120) {
  const dayKeys = new Set();
  (rows || []).forEach((row) => {
    const key = toLisbonDayKey(row[dateField]);
    if (key) dayKeys.add(key);
  });
  if (!dayKeys.size) return [];
  const sorted = [...dayKeys].sort();
  const end = floorToDay(new Date());
  let start = new Date(`${sorted[0]}T00:00:00`);
  const minStart = new Date(end);
  minStart.setDate(minStart.getDate() - (maxDays - 1));
  if (start < minStart) start = minStart;
  const counts = new Map();
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const key = toLisbonDayKey(d.toISOString());
    if (key) counts.set(key, 0);
  }
  (rows || []).forEach((row) => {
    const key = toLisbonDayKey(row[dateField]);
    if (key && counts.has(key)) counts.set(key, (counts.get(key) || 0) + 1);
  });
  return [...counts.entries()].map(([t, v]) => ({ t, v }));
}

function buildRangeSeries(rows, config) {
  if (config.all) {
    return buildAllDaySeries(rows, 'created_at', config.maxDays || 120);
  }
  if (config.bucketMinutes) {
    return buildMinuteSeries(rows, 'created_at', config.lookbackMs, config.bucketMinutes);
  }
  if (config.bucketHours) {
    return buildHourSeries(rows, 'created_at', config.lookbackMs);
  }
  const days = Math.max(1, Math.round(config.lookbackMs / (24 * 60 * 60 * 1000)));
  return buildDaySeries(rows, 'created_at', days);
}

function sumSeries(series) {
  return (series || []).reduce((sum, point) => sum + (Number(point.v) || 0), 0);
}

function buildTimeline(rows) {
  const { saved, ai, manual } = splitRows(rows);
  const timeline = {};
  Object.entries(TIMELINE_RANGE_CONFIG).forEach(([key, config]) => {
    const savedSeries = buildRangeSeries(saved, config);
    const aiSeries = buildRangeSeries(ai, config);
    const manualSeries = buildRangeSeries(manual, config);
    timeline[key] = {
      saved: savedSeries,
      ai: aiSeries,
      manual: manualSeries,
      totalSaved: sumSeries(savedSeries),
      totalAi: sumSeries(aiSeries),
      totalManual: sumSeries(manualSeries),
    };
  });
  return timeline;
}

const {
  BANK_AGE_BANDS,
  normalizeCategoryNs,
  normalizeAgeBands,
  buildBankTaxonomyPatch,
  expandBankRowTaxonomy,
  arraysEqual,
} = require('./question-taxonomy');

function rowInRange(iso, config) {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  if (config.all) return true;
  return t >= Date.now() - config.lookbackMs;
}

function buildTimelineByCategory(rows) {
  const byRange = {};
  Object.entries(TIMELINE_RANGE_CONFIG).forEach(([key, config]) => {
    const categories = {};
    for (let n = 1; n <= 20; n += 1) {
      categories[n] = { '6-9': 0, '10-15': 0, '15+': 0, total: 0 };
    }
    (rows || []).forEach((row) => {
      if (!rowInRange(row.created_at, config)) return;
      const { categoryNs, ageBands } = expandBankRowTaxonomy(row);
      for (const cat of categoryNs) {
        for (const age of ageBands) {
          if (!cat || cat < 1 || cat > 20 || !BANK_AGE_BANDS.includes(age)) continue;
          categories[cat][age] += 1;
          categories[cat].total += 1;
        }
      }
    });
    byRange[key] = categories;
  });
  return byRange;
}

async function fetchQuestionTimelineRows() {
  const rows = [];
  const pageSize = 1000;
  let offset = 0;
  while (true) {
    const path = `/question_bank?select=created_at,source,category_n,age_band,category_ns,age_bands&order=created_at.asc&limit=${pageSize}&offset=${offset}`;
    const batch = await supabaseRequest(path);
    if (!batch?.length) break;
    rows.push(...batch);
    if (batch.length < pageSize) break;
    offset += pageSize;
  }
  return rows;
}

async function getQuestionBankStats() {
  const pendingReviewMod = () => {
    try {
      return require('./question-pending-review-store');
    } catch {
      return null;
    }
  };
  const pendingStore = pendingReviewMod();

  const [data, timelineRows, quarantine, pendingReview, bankWithDifficulty] = await Promise.all([
    supabaseRpc('get_question_bank_stats'),
    fetchQuestionTimelineRows().catch((err) => {
      console.warn('[question-bank-store] timeline rows failed:', err?.message || err);
      return [];
    }),
    getQuarantineStats(30),
    pendingStore?.getPendingReviewStats?.().catch(() => ({ available: false })) ?? { available: false },
    pendingStore?.countBankRowsWithDifficulty?.().catch(() => null) ?? null,
  ]);

  const base = (!data || typeof data !== 'object')
    ? {
      total: 0,
      active: 0,
      reported: 0,
      blocked: 0,
      byCategoryAge: [],
      bySource: [],
    }
    : {
      total: Number(data.total) || 0,
      active: Number(data.active) || 0,
      validActive: Number(data.validActive) || 0,
      invalidActive: Number(data.invalidActive) || 0,
      reported: Number(data.reported) || 0,
      blocked: Number(data.blocked) || 0,
      byCategoryAge: Array.isArray(data.byCategoryAge) ? data.byCategoryAge : [],
      bySource: Array.isArray(data.bySource) ? data.bySource : [],
    };

  return {
    ...base,
    timeline: buildTimeline(timelineRows),
    timelineByCategory: buildTimelineByCategory(timelineRows),
    quarantine,
    pendingReview,
    bankWithDifficulty: bankWithDifficulty != null ? Number(bankWithDifficulty) || 0 : null,
  };
}

async function purgeQuestionsWithoutOptions() {
  const data = await supabaseRpc('purge_question_bank_without_options');
  return {
    deleted: Number(data?.deleted) || 0,
  };
}

function escapePostgrestFilter(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/,/g, ' ')
    .replace(/\(/g, ' ')
    .replace(/\)/g, ' ')
    .trim();
}

function toReportHashSets(reportHashSets) {
  if (!reportHashSets) return null;
  return {
    open: new Set(reportHashSets.open || []),
    resolved: new Set(reportHashSets.resolved || []),
    any: new Set(reportHashSets.any || []),
  };
}

function filterRowsByReportStatus(rows, reportFilter, reportHashSets) {
  const filter = String(reportFilter || 'all').trim() || 'all';
  if (filter === 'all') return rows || [];

  const sets = toReportHashSets(reportHashSets);
  return (rows || []).filter((row) => {
    const hash = String(row.question_hash || '').trim();
    switch (filter) {
      case 'open':
        return sets?.open.has(hash);
      case 'resolved':
        return sets?.resolved.has(hash);
      case 'reported':
        return sets?.any.has(hash);
      case 'bank-reported':
        return row.is_reported === true;
      case 'not-reported':
        return row.is_reported !== true && !sets?.any.has(hash);
      default:
        return true;
    }
  });
}

async function fetchAllBankRowsByCategory(categoryN, options = {}) {
  const cat = Number(categoryN);
  const ageBand = String(options.ageBand || '').trim();
  const reportFilter = String(options.reportFilter || 'all').trim() || 'all';
  const rows = [];
  const pageSize = 1000;
  let offset = 0;

  while (true) {
    const { rows: batch, taxonomyColumns } = await queryBankRows((params, select, taxonomy) => {
      params.set('select', select);
      params.set('order', 'created_at.desc');
      params.set('limit', String(pageSize));
      params.set('offset', String(offset));
      applyBankCategoryParam(params, cat, taxonomy);
      if (!taxonomy && BANK_AGE_BANDS.includes(ageBand)) {
        params.set('age_band', `eq.${ageBand}`);
      }
      if (reportFilter === 'bank-reported') params.set('is_reported', 'eq.true');
      if (reportFilter === 'not-reported') params.set('is_reported', 'eq.false');
    });

    let pageRows = batch;
    if (taxonomyColumns && BANK_AGE_BANDS.includes(ageBand)) {
      pageRows = pageRows.filter((row) => normalizeAgeBands(null, null, row).includes(ageBand));
    }
    if (!pageRows.length) break;
    rows.push(...pageRows);
    if (batch.length < pageSize) break;
    offset += pageSize;
  }

  return filterRowsByReportStatus(rows, reportFilter, options.reportHashSets);
}

async function getQuarantinedBankHashes(hashes, days = 30) {
  const unique = [...new Set((hashes || []).map((h) => String(h || '').trim()).filter(Boolean))];
  if (!unique.length) return new Set();

  const cutoff = new Date(Date.now() - Math.max(Number(days) || 30, 1) * 24 * 60 * 60 * 1000).toISOString();
  const params = new URLSearchParams();
  params.set('select', 'question_hash');
  params.set('question_hash', `in.(${unique.join(',')})`);
  params.set('played_at', `gte.${cutoff}`);

  try {
    const rows = await supabaseRequest(`/question_reuse_events?${params.toString()}`);
    return new Set((Array.isArray(rows) ? rows : []).map((r) => r.question_hash).filter(Boolean));
  } catch {
    return new Set();
  }
}

async function searchQuestionBank(options = {}) {
  const {
    query = '',
    hash = '',
    categoryN = null,
    ageBand = '',
    limit = 25,
    offset = 0,
    reportFilter = 'all',
    reportHashSets = null,
  } = options;

  const filter = String(reportFilter || 'all').trim() || 'all';
  const resolved = resolveBankSearchKeys({ query, hash });
  const queryRaw = String(resolved.queryTrim || query || '').trim();
  let queryTrim = escapePostgrestFilter(queryRaw);
  const hashTrim = String(resolved.hashTrim || hash || '').trim().toLowerCase();
  const explicitHashSearch = !!hashTrim;

  let cat = Number(categoryN);
  if (!cat && resolved.categoryN) cat = resolved.categoryN;
  let age = String(ageBand || '').trim();
  if (!age && resolved.ageBand) age = resolved.ageBand;

  const hasCategory = cat >= 1 && cat <= 20;
  const hasAge = BANK_AGE_BANDS.includes(age);
  const hasText = !!(explicitHashSearch || queryTrim);
  const hasReportFilter = filter !== 'all';
  const hasActiveFilter = hasCategory || hasAge || hasText || hasReportFilter;
  const resultLimit = hasActiveFilter
    ? 100
    : Math.min(Math.max(Number(limit) || 25, 1), 100);
  const fetchLimit = hasReportFilter ? 1000 : Math.max(resultLimit, hasActiveFilter ? 500 : resultLimit);

  if (!hasText && !hasCategory && !hasAge) {
    return { rows: [], total: 0 };
  }

  const { rows: rawRows, taxonomyColumns } = await queryBankRows((params, select, taxonomy) => {
    params.set('select', select);
    params.set('order', 'created_at.desc');
    params.set('limit', String(fetchLimit));
    params.set('offset', String(Math.max(Number(offset) || 0, 0)));

    if (explicitHashSearch) {
      params.set('question_hash', `ilike.*${hashTrim}*`);
    } else if (queryTrim) {
      const hashNeedle = escapePostgrestFilter(queryRaw.toLowerCase());
      if (/^[a-z0-9]{4,12}$/i.test(queryRaw)) {
        params.set('or', `(question_hash.ilike.*${hashNeedle}*,question.ilike.*${queryTrim}*,correct_answer.ilike.*${queryTrim}*)`);
      } else {
        params.set('or', `(question.ilike.*${queryTrim}*,correct_answer.ilike.*${queryTrim}*)`);
      }
    } else if (hasCategory) {
      applyBankCategoryParam(params, cat, taxonomy);
    } else if (hasAge) {
      params.set('age_band', `eq.${age}`);
    }

    if (filter === 'bank-reported') params.set('is_reported', 'eq.true');
    if (filter === 'not-reported') params.set('is_reported', 'eq.false');
  });

  let rows = Array.isArray(rawRows) ? rawRows : [];
  if (hasCategory && hasText) {
    rows = rows.filter((row) => normalizeCategoryNs(null, null, row).includes(cat));
  }
  if (hasAge) {
    rows = rows.filter((row) => normalizeAgeBands(null, null, row).includes(age));
  }

  const filtered = filterRowsByReportStatus(rows, filter, reportHashSets);
  const capped = filtered.slice(0, resultLimit);
  const quarantined = await getQuarantinedBankHashes(capped.map((r) => r.question_hash));

  return {
    rows: capped.map((r) => ({ ...r, in_quarantine: quarantined.has(r.question_hash) })),
    total: filtered.length,
  };
}

async function updateQuestionBankTaxonomy(questionHash, taxonomy = {}) {
  const hash = String(questionHash || '').trim();
  if (!hash) {
    const err = new Error('Falta question_hash.');
    err.code = 'MISSING_HASH';
    throw err;
  }

  let existingRows;
  try {
    existingRows = await supabaseRequest(
      `/question_bank?question_hash=eq.${encodeURIComponent(hash)}&select=${BANK_SELECT_FULL}&limit=1`,
    );
  } catch {
    existingRows = await supabaseRequest(
      `/question_bank?question_hash=eq.${encodeURIComponent(hash)}&select=${BANK_SELECT_BASE}&limit=1`,
    );
  }
  const existing = Array.isArray(existingRows) ? existingRows[0] : null;
  if (!existing) {
    const err = new Error('Pergunta não encontrada no banco.');
    err.code = 'NOT_FOUND';
    throw err;
  }

  const categoryNs = normalizeCategoryNs(taxonomy.categoryNs, taxonomy.categoryN, existing);
  const ageBands = normalizeAgeBands(taxonomy.ageBands, taxonomy.ageBand, existing);
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

  const prevCats = normalizeCategoryNs(null, null, existing);
  const prevAges = normalizeAgeBands(null, null, existing);
  if (arraysEqual(prevCats, categoryNs) && arraysEqual(prevAges, ageBands)) {
    return {
      ok: true,
      action: 'unchanged',
      questionHash: hash,
      categoryNs,
      ageBands,
      previousCategoryNs: prevCats,
      previousAgeBands: prevAges,
    };
  }

  const patch = buildBankTaxonomyPatch(categoryNs, ageBands);
  const updated = await supabaseRequest(
    `/question_bank?question_hash=eq.${encodeURIComponent(hash)}`,
    {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(patch),
    },
  );

  return {
    ok: true,
    action: 'updated',
    questionHash: hash,
    categoryNs,
    ageBands,
    previousCategoryNs: prevCats,
    previousAgeBands: prevAges,
    updated: Array.isArray(updated) ? updated.length : 1,
  };
}

async function updateQuestionBankCategory(questionHash, categoryN) {
  const existingRows = await supabaseRequest(
    `/question_bank?question_hash=eq.${encodeURIComponent(String(questionHash || '').trim())}&select=age_band,age_bands&limit=1`,
  );
  const existing = Array.isArray(existingRows) ? existingRows[0] : null;
  const ageBands = normalizeAgeBands(null, null, existing);
  return updateQuestionBankTaxonomy(questionHash, {
    categoryNs: [Number(categoryN)],
    ageBands,
  });
}

async function deleteQuestionsFromBank(hashes, block = true) {
  const unique = [...new Set((hashes || []).map((h) => String(h || '').trim()).filter(Boolean))];
  if (!unique.length) {
    return { deleted: 0, blocked: 0, reuseEventsRemoved: 0, hashes: [] };
  }

  const data = await supabaseRpc('delete_questions_from_bank', {
    p_hashes: unique,
    p_block: block !== false,
  });

  return {
    deleted: Number(data?.deleted) || 0,
    blocked: Number(data?.blocked) || 0,
    reuseEventsRemoved: Number(data?.reuseEventsRemoved) || 0,
    hashes: unique,
  };
}

async function deleteQuestionsByCategory(categoryN, options = {}) {
  const cat = Number(categoryN);
  if (!cat || cat < 1 || cat > 20) {
    const err = new Error('Categoria inválida (1–20).');
    err.code = 'INVALID_CATEGORY';
    throw err;
  }

  const ageBand = String(options.ageBand || '').trim();
  if (ageBand && !BANK_AGE_BANDS.includes(ageBand)) {
    const err = new Error('Faixa etária inválida.');
    err.code = 'INVALID_AGE_BAND';
    throw err;
  }

  const reportFilter = String(options.reportFilter || 'all').trim() || 'all';
  const block = options.block !== false;

  if (reportFilter === 'all') {
    const data = await supabaseRpc('delete_questions_from_bank_by_category', {
      p_category_n: cat,
      p_age_band: ageBand || null,
      p_include_reported: true,
      p_block: block,
    });

    const hashes = Array.isArray(data?.hashes)
      ? data.hashes.map((h) => String(h || '').trim()).filter(Boolean)
      : [];

    return {
      deleted: Number(data?.deleted) || 0,
      blocked: Number(data?.blocked) || 0,
      reuseEventsRemoved: Number(data?.reuseEventsRemoved) || 0,
      matched: Number(data?.matched) || hashes.length,
      hashes,
    };
  }

  const rows = await fetchAllBankRowsByCategory(cat, {
    ageBand,
    reportFilter,
    reportHashSets: options.reportHashSets,
  });
  const hashes = rows.map((r) => r.question_hash).filter(Boolean);
  if (!hashes.length) {
    return {
      deleted: 0,
      blocked: 0,
      reuseEventsRemoved: 0,
      matched: 0,
      hashes: [],
    };
  }

  const result = await deleteQuestionsFromBank(hashes, block);
  return {
    ...result,
    matched: hashes.length,
  };
}

async function unblockQuestionHash(questionHash) {
  const hash = String(questionHash || '').trim();
  if (!hash) return;
  try {
    await supabaseRequest(`/question_bank_blocked?question_hash=eq.${encodeURIComponent(hash)}`, {
      method: 'DELETE',
    });
  } catch {
    /* pode não existir bloqueio */
  }
}

async function getBankRowByHash(questionHash) {
  const hash = String(questionHash || '').trim();
  if (!hash) return null;
  let rows;
  try {
    rows = await supabaseRequest(
      `/question_bank?question_hash=eq.${encodeURIComponent(hash)}&select=${BANK_SELECT_FULL}&limit=1`,
    );
  } catch {
    rows = await supabaseRequest(
      `/question_bank?question_hash=eq.${encodeURIComponent(hash)}&select=${BANK_SELECT_BASE}&limit=1`,
    );
  }
  return Array.isArray(rows) ? rows[0] : null;
}

async function findBankRowsByContent(question, answer) {
  const q = String(question || '').trim();
  const a = String(answer || '').trim();
  if (!q || !a) return [];

  const { rows } = await queryBankRows((params, select) => {
    params.set('select', select);
    params.set('question', `eq.${q}`);
    params.set('correct_answer', `eq.${a}`);
    params.set('limit', '200');
  });

  return Array.isArray(rows) ? rows : [];
}

function inferBankHashScheme(row, oldQuestion, oldAnswer) {
  const oldHash = String(row?.question_hash || '').trim();
  const schemes = [
    ['base', hashQuestionKey(`${oldQuestion}|${oldAnswer}`)],
    ['age', hashQuestionKey(`${oldQuestion}|${oldAnswer}|${row.age_band}`)],
    ['catAge', hashQuestionKey(`${oldQuestion}|${oldAnswer}|${row.age_band}|${row.category_n}`)],
  ];
  for (const [name, hash] of schemes) {
    if (oldHash === hash) return name;
  }
  return 'base';
}

function computeBankHashForContent(question, answer, row, scheme) {
  const q = String(question || '').trim();
  const a = String(answer || '').trim();
  if (scheme === 'age') return hashQuestionKey(`${q}|${a}|${row.age_band}`);
  if (scheme === 'catAge') return hashQuestionKey(`${q}|${a}|${row.age_band}|${row.category_n}`);
  return hashQuestionKey(`${q}|${a}`);
}

async function mergeBankRowIntoTarget(targetRow, sourceRow, contentPatch) {
  const taxonomyPatch = buildBankTaxonomyPatch(
    [
      ...normalizeCategoryNs(null, null, targetRow),
      ...normalizeCategoryNs(null, null, sourceRow),
    ],
    [
      ...normalizeAgeBands(null, null, targetRow),
      ...normalizeAgeBands(null, null, sourceRow),
    ],
  );
  const patch = {
    ...contentPatch,
    ...taxonomyPatch,
    is_reported: false,
    reported_at: null,
  };
  await supabaseRequest(`/question_bank?id=eq.${encodeURIComponent(targetRow.id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(patch),
  });
  await unblockQuestionHash(sourceRow.question_hash);
  await supabaseRequest(`/question_bank?id=eq.${encodeURIComponent(sourceRow.id)}`, {
    method: 'DELETE',
  });
}

function normalizeBankDifficulty(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n);
  if (rounded < 1 || rounded > 5) return null;
  return rounded;
}

function normalizeDifficultyByAgeBand(raw, ageBands = []) {
  if (!raw || typeof raw !== 'object') return null;
  const normalized = {};
  const allowedAges = ageBands.length ? ageBands : BANK_AGE_BANDS;
  for (const age of allowedAges) {
    if (!BANK_AGE_BANDS.includes(age)) continue;
    const difficulty = normalizeBankDifficulty(raw[age]);
    if (difficulty) normalized[age] = difficulty;
  }
  return Object.keys(normalized).length ? normalized : null;
}

function applyDifficultyToPatch(patch, meta) {
  if (!patch) return;
  const ageBands = normalizeAgeBands(meta?.ageBands, meta?.ageBand, null);
  const byAge = normalizeDifficultyByAgeBand(meta?.difficultyByAgeBand, ageBands);
  if (byAge) {
    patch.difficulty_by_age_band = byAge;
    const primaryAge = String(meta?.ageBand || ageBands[0] || '').trim();
    if (primaryAge && byAge[primaryAge]) {
      patch.difficulty = byAge[primaryAge];
    } else {
      patch.difficulty = Object.values(byAge)[0];
    }
    return;
  }
  if (meta?.difficulty == null || meta?.difficulty === '') return;
  const difficulty = normalizeBankDifficulty(meta.difficulty);
  if (difficulty) patch.difficulty = difficulty;
}

async function applyContentCorrectionToBankRow(row, correction, oldQuestion, oldAnswer, meta = {}) {
  const finalQuestion = String(correction.question || '').trim();
  const finalAnswer = String(correction.answer || '').trim();
  const finalOptions = Array.isArray(correction.options)
    ? correction.options.map((o) => String(o || '').trim()).filter(Boolean)
    : null;
  const finalFormat = correction.format
    || (finalOptions?.length >= 2 ? 'ESCOLHA_MULTIPLA' : null);

  const question = finalQuestion || oldQuestion;
  const answer = finalAnswer || oldAnswer;
  const options = finalOptions?.length >= 2 ? finalOptions : (row.options || null);
  const format = finalFormat || row.format || null;

  const patch = {
    is_reported: false,
    reported_at: null,
  };
  if (finalQuestion) patch.question = finalQuestion;
  if (finalAnswer) patch.correct_answer = finalAnswer;
  if (finalOptions?.length >= 2) {
    patch.options = finalOptions;
    patch.format = format || 'ESCOLHA_MULTIPLA';
  } else if (format) patch.format = format;
  applyDifficultyToPatch(patch, meta);

  const contentChanged = (finalQuestion && finalQuestion !== oldQuestion)
    || (finalAnswer && finalAnswer !== oldAnswer);
  let newHash = row.question_hash;
  if (contentChanged) {
    const scheme = inferBankHashScheme(row, oldQuestion, oldAnswer);
    newHash = computeBankHashForContent(question, answer, row, scheme);
  }

  if (newHash !== row.question_hash) {
    await unblockQuestionHash(row.question_hash);
    await unblockQuestionHash(newHash);
    const conflict = await getBankRowByHash(newHash);
    if (conflict && conflict.id !== row.id) {
      await mergeBankRowIntoTarget(conflict, row, patch);
      return {
        action: 'merged',
        questionHash: newHash,
        previousHash: row.question_hash,
        rowId: conflict.id,
      };
    }
    patch.question_hash = newHash;
  }

  await supabaseRequest(`/question_bank?id=eq.${encodeURIComponent(row.id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(patch),
  });

  return {
    action: newHash !== row.question_hash ? 'rehash' : 'updated',
    questionHash: newHash,
    previousHash: newHash !== row.question_hash ? row.question_hash : null,
    rowId: row.id,
  };
}

async function finishReportCorrection(result, {
  question = '',
  answer = '',
  options = null,
  telemetryEventId = null,
} = {}) {
  if (!result?.ok) return result;
  try {
    const { resolvePendingReviewOnBankSave } = require('./question-pending-review-store');
    await resolvePendingReviewOnBankSave({
      questionHash: result.questionHash,
      previousHash: result.previousHash,
      question,
      answer,
      status: 'accepted',
    });
  } catch (err) {
    console.warn('[question-bank-store] resolve pending review:', err?.message || err);
  }
  try {
    const { markTelemetryBankValidated } = require('./gen-telemetry-store');
    const telemetry = await markTelemetryBankValidated({
      eventId: telemetryEventId,
      question,
      answer,
      options,
      questionHash: result.questionHash,
      previousHash: result.previousHash,
    });
    if (telemetry?.marked) {
      result.telemetryValidated = telemetry.marked;
    }
  } catch (err) {
    console.warn('[question-bank-store] mark telemetry validated:', err?.message || err);
  }
  return result;
}

async function applyReportCorrectionToBank(oldHash, correction = {}, meta = {}) {
  const lookupHash = String(oldHash || '').trim();
  if (!lookupHash) {
    const err = new Error('Falta question_hash.');
    err.code = 'MISSING_HASH';
    throw err;
  }

  const finalQuestion = String(correction.question || '').trim();
  const finalAnswer = String(correction.answer || '').trim();
  const finalOptions = Array.isArray(correction.options)
    ? correction.options.map((o) => String(o || '').trim()).filter(Boolean)
    : null;
  const finalFormat = correction.format
    || (finalOptions?.length >= 2 ? 'ESCOLHA_MULTIPLA' : null);

  if (!finalQuestion && !finalAnswer && !finalOptions?.length) {
    const err = new Error('Nada para actualizar na correcção.');
    err.code = 'EMPTY_PATCH';
    throw err;
  }

  const existing = await getBankRowByHash(lookupHash);
  const oldQuestion = String(existing?.question || finalQuestion || '').trim();
  const oldAnswer = String(existing?.correct_answer || finalAnswer || '').trim();

  if (existing) {
    let siblings = await findBankRowsByContent(oldQuestion, oldAnswer);
    if (!siblings.length) siblings = [existing];

    await unblockQuestionHash(lookupHash);
    const results = [];
    for (const row of siblings) {
      results.push(await applyContentCorrectionToBankRow(
        row,
        {
          question: finalQuestion,
          answer: finalAnswer,
          options: finalOptions,
          format: finalFormat,
        },
        oldQuestion,
        oldAnswer,
        meta,
      ));
    }

    const primary = results.find((r) => r.previousHash === lookupHash)
      || results.find((r) => r.questionHash === lookupHash)
      || results[0];

    return finishReportCorrection({
      ok: true,
      action: siblings.length > 1 ? 'updated-many' : (primary?.action || 'updated'),
      updated: results.length,
      duplicateCount: Math.max(0, siblings.length - 1),
      questionHash: primary?.questionHash || lookupHash,
      previousHash: primary?.previousHash || null,
      hashes: results.map((r) => ({
        previousHash: r.previousHash,
        questionHash: r.questionHash,
        rowId: r.rowId,
        action: r.action,
      })),
    }, {
      question: finalQuestion || oldQuestion,
      answer: finalAnswer || oldAnswer,
      options: finalOptions,
      telemetryEventId: meta.telemetryEventId || null,
    });
  }

  const question = finalQuestion || '';
  const answer = finalAnswer || '';
  const options = finalOptions?.length >= 2 ? finalOptions : null;
  const format = finalFormat || (options?.length >= 2 ? 'ESCOLHA_MULTIPLA' : null);
  const newHash = hashQuestionKey(`${question}|${answer}`);
  const categoryNs = normalizeCategoryNs(meta.categoryNs, meta.categoryN, existing);
  const ageBands = normalizeAgeBands(meta.ageBands, meta.ageBand, existing);

  if (question && answer) {
    const alreadyByHash = await getBankRowByHash(newHash);
    if (alreadyByHash) {
      return applyReportCorrectionToBank(alreadyByHash.question_hash, correction, meta);
    }
    const alreadyByContent = await findBankRowsByContent(question, answer);
    if (alreadyByContent.length) {
      return applyReportCorrectionToBank(alreadyByContent[0].question_hash, correction, meta);
    }
  }

  await unblockQuestionHash(lookupHash);
  if (newHash && newHash !== lookupHash) await unblockQuestionHash(newHash);

  if (!categoryNs.length || !ageBands.length) {
    const err = new Error('Pergunta não está no banco — falta categoria ou faixa etária para inserir a correcção.');
    err.code = 'MISSING_META';
    throw err;
  }

  const taxonomyPatch = buildBankTaxonomyPatch(categoryNs, ageBands);
  const insertBody = {
    ...taxonomyPatch,
    question,
    correct_answer: answer,
    options: options?.length >= 2 ? options : null,
    format,
    question_hash: newHash,
    source: meta.source || 'corrected',
    knowledge_id: meta.knowledgeId || null,
    is_reported: false,
    reported_at: null,
  };
  applyDifficultyToPatch(insertBody, meta);
  const inserted = await supabaseRequest('/question_bank', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(insertBody),
  });

  return finishReportCorrection({
    ok: true,
    action: 'inserted',
    updated: Array.isArray(inserted) ? inserted.length : 1,
    duplicateCount: 0,
    questionHash: newHash,
    previousHash: lookupHash !== newHash ? lookupHash : null,
  }, {
    question,
    answer,
    options,
    telemetryEventId: meta.telemetryEventId || null,
  });
}

module.exports = {
  getQuestionBankStats,
  purgeQuestionsWithoutOptions,
  searchQuestionBank,
  updateQuestionBankTaxonomy,
  updateQuestionBankCategory,
  deleteQuestionsFromBank,
  deleteQuestionsByCategory,
  filterRowsByReportStatus,
  applyReportCorrectionToBank,
  parseGameQuestionId,
  hashQuestionKey,
  findBankRowsByContent,
};
