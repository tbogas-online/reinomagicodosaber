const { getSupabaseAdmin } = require('./rooms-store');

const MAX_EVENTS = 10000;
const TABLE = 'gen_telemetry_events';

const VALID_OUTCOMES = new Set(['accepted', 'rejected', 'parse_error', 'api_error', 'unknown']);
const VALID_GAME_MODES = new Set(['local', 'multiplayer', 'test']);

function clip(value, max) {
  return String(value || '').trim().slice(0, max);
}

const MAX_ISSUE_MESSAGES = 6;
const MAX_ISSUE_MESSAGE_LEN = 200;

function clipIssueMessage(value) {
  return String(value || '').trim().slice(0, MAX_ISSUE_MESSAGE_LEN);
}

function normalizeIssueMessages(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((m) => clipIssueMessage(m)).filter(Boolean).slice(0, MAX_ISSUE_MESSAGES);
}

function accumulateIssueDetail(summary, ev) {
  const codes = ev.issueCodes || [];
  const messages = ev.issueMessages || [];
  for (let i = 0; i < codes.length; i += 1) {
    const code = codes[i];
    const msg = messages[i] || messages[0] || '';
    if (!summary.byIssueDetail[code]) {
      summary.byIssueDetail[code] = { count: 0, sampleMessage: msg, lastOccurrence: null };
    }
    const entry = summary.byIssueDetail[code];
    entry.count += 1;
    if (msg && !entry.sampleMessage) {
      entry.sampleMessage = msg;
    }
    const occurrence = {
      ts: Number(ev.ts) || Date.now(),
      message: clipIssueMessage(msg),
      category: ev.category != null ? Number(ev.category) : null,
      formatId: clip(ev.formatId, 32) || '',
      ageBandKey: clip(ev.ageBandKey, 12) || '',
      gameMode: ev.gameMode || 'local',
      provider: clip(ev.provider, 24) || '',
      model: clip(ev.model, 48) || '',
      difficulty: ev.difficulty != null ? Number(ev.difficulty) : null,
      attempt: ev.attempt != null ? Number(ev.attempt) : null,
    };
    if (!entry.lastOccurrence || occurrence.ts >= entry.lastOccurrence.ts) {
      entry.lastOccurrence = occurrence;
    }
  }
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

function normalizeEvent(raw) {
  const e = raw && typeof raw === 'object' ? raw : {};
  const outcome = VALID_OUTCOMES.has(String(e.outcome)) ? String(e.outcome) : 'unknown';
  const gameMode = VALID_GAME_MODES.has(String(e.gameMode)) ? String(e.gameMode) : 'local';
  const issueCodes = Array.isArray(e.issueCodes)
    ? e.issueCodes.map((c) => clip(c, 48)).filter(Boolean).slice(0, 12)
    : [];
  const issueMessages = normalizeIssueMessages(e.issueMessages);
  const category = e.category != null ? Number(e.category) : null;
  return {
    ts: Number(e.ts) || Date.now(),
    outcome,
    category: Number.isFinite(category) ? category : null,
    formatId: clip(e.formatId, 32),
    ageBandKey: clip(e.ageBandKey, 12),
    difficulty: e.difficulty != null ? Number(e.difficulty) : null,
    attempt: e.attempt != null ? Number(e.attempt) : null,
    issueCodes,
    issueMessages,
    provider: clip(e.provider, 24),
    model: clip(e.model, 48),
    score: e.score != null ? Number(e.score) : null,
    source: clip(e.source, 16) || 'ai',
    gameMode,
  };
}

function eventToRow(normalized) {
  return {
    event_ts: normalized.ts,
    outcome: normalized.outcome,
    category: normalized.category,
    format_id: normalized.formatId || null,
    age_band_key: normalized.ageBandKey || null,
    difficulty: normalized.difficulty != null ? Math.round(normalized.difficulty) : null,
    attempt: normalized.attempt != null ? Math.round(normalized.attempt) : null,
    issue_codes: normalized.issueCodes,
    issue_messages: normalized.issueMessages,
    provider: normalized.provider || null,
    model: normalized.model || null,
    score: normalized.score != null ? Math.round(normalized.score) : null,
    source: normalized.source,
    game_mode: normalized.gameMode,
  };
}

function rowToItem(row) {
  return {
    id: row.id,
    ts: row.event_ts,
    outcome: row.outcome,
    category: row.category,
    formatId: row.format_id || '',
    ageBandKey: row.age_band_key || '',
    gameMode: row.game_mode || 'local',
    source: row.source || 'ai',
    issueCodes: Array.isArray(row.issue_codes) ? row.issue_codes : [],
    issueMessages: Array.isArray(row.issue_messages) ? row.issue_messages : [],
    provider: row.provider || '',
    model: row.model || '',
    difficulty: row.difficulty != null ? Number(row.difficulty) : null,
    attempt: row.attempt != null ? Number(row.attempt) : null,
  };
}

function isRepoSource(source) {
  const src = String(source || '');
  return src === 'repository' || src === 'repo-direct' || src === 'repo-ai';
}

function repoAcceptedCount(bySource) {
  return (bySource?.repository?.accepted || 0)
    + (bySource?.['repo-direct']?.accepted || 0)
    + (bySource?.['repo-ai']?.accepted || 0);
}

function accumulateProvider(summary, ev) {
  const prov = clip(ev.provider, 24);
  if (!prov) return;
  if (!summary.byProvider[prov]) summary.byProvider[prov] = { total: 0, accepted: 0, rejected: 0 };
  summary.byProvider[prov].total += 1;
  if (ev.outcome === 'accepted') summary.byProvider[prov].accepted += 1;
  else if (ev.outcome === 'rejected') summary.byProvider[prov].rejected += 1;
}

function accumulateModel(summary, ev) {
  const model = clip(ev.model, 48);
  if (!model) return;
  if (!summary.byModel[model]) summary.byModel[model] = { total: 0, accepted: 0 };
  summary.byModel[model].total += 1;
  if (ev.outcome === 'accepted') summary.byModel[model].accepted += 1;
}

function accumulateAttempt(summary, ev) {
  if (ev.outcome !== 'accepted' || ev.attempt == null) return;
  const key = String(Math.min(Math.max(Math.round(ev.attempt), 1), 10));
  summary.byAttempt[key] = (summary.byAttempt[key] || 0) + 1;
  if (ev.source === 'ai') {
    summary._aiAttemptSum = (summary._aiAttemptSum || 0) + ev.attempt;
    summary._aiAttemptCount = (summary._aiAttemptCount || 0) + 1;
  }
}

function accumulateSource(summary, ev) {
  const src = clip(ev.source, 16) || 'ai';
  if (!summary.bySource[src]) summary.bySource[src] = { total: 0, accepted: 0 };
  summary.bySource[src].total += 1;
  if (ev.outcome === 'accepted') summary.bySource[src].accepted += 1;
}

function finalizeSummaryRates(summary) {
  const failures = summary.rejected + summary.parseErrors + summary.apiErrors;
  summary.rejectionRate = summary.total ? failures / summary.total : 0;
  summary.acceptanceRate = summary.total ? summary.accepted / summary.total : 0;
  const repoAccepted = repoAcceptedCount(summary.bySource);
  summary.repositoryShare = summary.accepted ? repoAccepted / summary.accepted : 0;
  const repoDirectAccepted = (summary.bySource?.['repo-direct']?.accepted || 0)
    + (summary.bySource?.repository?.accepted || 0);
  summary.repoDirectShare = repoAccepted ? repoDirectAccepted / repoAccepted : 0;
  const bankAccepted = summary.bySource?.bank?.accepted || 0;
  summary.bankShare = summary.accepted ? bankAccepted / summary.accepted : 0;
  const nonAiAccepted = Object.entries(summary.bySource || {})
    .filter(([key]) => key !== 'ai' && key !== 'repo-ai')
    .reduce((sum, [, bucket]) => sum + (bucket.accepted || 0), 0);
  summary.nonAiShare = summary.accepted ? nonAiAccepted / summary.accepted : 0;
  summary.aiAvgAttempts = summary._aiAttemptCount
    ? summary._aiAttemptSum / summary._aiAttemptCount
    : null;
  delete summary._aiAttemptSum;
  delete summary._aiAttemptCount;
  return summary;
}

function computeSummaryFromItems(items) {
  const summary = {
    total: items.length,
    accepted: 0,
    rejected: 0,
    parseErrors: 0,
    apiErrors: 0,
    byIssueCode: {},
    byIssueDetail: {},
    byCategory: {},
    byFormat: {},
    byGameMode: {},
    bySource: {},
    byProvider: {},
    byModel: {},
    byAttempt: {},
    rejectionRate: 0,
    acceptanceRate: 0,
    repositoryShare: 0,
    repoDirectShare: 0,
    bankShare: 0,
    nonAiShare: 0,
    aiAvgAttempts: null,
  };

  for (const ev of items) {
    if (ev.outcome === 'accepted') summary.accepted += 1;
    else if (ev.outcome === 'rejected') summary.rejected += 1;
    else if (ev.outcome === 'parse_error') summary.parseErrors += 1;
    else if (ev.outcome === 'api_error') summary.apiErrors += 1;

    for (const code of ev.issueCodes || []) {
      summary.byIssueCode[code] = (summary.byIssueCode[code] || 0) + 1;
    }
    accumulateIssueDetail(summary, ev);
    if (ev.category != null) {
      const ck = String(ev.category);
      if (!summary.byCategory[ck]) summary.byCategory[ck] = { total: 0, rejected: 0 };
      summary.byCategory[ck].total += 1;
      if (ev.outcome === 'rejected') summary.byCategory[ck].rejected += 1;
    }
    if (ev.formatId) {
      if (!summary.byFormat[ev.formatId]) summary.byFormat[ev.formatId] = { total: 0, rejected: 0 };
      summary.byFormat[ev.formatId].total += 1;
      if (ev.outcome === 'rejected') summary.byFormat[ev.formatId].rejected += 1;
    }
    const mode = ev.gameMode || 'local';
    if (!summary.byGameMode[mode]) summary.byGameMode[mode] = { total: 0, rejected: 0 };
    summary.byGameMode[mode].total += 1;
    if (ev.outcome === 'rejected' || ev.outcome === 'parse_error' || ev.outcome === 'api_error') {
      summary.byGameMode[mode].rejected += 1;
    }
    accumulateSource(summary, ev);
    accumulateProvider(summary, ev);
    accumulateModel(summary, ev);
    accumulateAttempt(summary, ev);
  }

  return finalizeSummaryRates(summary);
}

function sumByBucket(byBucket) {
  return Object.values(byBucket || {}).reduce((sum, value) => sum + value, 0);
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

function buildStackedDailySeries(byDayByBucket, days = 14) {
  const daily = [];
  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(end.getTime() - i * 86400000);
    const key = d.toISOString().slice(0, 10);
    const byIssue = byDayByBucket[key] || {};
    daily.push({ key, byIssue, count: sumByBucket(byIssue) });
  }
  return daily;
}

function buildStackedHourlySeries(byHourByBucket, hours = 24) {
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
    const byIssue = byHourByBucket[key] || {};
    series.push({ key, byIssue, count: sumByBucket(byIssue) });
  }
  return series;
}

function computeTimelineFromItems(items) {
  const byDay = {};
  const byHour = {};
  const byDayByOutcome = {};
  const byHourByOutcome = {};

  for (const ev of items) {
    const ts = Number(ev.ts);
    if (!Number.isFinite(ts) || ts <= 0) continue;
    const day = new Date(ts).toISOString().slice(0, 10);
    const hour = new Date(ts).toISOString().slice(0, 13);
    byDay[day] = (byDay[day] || 0) + 1;
    byHour[hour] = (byHour[hour] || 0) + 1;
    const outcome = ev.outcome || 'unknown';
    if (!byDayByOutcome[day]) byDayByOutcome[day] = {};
    if (!byHourByOutcome[hour]) byHourByOutcome[hour] = {};
    byDayByOutcome[day][outcome] = (byDayByOutcome[day][outcome] || 0) + 1;
    byHourByOutcome[hour][outcome] = (byHourByOutcome[hour][outcome] || 0) + 1;
  }

  return {
    timelineSeries: {
      '24h': buildHourlySeries(byHour, 24),
      '3d': buildHourlySeries(byHour, 72),
      '7d': buildDailySeries(byDay, 7),
      '14d': buildDailySeries(byDay, 14),
    },
    timelineStacked: {
      '24h': buildStackedHourlySeries(byHourByOutcome, 24),
      '3d': buildStackedHourlySeries(byHourByOutcome, 72),
      '7d': buildStackedDailySeries(byDayByOutcome, 7),
      '14d': buildStackedDailySeries(byDayByOutcome, 14),
    },
  };
}

async function recordEvent(payload) {
  const normalized = normalizeEvent(payload);
  const inserted = await supabaseRequest(`/${TABLE}`, {
    method: 'POST',
    body: JSON.stringify(eventToRow(normalized)),
    headers: { Prefer: 'return=representation' },
  });
  const id = Array.isArray(inserted) && inserted[0]?.id
    ? inserted[0].id
    : null;
  try {
    await supabaseRpc('trim_gen_telemetry_events', { p_max: MAX_EVENTS });
  } catch (err) {
    console.warn('[gen-telemetry-store] trim failed:', err.message || err);
  }
  return { id, event: normalized };
}

async function fetchEventItems(filters = {}) {
  const gameMode = filters.gameMode && VALID_GAME_MODES.has(String(filters.gameMode))
    ? String(filters.gameMode)
    : '';
  const params = new URLSearchParams({
    select: 'id,event_ts,outcome,category,format_id,age_band_key,difficulty,game_mode,source,issue_codes,issue_messages,provider,model,attempt',
    order: 'created_at.desc',
    limit: String(MAX_EVENTS),
  });
  if (gameMode) params.set('game_mode', `eq.${gameMode}`);
  const rows = await supabaseRequest(`/${TABLE}?${params.toString()}`);
  return (rows || []).map(rowToItem);
}

async function getStats(_event, filters = {}) {
  const items = await fetchEventItems(filters);
  return {
    ...computeSummaryFromItems(items),
    ...computeTimelineFromItems(items),
  };
}

async function clearAll() {
  try {
    const cleared = await supabaseRpc('clear_gen_telemetry_events');
    return { cleared: Number(cleared) || 0 };
  } catch (rpcErr) {
    console.warn('[gen-telemetry-store] RPC clear_gen_telemetry_events indisponível, fallback REST:', rpcErr.message);
    const cfg = getSupabaseAdmin();
    if (!cfg) throw rpcErr;

    const response = await fetch(`${cfg.url}/rest/v1/${TABLE}?event_ts=gte.0`, {
      method: 'DELETE',
      headers: {
        apikey: cfg.key,
        Authorization: `Bearer ${cfg.key}`,
        Prefer: 'count=exact',
      },
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      const err = new Error(text || `Supabase DELETE HTTP ${response.status}`);
      err.status = response.status;
      throw err;
    }

    const range = response.headers.get('content-range') || '';
    const match = range.match(/\/(\d+)$/);
    return { cleared: match ? Number(match[1]) : 0, fallback: true };
  }
}

module.exports = {
  MAX_EVENTS,
  normalizeEvent,
  recordEvent,
  getStats,
  clearAll,
  computeSummaryFromItems,
  computeTimelineFromItems,
  finalizeSummaryRates,
  accumulateSource,
  isRepoSource,
  repoAcceptedCount,
};
