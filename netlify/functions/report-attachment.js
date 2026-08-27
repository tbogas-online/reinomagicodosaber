// POST/GET /api/report-attachment — imagens anexadas a reportes do site.

const {
  json,
  getClientKey,
  checkRateLimit,
  validateAdminAuth,
  clip,
} = require('./lib/report-utils');
const {
  saveReportAttachment,
  getReportAttachment,
  isValidReportId,
  isAllowedAttachmentMime,
  MAX_ATTACHMENT_BYTES,
} = require('./lib/reports-store');

const requestLog = new Map();
const MAX_UPLOAD_BODY_CHARS = 4_000_000;

function attachmentError(status, error) {
  return json(status, { error });
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 204, headers: { 'access-control-allow-origin': '*' } };
    }

    if (event.httpMethod === 'GET') {
      const auth = validateAdminAuth(event);
      if (!auth.ok) return json(auth.status, { error: auth.error });

      const reportId = clip(event.queryStringParameters?.reportId, 80);
      if (!isValidReportId(reportId)) {
        return attachmentError(400, 'Reporte inválido.');
      }

      const attachment = await getReportAttachment(reportId, event);
      if (!attachment) return attachmentError(404, 'Imagem não encontrada.');

      return {
        statusCode: 200,
        headers: {
          'content-type': attachment.mimeType,
          'cache-control': 'private, no-store',
          'access-control-allow-origin': '*',
        },
        body: attachment.data.toString('base64'),
        isBase64Encoded: true,
      };
    }

    if (event.httpMethod !== 'POST') {
      return attachmentError(405, 'Método não permitido');
    }

    const raw = event.body || '';
    if (raw.length > MAX_UPLOAD_BODY_CHARS) {
      return attachmentError(413, 'Imagem demasiado grande.');
    }

    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      return attachmentError(400, 'JSON inválido.');
    }

    const reportId = clip(payload.reportId, 80);
    const mimeType = String(payload.mimeType || '').toLowerCase();
    const filename = clip(payload.filename, 120) || 'imagem';
    if (!isValidReportId(reportId)) {
      return attachmentError(400, 'Reporte inválido.');
    }
    if (!isAllowedAttachmentMime(mimeType)) {
      return attachmentError(400, 'Tipo de imagem não suportado.');
    }

    const clientKey = getClientKey(event.headers);
    const rate = checkRateLimit(requestLog, clientKey);
    if (!rate.ok) return json(rate.status, { error: rate.error });

    let buffer;
    try {
      buffer = Buffer.from(String(payload.dataBase64 || ''), 'base64');
    } catch {
      return attachmentError(400, 'Imagem inválida.');
    }
    if (!buffer.length || buffer.length > MAX_ATTACHMENT_BYTES) {
      return attachmentError(400, `A imagem deve ter no máximo ${Math.round(MAX_ATTACHMENT_BYTES / (1024 * 1024))} MB.`);
    }

    try {
      const saved = await saveReportAttachment(reportId, buffer, mimeType, filename, event);
      return json(200, { ok: true, attachment: saved });
    } catch (err) {
      console.error('[report-attachment] save failed:', err);
      return attachmentError(503, 'Não foi possível guardar a imagem. Tenta outra vez.');
    }
  } catch (err) {
    console.error('[report-attachment] unhandled:', err);
    return attachmentError(500, 'Erro interno ao processar a imagem.');
  }
};
