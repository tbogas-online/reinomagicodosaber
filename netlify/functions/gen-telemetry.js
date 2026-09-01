// POST /api/gen-telemetry — regista eventos de geração IA (todos os jogos/dispositivos).

const { json, getClientKey } = require('./lib/report-utils');
const { getSupabaseAdmin } = require('./lib/rooms-store');
const { recordEvent, normalizeEvent } = require('./lib/gen-telemetry-store');

const MAX_BODY_CHARS = 4000;
const requestLog = new Map();
const WINDOW_MS = 60 * 1000;
const MAX_EVENTS_PER_WINDOW = 120;

function checkTelemetryRateLimit(clientKey) {
  const now = Date.now();
  const recent = (requestLog.get(clientKey) || []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_EVENTS_PER_WINDOW) {
    return { ok: false, status: 429, error: 'Demasiados eventos. Espera um pouco.' };
  }
  recent.push(now);
  requestLog.set(clientKey, recent);
  return { ok: true };
}

function validateTelemetryPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, status: 400, error: 'Corpo inválido.' };
  }
  const normalized = normalizeEvent(payload);
  if (!normalized.outcome || normalized.outcome === 'unknown') {
    return { ok: false, status: 400, error: 'Campo outcome inválido.' };
  }
  return { ok: true, event: normalized };
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 204, headers: { 'access-control-allow-origin': '*' } };
    }
    if (event.httpMethod !== 'POST') {
      return json(405, { error: 'Método não permitido' });
    }

    if (!getSupabaseAdmin()) {
      return json(503, { error: 'Supabase não configurado para telemetria (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).' });
    }

    const raw = event.body || '';
    if (raw.length > MAX_BODY_CHARS) {
      return json(413, { error: 'Evento demasiado grande.' });
    }

    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      return json(400, { error: 'JSON inválido.' });
    }

    const validation = validateTelemetryPayload(payload);
    if (!validation.ok) {
      return json(validation.status, { error: validation.error });
    }

    const clientKey = getClientKey(event.headers);
    const rate = checkTelemetryRateLimit(clientKey);
    if (!rate.ok) {
      return json(rate.status, { error: rate.error });
    }

    try {
      const saved = await recordEvent(validation.event);
      return json(200, { ok: true, id: saved.id });
    } catch (err) {
      console.error('[gen-telemetry] save failed:', err);
      if (err.code === 'NOT_CONFIGURED') {
        return json(503, { error: 'Supabase não configurado para telemetria.' });
      }
      return json(503, { error: 'Não foi possível guardar o evento.' });
    }
  } catch (err) {
    console.error('[gen-telemetry] unhandled:', err);
    return json(500, { error: 'Erro interno ao processar telemetria.' });
  }
};
