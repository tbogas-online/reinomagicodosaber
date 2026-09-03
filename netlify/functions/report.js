// POST /api/report — regista problemas reportados (Netlify Functions v1 + Supabase).

const {
  MAX_BODY_CHARS,
  json,
  getClientKey,
  checkRateLimit,
  buildReport,
  validateReportPayload,
} = require('./lib/report-utils');
const { saveReport } = require('./lib/reports-store');
const { attachEngineDiagnosis } = require('./lib/report-diagnosis');

const requestLog = new Map();

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 204, headers: { 'access-control-allow-origin': '*' } };
    }
    if (event.httpMethod !== 'POST') {
      return json(405, { error: 'Método não permitido' });
    }

    const raw = event.body || '';
    if (raw.length > MAX_BODY_CHARS) {
      return json(413, { error: 'Reporte demasiado grande.' });
    }

    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      return json(400, { error: 'JSON inválido.' });
    }

    const validation = validateReportPayload(payload);
    if (!validation.ok) {
      return json(validation.status, { error: validation.error });
    }

    const clientKey = getClientKey(event.headers);
    const rate = checkRateLimit(requestLog, clientKey);
    if (!rate.ok) {
      return json(rate.status, { error: rate.error });
    }

    const report = buildReport(payload);
    attachEngineDiagnosis(report);

    try {
      await saveReport(report, event);
    } catch (err) {
      console.error('[question-report] blob save failed:', err);
      console.log('[question-report]', JSON.stringify(report));
      return json(503, { error: 'Não foi possível guardar o reporte. Tenta outra vez.' });
    }

    console.log('[question-report]', JSON.stringify({ reportId: report.reportId, issueType: report.issueType }));
    return json(200, { ok: true, reportId: report.reportId });
  } catch (err) {
    console.error('[question-report] unhandled:', err);
    return json(500, { error: 'Erro interno ao processar o reporte.' });
  }
};
