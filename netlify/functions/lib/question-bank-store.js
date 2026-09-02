const { getQuarantineStats } = require('./quarantine-store');
const { getSupabaseAdmin } = require('./rooms-store');

const LISBON_TZ = 'Europe/Lisbon';

const AI_SOURCES = new Set(['ai', 'test-page']);

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
  return { saved, ai };
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
  const { saved, ai } = splitRows(rows);
  const timeline = {};
  Object.entries(TIMELINE_RANGE_CONFIG).forEach(([key, config]) => {
    const savedSeries = buildRangeSeries(saved, config);
    const aiSeries = buildRangeSeries(ai, config);
    timeline[key] = {
      saved: savedSeries,
      ai: aiSeries,
      totalSaved: sumSeries(savedSeries),
      totalAi: sumSeries(aiSeries),
    };
  });
  return timeline;
}

const BANK_AGE_BANDS = ['6-9', '10-15', '15+'];

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
      const cat = Number(row.category_n);
      const age = row.age_band;
      if (!cat || cat < 1 || cat > 20 || !BANK_AGE_BANDS.includes(age)) return;
      categories[cat][age] += 1;
      categories[cat].total += 1;
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
    const path = `/question_bank?select=created_at,source,category_n,age_band&order=created_at.asc&limit=${pageSize}&offset=${offset}`;
    const batch = await supabaseRequest(path);
    if (!batch?.length) break;
    rows.push(...batch);
    if (batch.length < pageSize) break;
    offset += pageSize;
  }
  return rows;
}

async function getQuestionBankStats() {
  const [data, timelineRows, quarantine] = await Promise.all([
    supabaseRpc('get_question_bank_stats'),
    fetchQuestionTimelineRows().catch((err) => {
      console.warn('[question-bank-store] timeline rows failed:', err?.message || err);
      return [];
    }),
    getQuarantineStats(30),
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
    const params = new URLSearchParams();
    params.set('select', 'question_hash,is_reported,question,correct_answer');
    params.set('category_n', `eq.${cat}`);
    params.set('order', 'created_at.desc');
    params.set('limit', String(pageSize));
    params.set('offset', String(offset));

    if (BANK_AGE_BANDS.includes(ageBand)) params.set('age_band', `eq.${ageBand}`);
    if (reportFilter === 'bank-reported') params.set('is_reported', 'eq.true');
    if (reportFilter === 'not-reported') params.set('is_reported', 'eq.false');

    const batch = await supabaseRequest(`/question_bank?${params.toString()}`);
    if (!batch?.length) break;
    rows.push(...batch);
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
  const fetchLimit = filter === 'all'
    ? Math.min(Math.max(Number(limit) || 25, 1), 100)
    : 1000;

  const params = new URLSearchParams();
  params.set(
    'select',
    'id,question_hash,question,correct_answer,options,format,category_n,age_band,source,is_reported,created_at',
  );
  params.set('order', 'created_at.desc');
  params.set('limit', String(fetchLimit));
  params.set('offset', String(Math.max(Number(offset) || 0, 0)));

  const hashTrim = String(hash || '').trim();
  const queryTrim = escapePostgrestFilter(query);

  const cat = Number(categoryN);

  if (hashTrim) {
    params.set('question_hash', `eq.${hashTrim}`);
  } else if (queryTrim) {
    if (/^[a-z0-9]{4,12}$/i.test(queryTrim)) {
      params.set('or', `(question_hash.eq.${queryTrim},question.ilike.*${queryTrim}*)`);
    } else {
      params.set('question', `ilike.*${queryTrim}*`);
    }
  } else if (cat >= 1 && cat <= 20) {
    params.set('category_n', `eq.${cat}`);
  } else {
    return { rows: [], total: 0 };
  }

  if (cat >= 1 && cat <= 20 && (hashTrim || queryTrim)) {
    params.set('category_n', `eq.${cat}`);
  }

  const age = String(ageBand || '').trim();
  if (BANK_AGE_BANDS.includes(age)) params.set('age_band', `eq.${age}`);

  if (filter === 'bank-reported') params.set('is_reported', 'eq.true');
  if (filter === 'not-reported') params.set('is_reported', 'eq.false');

  const rawRows = await supabaseRequest(`/question_bank?${params.toString()}`);
  const filtered = filterRowsByReportStatus(
    Array.isArray(rawRows) ? rawRows : [],
    filter,
    reportHashSets,
  );
  const capped = filtered.slice(0, Math.min(Math.max(Number(limit) || 25, 1), 100));
  const quarantined = await getQuarantinedBankHashes(capped.map((r) => r.question_hash));

  return {
    rows: capped.map((r) => ({ ...r, in_quarantine: quarantined.has(r.question_hash) })),
    total: filtered.length,
  };
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

module.exports = {
  getQuestionBankStats,
  purgeQuestionsWithoutOptions,
  searchQuestionBank,
  deleteQuestionsFromBank,
  deleteQuestionsByCategory,
  filterRowsByReportStatus,
};
