// GET /api/report-status — Cloudflare Pages.

function json(statusCode, body) {
  return new Response(JSON.stringify(body), {
    status: statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
    },
  });
}

function normalizeReportStatus(status) {
  if (status === 'resolved') return 'resolved';
  if (status === 'cancelled' || status === 'deleted') return 'cancelled';
  return 'open';
}

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*' } });
  }
  if (context.request.method !== 'GET') {
    return json(405, { error: 'Método não permitido' });
  }

  const kv = context.env.REPORTS_KV;
  if (!kv) {
    return json(503, { error: 'Armazenamento não configurado.' });
  }

  const url = new URL(context.request.url);
  const reporterId = (url.searchParams.get('reporterId') || '').trim();
  const ids = (url.searchParams.get('ids') || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);

  if (!ids.length) {
    return json(400, { error: 'Falta ids (lista de reportId separados por vírgula).' });
  }

  const statuses = {};
  const limited = [...new Set(ids)].slice(0, 50);
  await Promise.all(limited.map(async (reportId) => {
    const raw = await kv.get(`report:${reportId}`);
    if (!raw) return;
    let report;
    try { report = JSON.parse(raw); } catch { return; }
    if (reporterId && report.reporterId && report.reporterId !== reporterId) return;
    statuses[reportId] = {
      status: normalizeReportStatus(report.status),
      resolvedAt: report.resolvedAt || null,
      cancelledAt: report.cancelledAt || null,
    };
  }));

  return json(200, { ok: true, statuses });
}
