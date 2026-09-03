const { getSupabaseAdmin } = require('./rooms-store');

const TABLE = 'ai_request_buckets';
const DIMS_TABLE = 'ai_request_bucket_dims';
const MINUTE_TABLE = 'ai_request_minute_dims';
const BUCKET_MINUTES = 5;
const MINUTE_BUCKET_MINUTES = 1;
const MAX_LOOKBACK_MS = 48 * 60 * 60 * 1000;
const MINUTE_LOOKBACK_MS = 60 * 60 * 1000;
const LISBON_TZ = 'Europe/Lisbon';

const USAGE_RANGE_CONFIG = {
  '1h': { lookbackMs: 60 * 60 * 1000, label: 'última hora' },
  '3h': { lookbackMs: 3 * 60 * 60 * 1000, label: 'últimas 3 horas' },
  '6h': { lookbackMs: 6 * 60 * 60 * 1000, label: 'últimas 6 horas' },
  '12h': { lookbackMs: 12 * 60 * 60 * 1000, label: 'últimas 12 horas' },
  '24h': { lookbackMs: 24 * 60 * 60 * 1000, label: 'últimas 24 horas' },
  '48h': { lookbackMs: 48 * 60 * 60 * 1000, label: 'últimas 48 horas' },
};

async function supabaseRpc(functionName, body = {}) {
  const cfg = getSupabaseAdmin();
  if (!cfg) {
    const err = new Error('Supabase admin não configurado.');
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
  return null;
}

async function supabaseRequest(path, options = {}) {
  const cfg = getSupabaseAdmin();
  if (!cfg) {
    const err = new Error('Supabase admin não configurado.');
    err.code = 'NOT_CONFIGURED';
    throw err;
  }
  const headers = {
    apikey: cfg.key,
    Authorization: `Bearer ${cfg.key}`,
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
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

function normalizeProvider(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeModel(value) {
  return String(value || '').trim();
}

function normalizeTokenCount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n);
}

function extractUsageTokens(usage) {
  if (!usage || typeof usage !== 'object') return 0;
  const total = normalizeTokenCount(usage.total_tokens);
  if (total) return total;
  const prompt = normalizeTokenCount(usage.prompt_tokens);
  const completion = normalizeTokenCount(usage.completion_tokens);
  const input = normalizeTokenCount(usage.input_tokens);
  const output = normalizeTokenCount(usage.output_tokens);
  return prompt + completion + input + output;
}

function apiBucketToLisbonKey(raw, bucketMinutes = BUCKET_MINUTES) {
  if (!raw) return null;
  const text = String(raw).trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (iso) {
    let minute = Number(iso[5]) || 0;
    if (bucketMinutes > 1) minute = Math.floor(minute / bucketMinutes) * bucketMinutes;
    return `${iso[1]}-${iso[2]}-${iso[3]}T${iso[4]}:${String(minute).padStart(2, '0')}`;
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text)) {
    let minute = Number(text.slice(14, 16)) || 0;
    if (bucketMinutes > 1) minute = Math.floor(minute / bucketMinutes) * bucketMinutes;
    return `${text.slice(0, 14)}${String(minute).padStart(2, '0')}`;
  }
  return toLisbonBucketKey(raw, bucketMinutes);
}

function toLisbonBucketKey(date, bucketMinutes = BUCKET_MINUTES) {
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

function toLisbonDayKey(date) {
  const key = toLisbonBucketKey(date, 60);
  return key ? key.slice(0, 10) : null;
}

function bucketKeyToUtcMs(key, bucketMinutes = BUCKET_MINUTES) {
  if (!key || !String(key).includes('T')) return NaN;
  const [datePart, timePart] = String(key).split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute] = timePart.split(':').map(Number);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: LISBON_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  for (const offsetHours of [-2, -1, 0, 1, 2]) {
    const probe = new Date(Date.UTC(year, month - 1, day, hour + offsetHours, minute, 0, 0));
    const parts = formatter.formatToParts(probe);
    const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    const probeMinute = Math.floor((Number(map.minute) || 0) / bucketMinutes) * bucketMinutes;
    const probeKey = `${map.year}-${map.month}-${map.day}T${map.hour}:${String(probeMinute).padStart(2, '0')}`;
    if (probeKey === key) return probe.getTime();
  }
  return Date.UTC(year, month - 1, day, hour, minute, 0, 0);
}

function filterDimensionRows(rows, filters = {}) {
  const provider = normalizeProvider(filters.provider);
  const model = normalizeModel(filters.model);
  const hasProvider = !!provider;
  const hasModel = !!model;
  return (rows || []).filter((row) => {
    const rowProvider = normalizeProvider(row.provider);
    const rowModel = normalizeModel(row.model);
    if (hasProvider && rowProvider !== provider) return false;
    if (hasModel && rowModel !== model) return false;
    return true;
  });
}

function aggregateRowsByBucket(rows) {
  const map = new Map();
  (rows || []).forEach((row) => {
    const key = apiBucketToLisbonKey(row.bucket_start, 1);
    if (!key) return;
    const slot = map.get(key) || {
      bucket_start: key,
      request_count: 0,
      error_count: 0,
      token_count: 0,
      latency_sum_ms: 0,
      latency_count: 0,
      limit_count: 0,
      quota_used_peak: 0,
    };
    slot.request_count += Number(row.request_count) || 0;
    slot.error_count += Number(row.error_count) || 0;
    slot.token_count += Number(row.token_count) || 0;
    slot.latency_sum_ms += Number(row.latency_sum_ms) || 0;
    slot.latency_count += Number(row.latency_count) || 0;
    slot.limit_count += Number(row.limit_count) || 0;
    slot.quota_used_peak = Math.max(slot.quota_used_peak || 0, Number(row.quota_used_peak) || 0);
    map.set(key, slot);
  });
  return [...map.values()].sort((a, b) => String(a.bucket_start).localeCompare(String(b.bucket_start)));
}

function buildBucketSeries(rows, lookbackMs, bucketMinutes = BUCKET_MINUTES) {
  const now = new Date();
  const endKey = toLisbonBucketKey(now, bucketMinutes);
  const endMs = bucketKeyToUtcMs(endKey, bucketMinutes);
  const startMs = endMs - lookbackMs + bucketMinutes * 60 * 1000;
  const counts = new Map();

  for (let t = startMs; t <= endMs; t += bucketMinutes * 60 * 1000) {
    const key = toLisbonBucketKey(new Date(t), bucketMinutes);
    if (key) {
      counts.set(key, {
        requests: 0, errors: 0, tokens: 0, latencySum: 0, latencyCount: 0, limits: 0, quotaPressure: 0,
      });
    }
  }

  (rows || []).forEach((row) => {
    const key = apiBucketToLisbonKey(row.bucket_start, bucketMinutes);
    if (!key) return;
    if (!counts.has(key)) {
      counts.set(key, {
        requests: 0, errors: 0, tokens: 0, latencySum: 0, latencyCount: 0, limits: 0, quotaPressure: 0,
      });
    }
    const slot = counts.get(key);
    slot.requests += Number(row.request_count) || 0;
    slot.errors += Number(row.error_count) || 0;
    slot.tokens += Number(row.token_count) || 0;
    slot.latencySum += Number(row.latency_sum_ms) || 0;
    slot.latencyCount += Number(row.latency_count) || 0;
    slot.limits += Number(row.limit_count) || 0;
    slot.quotaPressure = Math.max(slot.quotaPressure || 0, Number(row.quota_used_peak) || 0);
  });

  const sortedKeys = [...counts.keys()].sort();
  let daySum = 0;
  let dayTokenSum = 0;
  let currentDay = '';
  const requests = [];
  const cumulative = [];
  const cumulativeTokens = [];
  const errors = [];
  const tokens = [];
  const latency = [];
  const limits = [];
  const quotaPressure = [];

  sortedKeys.forEach((key) => {
    const slot = counts.get(key);
    const day = key.slice(0, 10);
    if (day !== currentDay) {
      currentDay = day;
      daySum = 0;
      dayTokenSum = 0;
    }
    daySum += slot.requests;
    dayTokenSum += slot.tokens;
    requests.push({ t: key, v: slot.requests });
    cumulative.push({ t: key, v: daySum });
    cumulativeTokens.push({ t: key, v: dayTokenSum });
    errors.push({ t: key, v: slot.errors });
    tokens.push({ t: key, v: slot.tokens });
    limits.push({ t: key, v: slot.limits });
    quotaPressure.push({ t: key, v: slot.quotaPressure });
    latency.push({
      t: key,
      v: slot.latencyCount > 0 ? Math.round(slot.latencySum / slot.latencyCount) : 0,
    });
  });

  const totalRequests = requests.reduce((sum, p) => sum + p.v, 0);
  const totalErrors = errors.reduce((sum, p) => sum + p.v, 0);
  const totalTokens = tokens.reduce((sum, p) => sum + p.v, 0);
  const totalLimitHits = limits.reduce((sum, p) => sum + p.v, 0);
  const peakQuotaPressure = quotaPressure.reduce((max, p) => Math.max(max, p.v), 0);
  const latencySamples = latency.filter((p) => p.v > 0);
  const avgLatencyMs = latencySamples.length
    ? Math.round(latencySamples.reduce((sum, p) => sum + p.v, 0) / latencySamples.length)
    : null;
  return {
    requests,
    cumulative,
    cumulativeTokens,
    errors,
    tokens,
    limits,
    quotaPressure,
    latency,
    totalRequests,
    totalErrors,
    totalTokens,
    totalLimitHits,
    peakQuotaPressure,
    avgLatencyMs,
  };
}

function buildMinuteHourTimeline(rows) {
  return buildBucketSeries(rows, MINUTE_LOOKBACK_MS, MINUTE_BUCKET_MINUTES);
}

function buildUsageTimeline(rows) {
  const timeline = {};
  Object.entries(USAGE_RANGE_CONFIG).forEach(([key, config]) => {
    timeline[key] = buildBucketSeries(rows, config.lookbackMs, BUCKET_MINUTES);
  });
  return timeline;
}

function computeUsageSummary(rows) {
  const now = Date.now();
  const cut1h = now - 60 * 60 * 1000;
  const cut24h = now - 24 * 60 * 60 * 1000;
  const cut48h = now - 48 * 60 * 60 * 1000;
  const todayKey = toLisbonDayKey(new Date());

  let last1h = 0;
  let last24h = 0;
  let last48h = 0;
  let errors48h = 0;
  let quotaUsedToday = 0;

  (rows || []).forEach((row) => {
    const bucketKey = apiBucketToLisbonKey(row.bucket_start, 1);
    const t = bucketKey ? bucketKeyToUtcMs(bucketKey, 1) : new Date(row.bucket_start).getTime();
    if (Number.isNaN(t)) return;
    const reqs = Number(row.request_count) || 0;
    const errs = Number(row.error_count) || 0;
    if (t >= cut48h) {
      last48h += reqs;
      errors48h += errs;
    }
    if (t >= cut24h) last24h += reqs;
    if (t >= cut1h) last1h += reqs;
    if ((apiBucketToLisbonKey(row.bucket_start, 60) || '').slice(0, 10) === todayKey) quotaUsedToday += reqs;
  });

  const successRate = last48h > 0
    ? Math.round(((last48h - errors48h) / last48h) * 1000) / 10
    : null;

  return {
    last1h,
    last24h,
    last48h,
    errors: errors48h,
    successRate,
    quotaUsedToday,
  };
}

function buildUsageCatalog(dimensionRows) {
  const providerCounts = new Map();
  const modelCounts = new Map();

  (dimensionRows || []).forEach((row) => {
    const provider = normalizeProvider(row.provider);
    const model = normalizeModel(row.model);
    const reqs = Number(row.request_count) || 0;
    if (!reqs || !provider) return;
    providerCounts.set(provider, (providerCounts.get(provider) || 0) + reqs);
    if (!model) return;
    const modelKey = `${provider}\0${model}`;
    const existing = modelCounts.get(modelKey) || { provider, model, count: 0 };
    existing.count += reqs;
    modelCounts.set(modelKey, existing);
  });

  const providers = [...providerCounts.entries()]
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));

  const models = [...modelCounts.values()]
    .sort((a, b) => b.count - a.count || a.model.localeCompare(b.model));

  return { providers, models };
}

function resolveQuotaLimit() {
  const raw = (process.env.AI_DAILY_REQUEST_QUOTA || '').trim();
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return Math.round(n);
  return null;
}

async function fetchAggregateBucketRows() {
  const since = new Date(Date.now() - MAX_LOOKBACK_MS).toISOString();
  const params = new URLSearchParams({
    select: 'bucket_start,request_count,error_count',
    bucket_start: `gte.${since}`,
    order: 'bucket_start.asc',
    limit: '600',
  });
  const rows = await supabaseRequest(`/${TABLE}?${params.toString()}`);
  return Array.isArray(rows) ? rows : [];
}

async function fetchDimensionBucketRows() {
  const since = new Date(Date.now() - MAX_LOOKBACK_MS).toISOString();
  const params = new URLSearchParams({
    select: 'bucket_start,provider,model,request_count,error_count,latency_sum_ms,latency_count',
    bucket_start: `gte.${since}`,
    order: 'bucket_start.asc',
    limit: '5000',
  });
  try {
    const rows = await supabaseRequest(`/${DIMS_TABLE}?${params.toString()}`);
    if (Array.isArray(rows) && rows.length) return rows;
  } catch (err) {
    const msg = String(err?.message || err);
    if (!msg.includes('ai_request_bucket_dims') && !msg.includes('PGRST205') && !msg.includes('42P01')) {
      throw err;
    }
  }
  const aggregate = await fetchAggregateBucketRows();
  return aggregate.map((row) => ({
    ...row,
    provider: '',
    model: '',
  }));
}

async function fetchMinuteDimensionRows() {
  const since = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const params = new URLSearchParams({
    select: 'bucket_start,provider,model,request_count,error_count,token_count,latency_sum_ms,latency_count,limit_count,quota_used_peak',
    bucket_start: `gte.${since}`,
    order: 'bucket_start.asc',
    limit: '5000',
  });
  try {
    const rows = await supabaseRequest(`/${MINUTE_TABLE}?${params.toString()}`);
    return Array.isArray(rows) ? rows : [];
  } catch (err) {
    const msg = String(err?.message || err);
    if (msg.includes('ai_request_minute_dims') || msg.includes('token_count') || msg.includes('PGRST205') || msg.includes('42P01')) {
      return [];
    }
    throw err;
  }
}

function normalizeLatencyMs(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(Math.round(n), 600000);
}

function normalizeQuotaTokensUsed(value, limit) {
  const used = Number(value);
  if (!Number.isFinite(used) || used < 0) return null;
  const l = Number(limit);
  if (Number.isFinite(l) && l > 0) return Math.min(Math.round(used), Math.round(l));
  return Math.round(used);
}

function quotaUsedFromRateLimitHeaders(headers = {}) {
  const limit = Number(headers.tokens_limit);
  const remaining = Number(headers.tokens_remaining);
  if (Number.isFinite(limit) && limit > 0 && Number.isFinite(remaining)) {
    return normalizeQuotaTokensUsed(limit - remaining, limit);
  }
  const used = Number(headers.tokens_used);
  if (Number.isFinite(used) && used >= 0) return normalizeQuotaTokensUsed(used, limit);
  return null;
}

async function recordAiRequest({
  ok = true,
  provider = '',
  model = '',
  tokens = 0,
  latencyMs = 0,
  limitHit = false,
  quotaTokensUsed = null,
} = {}) {
  if (!getSupabaseAdmin()) return { recorded: false, reason: 'not_configured' };
  const payload = {
    p_ok: !!ok,
    p_provider: normalizeProvider(provider),
    p_model: normalizeModel(model),
    p_tokens: normalizeTokenCount(tokens),
    p_latency_ms: normalizeLatencyMs(latencyMs),
    p_limit_hit: !!limitHit,
    p_quota_tokens_used: quotaTokensUsed != null ? normalizeQuotaTokensUsed(quotaTokensUsed) : null,
  };
  try {
    await supabaseRpc('increment_ai_request_bucket', payload);
    return { recorded: true };
  } catch (err) {
    const msg = String(err?.message || err);
    if (msg.includes('ai_request_buckets') || msg.includes('increment_ai_request_bucket') || msg.includes('PGRST')) {
      try {
        await supabaseRpc('increment_ai_request_bucket', {
          p_ok: !!ok,
          p_provider: payload.p_provider,
          p_model: payload.p_model,
          p_tokens: payload.p_tokens,
          p_latency_ms: payload.p_latency_ms,
          p_limit_hit: payload.p_limit_hit,
          p_quota_tokens_used: payload.p_quota_tokens_used,
        });
        return { recorded: true, legacy: true };
      } catch (legacyErr) {
        try {
          await supabaseRpc('increment_ai_request_bucket', {
            p_ok: !!ok,
            p_provider: payload.p_provider,
            p_model: payload.p_model,
            p_tokens: payload.p_tokens,
            p_latency_ms: payload.p_latency_ms,
          });
          return { recorded: true, legacy: true };
        } catch {
          return { recorded: false, reason: 'table_missing', detail: legacyErr?.message || legacyErr };
        }
      }
    }
    throw err;
  }
}

async function recordAiQuotaMinutePressure({ provider = '', quotaTokensUsed = null, limitHit = false } = {}) {
  if (!getSupabaseAdmin()) return { recorded: false, reason: 'not_configured' };
  const used = quotaTokensUsed != null ? normalizeQuotaTokensUsed(quotaTokensUsed) : null;
  if (!normalizeProvider(provider) || (used == null && !limitHit)) {
    return { recorded: false, reason: 'empty' };
  }
  try {
    await supabaseRpc('record_ai_quota_minute_pressure', {
      p_provider: normalizeProvider(provider),
      p_quota_tokens_used: used,
      p_limit_hit: !!limitHit,
    });
    return { recorded: true };
  } catch (err) {
    const msg = String(err?.message || err);
    if (msg.includes('record_ai_quota_minute_pressure') || msg.includes('quota_used_peak') || msg.includes('PGRST')) {
      return { recorded: false, reason: 'migration_missing' };
    }
    throw err;
  }
}

async function getAiUsageStats() {
  if (!getSupabaseAdmin()) {
    return {
      available: false,
      bucketMinutes: BUCKET_MINUTES,
      ranges: Object.keys(USAGE_RANGE_CONFIG),
      summary: null,
      timeline: null,
      dimensionRows: [],
      catalog: { providers: [], models: [] },
      quotaLimit: resolveQuotaLimit(),
    };
  }
  try {
    const dimensionRows = await fetchDimensionBucketRows();
    const minuteDimensionRows = await fetchMinuteDimensionRows();
    const aggregatedRows = aggregateRowsByBucket(dimensionRows);
    const aggregatedMinuteRows = aggregateRowsByBucket(minuteDimensionRows);
    const summary = computeUsageSummary(aggregatedRows);
    const quotaLimit = resolveQuotaLimit();
    return {
      available: true,
      bucketMinutes: BUCKET_MINUTES,
      minuteBucketMinutes: MINUTE_BUCKET_MINUTES,
      ranges: Object.keys(USAGE_RANGE_CONFIG),
      summary: {
        ...summary,
        quotaLimit,
        quotaPercentToday: quotaLimit && summary.quotaUsedToday != null
          ? Math.min(100, Math.round((summary.quotaUsedToday / quotaLimit) * 1000) / 10)
          : null,
      },
      timeline: buildUsageTimeline(aggregatedRows),
      minuteTimeline: buildMinuteHourTimeline(aggregatedMinuteRows),
      dimensionRows,
      minuteDimensionRows,
      catalog: buildUsageCatalog(dimensionRows),
      quotaLimit,
    };
  } catch (err) {
    const msg = String(err?.message || err);
    if (msg.includes('ai_request_buckets') || msg.includes('PGRST205') || msg.includes('42P01')) {
      return {
        available: false,
        bucketMinutes: BUCKET_MINUTES,
        ranges: Object.keys(USAGE_RANGE_CONFIG),
        summary: null,
        timeline: null,
        dimensionRows: [],
        catalog: { providers: [], models: [] },
        quotaLimit: resolveQuotaLimit(),
        error: 'Tabela ai_request_buckets em falta — executa supabase/ai-usage-buckets.sql.',
      };
    }
    throw err;
  }
}

module.exports = {
  BUCKET_MINUTES,
  MINUTE_BUCKET_MINUTES,
  USAGE_RANGE_CONFIG,
  recordAiRequest,
  recordAiQuotaMinutePressure,
  quotaUsedFromRateLimitHeaders,
  extractUsageTokens,
  getAiUsageStats,
  buildBucketSeries,
  buildMinuteHourTimeline,
  computeUsageSummary,
  filterDimensionRows,
  aggregateRowsByBucket,
  buildUsageCatalog,
  buildUsageTimeline,
};
