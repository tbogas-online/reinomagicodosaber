'use strict';

const fs = require('fs');
const path = require('path');
const { connectLambda, getStore } = require('@netlify/blobs');
const { getSupabaseAdmin } = require('./rooms-store');
const core = require('../../../scripts/lib/knowledge-import-core');

const STORE_NAME = 'knowledge-import';
const STATE_KEY = 'state';
const OVERRIDES_KEY = 'overrides';

function getBlobStore(event) {
  connectLambda(event);
  return getStore(STORE_NAME);
}

function defaultQueuePath() {
  return path.join(__dirname, '../../../data/knowledge-import-queue.json');
}

function loadQueueFromFile() {
  const filePath = defaultQueuePath();
  if (!fs.existsSync(filePath)) {
    return { description: '', items: [] };
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

async function loadBlobJson(store, key, fallback) {
  try {
    const raw = await store.get(key, { type: 'text' });
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function saveBlobJson(store, key, data) {
  await store.set(key, JSON.stringify(data, null, 2));
}

async function getImportDashboard(event) {
  const queueFile = loadQueueFromFile();
  const store = getBlobStore(event);
  const [state, overrides] = await Promise.all([
    loadBlobJson(store, STATE_KEY, { lastRunDate: null, runs: [] }),
    loadBlobJson(store, OVERRIDES_KEY, {}),
  ]);
  const items = core.mergeQueueWithOverrides(queueFile, overrides);
  const summary = core.summarizeQueue(items);
  const repoStats = await fetchRepositoryStats();

  return {
    ok: true,
    summary,
    state,
    lastRun: state.runs?.[0] || null,
    pendingPreview: items
      .filter((i) => i.status === 'pending')
      .slice(0, 12)
      .map((i) => ({
        queueId: i.queueId,
        knowledgeId: core.normalizeRecord(i.record).knowledge_id,
        topic: core.normalizeRecord(i.record).topic,
        ageBands: core.normalizeRecord(i.record).age_bands,
      })),
    repository: repoStats,
  };
}

async function fetchRepositoryStats() {
  const cfg = getSupabaseAdmin();
  if (!cfg) return null;
  try {
    const response = await fetch(`${cfg.url}/rest/v1/rpc/get_knowledge_repository_stats`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: cfg.key,
        Authorization: `Bearer ${cfg.key}`,
      },
      body: '{}',
    });
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}

async function runDailyImport(event, { force = false, dryRun = false } = {}) {
  const cfg = getSupabaseAdmin();
  if (!cfg && !dryRun) {
    const err = new Error('Supabase admin não configurado (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).');
    err.code = 'NOT_CONFIGURED';
    throw err;
  }

  const queueFile = loadQueueFromFile();
  const store = getBlobStore(event);
  const [state, overrides] = await Promise.all([
    loadBlobJson(store, STATE_KEY, { lastRunDate: null, runs: [] }),
    loadBlobJson(store, OVERRIDES_KEY, {}),
  ]);

  const today = core.todayPt();
  if (!force && state.lastRunDate === today) {
    return {
      ok: true,
      skipped: true,
      reason: 'already_ran_today',
      lastRunDate: state.lastRunDate,
      message: `Já importado hoje (${today}). Usa forçar para repetir.`,
    };
  }

  const items = core.mergeQueueWithOverrides(queueFile, overrides);
  const picked = core.pickItemsForToday(items);
  if (!picked.length) {
    return {
      ok: true,
      skipped: true,
      reason: 'queue_empty',
      message: 'Não há registos pendentes na fila.',
      summary: core.summarizeQueue(items),
    };
  }

  const records = [];
  for (const { item, record } of picked) {
    const missing = core.validateRecord(record);
    if (missing.length) {
      const err = new Error(`Registo inválido (${item.queueId}): falta ${missing.join(', ')}`);
      err.code = 'INVALID_RECORD';
      throw err;
    }
    records.push(record);
  }

  const plan = picked.map(({ band, record }) => ({
    band,
    knowledgeId: record.knowledge_id,
    topic: record.topic,
  }));

  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      plan,
      records: records.length,
      summary: core.summarizeQueue(items),
    };
  }

  const result = await core.importBatch(cfg.url, cfg.key, records);
  if (!result?.ok) {
    const err = new Error('import_knowledge_batch devolveu ok=false');
    err.code = 'IMPORT_FAILED';
    err.details = result;
    throw err;
  }

  const importedAt = new Date().toISOString();
  for (const { item } of picked) {
    overrides[item.queueId] = { status: 'imported', importedAt };
  }

  state.lastRunDate = today;
  state.runs = [
    {
      date: today,
      importedAt,
      knowledgeIds: records.map((r) => r.knowledge_id),
      upserted: result.upserted ?? records.length,
      skipped: result.skipped ?? 0,
      source: 'admin',
    },
    ...(state.runs || []).slice(0, 29),
  ];

  await Promise.all([
    saveBlobJson(store, OVERRIDES_KEY, overrides),
    saveBlobJson(store, STATE_KEY, state),
  ]);

  const merged = core.mergeQueueWithOverrides(queueFile, overrides);
  return {
    ok: true,
    imported: true,
    plan,
    result,
    summary: core.summarizeQueue(merged),
    lastRunDate: state.lastRunDate,
  };
}

module.exports = {
  getImportDashboard,
  runDailyImport,
};
