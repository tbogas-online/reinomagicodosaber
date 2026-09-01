// GET/DELETE /api/gen-telemetry-admin — estatísticas agregadas (Basic Auth).

const { json, validateAdminAuth } = require('./lib/report-utils');
const { getStats, clearAll } = require('./lib/gen-telemetry-store');

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 204, headers: { 'access-control-allow-origin': '*' } };
    }

    const auth = validateAdminAuth(event);
    if (!auth.ok) {
      return json(auth.status, { error: auth.error });
    }

    if (event.httpMethod === 'GET') {
      const params = event.queryStringParameters || {};
      if (params.stats !== '1') {
        return json(400, { error: 'Usa stats=1.' });
      }
      try {
        const stats = await getStats(event);
        return json(200, { ok: true, stats });
      } catch (err) {
        console.error('[gen-telemetry-admin] stats failed:', err);
        return json(503, { error: 'Não foi possível ler telemetria.' });
      }
    }

    if (event.httpMethod === 'DELETE') {
      try {
        const result = await clearAll(event);
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
