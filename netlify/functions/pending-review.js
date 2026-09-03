// POST /api/pending-review — enfileira pergunta com dificuldade errada (jogo → fila de revisão).

const { json, getClientKey } = require('./lib/report-utils');
const { getSupabaseAdmin } = require('./lib/rooms-store');
const { queuePendingReviewEntry, isDifficultyOnlyCodes } = require('./lib/question-pending-review-store');

const MAX_BODY_CHARS = 6000;
const requestLog = new Map();
const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 80;

function checkRateLimit(clientKey) {
  const now = Date.now();
  const recent = (requestLog.get(clientKey) || []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) {
    return { ok: false, status: 429, error: 'Demasiados pedidos. Espera um pouco.' };
  }
  recent.push(now);
  requestLog.set(clientKey, recent);
  return { ok: true };
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
      return json(503, { error: 'Supabase não configurado.' });
    }

    const raw = event.body || '';
    if (raw.length > MAX_BODY_CHARS) {
      return json(413, { error: 'Pedido demasiado grande.' });
    }

    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return json(400, { error: 'JSON inválido.' });
    }

    const issueCodes = Array.isArray(body.issueCodes) ? body.issueCodes : [];
    if (!isDifficultyOnlyCodes(issueCodes)) {
      return json(400, { error: 'Só rejeições exclusivamente de dificuldade podem ser enfileiradas.' });
    }

    const rate = checkRateLimit(getClientKey(event.headers));
    if (!rate.ok) {
      return json(rate.status, { error: rate.error });
    }

    try {
      const result = await queuePendingReviewEntry({
        questionHash: body.questionHash,
        categoryN: body.categoryN,
        ageBand: body.ageBand,
        question: body.question,
        correctAnswer: body.correctAnswer,
        options: body.options,
        format: body.format,
        requestedDifficulty: body.requestedDifficulty,
        estimatedDifficulty: body.estimatedDifficulty,
        issueCodes,
        knowledgeKey: body.knowledgeKey,
        knowledgeId: body.knowledgeId,
        source: body.source || 'difficulty-mismatch',
        sourceId: body.sourceId,
        confidence: body.confidence,
        gameMode: body.gameMode,
      });
      return json(200, { ok: true, ...result });
    } catch (err) {
      console.error('[pending-review] queue failed:', err);
      const msg = String(err?.message || '');
      if (msg.includes('queue_question_pending_review') || msg.includes('question_pending_review')) {
        return json(503, { error: 'Fila de revisão não configurada no Supabase.' });
      }
      return json(503, { error: 'Não foi possível enfileirar a pergunta.' });
    }
  } catch (err) {
    console.error('[pending-review] unhandled:', err);
    return json(500, { error: 'Erro interno.' });
  }
};
