// GET /api/question-bank-admin — estatísticas do banco de perguntas
// POST /api/question-bank-admin — { action: 'purge-without-options' | 'search' | 'delete' | 'delete-by-category' }

const { json, validateAdminAuth } = require('./lib/report-utils');
const {
  getQuestionBankStats,
  purgeQuestionsWithoutOptions,
  searchQuestionBank,
  deleteQuestionsFromBank,
  deleteQuestionsByCategory,
  applyReportCorrectionToBank,
} = require('./lib/question-bank-store');
const { regenerateAdivinhaBankOptions } = require('./lib/adivinha-bank-fix');
const { getSupabaseAdmin } = require('./lib/rooms-store');
const { getQuestionHashesByReportStatus } = require('./lib/reports-store');

async function loadReportHashSets(event, reportFilter) {
  const filter = String(reportFilter || 'all').trim() || 'all';
  if (filter === 'all' || filter === 'bank-reported') {
    return null;
  }
  return getQuestionHashesByReportStatus(event);
}

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
          const reportFilter = body.reportFilter || 'all';
          const reportHashSets = await loadReportHashSets(event, reportFilter);
          const result = await searchQuestionBank({
            query: body.query,
            hash: body.hash,
            categoryN: body.categoryN,
            ageBand: body.ageBand,
            limit: body.limit,
            offset: body.offset,
            reportFilter,
            reportHashSets,
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

      if (body.action === 'delete-by-category') {
        const categoryN = Number(body.categoryN);
        if (!categoryN || categoryN < 1 || categoryN > 20) {
          return json(400, { error: 'Indica uma categoria (1–20).' });
        }
        try {
          const reportFilter = body.reportFilter || 'all';
          const reportHashSets = await loadReportHashSets(event, reportFilter);
          const result = await deleteQuestionsByCategory(categoryN, {
            ageBand: body.ageBand,
            reportFilter,
            reportHashSets,
            block: body.block !== false,
          });
          return json(200, { ok: true, ...result });
        } catch (err) {
          console.error('[question-bank-admin] delete-by-category failed:', err);
          const msg = String(err?.message || '');
          if (msg.includes('delete_questions_from_bank_by_category') || msg.includes('PGRST202')) {
            return json(503, { error: 'Função delete_questions_from_bank_by_category em falta — executa supabase/question-bank-delete.sql no Supabase.' });
          }
          if (err.code === 'INVALID_CATEGORY' || err.code === 'INVALID_AGE_BAND') {
            return json(400, { error: err.message });
          }
          return json(503, { error: 'Não foi possível apagar perguntas da categoria.' });
        }
      }

      if (body.action === 'regenerate-adivinha-options') {
        try {
          const categoryN = body.categoryN != null ? Number(body.categoryN) : 20;
          const result = await regenerateAdivinhaBankOptions({
            categoryN,
            dryRun: body.dryRun === true,
          });
          return json(200, { ok: true, ...result });
        } catch (err) {
          console.error('[question-bank-admin] regenerate-adivinha-options failed:', err);
          return json(503, { error: 'Não foi possível regenerar opções de adivinhas.' });
        }
      }

      if (body.action === 'apply-report-correction') {
        const questionHash = String(body.questionHash || '').trim();
        const correction = body.correction && typeof body.correction === 'object' ? body.correction : {};
        if (!questionHash) {
          return json(400, { error: 'Indica question_hash.' });
        }
        try {
          const result = await applyReportCorrectionToBank(questionHash, correction);
          return json(200, { ok: true, ...result });
        } catch (err) {
          console.error('[question-bank-admin] apply-report-correction failed:', err);
          if (err.code === 'EMPTY_PATCH' || err.code === 'MISSING_HASH') {
            return json(400, { error: err.message });
          }
          return json(503, { error: 'Não foi possível aplicar a correcção no banco.' });
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
