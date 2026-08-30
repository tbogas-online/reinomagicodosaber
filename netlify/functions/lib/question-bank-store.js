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
  const [data, timelineRows] = await Promise.all([
    supabaseRpc('get_question_bank_stats'),
    fetchQuestionTimelineRows().catch((err) => {
      console.warn('[question-bank-store] timeline rows failed:', err?.message || err);
      return [];
    }),
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
  };
}

async function purgeQuestionsWithoutOptions() {
  const data = await supabaseRpc('purge_question_bank_without_options');
  return {
    deleted: Number(data?.deleted) || 0,
  };
}

module.exports = {
  getQuestionBankStats,
  purgeQuestionsWithoutOptions,
};
