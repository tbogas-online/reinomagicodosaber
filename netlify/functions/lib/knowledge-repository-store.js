const { getSupabaseAdmin } = require('./rooms-store');

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
    limit = 50,
    offset = 0,
  } = options;

  const params = new URLSearchParams();
  params.set('select', KNOWLEDGE_SELECT);
  params.set('order', 'updated_at.desc');
  params.set('limit', String(Math.min(Math.max(Number(limit) || 50, 1), 200)));
  params.set('offset', String(Math.max(Number(offset) || 0, 0)));

  const kid = String(knowledgeId || '').trim();
  const q = escapePostgrestFilter(query);
  const topicTrim = escapePostgrestFilter(topic);
  const sourceTrim = escapePostgrestFilter(source);

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

  if (!kid && !q && !(cat >= 1 && cat <= 20) && !topicTrim && !sourceTrim) {
    return { rows: [], total: 0 };
  }

  const rows = await supabaseRequest(`/knowledge_records?${params.toString()}`);
  return {
    rows: Array.isArray(rows) ? rows : [],
    total: Array.isArray(rows) ? rows.length : 0,
  };
}

async function disableKnowledgeRecord(knowledgeId) {
  const kid = String(knowledgeId || '').trim();
  if (!kid) return { ok: false, disabled: 0 };

  const data = await supabaseRpc('disable_knowledge_record', { p_knowledge_id: kid });
  return {
    ok: !!data?.ok,
    disabled: data?.ok ? 1 : 0,
    knowledgeId: kid,
  };
}

async function disableKnowledgeRecords(knowledgeIds) {
  const unique = [...new Set((knowledgeIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
  let disabled = 0;
  const failed = [];

  for (const knowledgeId of unique) {
    try {
      const result = await disableKnowledgeRecord(knowledgeId);
      if (result.ok) disabled += 1;
      else failed.push(knowledgeId);
    } catch {
      failed.push(knowledgeId);
    }
  }

  return { ok: true, disabled, failed, knowledgeIds: unique };
}

module.exports = {
  searchKnowledgeRecords,
  disableKnowledgeRecord,
  disableKnowledgeRecords,
};
