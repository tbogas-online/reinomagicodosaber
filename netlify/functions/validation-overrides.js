// GET/POST/DELETE /api/validation-overrides — overrides de regras de validação IA.

const { json, validateAdminAuth } = require('./lib/report-utils');
const { getSupabaseAdmin } = require('./lib/rooms-store');
const {
  listActiveOverrides,
  addOverride,
  deactivateOverride,
} = require('./lib/validation-rule-overrides-store');

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 204, headers: { 'access-control-allow-origin': '*' } };
    }

    if (event.httpMethod === 'GET') {
      if (!getSupabaseAdmin()) {
        return json(200, { ok: true, overrides: [] });
      }
      try {
        const overrides = await listActiveOverrides();
        return json(200, { ok: true, overrides });
      } catch (err) {
        console.error('[validation-overrides] list failed:', err);
        return json(503, { error: 'Não foi possível ler overrides de validação.' });
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
        const override = await addOverride(body);
        return json(200, { ok: true, override });
      } catch (err) {
        console.error('[validation-overrides] add failed:', err);
        return json(err.status || 503, { error: err.message || 'Não foi possível guardar override.' });
      }
    }

    if (event.httpMethod === 'DELETE') {
      const params = event.queryStringParameters || {};
      const id = params.id || '';
      if (!id) {
        return json(400, { error: 'Indica id=…' });
      }
      try {
        const override = await deactivateOverride(id);
        return json(200, { ok: true, override });
      } catch (err) {
        console.error('[validation-overrides] delete failed:', err);
        return json(err.status || 503, { error: err.message || 'Não foi possível remover override.' });
      }
    }

    return json(405, { error: 'Método não permitido.' });
  } catch (err) {
    console.error('[validation-overrides] unhandled:', err);
    return json(500, { error: 'Erro interno nos overrides de validação.' });
  }
};
