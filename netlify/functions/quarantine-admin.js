// POST /api/quarantine-admin — libertar perguntas/factos da quarentena anti-reuso

const { json, validateAdminAuth } = require('./lib/report-utils');
const { getSupabaseAdmin } = require('./lib/rooms-store');
const { releaseQuarantine } = require('./lib/quarantine-store');

const VALID_SCOPES = new Set(['all', 'bank', 'knowledge', 'hash', 'knowledge_id']);

function parseScope(body) {
  const scope = String(body.scope || body.action || '').trim().toLowerCase();
  if (scope === 'release-all') return 'all';
  if (scope === 'release-bank') return 'bank';
  if (scope === 'release-knowledge') return 'knowledge';
  if (scope === 'release-hash') return 'hash';
  if (scope === 'release-knowledge-id') return 'knowledge_id';
  return scope;
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

    if (event.httpMethod !== 'POST') {
      return json(405, { error: 'Método não permitido.' });
    }

    if (!getSupabaseAdmin()) {
      return json(503, { error: 'Supabase admin não configurado (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).' });
    }

    let body = {};
    try {
      body = event.body ? JSON.parse(event.body) : {};
    } catch {
      return json(400, { error: 'Corpo JSON inválido.' });
    }

    const scope = parseScope(body);
    if (!VALID_SCOPES.has(scope)) {
      return json(400, { error: 'Indica scope: all, bank, knowledge, hash ou knowledge_id.' });
    }

    const categoryN = body.categoryN != null && body.categoryN !== ''
      ? Number(body.categoryN)
      : null;
    if (categoryN != null && (!Number.isFinite(categoryN) || categoryN < 1 || categoryN > 20)) {
      return json(400, { error: 'Categoria inválida (1–20).' });
    }

    const days = body.days != null ? Number(body.days) : 30;
    if (!Number.isFinite(days) || days < 1 || days > 365) {
      return json(400, { error: 'Dias inválidos (1–365).' });
    }

    try {
      const result = await releaseQuarantine({
        scope,
        categoryN,
        ageBand: body.ageBand || null,
        topic: body.topic || null,
        questionHash: body.questionHash || body.hash || null,
        knowledgeId: body.knowledgeId || null,
        days,
      });
      return json(200, result);
    } catch (err) {
      console.error('[quarantine-admin] release failed:', err);
      const msg = String(err?.message || '');
      if (msg.includes('release_question_reuse_quarantine') || msg.includes('PGRST202')) {
        return json(503, {
          error: 'Função release_question_reuse_quarantine em falta — executa supabase/question-reuse-global.sql no Supabase.',
        });
      }
      return json(503, { error: 'Não foi possível libertar a quarentena.' });
    }
  } catch (err) {
    console.error('[quarantine-admin] unexpected:', err);
    return json(500, { error: 'Erro interno.' });
  }
};
