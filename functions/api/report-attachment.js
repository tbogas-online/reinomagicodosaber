// POST/GET /api/report-attachment — Cloudflare Pages (KV).

const MAX_ATTACHMENT_BYTES = 1.5 * 1024 * 1024;
const ALLOWED_ATTACHMENT_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const WINDOW_MS = 60 * 1000;
const MAX_UPLOADS_PER_WINDOW = 20;
const MAX_UPLOAD_BODY_CHARS = 4_000_000;
const requestLog = new Map();

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

function clip(value, max) {
  return String(value || '').trim().slice(0, max);
}

function isValidReportId(reportId) {
  return /^rpt-[a-z0-9-]+$/i.test(String(reportId || '').trim());
}

function isAllowedAttachmentMime(mimeType) {
  return ALLOWED_ATTACHMENT_MIME.has(String(mimeType || '').toLowerCase());
}

function attachmentKey(reportId) {
  return `attachment:${reportId}`;
}

function parseBasicAuth(authorization) {
  if (!authorization || !authorization.startsWith('Basic ')) return null;
  try {
    const decoded = atob(authorization.slice(6));
    const sep = decoded.indexOf(':');
    if (sep < 0) return { user: decoded, pass: '' };
    return { user: decoded.slice(0, sep), pass: decoded.slice(sep + 1) };
  } catch {
    return null;
  }
}

function validateAdminAuth(request, env) {
  const expectedUser = env.REPORTS_ADMIN_USER;
  const expectedPass = env.REPORTS_ADMIN_PASS;
  if (!expectedUser || !expectedPass) {
    return { ok: false, status: 503, error: 'Painel admin não configurado (falta REPORTS_ADMIN_USER / REPORTS_ADMIN_PASS).' };
  }
  const credentials = parseBasicAuth(request.headers.get('authorization') || '');
  if (!credentials) {
    return { ok: false, status: 401, error: 'Utilizador ou palavra-passe incorretos.' };
  }
  if (credentials.user === expectedUser && credentials.pass === expectedPass) {
    return { ok: true };
  }
  return { ok: false, status: 401, error: 'Utilizador ou palavra-passe incorretos.' };
}

function getClientKey(request) {
  return request.headers.get('cf-connecting-ip')
    || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || 'unknown';
}

function checkRateLimit(clientKey) {
  const now = Date.now();
  const recent = (requestLog.get(clientKey) || []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_UPLOADS_PER_WINDOW) {
    return { ok: false, status: 429, error: 'Demasiados envios. Espera um pouco.' };
  }
  recent.push(now);
  requestLog.set(clientKey, recent);
  return { ok: true };
}

async function saveReportAttachment(kv, reportId, buffer, mimeType, filename) {
  await kv.put(attachmentKey(reportId), buffer, {
    metadata: {
      contentType: mimeType,
      filename: String(filename || 'imagem').slice(0, 120),
      size: String(buffer.byteLength),
    },
  });
  return {
    reportId,
    mimeType,
    filename: String(filename || 'imagem').slice(0, 120),
    size: buffer.byteLength,
  };
}

async function getReportAttachment(kv, reportId) {
  const result = await kv.getWithMetadata(attachmentKey(reportId), { type: 'arrayBuffer' });
  if (!result?.value) return null;
  return {
    data: result.value,
    mimeType: result.metadata?.contentType || 'application/octet-stream',
    filename: result.metadata?.filename || 'imagem',
    size: result.value.byteLength,
  };
}

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*' } });
  }

  const kv = context.env.REPORTS_KV;
  if (!kv) {
    return json(503, { error: 'Armazenamento não configurado (falta binding REPORTS_KV).' });
  }

  if (context.request.method === 'GET') {
    const auth = validateAdminAuth(context.request, context.env);
    if (!auth.ok) return json(auth.status, { error: auth.error });

    const url = new URL(context.request.url);
    const reportId = clip(url.searchParams.get('reportId'), 80);
    if (!isValidReportId(reportId)) {
      return json(400, { error: 'Reporte inválido.' });
    }

    const attachment = await getReportAttachment(kv, reportId);
    if (!attachment) return json(404, { error: 'Imagem não encontrada.' });

    return new Response(attachment.data, {
      status: 200,
      headers: {
        'content-type': attachment.mimeType,
        'cache-control': 'private, no-store',
        'access-control-allow-origin': '*',
      },
    });
  }

  if (context.request.method !== 'POST') {
    return json(405, { error: 'Método não permitido' });
  }

  const raw = await context.request.text();
  if (raw.length > MAX_UPLOAD_BODY_CHARS) {
    return json(413, { error: 'Imagem demasiado grande.' });
  }

  let payload;
  try {
    payload = JSON.parse(raw || '{}');
  } catch {
    return json(400, { error: 'JSON inválido.' });
  }

  const reportId = clip(payload.reportId, 80);
  const mimeType = String(payload.mimeType || '').toLowerCase();
  const filename = clip(payload.filename, 120) || 'imagem';
  if (!isValidReportId(reportId)) {
    return json(400, { error: 'Reporte inválido.' });
  }
  if (!isAllowedAttachmentMime(mimeType)) {
    return json(400, { error: 'Tipo de imagem não suportado.' });
  }

  const rate = checkRateLimit(getClientKey(context.request));
  if (!rate.ok) return json(rate.status, { error: rate.error });

  let buffer;
  try {
    const binary = atob(String(payload.dataBase64 || ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    buffer = bytes.buffer;
  } catch {
    return json(400, { error: 'Imagem inválida.' });
  }

  if (!buffer.byteLength || buffer.byteLength > MAX_ATTACHMENT_BYTES) {
    return json(400, { error: `A imagem deve ter no máximo ${Math.round(MAX_ATTACHMENT_BYTES / (1024 * 1024))} MB.` });
  }

  try {
    const saved = await saveReportAttachment(kv, reportId, buffer, mimeType, filename);
    return json(200, { ok: true, attachment: saved });
  } catch (err) {
    console.error('[report-attachment] save failed:', err);
    return json(503, { error: 'Não foi possível guardar a imagem. Tenta outra vez.' });
  }
}
