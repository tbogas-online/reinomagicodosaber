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

async function getQuestionBankStats() {
  const data = await supabaseRpc('get_question_bank_stats');
  if (!data || typeof data !== 'object') {
    return {
      total: 0,
      active: 0,
      reported: 0,
      blocked: 0,
      byCategoryAge: [],
      bySource: [],
    };
  }
  return {
    total: Number(data.total) || 0,
    active: Number(data.active) || 0,
    reported: Number(data.reported) || 0,
    blocked: Number(data.blocked) || 0,
    byCategoryAge: Array.isArray(data.byCategoryAge) ? data.byCategoryAge : [],
    bySource: Array.isArray(data.bySource) ? data.bySource : [],
  };
}

module.exports = {
  getQuestionBankStats,
};
