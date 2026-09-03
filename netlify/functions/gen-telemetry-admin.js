// GET/DELETE /api/gen-telemetry-admin — estatísticas agregadas (Basic Auth).

const { json, validateAdminAuth } = require('./lib/report-utils');
const { getSupabaseAdmin } = require('./lib/rooms-store');
const { getStats, clearAll } = require('./lib/gen-telemetry-store');
const { getAiUsageStats } = require('./lib/ai-usage-store');
const { listActiveOverrides } = require('./lib/validation-rule-overrides-store');

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
      const params = event.queryStringParameters || {};
      if (params.stats !== '1') {
        return json(400, { error: 'Usa stats=1.' });
      }
      try {
        const [stats, overrides, aiUsage] = await Promise.all([
          getStats(null, { gameMode: params.gameMode }),
          listActiveOverrides().catch(() => []),
          getAiUsageStats().catch((err) => ({
            available: false,
            error: err?.message || 'Não foi possível ler pedidos à IA.',
          })),
        ]);
        return json(200, {
          ok: true,
          stats,
          aiUsage,
          overrides,
          filters: { gameMode: params.gameMode || '' },
        });
      } catch (err) {
        console.error('[gen-telemetry-admin] stats failed:', err);
        return json(503, { error: 'Não foi possível ler telemetria.' });
      }
    }

    if (event.httpMethod === 'DELETE') {
      try {
        const result = await clearAll();
        return json(200, { ok: true, ...result });
      } catch (err) {
        console.error('[gen-telemetry-admin] clear failed:', err);
        return json(503, { error: 'Não foi possível limpar telemetria.' });
      }
    }

    return json(405, { error: 'Método não permitido' });
  } catch (err) {
    console.error('[gen-telemetry-admin] unhandled:', err);
    return json(500, { error: 'Erro interno no painel de telemetria.' });
  }
};
