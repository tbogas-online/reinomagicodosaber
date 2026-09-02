// POST /api/bank-replenish — materializa adivinhas do repositório no question_bank
// Chamado pelo jogo quando o stock jogável está baixo (cat. 20).

const { json } = require('./lib/report-utils');
const { replenishCategory20Bank } = require('./lib/bank-replenish-store');

const VALID_AGE_BANDS = new Set(['6-9', '10-15', '15+']);
const MAX_LIMIT = 80;
const COOLDOWN_MS = 60 * 1000;
const lastByKey = new Map();

function cooldownKey(ageBand) {
  return `cat20:${ageBand}`;
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 204, headers: { 'access-control-allow-origin': '*' } };
    }

    if (event.httpMethod !== 'POST') {
      return json(405, { error: 'Método não permitido.' });
    }

    let body = {};
    try {
      body = event.body ? JSON.parse(event.body) : {};
    } catch {
      return json(400, { error: 'Corpo JSON inválido.' });
    }

    const ageBand = String(body.ageBand || '').trim();
    if (!VALID_AGE_BANDS.has(ageBand)) {
      return json(400, { error: 'Indica ageBand: 6-9, 10-15 ou 15+.' });
    }

    const categoryN = Number(body.categoryN || 20);
    if (categoryN !== 20) {
      return json(400, { error: 'Reabastecimento automático só para categoria 20.' });
    }

    const limit = Math.min(Math.max(Number(body.limit) || 40, 1), MAX_LIMIT);
    const force = !!body.force;
    const key = cooldownKey(ageBand);
    const now = Date.now();
    const last = lastByKey.get(key) || 0;
    if (!force && now - last < COOLDOWN_MS) {
      return json(200, {
        ok: true,
        skipped: true,
        reason: 'cooldown',
        retryAfterMs: COOLDOWN_MS - (now - last),
      });
    }

    const result = await replenishCategory20Bank({
      ageBand,
      limit,
      dryRun: !!body.dryRun,
    });

    if (!body.dryRun) lastByKey.set(key, now);
    return json(200, result);
  } catch (err) {
    console.error('[bank-replenish] failed:', err);
    if (err.code === 'NOT_CONFIGURED') {
      return json(503, { error: err.message });
    }
    return json(500, { error: err.message || 'Falha ao reabastecer banco.' });
  }
};
