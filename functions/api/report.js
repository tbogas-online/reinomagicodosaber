// POST /api/report — Cloudflare Pages. Replica netlify/functions/report.js com KV opcional.

const MAX_BODY_CHARS = 8000;
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

const INDEX_KEY = 'reports-index';
const MAX_REPORTS = 2000;
const requestLog = new Map();
const WINDOW_MS = 60 * 1000;
const MAX_REPORTS_PER_WINDOW = 12;

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
    question: clip(payload.question, 500),
    category,
    surprise: !!payload.surprise,
    ageBand: clip(payload.ageBand, 16),
    format: clip(payload.format, 40),
    source: clip(payload.source, 24),
    options: Array.isArray(payload.options)
      ? payload.options.slice(0, 6).map((o) => clip(o, 120))
      : [],
    correctAnswer: clip(payload.correctAnswer, 200),
    selectedAnswer: clip(payload.selectedAnswer, 200) || null,
    issueType,
    issueLabel: clip(payload.issueLabel, 80),
    comment: clip(payload.comment, 400),
    suggestion: clip(payload.suggestion, 400),
    attachments: Array.isArray(payload.attachments)
      ? payload.attachments.slice(0, 1).map((item) => ({
          filename: clip(item?.filename, 120) || 'imagem',
          mimeType: clip(item?.mimeType, 40),
          size: Math.min(Math.max(Number(item?.size) || 0, 0), 1.5 * 1024 * 1024),
        })).filter((item) => item.mimeType.startsWith('image/') && item.size > 0)
      : [],
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

async function readIndex(kv) {
  const raw = await kv.get(INDEX_KEY);
  if (!raw) return { items: [], total: 0 };
  try {
    const index = JSON.parse(raw);
    return index && Array.isArray(index.items) ? index : { items: [], total: 0 };
  } catch {
    return { items: [], total: 0 };
  }
}

async function saveReportKv(kv, report) {
  await kv.put(`report:${report.reportId}`, JSON.stringify(report));
  const index = await readIndex(kv);
  index.items.unshift({
    reportId: report.reportId,
    receivedAt: report.receivedAt,
    issueType: report.issueType,
    ageBand: report.ageBand,
    categoryName: String(report.issueType || '').startsWith('site_')
      ? 'Site/app'
      : (report.category?.name || ''),
    reporterId: report.reporterId || '',
    deviceType: report.device?.type || '',
    status: report.status === 'resolved' ? 'resolved' : 'open',
  });
  if (index.items.length > MAX_REPORTS) {
    const removed = index.items.splice(MAX_REPORTS);
    for (const item of removed) {
      await kv.delete(`report:${item.reportId}`);
    }
  }
  index.total = index.items.length;
  await kv.put(INDEX_KEY, JSON.stringify(index));
}

export async function onRequestPost(context) {
  const raw = await context.request.text();
  if (raw.length > MAX_BODY_CHARS) {
    return json(413, { error: 'Reporte demasiado grande.' });
  }

  let payload;
  try {
    payload = JSON.parse(raw || '{}');
  } catch {
    return json(400, { error: 'JSON inválido.' });
  }

  const issueType = clip(payload.issueType, 40);
  if (!ISSUE_TYPES.has(issueType)) {
    return json(400, { error: 'Tipo de problema inválido.' });
  }

  const clientKey = context.request.headers.get('cf-connecting-ip')
    || context.request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || 'unknown';
  const now = Date.now();
  const recent = (requestLog.get(clientKey) || []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_REPORTS_PER_WINDOW) {
    return json(429, { error: 'Demasiados reportes. Espera um pouco.' });
  }
  recent.push(now);
  requestLog.set(clientKey, recent);

  const report = buildReport(payload);
  const kv = context.env.REPORTS_KV;
  if (kv) {
    try {
      await saveReportKv(kv, report);
    } catch (err) {
      console.error('[question-report] KV save failed:', err);
      console.log('[question-report]', JSON.stringify(report));
      return json(503, { error: 'Não foi possível guardar o reporte. Tenta outra vez.' });
    }
  } else {
    console.log('[question-report]', JSON.stringify(report));
  }

  return json(200, { ok: true, reportId: report.reportId });
}

export async function onRequest(context) {
  if (context.request.method === 'POST') return onRequestPost(context);
  if (context.request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*' } });
  }
  return json(405, { error: 'Método não permitido' });
}
