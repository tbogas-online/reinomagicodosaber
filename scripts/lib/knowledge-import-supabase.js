'use strict';

const fs = require('fs');
const path = require('path');
const core = require('./knowledge-import-core');

function getAdminConfig() {
  const url = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key) return null;
  return { url, key };
}

async function supabaseRpc(cfg, name, params = {}) {
  const response = await fetch(`${cfg.url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: cfg.key,
      Authorization: `Bearer ${cfg.key}`,
    },
    body: JSON.stringify(params),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const msg = data.message || data.error || data.hint || `HTTP ${response.status}`;
    const err = new Error(`${name} falhou: ${msg}`);
    err.code = 'SUPABASE_RPC';
    err.details = data;
    throw err;
  }
  return data;
}

function resolveSeedQueuePath() {
  const rel = path.join('data', 'knowledge-import-queue.json');
  const roots = [
    path.join(__dirname, '..', '..'),
    process.cwd(),
  ];
  for (const root of roots) {
    const candidate = path.join(root, rel);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function loadSeedQueueFile() {
  const filePath = resolveSeedQueuePath();
  if (!filePath) return { items: [], _fileMissing: true };
  const queue = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  queue._filePath = filePath;
  return queue;
}

function seedItemsToSyncPayload(items) {
  return (items || []).map((item) => ({
    queue_id: item.queueId,
    status: item.status || 'pending',
    record: item.record,
    imported_at: item.importedAt || null,
  }));
}

async function ensureQueueSynced(cfg) {
  const dashboard = await supabaseRpc(cfg, 'get_knowledge_import_dashboard');
  const total = dashboard?.summary?.total || 0;
  if (total > 0) {
    return { synced: false, reason: 'already_populated', total };
  }
  const seed = loadSeedQueueFile();
  if (!seed.items?.length) {
    return { synced: false, reason: 'seed_missing', total: 0 };
  }
  const result = await supabaseRpc(cfg, 'sync_knowledge_import_queue', {
    p_items: seedItemsToSyncPayload(seed.items),
  });
  return { synced: true, seedPath: seed._filePath, ...result };
}

async function fetchQueueItems(cfg) {
  const response = await fetch(
    `${cfg.url}/rest/v1/knowledge_import_queue?select=queue_id,status,record,imported_at&order=created_at.asc`,
    {
      headers: {
        apikey: cfg.key,
        Authorization: `Bearer ${cfg.key}`,
      },
    },
  );
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`knowledge_import_queue: ${text || response.status}`);
  }
  const rows = await response.json();
  return rows.map((row) => ({
    queueId: row.queue_id,
    status: row.status,
    record: row.record,
    importedAt: row.imported_at,
  }));
}

async function fetchRepositoryStats(cfg) {
  try {
    return await supabaseRpc(cfg, 'get_knowledge_repository_stats');
  } catch {
    return null;
  }
}

async function getDashboard(cfg, { autoSync = true } = {}) {
  if (autoSync) {
    try {
      await ensureQueueSynced(cfg);
    } catch (err) {
      if (!String(err.message || '').includes('get_knowledge_import_dashboard')) {
        // tabela ainda não criada — continua para mensagem clara abaixo
      }
    }
  }

  let dashboard;
  try {
    dashboard = await supabaseRpc(cfg, 'get_knowledge_import_dashboard');
  } catch (err) {
    const missing = String(err.message || '').includes('get_knowledge_import_dashboard')
      || String(err.message || '').includes('knowledge_import_queue');
    if (missing) {
      const e = new Error('Executa supabase/knowledge-import-queue.sql no Supabase.');
      e.code = 'SCHEMA_MISSING';
      throw e;
    }
    throw err;
  }

  const repository = await fetchRepositoryStats(cfg);
  const seed = loadSeedQueueFile();
  return {
    ok: true,
    ...dashboard,
    repository,
    diagnostics: {
      storage: 'supabase',
      seedFileFound: !seed._fileMissing,
      seedFilePath: seed._filePath || null,
      seedFileTotal: (seed.items || []).length,
      effectivePending: dashboard?.summary?.pending ?? 0,
    },
  };
}

async function runDailyImport(cfg, { force = false, dryRun = false } = {}) {
  const dashboard = await getDashboard(cfg, { autoSync: true });
  const state = dashboard.state || { lastRunDate: null, runs: [] };
  const today = core.todayPt();

  if (!force && state.lastRunDate === today) {
    return {
      ok: true,
      skipped: true,
      reason: 'already_ran_today',
      lastRunDate: state.lastRunDate,
      message: `Já importado hoje (${today}). Usa forçar para repetir.`,
      summary: dashboard.summary,
      diagnostics: dashboard.diagnostics,
    };
  }

  const items = await fetchQueueItems(cfg);
  const picked = core.pickItemsForToday(items);
  if (!picked.length) {
    return {
      ok: true,
      skipped: true,
      reason: 'queue_empty',
      message: dashboard.summary?.pending
        ? 'Não foi possível escolher itens por faixa etária.'
        : 'Não há registos pendentes na fila. Sincroniza ou adiciona itens no Supabase.',
      summary: core.summarizeQueue(items),
      diagnostics: dashboard.diagnostics,
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
      diagnostics: dashboard.diagnostics,
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
  const queueIds = picked.map(({ item }) => item.queueId);
  await supabaseRpc(cfg, 'mark_knowledge_import_queue_imported', {
    p_queue_ids: queueIds,
    p_imported_at: importedAt,
  });
  await supabaseRpc(cfg, 'touch_knowledge_import_state', {
    p_last_run_date: today,
    p_run: {
      date: today,
      importedAt,
      knowledgeIds: records.map((r) => r.knowledge_id),
      upserted: result.upserted ?? records.length,
      skipped: result.skipped ?? 0,
      source: 'import',
    },
  });

  const refreshed = await getDashboard(cfg, { autoSync: false });
  return {
    ok: true,
    imported: true,
    plan,
    result,
    summary: refreshed.summary,
    diagnostics: refreshed.diagnostics,
    lastRunDate: today,
  };
}

async function resetQueuePending(cfg) {
  const result = await supabaseRpc(cfg, 'reset_knowledge_import_queue');
  const dashboard = await getDashboard(cfg, { autoSync: false });
  return {
    ok: true,
    reset: true,
    message: `Fila reposta — ${result.reset ?? 0} registo(s) voltaram a pendente.`,
    resetCount: result.reset ?? 0,
    ...dashboard,
  };
}

async function syncSeedQueue(cfg) {
  const seed = loadSeedQueueFile();
  if (!seed.items?.length) {
    const err = new Error('Ficheiro data/knowledge-import-queue.json não encontrado.');
    err.code = 'SEED_MISSING';
    throw err;
  }
  const result = await supabaseRpc(cfg, 'sync_knowledge_import_queue', {
    p_items: seedItemsToSyncPayload(seed.items),
  });
  const dashboard = await getDashboard(cfg, { autoSync: false });
  return {
    ok: true,
    synced: true,
    message: `Fila sincronizada — ${result.upserted ?? 0} actualizado(s), ${result.skipped ?? 0} ignorado(s).`,
    sync: result,
    ...dashboard,
  };
}

module.exports = {
  getAdminConfig,
  getDashboard,
  runDailyImport,
  resetQueuePending,
  syncSeedQueue,
  loadSeedQueueFile,
};
