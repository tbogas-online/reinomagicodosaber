'use strict';

const { getSupabaseAdmin } = require('./rooms-store');
const Learning = require('../../../public/question-engine/learning-engine.js');

const RESULTS_TABLE = 'question_test_results';
const RULES_TABLE = 'question_learning_rules';
const RESULT_LIMIT = 400;

function clip(value, max) {
  return String(value || '').trim().slice(0, max);
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
  if (!options.headers?.Prefer && options.method && options.method !== 'GET') {
    headers.Prefer = options.prefer || 'return=representation';
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

function isMissingTableError(err) {
  return /relation|does not exist|PGRST205|PGRST204/i.test(String(err?.message || ''));
}

function missingTableError() {
  const err = new Error('Tabelas de aprendizagem em falta — executa supabase/question-test-learning.sql.');
  err.status = 503;
  return err;
}

function rowToRule(row) {
  const evidence = Number(row.evidence) || 0;
  return {
    id: row.id,
    rule_key: row.rule_key,
    scope: row.scope || {},
    type: row.type,
    rule: row.rule_text || row.rule || '',
    confidence: Number(row.confidence) || 0,
    evidence,
    level: evidence >= Learning.HIGH_EVIDENCE ? 'high' : 'medium',
    active: row.active !== false,
    updatedAt: row.updated_at,
  };
}

function sanitizeResult(raw) {
  const item = Learning.toLearningInput(raw) || raw;
  if (!item || typeof item !== 'object') {
    const err = new Error('Resultado de teste inválido.');
    err.status = 400;
    throw err;
  }
  const input = item.input || {};
  const human = item.human || {};
  const generated = item.generated || {};
  if (!generated.question && !item.id) {
    const err = new Error('Falta a pergunta avaliada.');
    err.status = 400;
    throw err;
  }
  return {
    schemaVersion: Learning.SCHEMA_VERSION,
    id: clip(item.id || `q-${Date.now()}`, 80),
    evaluatedAt: item.evaluatedAt || new Date().toISOString(),
    sessionId: clip(item.sessionId || item.testSessionId, 80),
    tester: clip(item.tester, 80),
    engineVersion: clip(item.engineVersion, 40),
    input: {
      category: clip(input.category, 80),
      age: clip(input.age, 12),
      difficulty: input.difficulty ?? null,
      format: clip(input.format, 40),
      archetype: clip(input.archetype, 64),
    },
    generated: {
      question: clip(generated.question, 800),
      answer: clip(generated.answer, 240),
      options: Array.isArray(generated.options)
        ? generated.options.map((opt) => clip(opt, 240)).slice(0, 8)
        : [],
    },
    engine: item.engine || {},
    human: {
      verdict: Learning.normalizeVerdict(human.verdict, Learning.SCHEMA_VERSION),
      rating: human.rating ?? null,
      issues: Learning.normalizeIssues(human.issues),
      corrections: human.corrections || {},
      fieldErrors: Array.isArray(human.fieldErrors) ? human.fieldErrors.slice(0, 12) : [],
      layerScores: human.layerScores || {},
      applicableAges: human.applicableAges || [],
      extraCategories: (human.extraCategories || []).slice(0, 8),
      comment: clip(human.comment, 800),
    },
  };
}

async function listRecentPayloads(limit = RESULT_LIMIT) {
  try {
    const rows = await supabaseRequest(
      `/${RESULTS_TABLE}?select=payload&order=created_at.desc&limit=${Math.min(Number(limit) || RESULT_LIMIT, 800)}`,
    );
    return (rows || []).map((row) => row.payload).filter(Boolean);
  } catch (err) {
    if (isMissingTableError(err)) throw missingTableError();
    throw err;
  }
}

async function listActiveRules() {
  try {
    const rows = await supabaseRequest(
      `/${RULES_TABLE}?select=id,updated_at,rule_key,scope,type,rule_text,confidence,evidence,active&active=eq.true&order=confidence.desc&limit=200`,
    );
    return (rows || []).map(rowToRule);
  } catch (err) {
    if (isMissingTableError(err)) return [];
    throw err;
  }
}

async function insertResult(raw) {
  const result = sanitizeResult(raw);
  const row = {
    session_id: result.sessionId || null,
    tester: result.tester || null,
    engine_version: result.engineVersion || null,
    result_id: result.id,
    category: result.input.category || null,
    age_band_key: result.input.age || null,
    format_id: result.input.format || null,
    rating: result.human.rating,
    verdict: result.human.verdict || null,
    issues: result.human.issues || [],
    payload: result,
  };
  try {
    const inserted = await supabaseRequest(`/${RESULTS_TABLE}`, {
      method: 'POST',
      body: JSON.stringify(row),
    });
    const saved = Array.isArray(inserted) ? inserted[0] : inserted;
    return { row: saved, result };
  } catch (err) {
    if (isMissingTableError(err)) throw missingTableError();
    throw err;
  }
}

async function upsertRules(rules) {
  if (!rules.length) return [];
  const rows = rules.map((rule) => ({
    rule_key: clip(rule.rule_key, 180),
    scope: rule.scope || {},
    type: clip(rule.type, 40),
    rule_text: clip(rule.rule, 400),
    confidence: Number(rule.confidence) || 0,
    evidence: Number(rule.evidence) || 0,
    active: true,
    updated_at: new Date().toISOString(),
  }));
  try {
    await supabaseRequest(`/${RULES_TABLE}?on_conflict=rule_key`, {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(rows),
    });
  } catch (err) {
    if (isMissingTableError(err)) throw missingTableError();
    throw err;
  }
  return rows;
}

async function deactivateMissingRules(keepKeys) {
  const active = await listActiveRules();
  const keep = new Set(keepKeys);
  const stale = active.filter((rule) => !keep.has(rule.rule_key));
  for (const rule of stale) {
    await supabaseRequest(
      `/${RULES_TABLE}?rule_key=eq.${encodeURIComponent(rule.rule_key)}`,
      {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ active: false, updated_at: new Date().toISOString() }),
      },
    );
  }
  return stale.length;
}

async function rebuildRules() {
  const payloads = await listRecentPayloads();
  const derived = Learning.deriveRules(payloads);
  await upsertRules(derived);
  if (Learning.longTermReady(payloads.length)) {
    await deactivateMissingRules(derived.map((rule) => rule.rule_key));
  }
  return listActiveRules();
}

async function saveResultAndRebuild(raw) {
  const saved = await insertResult(raw);
  let rules = [];
  try {
    rules = await rebuildRules();
  } catch (err) {
    console.error('[test-eval] rebuild rules failed:', err);
  }
  return { result: saved.result, id: saved.row?.id, rules };
}

module.exports = {
  listActiveRules,
  saveResultAndRebuild,
  rebuildRules,
};
