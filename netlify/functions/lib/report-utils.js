const MAX_BODY_CHARS = 8000;
const MAX_ATTACHMENT_BYTES = 1.5 * 1024 * 1024;
const ALLOWED_ATTACHMENT_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const ISSUE_TYPES = new Set([
  'wrong_answer',
  'confusing',
  'multiple_correct',
  'bad_options',
  'portuguese',
  'outdated',
  'wrong_category',
  'repeated',
  'other',
  'suggestion',
  'site_bug',
  'site_ui',
  'site_slow',
  'site_suggestion',
  'site_other',
]);

const WINDOW_MS = 60 * 1000;
const MAX_REPORTS_PER_WINDOW = 12;

function clip(value, max) {
  return String(value || '').trim().slice(0, max);
}

function formatPortugalDateTime(dateInput) {
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('pt-PT', {
    timeZone: 'Europe/Lisbon',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
    },
    body: JSON.stringify(body),
  };
}

function getClientKey(headers = {}) {
  return headers['x-nf-client-connection-ip']
    || headers['client-ip']
    || headers['x-forwarded-for']?.split(',')[0]?.trim()
    || 'unknown';
}

function checkRateLimit(requestLog, clientKey) {
  const now = Date.now();
  const recent = (requestLog.get(clientKey) || []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_REPORTS_PER_WINDOW) {
    return { ok: false, status: 429, error: 'Demasiados reportes. Espera um pouco.' };
  }
  recent.push(now);
  requestLog.set(clientKey, recent);
  return { ok: true };
}

function buildDeviceInfo(device) {
  if (!device || typeof device !== 'object') return null;
  const info = {
    type: clip(device.type, 16),
    os: clip(device.os, 24),
    osVersion: clip(device.osVersion, 24),
    browser: clip(device.browser, 24),
    browserVersion: clip(device.browserVersion, 24),
    screen: clip(device.screen, 20),
    viewport: clip(device.viewport, 20),
    pixelRatio: clip(String(device.pixelRatio ?? ''), 8),
    orientation: clip(device.orientation, 24),
    language: clip(device.language, 16),
    languages: clip(device.languages, 80),
    timezone: clip(device.timezone, 40),
    touchPoints: Number(device.touchPoints) || 0,
    connection: clip(device.connection, 16),
    standalone: !!device.standalone,
    pageUrl: clip(device.pageUrl, 200),
    userAgent: clip(device.userAgent, 300),
  };
  return Object.values(info).some((v) => v !== '' && v !== 0 && v !== false) ? info : null;
}

function buildAttachments(payload) {
  if (!Array.isArray(payload?.attachments)) return [];
  return payload.attachments
    .slice(0, 1)
    .map((item) => {
      const mimeType = String(item?.mimeType || '').toLowerCase();
      const size = Number(item?.size) || 0;
      if (!ALLOWED_ATTACHMENT_MIME.has(mimeType) || size <= 0 || size > MAX_ATTACHMENT_BYTES) {
        return null;
      }
      return {
        filename: clip(item.filename, 120) || 'imagem',
        mimeType,
        size,
      };
    })
    .filter(Boolean);
}

function buildReport(payload) {
  const issueType = clip(payload.issueType, 40);
  const isSite = String(issueType).startsWith('site_');
  const category = isSite
    ? { n: 0, name: 'Site/app', desc: 'Reporte do site ou app' }
    : (payload.category && typeof payload.category === 'object'
      ? {
          n: Number(payload.category.n) || 0,
          name: clip(payload.category.name, 80),
          desc: clip(payload.category.desc, 160),
        }
      : null);
  return {
    reportId: clip(payload.reportId, 80),
    questionId: clip(payload.questionId, 80),
    knowledgeId: clip(payload.knowledgeId, 80),
    question: clip(payload.question, 500),
    category,
    surprise: !!payload.surprise,
    ageBand: clip(payload.ageBand, 16),
    format: clip(payload.format, 40),
    source: clip(payload.source, 24),
    sourceId: clip(payload.sourceId, 80),
    questionDbAddedAt: clip(payload.questionDbAddedAt, 40),
    questionDbAddedAtPortugal: clip(payload.questionDbAddedAtPortugal, 40),
    options: Array.isArray(payload.options)
      ? payload.options.slice(0, 6).map((o) => clip(o, 120))
      : [],
    correctAnswer: clip(payload.correctAnswer, 200),
    selectedAnswer: clip(payload.selectedAnswer, 200) || null,
    issueType,
    issueLabel: clip(payload.issueLabel, 80),
    comment: clip(payload.comment, 400),
    suggestion: clip(payload.suggestion, 400),
    attachments: buildAttachments(payload),
    reporterId: clip(payload.reporterId, 48),
    createdAt: clip(payload.createdAt, 40),
    createdAtPortugal: clip(payload.createdAtPortugal, 40),
    appBuild: clip(payload.appBuild, 32),
    gameVersion: clip(payload.gameVersion, 32),
    theme: clip(payload.theme, 8),
    page: clip(payload.page, 16),
    device: buildDeviceInfo(payload.device),
    status: 'open',
    receivedAt: new Date().toISOString(),
  };
}

function validateReportPayload(payload) {
  const issueType = clip(payload?.issueType, 40);
  if (!ISSUE_TYPES.has(issueType)) {
    return { ok: false, status: 400, error: 'Tipo de problema inválido.' };
  }
  return { ok: true, issueType };
}

function parseBasicAuth(authorization) {
  if (!authorization || !authorization.startsWith('Basic ')) return null;
  try {
    const decoded = Buffer.from(authorization.slice(6), 'base64').toString('utf8');
    const sep = decoded.indexOf(':');
    if (sep < 0) return { user: decoded, pass: '' };
    return { user: decoded.slice(0, sep), pass: decoded.slice(sep + 1) };
  } catch {
    return null;
  }
}

function validateAdminAuth(event) {
  const expectedUser = process.env.REPORTS_ADMIN_USER;
  const expectedPass = process.env.REPORTS_ADMIN_PASS;
  if (!expectedUser || !expectedPass) {
    return { ok: false, status: 503, error: 'Painel admin não configurado (falta REPORTS_ADMIN_USER / REPORTS_ADMIN_PASS).' };
  }
  const credentials = parseBasicAuth(event.headers?.authorization || '');
  if (!credentials) {
    return { ok: false, status: 401, error: 'Utilizador ou palavra-passe incorretos.' };
  }
  if (credentials.user === expectedUser && credentials.pass === expectedPass) {
    return { ok: true };
  }
  return { ok: false, status: 401, error: 'Utilizador ou palavra-passe incorretos.' };
}

function validateAdminAuthRequest(request) {
  const expectedUser = process.env.REPORTS_ADMIN_USER;
  const expectedPass = process.env.REPORTS_ADMIN_PASS;
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

function getClientKeyFromRequest(request) {
  return request.headers.get('x-nf-client-connection-ip')
    || request.headers.get('client-ip')
    || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || 'unknown';
}

function jsonResponse(statusCode, body) {
  return new Response(JSON.stringify(body), {
    status: statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
    },
  });
}

module.exports = {
  MAX_BODY_CHARS,
  MAX_ATTACHMENT_BYTES,
  ALLOWED_ATTACHMENT_MIME,
  ISSUE_TYPES,
  WINDOW_MS,
  MAX_REPORTS_PER_WINDOW,
  clip,
  formatPortugalDateTime,
  json,
  getClientKey,
  checkRateLimit,
  buildReport,
  validateReportPayload,
  validateAdminAuth,
  validateAdminAuthRequest,
  getClientKeyFromRequest,
  jsonResponse,
};
