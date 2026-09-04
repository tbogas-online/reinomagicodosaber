// GET/DELETE /api/gen-telemetry-admin — estatísticas agregadas (Basic Auth).

const { json, validateAdminAuth } = require('./lib/report-utils');
const { getSupabaseAdmin } = require('./lib/rooms-store');
const { getStats, clearAll, dismissTelemetryEvent, dismissTelemetryEventsByIssueCode, dismissAllOpenTelemetryEvents, listOpenIssueOccurrencesByCode } = require('./lib/gen-telemetry-store');
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

    if (event.httpMethod === 'POST') {
      let body = {};
      try {
        body = event.body ? JSON.parse(event.body) : {};
      } catch {
        return json(400, { error: 'JSON inválido.' });
      }
      if (body.action === 'dismiss') {
        try {
          const result = await dismissTelemetryEvent({ eventId: body.eventId });
          if (result.skipped === 'column_missing') {
            return json(503, {
              error: 'Coluna dismissed_at em falta — executa supabase/gen-telemetry-dismissed.sql no Supabase.',
            });
          }
          return json(200, { ok: true, ...result });
        } catch (err) {
          console.error('[gen-telemetry-admin] dismiss failed:', err);
          const msg = String(err?.message || err);
          if (err.code === 'MISSING_EVENT_ID') return json(400, { error: msg });
          return json(503, { error: 'Não foi possível descartar a ocorrência.' });
        }
      }
      if (body.action === 'dismiss-code') {
        try {
          const result = await dismissTelemetryEventsByIssueCode({
            issueCode: body.issueCode,
            gameMode: body.gameMode,
          });
          if (result.skipped === 'column_missing') {
            return json(503, {
              error: 'Coluna dismissed_at em falta — executa supabase/gen-telemetry-dismissed.sql no Supabase.',
            });
          }
          return json(200, { ok: true, ...result });
        } catch (err) {
          console.error('[gen-telemetry-admin] dismiss-code failed:', err);
          const msg = String(err?.message || err);
          if (err.code === 'MISSING_ISSUE_CODE') return json(400, { error: msg });
          return json(503, { error: 'Não foi possível descartar as ocorrências deste código.' });
        }
      }
      if (body.action === 'dismiss-all') {
        try {
          const result = await dismissAllOpenTelemetryEvents({
            gameMode: body.gameMode,
          });
          if (result.skipped === 'column_missing') {
            return json(503, {
              error: 'Coluna dismissed_at em falta — executa supabase/gen-telemetry-dismissed.sql no Supabase.',
            });
          }
          return json(200, { ok: true, ...result });
        } catch (err) {
          console.error('[gen-telemetry-admin] dismiss-all failed:', err);
          return json(503, { error: 'Não foi possível descartar todas as ocorrências.' });
        }
      }
      if (body.action === 'list-issue-occurrences') {
        try {
          const occurrences = await listOpenIssueOccurrencesByCode({
            issueCode: body.issueCode,
            gameMode: body.gameMode,
            limit: body.limit,
          });
          return json(200, {
            ok: true,
            issueCode: body.issueCode,
            occurrences,
            total: occurrences.length,
          });
        } catch (err) {
          console.error('[gen-telemetry-admin] list-issue-occurrences failed:', err);
          const msg = String(err?.message || err);
          if (err.code === 'MISSING_ISSUE_CODE') return json(400, { error: msg });
          return json(503, { error: 'Não foi possível listar as ocorrências deste código.' });
        }
      }
      return json(400, { error: 'Ação inválida.' });
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
