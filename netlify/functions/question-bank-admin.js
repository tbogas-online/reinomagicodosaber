// GET /api/question-bank-admin — estatísticas do banco de perguntas
// POST /api/question-bank-admin — { action: 'purge-without-options' }

const { json, validateAdminAuth } = require('./lib/report-utils');
const { getQuestionBankStats, purgeQuestionsWithoutOptions } = require('./lib/question-bank-store');
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

    if (!getSupabaseAdmin()) {
      return json(503, { error: 'Supabase admin não configurado (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).' });
    }

    if (event.httpMethod === 'GET') {
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
    }

    if (event.httpMethod === 'POST') {
      let body = {};
      try {
        body = event.body ? JSON.parse(event.body) : {};
      } catch {
        return json(400, { error: 'Corpo JSON inválido.' });
      }

      if (body.action === 'purge-without-options') {
        try {
          const result = await purgeQuestionsWithoutOptions();
          return json(200, { ok: true, ...result });
        } catch (err) {
          console.error('[question-bank-admin] purge failed:', err);
          const msg = String(err?.message || '');
          if (msg.includes('purge_question_bank_without_options') || msg.includes('PGRST202')) {
            return json(503, { error: 'Função purge_question_bank_without_options em falta — executa supabase/question-bank.sql no Supabase.' });
          }
          return json(503, { error: 'Não foi possível limpar perguntas sem opções.' });
        }
      }

      return json(400, { error: 'Acção desconhecida.' });
    }

    return json(405, { error: 'Método não permitido.' });
  } catch (err) {
    console.error('[question-bank-admin] unhandled:', err);
    return json(500, { error: 'Erro interno no painel do banco de perguntas.' });
  }
};
