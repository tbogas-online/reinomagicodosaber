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
      summary.byIssueDetail[code] = { count: 0, sampleMessage: msg };
    }
    summary.byIssueDetail[code].count += 1;
    if (msg && !summary.byIssueDetail[code].sampleMessage) {
      summary.byIssueDetail[code].sampleMessage = msg;
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
    issueCodes: Array.isArray(row.issue_codes) ? row.issue_codes : [],
    issueMessages: Array.isArray(row.issue_messages) ? row.issue_messages : [],
    provider: row.provider || '',
  };
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
    rejectionRate: 0,
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
  }

  const failures = summary.rejected + summary.parseErrors + summary.apiErrors;
  summary.rejectionRate = summary.total ? failures / summary.total : 0;
  return summary;
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
    select: 'id,event_ts,outcome,category,format_id,age_band_key,game_mode,issue_codes,issue_messages,provider',
    order: 'created_at.desc',
    limit: String(MAX_EVENTS),
  });
  if (gameMode) params.set('game_mode', `eq.${gameMode}`);
  const rows = await supabaseRequest(`/${TABLE}?${params.toString()}`);
  return (rows || []).map(rowToItem);
}

async function getStats(_event, filters = {}) {
  const items = await fetchEventItems(filters);
  return computeSummaryFromItems(items);
}

async function clearAll() {
  const cleared = await supabaseRpc('clear_gen_telemetry_events');
  return { cleared: Number(cleared) || 0 };
}

module.exports = {
  MAX_EVENTS,
  normalizeEvent,
  recordEvent,
  getStats,
  clearAll,
  computeSummaryFromItems,
};
