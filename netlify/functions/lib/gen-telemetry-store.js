const { getSupabaseAdmin } = require('./rooms-store');
const {
  toLisbonDayKey,
  toLisbonHourKey,
  buildDailySeries,
  buildHourlySeries,
  buildStackedDailySeries,
  buildStackedHourlySeries,
} = require('./lisbon-time');
const {
  enrichSummaryWithCategoryDelivery,
  enrichSummaryWithProviderInsights,
  isAiProviderTelemetryEvent,
} = require('../../../scripts/lib/gen-telemetry-metrics');

const MAX_EVENTS = 10000;
const TABLE = 'gen_telemetry_events';

const VALID_OUTCOMES = new Set(['accepted', 'rejected', 'parse_error', 'api_error', 'unknown']);
const VALID_GAME_MODES = new Set(['local', 'multiplayer', 'test']);

function clip(value, max) {
  return String(value || '').trim().slice(0, max);
}

const MAX_ISSUE_MESSAGES = 6;
const MAX_ISSUE_MESSAGE_LEN = 200;
const MAX_RECENT_ISSUE_OCCURRENCES = 10;
const MAX_QUESTION_LEN = 500;
const MAX_ANSWER_LEN = 200;
const MAX_OPTION_LEN = 120;
const MAX_OPTIONS = 6;

function clipIssueMessage(value) {
  return String(value || '').trim().slice(0, MAX_ISSUE_MESSAGE_LEN);
}

function stripTags(str) {
  return String(str || '').replace(/<[^>]*>/g, '').trim();
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

function normalizeTelemetryContent(question, answer) {
  const q = stripTags(question);
  const a = stripTags(answer);
  if (!q || !a) return null;
  return { q, a, hash: hashQuestionKey(`${q}|${a}`) };
}

function telemetryContentMatches(row, content) {
  if (!content || !row) return false;
  const rq = stripTags(row.question_text);
  const ra = stripTags(row.answer_text);
  if (!rq || !ra) return false;
  if (rq === content.q && ra === content.a) return true;
  if (content.hash) {
    return hashQuestionKey(`${rq}|${ra}`) === content.hash;
  }
  return false;
}

function telemetryHashFromSnapshot(snapshot) {
  if (!snapshot?.q || !snapshot?.a) return '';
  return hashQuestionKey(`${stripTags(snapshot.q)}|${stripTags(snapshot.a)}`);
}

function isMissingBankValidatedColumnError(msg) {
  const text = String(msg || '');
  return text.includes('bank_validated_at') || text.includes('42703');
}

function isMissingBankQuestionHashColumnError(msg) {
  const text = String(msg || '');
  return text.includes('bank_question_hash') || text.includes('PGRST204');
}

function isMissingBankValidatedSchemaError(msg) {
  return isMissingBankValidatedColumnError(msg) || isMissingBankQuestionHashColumnError(msg);
}

async function patchBankValidatedEvent(querySuffix, hash = '') {
  const now = new Date().toISOString();
  const path = `/${TABLE}?${querySuffix}`;
  const patchWithHash = { bank_validated_at: now };
  const trimmedHash = String(hash || '').trim();
  if (trimmedHash) patchWithHash.bank_question_hash = trimmedHash;
  const request = (body) => supabaseRequest(path, {
    method: 'PATCH',
    body: JSON.stringify(body),
    prefer: 'return=minimal',
  });
  try {
    await request(patchWithHash);
    return { ok: true };
  } catch (err) {
    const msg = String(err?.message || err);
    if (trimmedHash && isMissingBankQuestionHashColumnError(msg)) {
      try {
        await request({ bank_validated_at: now });
        return { ok: true, hashColumnMissing: true };
      } catch (retryErr) {
        const retryMsg = String(retryErr?.message || retryErr);
        if (isMissingBankValidatedColumnError(retryMsg)) {
          return { ok: false, skipped: 'column_missing' };
        }
        throw retryErr;
      }
    }
    if (isMissingBankValidatedColumnError(msg)) {
      return { ok: false, skipped: 'column_missing' };
    }
    throw err;
  }
}

async function fetchExistingBankHashes(hashes) {
  const list = [...new Set((hashes || []).map((h) => String(h || '').trim()).filter(Boolean))];
  if (!list.length) return new Set();
  const found = new Set();
  const chunkSize = 80;
  for (let i = 0; i < list.length; i += chunkSize) {
    const chunk = list.slice(i, i + chunkSize);
    const params = new URLSearchParams({
      select: 'question_hash',
      question_hash: `in.(${chunk.map((h) => encodeURIComponent(h)).join(',')})`,
      limit: String(chunk.length),
    });
    try {
      const rows = await supabaseRequest(`/question_bank?${params.toString()}`);
      (Array.isArray(rows) ? rows : []).forEach((row) => {
        const hash = String(row.question_hash || '').trim();
        if (hash) found.add(hash);
      });
    } catch (err) {
      console.warn('[gen-telemetry-store] fetch bank hashes:', err?.message || err);
      break;
    }
  }
  return found;
}

async function backfillBankValidatedRows(entries) {
  const cfg = getSupabaseAdmin();
  if (!cfg || !entries?.length) return { marked: 0 };
  let marked = 0;
  for (const entry of entries) {
    const id = String(entry?.id || '').trim();
    if (!id) continue;
    const hash = String(entry.hash || '').trim();
    try {
      const result = await patchBankValidatedEvent(
        `id=eq.${encodeURIComponent(id)}&outcome=eq.rejected&bank_validated_at=is.null`,
        hash,
      );
      if (result.skipped === 'column_missing') {
        return { marked, skipped: 'column_missing' };
      }
      if (result.ok) marked += 1;
    } catch (err) {
      console.warn('[gen-telemetry-store] backfill bank validated:', err?.message || err);
    }
  }
  return { marked };
}

async function enrichItemsWithBankValidation(items) {
  const list = Array.isArray(items) ? items : [];
  const pending = list.filter((ev) => ev.outcome === 'rejected'
    && !ev.bankValidatedAt
    && ev.questionSnapshot?.q
    && ev.questionSnapshot?.a);
  if (!pending.length) return list;

  const hashByEventId = new Map();
  const hashSet = new Set();
  pending.forEach((ev) => {
    const hash = telemetryHashFromSnapshot(ev.questionSnapshot);
    if (!hash) return;
    hashByEventId.set(ev.id, hash);
    hashSet.add(hash);
  });
  if (!hashSet.size) return list;

  const inBank = await fetchExistingBankHashes([...hashSet]);
  if (!inBank.size) return list;

  const now = new Date().toISOString();
  const toBackfill = [];
  pending.forEach((ev) => {
    const hash = hashByEventId.get(ev.id);
    if (!hash || !inBank.has(hash)) return;
    ev.bankValidatedAt = now;
    ev.bankQuestionHash = hash;
    toBackfill.push({ id: ev.id, hash });
  });

  if (toBackfill.length) {
    backfillBankValidatedRows(toBackfill).catch((err) => {
      console.warn('[gen-telemetry-store] backfill bank validated:', err?.message || err);
    });
  }
  return list;
}

function normalizeQuestionSnapshot(raw) {
  const src = raw?.questionSnapshot && typeof raw.questionSnapshot === 'object'
    ? raw.questionSnapshot
    : raw?.parsed && typeof raw.parsed === 'object'
      ? raw.parsed
      : null;
  if (!src) return null;
  const q = String(src.q || '').trim().slice(0, MAX_QUESTION_LEN);
  const a = String(src.a || '').trim().slice(0, MAX_ANSWER_LEN);
  const options = Array.isArray(src.options)
    ? src.options.map((o) => String(o || '').trim().slice(0, MAX_OPTION_LEN)).filter(Boolean).slice(0, MAX_OPTIONS)
    : [];
  if (!q && !a) return null;
  return { q, a, options };
}

function normalizeIssueMessages(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((m) => clipIssueMessage(m)).filter(Boolean).slice(0, MAX_ISSUE_MESSAGES);
}

function pushIssueOccurrence(entry, occurrence) {
  if (!entry.recentOccurrences) entry.recentOccurrences = [];
  entry.recentOccurrences.push(occurrence);
  entry.recentOccurrences.sort((a, b) => (Number(b.ts) || 0) - (Number(a.ts) || 0));
  if (entry.recentOccurrences.length > MAX_RECENT_ISSUE_OCCURRENCES) {
    entry.recentOccurrences.length = MAX_RECENT_ISSUE_OCCURRENCES;
  }
  if (!entry.lastOccurrence || occurrence.ts >= entry.lastOccurrence.ts) {
    entry.lastOccurrence = occurrence;
  }
}

function accumulateIssueDetail(summary, ev) {
  const codes = ev.issueCodes || [];
  const messages = ev.issueMessages || [];
  for (let i = 0; i < codes.length; i += 1) {
    const code = codes[i];
    const msg = messages[i] || messages[0] || '';
    if (!summary.byIssueDetail[code]) {
      summary.byIssueDetail[code] = {
        count: 0,
        validatedCount: 0,
        sampleMessage: msg,
        lastOccurrence: null,
        recentOccurrences: [],
      };
    }
    const entry = summary.byIssueDetail[code];
    entry.count += 1;
    if (ev.bankValidatedAt) {
      entry.validatedCount = (entry.validatedCount || 0) + 1;
    }
    if (msg && !entry.sampleMessage) {
      entry.sampleMessage = msg;
    }
    const occurrence = {
      eventId: ev.id || null,
      ts: Number(ev.ts) || Date.now(),
      message: clipIssueMessage(msg),
      outcome: ev.outcome || '',
      source: clip(ev.source, 16) || 'ai',
      score: ev.score != null ? Number(ev.score) : null,
      category: ev.category != null ? Number(ev.category) : null,
      formatId: clip(ev.formatId, 32) || '',
      ageBandKey: clip(ev.ageBandKey, 12) || '',
      gameMode: ev.gameMode || 'local',
      provider: clip(ev.provider, 24) || '',
      model: clip(ev.model, 48) || '',
      difficulty: ev.difficulty != null ? Number(ev.difficulty) : null,
      attempt: ev.attempt != null ? Number(ev.attempt) : null,
      questionSnapshot: ev.questionSnapshot || null,
      bankValidatedAt: ev.bankValidatedAt || null,
      bankQuestionHash: ev.bankQuestionHash || null,
    };
    pushIssueOccurrence(entry, occurrence);
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
  const questionSnapshot = normalizeQuestionSnapshot(e);
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
    questionSnapshot,
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
    question_text: normalized.questionSnapshot?.q || null,
    answer_text: normalized.questionSnapshot?.a || null,
    question_options: normalized.questionSnapshot?.options?.length
      ? normalized.questionSnapshot.options
      : [],
    provider: normalized.provider || null,
    model: normalized.model || null,
    score: normalized.score != null ? Math.round(normalized.score) : null,
    source: normalized.source,
    game_mode: normalized.gameMode,
  };
}

function rowToItem(row) {
  const questionSnapshot = (row.question_text || row.answer_text)
    ? {
      q: row.question_text || '',
      a: row.answer_text || '',
      options: Array.isArray(row.question_options) ? row.question_options : [],
    }
    : null;
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
    questionSnapshot,
    bankValidatedAt: row.bank_validated_at || null,
    bankQuestionHash: row.bank_question_hash || null,
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
  if (!prov || !isAiProviderTelemetryEvent(ev)) return;
  if (!summary.byProvider[prov]) {
    summary.byProvider[prov] = {
      total: 0,
      accepted: 0,
      rejected: 0,
      parseErrors: 0,
      apiErrors: 0,
      attemptSum: 0,
      attemptCount: 0,
    };
  }
  const bucket = summary.byProvider[prov];
  bucket.total += 1;
  if (ev.outcome === 'accepted') bucket.accepted += 1;
  else if (ev.outcome === 'rejected') bucket.rejected += 1;
  else if (ev.outcome === 'parse_error') bucket.parseErrors += 1;
  else if (ev.outcome === 'api_error') bucket.apiErrors += 1;
  if (ev.attempt != null && (ev.outcome === 'accepted' || ev.outcome === 'rejected' || ev.outcome === 'parse_error')) {
    bucket.attemptSum += ev.attempt;
    bucket.attemptCount += 1;
  }
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
    validatedInBank: 0,
  };

  for (const ev of items) {
    if (ev.outcome === 'accepted') summary.accepted += 1;
    else if (ev.outcome === 'rejected') summary.rejected += 1;
    else if (ev.outcome === 'parse_error') summary.parseErrors += 1;
    else if (ev.outcome === 'api_error') summary.apiErrors += 1;
    if (ev.bankValidatedAt) summary.validatedInBank += 1;

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

  return enrichSummaryWithProviderInsights(
    enrichSummaryWithCategoryDelivery(finalizeSummaryRates(summary), items),
  );
}

function sumByBucket(byBucket) {
  return Object.values(byBucket || {}).reduce((sum, value) => sum + value, 0);
}

function computeTimelineFromItems(items) {
  const byDay = {};
  const byHour = {};
  const byDayByOutcome = {};
  const byHourByOutcome = {};

  for (const ev of items) {
    const ts = Number(ev.ts);
    if (!Number.isFinite(ts) || ts <= 0) continue;
    const day = toLisbonDayKey(new Date(ts));
    const hour = toLisbonHourKey(new Date(ts));
    if (!day || !hour) continue;
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
      '24h': buildStackedHourlySeries(byHourByOutcome, 24, sumByBucket),
      '3d': buildStackedHourlySeries(byHourByOutcome, 72, sumByBucket),
      '7d': buildStackedDailySeries(byDayByOutcome, 7, sumByBucket),
      '14d': buildStackedDailySeries(byDayByOutcome, 14, sumByBucket),
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
  const baseSelect = 'id,event_ts,outcome,category,format_id,age_band_key,difficulty,game_mode,source,issue_codes,issue_messages,question_text,answer_text,question_options,provider,model,attempt';
  const extendedSelect = `${baseSelect},bank_validated_at,bank_question_hash`;
  const params = new URLSearchParams({
    order: 'created_at.desc',
    limit: String(MAX_EVENTS),
  });
  if (gameMode) params.set('game_mode', `eq.${gameMode}`);

  let rows;
  try {
    params.set('select', extendedSelect);
    rows = await supabaseRequest(`/${TABLE}?${params.toString()}`);
  } catch (err) {
    const msg = String(err?.message || err);
    if (!isMissingBankValidatedSchemaError(msg)) {
      throw err;
    }
    params.set('select', baseSelect);
    rows = await supabaseRequest(`/${TABLE}?${params.toString()}`);
  }
  return (rows || []).map(rowToItem);
}

async function markTelemetryBankValidated({
  eventId = null,
  question = '',
  answer = '',
  questionHash = '',
} = {}) {
  const cfg = getSupabaseAdmin();
  if (!cfg) return { marked: 0, ids: [] };

  const content = normalizeTelemetryContent(question, answer);
  const hash = String(questionHash || '').trim() || content?.hash || '';

  const markedIds = [];

  const patchRows = async (ids) => {
    const unique = [...new Set((ids || []).map((id) => String(id || '').trim()).filter(Boolean))];
    if (!unique.length) return { skipped: null };
    for (const id of unique) {
      const result = await patchBankValidatedEvent(
        `id=eq.${encodeURIComponent(id)}&outcome=eq.rejected`,
        hash,
      );
      if (result.skipped === 'column_missing') {
        return { skipped: 'column_missing' };
      }
      if (result.ok) markedIds.push(id);
    }
    return { skipped: null };
  };

  const eventRowId = String(eventId || '').trim();
  if (eventRowId) {
    const result = await patchRows([eventRowId]);
    if (result.skipped === 'column_missing') {
      return { marked: 0, ids: [], skipped: 'column_missing' };
    }
    if (markedIds.length) return { marked: markedIds.length, ids: markedIds };
  }

  if (!content) return { marked: 0, ids: [] };

  if (hash) {
    try {
      const params = new URLSearchParams({
        select: 'id,question_text,answer_text,bank_validated_at',
        outcome: 'eq.rejected',
        bank_validated_at: 'is.null',
        question_text: 'not.is.null',
        answer_text: 'not.is.null',
        order: 'created_at.desc',
        limit: '800',
      });
      const rows = await supabaseRequest(`/${TABLE}?${params.toString()}`);
      const matches = (Array.isArray(rows) ? rows : []).filter((row) => {
        const rowHash = hashQuestionKey(`${stripTags(row.question_text)}|${stripTags(row.answer_text)}`);
        return rowHash === hash;
      });
      const patchResult = await patchRows(matches.map((row) => row.id));
      if (patchResult.skipped === 'column_missing') {
        return { marked: 0, ids: [], skipped: 'column_missing' };
      }
      if (markedIds.length) return { marked: markedIds.length, ids: markedIds };
    } catch (err) {
      const msg = String(err?.message || err);
      if (isMissingBankValidatedSchemaError(msg)) {
        return { marked: 0, ids: [], skipped: 'column_missing' };
      }
      throw err;
    }
  }

  try {
    const params = new URLSearchParams({
      select: 'id,question_text,answer_text,bank_validated_at',
      outcome: 'eq.rejected',
      bank_validated_at: 'is.null',
      question_text: 'not.is.null',
      answer_text: 'not.is.null',
      order: 'created_at.desc',
      limit: '800',
    });
    const rows = await supabaseRequest(`/${TABLE}?${params.toString()}`);
    const matches = (Array.isArray(rows) ? rows : []).filter((row) => telemetryContentMatches(row, content));
    const patchResult = await patchRows(matches.map((row) => row.id));
    if (patchResult.skipped === 'column_missing') {
      return { marked: 0, ids: [], skipped: 'column_missing' };
    }
    return { marked: markedIds.length, ids: markedIds };
  } catch (err) {
    const msg = String(err?.message || err);
    if (isMissingBankValidatedSchemaError(msg)) {
      return { marked: 0, ids: [], skipped: 'column_missing' };
    }
    throw err;
  }
}

async function getStats(_event, filters = {}) {
  const items = await enrichItemsWithBankValidation(await fetchEventItems(filters));
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
  normalizeQuestionSnapshot,
  recordEvent,
  getStats,
  clearAll,
  computeSummaryFromItems,
  computeTimelineFromItems,
  finalizeSummaryRates,
  accumulateSource,
  isRepoSource,
  repoAcceptedCount,
  markTelemetryBankValidated,
  enrichItemsWithBankValidation,
  telemetryHashFromSnapshot,
};
