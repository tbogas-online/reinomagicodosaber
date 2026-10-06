const { getSupabaseAdmin } = require('./rooms-store');
const { buildDedupePlan, formatDisabledReason } = require('./knowledge-dedupe');
const { lisbonCreatedFromIso, lisbonCreatedToExclusiveIso } = require('../../../scripts/lib/lisbon-time');

const KNOWLEDGE_SELECT = [
  'knowledge_id',
  'category_n',
  'topic',
  'subtopic',
  'fact',
  'answer',
  'source',
  'source_id',
  'confidence',
  'is_active',
  'disabled_reason',
  'age_bands',
  'allowed_formats',
  'usage_count',
  'created_at',
  'updated_at',
].join(',');

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
    headers.Prefer = 'return=minimal';
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

function escapePostgrestFilter(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/,/g, ' ')
    .replace(/\(/g, ' ')
    .replace(/\)/g, ' ')
    .trim();
}

async function searchKnowledgeRecords(options = {}) {
  const {
    query = '',
    knowledgeId = '',
    categoryN = null,
    topic = '',
    source = '',
    activeFilter = 'all',
    createdFrom = '',
    createdTo = '',
    limit = 50,
    offset = 0,
  } = options;

  const pageSize = Math.min(Math.max(Number(limit) || 50, 1), 500);
  const pageOffset = Math.max(Number(offset) || 0, 0);
  const params = new URLSearchParams();
  params.set('select', KNOWLEDGE_SELECT);
  params.set('order', 'created_at.desc,knowledge_id.desc');
  params.set('limit', String(pageSize));
  params.set('offset', String(pageOffset));

  const kid = String(knowledgeId || '').trim();
  const q = escapePostgrestFilter(query);
  const topicTrim = escapePostgrestFilter(topic);
  const sourceTrim = escapePostgrestFilter(source);
  const fromRaw = String(createdFrom || '').trim();
  const toRaw = String(createdTo || '').trim();
  const fromIso = lisbonCreatedFromIso(fromRaw);
  const toExclusiveIso = lisbonCreatedToExclusiveIso(toRaw);

  if (kid) {
    params.set('knowledge_id', `eq.${kid}`);
  } else if (q) {
    params.set('or', `(knowledge_id.ilike.*${q}*,fact.ilike.*${q}*,answer.ilike.*${q}*)`);
  }

  const cat = Number(categoryN);
  if (cat >= 1 && cat <= 20) params.set('category_n', `eq.${cat}`);

  if (topicTrim) params.set('topic', `ilike.*${topicTrim}*`);
  if (sourceTrim) params.set('source', `ilike.*${sourceTrim}*`);

  if (activeFilter === 'active') params.set('is_active', 'eq.true');
  if (activeFilter === 'inactive') params.set('is_active', 'eq.false');

  const createdFilters = [];
  if (fromIso) createdFilters.push(`created_at.gte."${fromIso}"`);
  if (toExclusiveIso) createdFilters.push(`created_at.lt."${toExclusiveIso}"`);
  if (createdFilters.length) params.set('and', `(${createdFilters.join(',')})`);

  if (!kid && !q && !(cat >= 1 && cat <= 20) && !topicTrim && !sourceTrim && !fromIso && !toExclusiveIso) {
    return { rows: [], total: 0 };
  }

  const rows = await supabaseRequest(`/knowledge_records?${params.toString()}`);
  const list = Array.isArray(rows) ? rows : [];
  const quarantined = await getQuarantinedKnowledgeIds(list.map((row) => row.knowledge_id));
  return {
    rows: list.map((row) => ({ ...row, in_quarantine: quarantined.has(row.knowledge_id) })),
    total: list.length,
  };
}

async function getQuarantinedKnowledgeIds(ids, days = 30) {
  const unique = [...new Set((ids || []).map((id) => String(id || '').trim()).filter(Boolean))];
  if (!unique.length) return new Set();

  const cutoff = new Date(Date.now() - Math.max(Number(days) || 30, 1) * 24 * 60 * 60 * 1000).toISOString();
  const quoted = unique.map((id) => `"${id.replace(/"/g, '')}"`).join(',');
  const params = new URLSearchParams();
  params.set('select', 'knowledge_id');
  params.set('knowledge_id', `in.(${quoted})`);
  params.set('played_at', `gte.${cutoff}`);

  try {
    const rows = await supabaseRequest(`/question_reuse_events?${params.toString()}`);
    return new Set((Array.isArray(rows) ? rows : []).map((r) => r.knowledge_id).filter(Boolean));
  } catch {
    return new Set();
  }
}

function clipDisabledReason(reason) {
  return String(reason || '').trim().slice(0, 400);
}

async function disableKnowledgeRecord(knowledgeId, reason) {
  const kid = String(knowledgeId || '').trim();
  if (!kid) return { ok: false, disabled: 0 };

  const data = await supabaseRpc('disable_knowledge_record', {
    p_knowledge_id: kid,
    p_reason: clipDisabledReason(reason) || null,
  });
  return {
    ok: !!data?.ok,
    disabled: data?.ok ? 1 : 0,
    knowledgeId: kid,
    reason: clipDisabledReason(reason),
  };
}

async function disableKnowledgeRecords(knowledgeIds, { reason } = {}) {
  const unique = [...new Set((knowledgeIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
  let disabled = 0;
  const failed = [];
  const clipped = clipDisabledReason(reason);

  for (const knowledgeId of unique) {
    try {
      const result = await disableKnowledgeRecord(knowledgeId, clipped);
      if (result.ok) disabled += 1;
      else failed.push(knowledgeId);
    } catch {
      failed.push(knowledgeId);
    }
  }

  return { ok: true, disabled, failed, knowledgeIds: unique, reason: clipped };
}

async function deleteKnowledgeRecords(knowledgeIds) {
  const unique = [...new Set((knowledgeIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
  if (!unique.length) {
    return { ok: false, deleted: 0, bankDeleted: 0, reuseDeleted: 0, knowledgeIds: [] };
  }

  const data = await supabaseRpc('delete_knowledge_records', { p_knowledge_ids: unique });
  return {
    ok: data?.ok !== false,
    deleted: Number(data?.deleted) || 0,
    bankDeleted: Number(data?.bankDeleted) || 0,
    reuseDeleted: Number(data?.reuseDeleted) || 0,
    knowledgeIds: unique,
  };
}

const DEDUPE_SELECT = 'knowledge_id,category_n,topic,fact,answer,source,source_id,is_active,priority_pt';

async function fetchActiveKnowledgeRecords(categoryN = 20) {
  const pageSize = 1000;
  let offset = 0;
  const all = [];

  while (true) {
    const params = new URLSearchParams();
    params.set('select', DEDUPE_SELECT);
    params.set('category_n', `eq.${categoryN}`);
    params.set('is_active', 'eq.true');
    params.set('order', 'knowledge_id.asc');
    params.set('limit', String(pageSize));
    params.set('offset', String(offset));
    const rows = await supabaseRequest(`/knowledge_records?${params.toString()}`);
    const batch = Array.isArray(rows) ? rows : [];
    all.push(...batch);
    if (batch.length < pageSize) break;
    offset += pageSize;
  }

  return all;
}

async function auditKnowledgeDuplicates(options = {}) {
  const categoryN = Number(options.categoryN) || 20;
  const records = await fetchActiveKnowledgeRecords(categoryN);
  const plan = buildDedupePlan(records, {
    adivinhas: !!options.adivinhas,
    curiosidades: options.curiosidades !== false,
  });

  return {
    ok: true,
    categoryN,
    analyzed: records.length,
    adivinhasActive: records.filter((r) => r.topic === 'adivinha tradicional').length,
    curiosidadesActive: records.filter((r) => r.topic === 'curiosidade surpreendente').length,
    ...plan,
  };
}

async function applyKnowledgeDedupe(options = {}) {
  const audit = await auditKnowledgeDuplicates(options);
  const ids = audit.toDisable.map((e) => e.knowledge_id);

  if (!ids.length) {
    return {
      ok: true,
      applied: false,
      message: 'Nenhum duplicado a desactivar.',
      analyzed: audit.analyzed,
      stats: audit.stats,
      toDisable: [],
    };
  }

  let disabled = 0;
  const failed = [];
  for (const entry of audit.toDisable) {
    try {
      const result = await disableKnowledgeRecord(entry.knowledge_id, formatDisabledReason(entry));
      if (result.ok) disabled += 1;
      else failed.push(entry.knowledge_id);
    } catch {
      failed.push(entry.knowledge_id);
    }
  }

  return {
    ok: true,
    applied: true,
    message: `Desactivados ${disabled} duplicado(s).`,
    analyzed: audit.analyzed,
    stats: audit.stats,
    disabled,
    failed,
    toDisable: audit.toDisable,
  };
}

module.exports = {
  searchKnowledgeRecords,
  disableKnowledgeRecord,
  disableKnowledgeRecords,
  deleteKnowledgeRecords,
  auditKnowledgeDuplicates,
  applyKnowledgeDedupe,
};
