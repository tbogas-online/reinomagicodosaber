// GET /api/question-bank-admin — estatísticas do banco de perguntas (Supabase service role + Basic Auth).

const { json, validateAdminAuth } = require('./lib/report-utils');
const { getQuestionBankStats } = require('./lib/question-bank-store');
const { getSupabaseAdmin } = require('./lib/rooms-store');

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 204, headers: { 'access-control-allow-origin': '*' } };
    }

    const auth = validateAdminAuth(event);
    if (!auth.ok) {
      return json(auth.status, { error: auth.error });
    }

    if (event.httpMethod !== 'GET') {
      return json(405, { error: 'Método não permitido.' });
    }

    if (!getSupabaseAdmin()) {
      return json(503, { error: 'Supabase admin não configurado (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).' });
    }

    try {
      const stats = await getQuestionBankStats();
      return json(200, { ok: true, stats });
    } catch (err) {
      console.error('[question-bank-admin] stats failed:', err);
      const msg = String(err?.message || '');
      if (msg.includes('get_question_bank_stats') || msg.includes('PGRST202')) {
        return json(503, { error: 'Função get_question_bank_stats em falta — executa supabase/question-bank.sql no Supabase.' });
      }
      return json(503, { error: 'Não foi possível ler estatísticas do banco de perguntas.' });
    }
  } catch (err) {
    console.error('[question-bank-admin] unhandled:', err);
    return json(500, { error: 'Erro interno no painel do banco de perguntas.' });
  }
};
