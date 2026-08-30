// GET/PATCH /api/rooms-admin — salas multijogador (Supabase service role + Basic Auth).

const { json, validateAdminAuth } = require('./lib/report-utils');
const { listOpenRooms, getRoomStats, closeRoom, getSupabaseAdmin } = require('./lib/rooms-store');

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
      if (params.stats === '1') {
        try {
          const stats = await getRoomStats();
          return json(200, { ok: true, stats });
        } catch (err) {
          console.error('[rooms-admin] stats failed:', err);
          return json(503, { error: 'Não foi possível ler estatísticas das salas.' });
        }
      }

      try {
        const rooms = await listOpenRooms();
        return json(200, { ok: true, rooms });
      } catch (err) {
        console.error('[rooms-admin] list failed:', err);
        return json(503, { error: 'Não foi possível listar salas.' });
      }
    }

    if (event.httpMethod === 'PATCH') {
      const roomId = event.queryStringParameters?.roomId;
      let body = {};
      try {
        body = event.body ? JSON.parse(event.body) : {};
      } catch {
        return json(400, { error: 'Corpo JSON inválido.' });
      }
      if (body.action !== 'close' || !roomId) {
        return json(400, { error: 'Parâmetros inválidos (roomId + action=close).' });
      }
      try {
        const result = await closeRoom(roomId);
        return json(200, { ok: true, ...result });
      } catch (err) {
        console.error('[rooms-admin] close failed:', err);
        return json(503, { error: 'Não foi possível desligar a sala.' });
      }
    }

    return json(405, { error: 'Método não permitido.' });
  } catch (err) {
    console.error('[rooms-admin] unhandled:', err);
    return json(500, { error: 'Erro interno no painel de salas.' });
  }
};
