// GET/PATCH/DELETE /api/reports-admin — painel admin de reportes (Netlify Functions v1 + Supabase).

const { json, validateAdminAuth } = require('./lib/report-utils');
const {
  listReports,
  getStats,
  updateReportStatus,
  updateManyReportStatuses,
  deleteReport,
  deleteManyReports,
  normalizeReportStatus,
} = require('./lib/reports-store');

function isValidReportStatus(status) {
  return ['open', 'resolved', 'cancelled'].includes(normalizeReportStatus(status));
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

    if (event.httpMethod === 'GET') {
      const params = event.queryStringParameters || {};
      if (params.stats === '1') {
        try {
          const scope = params.scope || 'all';
          const stats = await getStats(event, scope, {
            issueType: params.issueType,
            ageBand: params.ageBand,
            category: params.category,
            reporterId: params.reporterId,
            deviceType: params.deviceType,
            status: params.status,
            dateFrom: params.dateFrom,
            dateTo: params.dateTo,
          });
          return json(200, { ok: true, stats });
        } catch (err) {
          console.error('[reports-admin] stats failed:', err);
          return json(503, { error: 'Não foi possível ler estatísticas.' });
        }
      }

      try {
        const data = await listReports({
          limit: params.limit,
          offset: params.offset,
          issueType: params.issueType,
          ageBand: params.ageBand,
          category: params.category,
          reporterId: params.reporterId,
          deviceType: params.deviceType,
          status: params.status,
          dateFrom: params.dateFrom,
          dateTo: params.dateTo,
          q: params.q,
        }, event);
        return json(200, { ok: true, ...data });
      } catch (err) {
        console.error('[reports-admin] list failed:', err);
        return json(503, { error: 'Não foi possível listar reportes.' });
      }
    }

    if (event.httpMethod === 'PATCH') {
      let body = {};
      try {
        body = event.body ? JSON.parse(event.body) : {};
      } catch {
        return json(400, { error: 'Corpo JSON inválido.' });
      }
      if (!body.status || !isValidReportStatus(body.status)) {
        return json(400, { error: 'Estado inválido (open, resolved ou cancelled).' });
      }
      const singleId = event.queryStringParameters?.reportId;
      const reportIds = Array.isArray(body.reportIds) && body.reportIds.length
        ? body.reportIds
        : (singleId ? [singleId] : []);
      if (!reportIds.length) {
        return json(400, { error: 'Falta reportId ou reportIds.' });
      }
      try {
        const extras = {};
        if (body.reviewDecision && typeof body.reviewDecision === 'object') {
          extras.reviewDecision = body.reviewDecision;
        }
        if (reportIds.length === 1) {
          const report = await updateReportStatus(reportIds[0], body.status, event, extras);
          if (!report) return json(404, { error: 'Reporte não encontrado.' });
          return json(200, { ok: true, report, updated: [reportIds[0]], failed: [] });
        }
        const result = await updateManyReportStatuses(reportIds, body.status, event, extras);
        return json(200, { ok: true, ...result });
      } catch (err) {
        console.error('[reports-admin] patch failed:', err);
        return json(503, { error: 'Não foi possível atualizar o reporte.' });
      }
    }

    if (event.httpMethod === 'DELETE') {
      let body = {};
      try {
        body = event.body ? JSON.parse(event.body) : {};
      } catch {
        return json(400, { error: 'Corpo JSON inválido.' });
      }
      const singleId = event.queryStringParameters?.reportId;
      const reportIds = Array.isArray(body.reportIds) && body.reportIds.length
        ? body.reportIds
        : (singleId ? [singleId] : []);
      if (!reportIds.length) {
        return json(400, { error: 'Falta reportId ou reportIds.' });
      }
      try {
        if (reportIds.length === 1) {
          const result = await deleteReport(reportIds[0], event);
          if (result.error === 'not_found') return json(404, { error: 'Reporte não encontrado.' });
          if (result.error === 'not_cancelled') {
            return json(400, { error: 'Só reportes cancelados podem ser apagados.' });
          }
          return json(200, { ok: true, deleted: [reportIds[0]], failed: [], skipped: [] });
        }
        const result = await deleteManyReports(reportIds, event);
        return json(200, { ok: true, ...result });
      } catch (err) {
        console.error('[reports-admin] delete failed:', err);
        return json(503, { error: 'Não foi possível apagar o reporte.' });
      }
    }

    return json(405, { error: 'Método não permitido' });
  } catch (err) {
    console.error('[reports-admin] unhandled:', err);
    return json(500, { error: 'Erro interno no painel admin.' });
  }
};
