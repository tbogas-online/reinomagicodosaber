'use strict';

const { getSupabaseAdmin } = require('./rooms-store');

const TABLE = 'gen_validation_rule_overrides';

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
  if (!options.headers?.Prefer && options.method !== 'GET') {
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

function rowToOverride(row) {
  return {
    id: row.id,
    issueCode: row.issue_code,
    message: row.message || '',
    ageBandKey: row.age_band_key || '',
    formatId: row.format_id || '',
    note: row.note || '',
    active: row.active !== false,
    createdAt: row.created_at,
  };
}

function isMissingTableError(err) {
  return /relation|does not exist|PGRST205|PGRST204/i.test(String(err?.message || ''));
}

async function listActiveOverrides() {
  try {
    const rows = await supabaseRequest(
      `/${TABLE}?select=id,created_at,issue_code,message,age_band_key,format_id,note,active&active=eq.true&order=created_at.desc&limit=200`,
    );
    return (rows || []).map(rowToOverride);
  } catch (err) {
    if (isMissingTableError(err)) return [];
    throw err;
  }
}

async function addOverride(payload = {}) {
  const issueCode = clip(payload.issueCode || payload.issue_code, 48);
  if (!issueCode) {
    const err = new Error('issueCode é obrigatório.');
    err.status = 400;
    throw err;
  }

  const row = {
    issue_code: issueCode,
    message: clip(payload.message, 200) || null,
    age_band_key: clip(payload.ageBandKey || payload.age_band_key, 12) || null,
    format_id: clip(payload.formatId || payload.format_id, 32) || null,
    note: clip(payload.note, 240) || null,
    active: true,
  };

  try {
    const inserted = await supabaseRequest(`/${TABLE}`, {
      method: 'POST',
      body: JSON.stringify(row),
    });
    const saved = Array.isArray(inserted) ? inserted[0] : inserted;
    return rowToOverride(saved);
  } catch (err) {
    if (isMissingTableError(err)) {
      const missing = new Error('Tabela gen_validation_rule_overrides em falta — executa supabase/gen-validation-rule-overrides.sql.');
      missing.status = 503;
      throw missing;
    }
    throw err;
  }
}

async function deactivateOverride(id) {
  const overrideId = clip(id, 64);
  if (!overrideId) {
    const err = new Error('id é obrigatório.');
    err.status = 400;
    throw err;
  }

  try {
    const updated = await supabaseRequest(`/${TABLE}?id=eq.${encodeURIComponent(overrideId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ active: false }),
      headers: { Prefer: 'return=representation' },
    });
    const row = Array.isArray(updated) ? updated[0] : updated;
    return row ? rowToOverride(row) : { id: overrideId, active: false };
  } catch (err) {
    if (isMissingTableError(err)) {
      const missing = new Error('Tabela gen_validation_rule_overrides em falta — executa supabase/gen-validation-rule-overrides.sql.');
      missing.status = 503;
      throw missing;
    }
    throw err;
  }
}

module.exports = {
  listActiveOverrides,
  addOverride,
  deactivateOverride,
};
