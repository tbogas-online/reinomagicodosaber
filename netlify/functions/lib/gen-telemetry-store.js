const { connectLambda, getStore } = require('@netlify/blobs');

const STORE_NAME = 'gen-telemetry';
const INDEX_KEY = 'events-index';
const MAX_EVENTS = 10000;

const VALID_OUTCOMES = new Set(['accepted', 'rejected', 'parse_error', 'api_error', 'unknown']);
const VALID_GAME_MODES = new Set(['local', 'multiplayer', 'test']);

function clip(value, max) {
  return String(value || '').trim().slice(0, max);
}

function getTelemetryStore(event) {
  connectLambda(event);
  return getStore(STORE_NAME);
}

async function readIndex(store) {
  try {
    const index = await store.get(INDEX_KEY, { type: 'json' });
    return index && Array.isArray(index.items) ? index : { items: [], total: 0 };
  } catch (err) {
    console.error('[gen-telemetry-store] readIndex failed:', err);
    return { items: [], total: 0 };
  }
}

function normalizeEvent(raw) {
  const e = raw && typeof raw === 'object' ? raw : {};
  const outcome = VALID_OUTCOMES.has(String(e.outcome)) ? String(e.outcome) : 'unknown';
  const gameMode = VALID_GAME_MODES.has(String(e.gameMode)) ? String(e.gameMode) : 'local';
  const issueCodes = Array.isArray(e.issueCodes)
    ? e.issueCodes.map((c) => clip(c, 48)).filter(Boolean).slice(0, 12)
    : [];
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
    provider: clip(e.provider, 24),
    model: clip(e.model, 48),
    score: e.score != null ? Number(e.score) : null,
    source: clip(e.source, 16) || 'ai',
    gameMode,
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

async function recordEvent(payload, event) {
  const normalized = normalizeEvent(payload);
  const store = getTelemetryStore(event);
  const id = `evt-${normalized.ts}-${Math.random().toString(36).slice(2, 10)}`;
  await store.setJSON(`event:${id}`, normalized);

  const index = await readIndex(store);
  index.items.push({
    id,
    ts: normalized.ts,
    outcome: normalized.outcome,
    category: normalized.category,
    formatId: normalized.formatId,
    ageBandKey: normalized.ageBandKey,
    gameMode: normalized.gameMode,
    issueCodes: normalized.issueCodes,
    provider: normalized.provider,
  });
  if (index.items.length > MAX_EVENTS) {
    const removed = index.items.splice(0, index.items.length - MAX_EVENTS);
    await Promise.all(removed.map((item) => store.delete(`event:${item.id}`).catch(() => {})));
  }
  index.total = index.items.length;
  await store.setJSON(INDEX_KEY, index);
  return { id, event: normalized };
}

async function getStats(event) {
  const store = getTelemetryStore(event);
  const index = await readIndex(store);
  return computeSummaryFromItems(index.items);
}

async function clearAll(event) {
  const store = getTelemetryStore(event);
  const index = await readIndex(store);
  await Promise.all(index.items.map((item) => store.delete(`event:${item.id}`).catch(() => {})));
  await store.setJSON(INDEX_KEY, { items: [], total: 0 });
  return { cleared: index.items.length };
}

module.exports = {
  MAX_EVENTS,
  normalizeEvent,
  recordEvent,
  getStats,
  clearAll,
  computeSummaryFromItems,
};
