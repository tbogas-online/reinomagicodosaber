'use strict';

const { toRejectionRow } = require('./knowledge-import-rejections');

const TABLE = 'knowledge_import_rejections';
const LOAD_LIMIT = 8000;

function isMissingTableError(err) {
  return /relation|does not exist|PGRST205|PGRST204|42P01/i.test(String(err?.message || ''));
}

async function supabaseRequest(cfg, path, options = {}) {
  const response = await fetch(`${cfg.url}/rest/v1${path}`, {
    method: options.method || 'GET',
    headers: {
      apikey: cfg.key,
      Authorization: `Bearer ${cfg.key}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
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

async function loadImportRejections(cfg) {
  if (!cfg?.url || !cfg?.key) return [];
  try {
    const rows = await supabaseRequest(
      cfg,
      `/${TABLE}?select=knowledge_id,source,source_id,qid,fact_key,fact_hash,fact,answer,category_n,topic&order=rejected_at.desc&limit=${LOAD_LIMIT}`,
    );
    return Array.isArray(rows) ? rows : [];
  } catch (err) {
    if (isMissingTableError(err)) return [];
    console.warn('[knowledge-import] load rejections failed:', err.message || err);
    return [];
  }
}

async function countImportRejections(cfg) {
  if (!cfg?.url || !cfg?.key) return { count: 0, available: false };
  try {
    const response = await fetch(`${cfg.url}/rest/v1/${TABLE}?select=knowledge_id`, {
      method: 'HEAD',
      headers: {
        apikey: cfg.key,
        Authorization: `Bearer ${cfg.key}`,
        Prefer: 'count=exact',
        Range: '0-0',
      },
    });
    if (!response.ok) {
      if (response.status === 404) return { count: 0, available: false };
      return { count: 0, available: false };
    }
    const total = Number(String(response.headers.get('content-range') || '').split('/')[1]) || 0;
    return { count: total, available: true };
  } catch (err) {
    if (isMissingTableError(err)) return { count: 0, available: false };
    return { count: 0, available: false };
  }
}

async function rememberImportRejections(cfg, records) {
  if (!cfg?.url || !cfg?.key) {
    return { ok: false, remembered: 0, available: false };
  }
  const rows = [];
  const seen = new Set();
  for (const record of records || []) {
    const row = toRejectionRow(record);
    if (!row?.knowledge_id || seen.has(row.knowledge_id)) continue;
    seen.add(row.knowledge_id);
    rows.push(row);
  }
  if (!rows.length) return { ok: true, remembered: 0, available: true };

  try {
    await supabaseRequest(cfg, `/${TABLE}?on_conflict=knowledge_id`, {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(rows),
    });
    return { ok: true, remembered: rows.length, available: true };
  } catch (err) {
    if (isMissingTableError(err)) {
      return { ok: false, remembered: 0, available: false };
    }
    throw err;
  }
}

module.exports = {
  loadImportRejections,
  countImportRejections,
  rememberImportRejections,
};
