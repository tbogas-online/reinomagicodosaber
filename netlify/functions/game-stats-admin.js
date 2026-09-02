// GET /api/game-stats-admin — estatísticas de jogo (Supabase + Basic Auth).

const { json, validateAdminAuth } = require('./lib/report-utils');
const { getSupabaseAdmin } = require('./lib/rooms-store');
const { fetchGameStatsPayload } = require('./lib/game-stats-store');
const { fromSupabasePayload } = require('./lib/game-stats-adapters-node');
const { computeAllStats } = require('./lib/game-stats-engine');

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

    if (event.httpMethod !== 'GET') {
      return json(405, { error: 'Método não permitido.' });
    }

    const params = event.queryStringParameters || {};
    if (params.stats !== '1') {
      return json(400, { error: 'Usa stats=1.' });
    }

    const limit = Number(params.limit) || 200;
    const payload = await fetchGameStatsPayload({ limit });
    const games = fromSupabasePayload(payload);
    const stats = computeAllStats(games);

    return json(200, {
      ok: true,
      stats,
      meta: {
        matchesFetched: payload.matches.length,
        historyRows: payload.historyRows.length,
        answerEvents: payload.answerEvents.length,
        fetchedAt: payload.fetchedAt,
      },
    });
  } catch (err) {
    console.error('[game-stats-admin] unhandled:', err);
    return json(503, { error: 'Não foi possível ler estatísticas de jogo.' });
  }
};
