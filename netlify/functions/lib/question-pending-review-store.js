const { getSupabaseAdmin } = require('./rooms-store');
const { applyReportCorrectionToBank, hashQuestionKey } = require('./question-bank-store');
const { normalizeCategoryNs, normalizeAgeBands } = require('./question-taxonomy');

const TABLE = 'question_pending_review';
const TELEMETRY_TABLE = 'gen_telemetry_events';

const DIFFICULTY_MISMATCH_CODES = new Set([
  'DIFFICULTY_EASIER_THAN_REQUESTED',
  'DIFFICULTY_HARDER_THAN_REQUESTED',
  'DIFFICULTY_OUT_OF_RANGE',
]);

function stripTags(str) {
  return String(str || '').replace(/<[^>]*>/g, '').trim();
}

function isDifficultyOnlyCodes(codes) {
  const list = (Array.isArray(codes) ? codes : [])
    .map((c) => String(c || '').trim())
    .filter(Boolean);
  return list.length > 0 && list.every((c) => DIFFICULTY_MISMATCH_CODES.has(c));
}

function parseEstimatedDifficultyFromMessages(messages) {
  const text = (Array.isArray(messages) ? messages : []).join(' ');
  const m = text.match(/estimada\s+(\d)/i);
  return m ? Number(m[1]) : null;
}

async function queuePendingReviewEntry(meta = {}) {
  const question = stripTags(meta.question);
  const answer = stripTags(meta.correctAnswer);
  const questionHash = String(meta.questionHash || '').trim()
    || (question && answer ? hashQuestionKey(`${question}|${answer}`) : '');
  if (!questionHash || !question || !answer) {
    return { ok: false, reason: 'missing_content' };
  }
  const issueCodes = Array.isArray(meta.issueCodes)
    ? meta.issueCodes.map((c) => String(c || '').trim()).filter(Boolean)
    : [];
  return supabaseRpc('queue_question_pending_review', {
    p_question_hash: questionHash,
    p_category_n: meta.categoryN != null ? Number(meta.categoryN) : null,
    p_age_band: meta.ageBand || null,
    p_question: question,
    p_correct_answer: answer,
    p_options: meta.options || null,
    p_format_id: meta.format || meta.formatId || null,
    p_requested_difficulty: meta.requestedDifficulty != null
      ? Math.round(Number(meta.requestedDifficulty))
      : null,
    p_estimated_difficulty: meta.estimatedDifficulty != null
      ? Math.round(Number(meta.estimatedDifficulty))
      : null,
    p_issue_codes: issueCodes,
    p_knowledge_key: meta.knowledgeKey || null,
    p_knowledge_id: meta.knowledgeId || null,
    p_source: meta.source || 'difficulty-mismatch',
    p_source_id: meta.sourceId || null,
    p_confidence: meta.confidence ?? null,
    p_game_mode: meta.gameMode || 'local',
  });
}

async function fetchReviewedQuestionHashes() {
  const rows = await supabaseRequest(
    `/${TABLE}?status=in.(accepted,dismissed)&select=question_hash&limit=5000`,
    { prefer: 'return=representation' },
  ).catch(() => []);
  return new Set(
    (Array.isArray(rows) ? rows : [])
      .map((row) => String(row.question_hash || '').trim())
      .filter(Boolean),
  );
}

async function syncPendingReviewFromTelemetry({ limit = 300, days = 90 } = {}) {
  const capped = Math.min(Math.max(Number(limit) || 300, 1), 1000);
  const dayCount = Math.min(Math.max(Number(days) || 90, 1), 365);
  const sinceIso = new Date(Date.now() - dayCount * 24 * 60 * 60 * 1000).toISOString();

  const params = new URLSearchParams({
    select: 'category,format_id,age_band_key,difficulty,game_mode,source,issue_codes,issue_messages,question_text,answer_text,question_options',
    outcome: 'eq.rejected',
    created_at: `gte.${sinceIso}`,
    question_text: 'not.is.null',
    answer_text: 'not.is.null',
    order: 'created_at.desc',
    limit: String(capped),
  });

  const [rows, reviewedHashes] = await Promise.all([
    supabaseRequest(`/${TELEMETRY_TABLE}?${params.toString()}`),
    fetchReviewedQuestionHashes(),
  ]);
  const list = Array.isArray(rows) ? rows : [];

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let alreadyReviewed = 0;
  const seen = new Set();

  for (const row of list) {
    const codes = row.issue_codes || [];
    if (!isDifficultyOnlyCodes(codes)) {
      skipped += 1;
      continue;
    }
    const question = stripTags(row.question_text);
    const answer = stripTags(row.answer_text);
    if (!question || !answer) {
      skipped += 1;
      continue;
    }
    const hash = hashQuestionKey(`${question}|${answer}`);
    if (reviewedHashes.has(hash)) {
      alreadyReviewed += 1;
      continue;
    }
    if (seen.has(hash)) {
      skipped += 1;
      continue;
    }
    seen.add(hash);

    const estimated = parseEstimatedDifficultyFromMessages(row.issue_messages)
      ?? (Number.isFinite(Number(row.difficulty)) ? Number(row.difficulty) : null);

    let result;
    try {
      result = await queuePendingReviewEntry({
        categoryN: row.category,
        ageBand: row.age_band_key,
        question,
        correctAnswer: answer,
        options: Array.isArray(row.question_options) ? row.question_options : null,
        format: row.format_id,
        questionHash: hash,
        requestedDifficulty: row.difficulty,
        estimatedDifficulty: estimated,
        issueCodes: codes,
        source: 'telemetry-import',
        gameMode: row.game_mode,
      });
    } catch {
      skipped += 1;
      continue;
    }

    const reason = String(result?.reason || '');
    if (reason === 'inserted') inserted += 1;
    else if (reason === 'updated') updated += 1;
    else if (reason === 'already_reviewed') alreadyReviewed += 1;
    else skipped += 1;
  }

  return {
    scanned: list.length,
    inserted,
    updated,
    skipped,
    alreadyReviewed,
    candidates: seen.size,
  };
}

async function supabaseRequest(path, options = {}) {
  const cfg = getSupabaseAdmin();
  if (!cfg) {
    const err = new Error('Supabase admin não configurado.');
    err.code = 'NOT_CONFIGURED';
    throw err;
  }
  const response = await fetch(`${cfg.url}/rest/v1${path}`, {
    ...options,
    headers: {
      apikey: cfg.key,
      Authorization: `Bearer ${cfg.key}`,
      'Content-Type': 'application/json',
      Prefer: options.prefer || 'return=representation',
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    const text = await response.text();
    const err = new Error(text || `Supabase HTTP ${response.status}`);
    err.status = response.status;
    throw err;
  }
  const text = await response.text();
  if (!text) return null;
  return JSON.parse(text);
}

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
    const text = await response.text();
    const err = new Error(text || `Supabase RPC HTTP ${response.status}`);
    err.status = response.status;
    throw err;
  }
  const text = await response.text();
  if (!text) return null;
  return JSON.parse(text);
}

function rowToItem(row) {
  if (!row) return null;
  return {
    id: row.id,
    createdAt: row.created_at,
    status: row.status,
    reviewedAt: row.reviewed_at,
    questionHash: row.question_hash,
    categoryN: row.category_n,
    ageBand: row.age_band || '',
    formatId: row.format_id || '',
    requestedDifficulty: row.requested_difficulty,
    estimatedDifficulty: row.estimated_difficulty,
    question: row.question || '',
    correctAnswer: row.correct_answer || '',
    options: Array.isArray(row.options) ? row.options : [],
    issueCodes: Array.isArray(row.issue_codes) ? row.issue_codes : [],
    knowledgeKey: row.knowledge_key || '',
    knowledgeId: row.knowledge_id || '',
    source: row.source || '',
    sourceId: row.source_id || '',
    confidence: row.confidence,
    gameMode: row.game_mode || 'local',
  };
}

async function getPendingReviewStats() {
  try {
    const data = await supabaseRpc('get_question_pending_review_stats');
    if (!data || typeof data !== 'object') return { available: false };
    return {
      available: data.available !== false,
      pending: Number(data.pending) || 0,
      accepted: Number(data.accepted) || 0,
      dismissed: Number(data.dismissed) || 0,
      queuedLast7d: Number(data.queuedLast7d) || 0,
      acceptedLast7d: Number(data.acceptedLast7d) || 0,
      dismissedLast7d: Number(data.dismissedLast7d) || 0,
    };
  } catch (err) {
    const msg = String(err?.message || '');
    if (msg.includes('get_question_pending_review_stats')
      || msg.includes('question_pending_review')
      || msg.includes('PGRST202')
      || msg.includes('PGRST205')) {
      return { available: false };
    }
    throw err;
  }
}

async function countBankRowsWithDifficulty() {
  const cfg = getSupabaseAdmin();
  if (!cfg) return null;
  try {
    const response = await fetch(`${cfg.url}/rest/v1/question_bank?difficulty=not.is.null&select=id`, {
      method: 'HEAD',
      headers: {
        apikey: cfg.key,
        Authorization: `Bearer ${cfg.key}`,
        Prefer: 'count=exact',
      },
    });
    if (!response.ok) return null;
    const range = response.headers.get('content-range') || '';
    const total = Number(range.split('/')[1]);
    return Number.isFinite(total) ? total : null;
  } catch {
    return null;
  }
}

async function resolvePendingReviewOnBankSave({
  questionHash,
  previousHash,
  question,
  answer,
  status = 'accepted',
} = {}) {
  const hashes = new Set();
  for (const h of [questionHash, previousHash]) {
    const trimmed = String(h || '').trim();
    if (trimmed) hashes.add(trimmed);
  }
  const q = String(question || '').trim();
  const a = String(answer || '').trim();
  if (q && a) hashes.add(hashQuestionKey(`${q}|${a}`));
  if (!hashes.size) return { resolved: 0 };

  const now = new Date().toISOString();
  let resolved = 0;
  for (const hash of hashes) {
    const rows = await supabaseRequest(
      `/${TABLE}?question_hash=eq.${encodeURIComponent(hash)}&status=eq.pending&select=id`,
      { prefer: 'return=representation' },
    ).catch(() => []);
    if (!Array.isArray(rows) || !rows.length) continue;
    await supabaseRequest(
      `/${TABLE}?question_hash=eq.${encodeURIComponent(hash)}&status=eq.pending`,
      {
        method: 'PATCH',
        body: JSON.stringify({ status, reviewed_at: now }),
        prefer: 'return=minimal',
      },
    );
    resolved += rows.length;
  }
  return { resolved };
}

async function listPendingReview({ limit = 50, status = 'pending' } = {}) {
  const capped = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const statusVal = String(status || 'pending').trim() || 'pending';
  const rows = await supabaseRequest(
    `/${TABLE}?status=eq.${encodeURIComponent(statusVal)}&order=created_at.desc&limit=${capped}`,
    { prefer: 'return=representation' },
  );
  const items = Array.isArray(rows) ? rows.map(rowToItem).filter(Boolean) : [];
  const stats = await getPendingReviewStats().catch(() => ({ available: false }));
  return {
    items,
    total: items.length,
    status: statusVal,
    stats,
  };
}

async function updatePendingReviewStatus(id, status) {
  const rowId = String(id || '').trim();
  if (!rowId) {
    const err = new Error('ID em falta.');
    err.code = 'MISSING_ID';
    throw err;
  }
  const now = new Date().toISOString();
  const rows = await supabaseRequest(`/${TABLE}?id=eq.${encodeURIComponent(rowId)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      status,
      reviewed_at: now,
    }),
    prefer: 'return=representation',
  });
  return rowToItem(Array.isArray(rows) ? rows[0] : null);
}

async function getPendingReviewById(id) {
  const rowId = String(id || '').trim();
  if (!rowId) return null;
  const rows = await supabaseRequest(
    `/${TABLE}?id=eq.${encodeURIComponent(rowId)}&limit=1`,
    { prefer: 'return=representation' },
  );
  return rowToItem(Array.isArray(rows) ? rows[0] : null);
}

async function acceptPendingReview(id, correction = {}, meta = {}) {
  const row = await getPendingReviewById(id);
  if (!row) {
    const err = new Error('Entrada não encontrada na fila.');
    err.code = 'NOT_FOUND';
    throw err;
  }
  if (row.status !== 'pending') {
    const err = new Error('Esta entrada já foi revista.');
    err.code = 'ALREADY_REVIEWED';
    throw err;
  }

  const question = String(correction.question || row.question || '').trim();
  const answer = String(correction.answer || row.correctAnswer || '').trim();
  const options = Array.isArray(correction.options) && correction.options.length
    ? correction.options
    : row.options;
  const difficulty = correction.difficulty != null
    ? correction.difficulty
    : (row.estimatedDifficulty ?? row.requestedDifficulty);
  const difficultyByAgeBand = correction.difficultyByAgeBand || meta.difficultyByAgeBand || null;

  const categoryN = Number(meta.categoryN ?? row.categoryN);
  const ageBand = String(meta.ageBand || row.ageBand || '').trim();
  const categoryNs = normalizeCategoryNs(meta.categoryNs, meta.categoryN ?? row.categoryN, null);
  const ageBands = normalizeAgeBands(meta.ageBands, meta.ageBand ?? row.ageBand, null);

  const bankResult = await applyReportCorrectionToBank(row.questionHash, {
    question,
    answer,
    options,
    format: correction.format || row.formatId || (options?.length >= 2 ? 'ESCOLHA_MULTIPLA' : undefined),
  }, {
    categoryNs: categoryNs.length ? categoryNs : (categoryN ? [categoryN] : []),
    ageBands: ageBands.length ? ageBands : (ageBand ? [ageBand] : []),
    categoryN,
    ageBand,
    difficulty,
    difficultyByAgeBand,
    knowledgeId: meta.knowledgeId || row.knowledgeId || null,
    source: meta.source || 'pending-review',
  });

  await updatePendingReviewStatus(id, 'accepted');
  return { row, bankResult };
}

async function dismissPendingReview(id) {
  const row = await getPendingReviewById(id);
  if (!row) {
    const err = new Error('Entrada não encontrada na fila.');
    err.code = 'NOT_FOUND';
    throw err;
  }
  if (row.status !== 'pending') {
    const err = new Error('Esta entrada já foi revista.');
    err.code = 'ALREADY_REVIEWED';
    throw err;
  }
  const updated = await updatePendingReviewStatus(id, 'dismissed');
  return { row: updated };
}

module.exports = {
  DIFFICULTY_MISMATCH_CODES,
  isDifficultyOnlyCodes,
  getPendingReviewStats,
  countBankRowsWithDifficulty,
  queuePendingReviewEntry,
  syncPendingReviewFromTelemetry,
  resolvePendingReviewOnBankSave,
  listPendingReview,
  acceptPendingReview,
  dismissPendingReview,
};
