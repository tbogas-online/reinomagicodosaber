// GET /api/knowledge-import-admin — estado da fila e repositório
// POST /api/knowledge-import-admin — { action: 'run', force?: bool, dryRun?: bool }

const { json, validateAdminAuth } = require('./lib/report-utils');
const { getImportDashboard, runDailyImport } = require('./lib/knowledge-import-store');
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

    if (event.httpMethod === 'GET') {
      const dashboard = await getImportDashboard(event);
      return json(200, dashboard);
    }

    if (event.httpMethod === 'POST') {
      let body = {};
      try {
        body = event.body ? JSON.parse(event.body) : {};
      } catch {
        return json(400, { error: 'Corpo JSON inválido.' });
      }

      if (body.action === 'run' || body.action === 'dry-run') {
        if (!getSupabaseAdmin() && body.action !== 'dry-run' && !body.dryRun) {
          return json(503, {
            error: 'Supabase admin não configurado (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).',
          });
        }
        try {
          const result = await runDailyImport(event, {
            force: !!body.force,
            dryRun: body.action === 'dry-run' || !!body.dryRun,
          });
          return json(200, result);
        } catch (err) {
          console.error('[knowledge-import-admin] run failed:', err);
          if (err.code === 'NOT_CONFIGURED') {
            return json(503, { error: err.message });
          }
          if (err.code === 'INVALID_RECORD') {
            return json(400, { error: err.message });
          }
          return json(500, { error: err.message || 'Falha na importação.' });
        }
      }

      return json(400, { error: 'Acção desconhecida. Usa action: "run" ou "dry-run".' });
    }

    return json(405, { error: 'Método não permitido.' });
  } catch (err) {
    console.error('[knowledge-import-admin] unhandled:', err);
    return json(500, { error: 'Erro interno na importação do repositório.' });
  }
};
