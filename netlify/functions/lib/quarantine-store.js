const { getSupabaseAdmin } = require('./rooms-store');

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

const EMPTY_QUARANTINE = Object.freeze({
  days: 30,
  available: false,
  bankTotal: 0,
  knowledgeTotal: 0,
  eventsTotal: 0,
  bankByCategoryAge: [],
  bankByCategory: [],
  knowledgeByCategory: [],
  knowledgeByCategoryTopic: [],
});

async function getQuarantineStats(days = 30) {
  try {
    const data = await supabaseRpc('get_question_reuse_quarantine_stats', { p_days: days });
    if (!data || typeof data !== 'object') return { ...EMPTY_QUARANTINE };
    return {
      days: Number(data.days) || days,
      available: data.available !== false,
      bankTotal: Number(data.bankTotal) || 0,
      knowledgeTotal: Number(data.knowledgeTotal) || 0,
      eventsTotal: Number(data.eventsTotal) || 0,
      bankByCategoryAge: Array.isArray(data.bankByCategoryAge) ? data.bankByCategoryAge : [],
      bankByCategory: Array.isArray(data.bankByCategory) ? data.bankByCategory : [],
      knowledgeByCategory: Array.isArray(data.knowledgeByCategory) ? data.knowledgeByCategory : [],
      knowledgeByCategoryTopic: Array.isArray(data.knowledgeByCategoryTopic) ? data.knowledgeByCategoryTopic : [],
    };
  } catch (err) {
    const msg = String(err?.message || '');
    if (msg.includes('get_question_reuse_quarantine_stats') || msg.includes('PGRST202')) {
      return { ...EMPTY_QUARANTINE };
    }
    console.warn('[quarantine-store] stats failed:', err?.message || err);
    return { ...EMPTY_QUARANTINE };
  }
}

async function releaseQuarantine({
  scope,
  categoryN = null,
  ageBand = null,
  topic = null,
  questionHash = null,
  knowledgeId = null,
  days = 30,
} = {}) {
  const data = await supabaseRpc('release_question_reuse_quarantine', {
    p_scope: scope,
    p_category_n: categoryN,
    p_age_band: ageBand,
    p_topic: topic,
    p_question_hash: questionHash,
    p_knowledge_id: knowledgeId,
    p_days: days,
  });
  if (!data || data.ok === false) {
    const err = new Error(data?.reason || 'release_question_reuse_quarantine falhou');
    err.code = data?.reason || 'RELEASE_FAILED';
    throw err;
  }
  return {
    ok: true,
    deleted: Number(data.deleted) || 0,
    scope: data.scope || scope,
    days: Number(data.days) || days,
  };
}

module.exports = {
  getQuarantineStats,
  releaseQuarantine,
  EMPTY_QUARANTINE,
};
