// GET /api/question-bank-admin — estatísticas do banco de perguntas
// POST /api/question-bank-admin — { action: 'purge-without-options' | 'search' | 'delete' }

const { json, validateAdminAuth } = require('./lib/report-utils');
const {
  getQuestionBankStats,
  purgeQuestionsWithoutOptions,
  searchQuestionBank,
  deleteQuestionsFromBank,
} = require('./lib/question-bank-store');
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

      if (body.action === 'search') {
        try {
          const result = await searchQuestionBank({
            query: body.query,
            hash: body.hash,
            categoryN: body.categoryN,
            ageBand: body.ageBand,
            limit: body.limit,
            offset: body.offset,
            includeReported: body.includeReported !== false,
          });
          return json(200, { ok: true, ...result });
        } catch (err) {
          console.error('[question-bank-admin] search failed:', err);
          return json(503, { error: 'Não foi possível pesquisar perguntas no banco.' });
        }
      }

      if (body.action === 'delete') {
        const hashes = Array.isArray(body.hashes) ? body.hashes : [];
        if (!hashes.length) {
          return json(400, { error: 'Indica pelo menos um question_hash.' });
        }
        try {
          const result = await deleteQuestionsFromBank(hashes, body.block !== false);
          return json(200, { ok: true, ...result });
        } catch (err) {
          console.error('[question-bank-admin] delete failed:', err);
          const msg = String(err?.message || '');
          if (msg.includes('delete_questions_from_bank') || msg.includes('PGRST202')) {
            return json(503, { error: 'Função delete_questions_from_bank em falta — executa supabase/question-bank-delete.sql no Supabase.' });
          }
          return json(503, { error: 'Não foi possível apagar perguntas do banco.' });
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
