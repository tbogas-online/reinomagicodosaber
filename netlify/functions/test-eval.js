// GET/POST /api/test-eval — resultados de teste + regras de aprendizagem.

const { json, validateAdminAuth } = require('./lib/report-utils');
const { getSupabaseAdmin } = require('./lib/rooms-store');
const {
  listActiveRules,
  saveResultAndRebuild,
} = require('./lib/question-test-eval-store');

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 204, headers: { 'access-control-allow-origin': '*' } };
    }

    if (event.httpMethod === 'GET') {
      if (!getSupabaseAdmin()) {
        return json(200, { ok: true, rules: [] });
      }
      try {
        const rules = await listActiveRules();
        return json(200, { ok: true, rules });
      } catch (err) {
        console.error('[test-eval] list rules failed:', err);
        return json(503, { error: err.message || 'Não foi possível ler regras de aprendizagem.' });
      }
    }

    const auth = validateAdminAuth(event);
    if (!auth.ok) {
      return json(auth.status, { error: auth.error });
    }

    if (!getSupabaseAdmin()) {
      return json(503, { error: 'Supabase admin não configurado (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).' });
    }

    if (event.httpMethod === 'POST') {
      let body = {};
      try {
        body = event.body ? JSON.parse(event.body) : {};
      } catch {
        return json(400, { error: 'Corpo JSON inválido.' });
      }
      try {
        const saved = await saveResultAndRebuild(body.result || body);
        return json(200, { ok: true, ...saved });
      } catch (err) {
        console.error('[test-eval] save failed:', err);
        return json(err.status || 503, { error: err.message || 'Não foi possível guardar a avaliação.' });
      }
    }

    return json(405, { error: 'Método não permitido.' });
  } catch (err) {
    console.error('[test-eval] unhandled:', err);
    return json(500, { error: 'Erro interno na aprendizagem de testes.' });
  }
};
