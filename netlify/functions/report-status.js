// GET /api/report-status — estado dos reportes do jogador (para o ecrã Sobre).

const { json } = require('./lib/report-utils');
const { getReportStatuses } = require('./lib/reports-store');

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 204, headers: { 'access-control-allow-origin': '*' } };
    }
    if (event.httpMethod !== 'GET') {
      return json(405, { error: 'Método não permitido' });
    }

    const params = event.queryStringParameters || {};
    const reporterId = String(params.reporterId || '').trim();
    const ids = String(params.ids || '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);

    if (!ids.length) {
      return json(400, { error: 'Falta ids (lista de reportId separados por vírgula).' });
    }

    const statuses = await getReportStatuses(ids, reporterId, event);
    return json(200, { ok: true, statuses });
  } catch (err) {
    console.error('[report-status] unhandled:', err);
    return json(500, { error: 'Erro ao consultar estado dos reportes.' });
  }
};
