/**
 * Fallback resiliente entre providers/modelos de IA.
 * Usado por netlify/functions/generate.js e functions/api/generate.js (cópia).
 */

const ATTEMPT_TIMEOUT_MS = Number(process.env.AI_ATTEMPT_TIMEOUT_MS) || 10000;
const TOTAL_TIMEOUT_MS = Number(process.env.AI_TOTAL_TIMEOUT_MS) || 20000;
const MAX_FALLBACK_ATTEMPTS = Number(process.env.AI_MAX_FALLBACK_ATTEMPTS) || 12;
const CIRCUIT_FAILURE_THRESHOLD = 3;
const CIRCUIT_DEFAULT_COOLDOWN_MS = 60 * 1000;
const CIRCUIT_MAX_COOLDOWN_MS = 5 * 60 * 1000;
const AUTH_DISABLE_MS = 30 * 60 * 1000;

const ERROR_TYPES = Object.freeze({
  RATE_LIMIT: 'RATE_LIMIT',
  TIMEOUT: 'TIMEOUT',
  NETWORK: 'NETWORK',
  SERVER_ERROR: 'SERVER_ERROR',
  AUTH: 'AUTH',
  INVALID_RESPONSE: 'INVALID_RESPONSE',
  QUOTA: 'QUOTA',
  OTHER: 'OTHER',
});

function classifyProviderError(err, httpStatus = 0) {
  const status = Number(httpStatus) || Number(err?.httpStatus) || 0;
  const msg = err instanceof Error ? err.message : String(err || '');

  if (err?.isTimeout || /tempo esgotado|timed out|abort/i.test(msg)) {
    return { errorType: ERROR_TYPES.TIMEOUT, retryable: true, disableProvider: false };
  }
  if (err?.isNetwork || /network error|fetch failed|econnreset|enotfound|failed to fetch/i.test(msg)) {
    return { errorType: ERROR_TYPES.NETWORK, retryable: true, disableProvider: false };
  }
  if (
    status === 401
    || status === 403
    || /invalid api key|incorrect api key|chave de api|authentication failed|unauthorized|não autorizado|falha na autenticação/i.test(msg)
  ) {
    return { errorType: ERROR_TYPES.AUTH, retryable: false, disableProvider: true };
  }
  if (
    status === 429
    || err?.isRateLimit
    || /rate limit|too many requests|limite de pedidos atingido|tokens per min/i.test(msg)
  ) {
    return { errorType: ERROR_TYPES.RATE_LIMIT, retryable: true, disableProvider: false, isRateLimit: true };
  }
  if (/quota|tokens per day|esgotada|insufficient_quota/i.test(msg)) {
    return { errorType: ERROR_TYPES.QUOTA, retryable: true, disableProvider: false, isRateLimit: true };
  }
  if (status >= 500 && status < 600 || /502|503|504|overloaded|indisponível|bad gateway|internal server error/i.test(msg)) {
    return { errorType: ERROR_TYPES.SERVER_ERROR, retryable: true, disableProvider: false };
  }
  if (/json inválido|resposta vazia|failed to validate json|resposta inválida|raciocínio em vez de json/i.test(msg)) {
    return { errorType: ERROR_TYPES.INVALID_RESPONSE, retryable: true, disableProvider: false };
  }
  return { errorType: ERROR_TYPES.OTHER, retryable: true, disableProvider: false };
}

function parseRetryAfterSeconds(headers, message) {
  if (headers) {
    const raw = typeof headers.get === 'function'
      ? (headers.get('retry-after') || headers.get('Retry-After'))
      : (headers['retry-after'] || headers['Retry-After']);
    if (raw != null && raw !== '') {
      const n = Number(raw);
      if (Number.isFinite(n) && n > 0) return Math.min(Math.ceil(n), 600);
      const date = Date.parse(String(raw));
      if (Number.isFinite(date)) {
        return Math.min(600, Math.max(1, Math.ceil((date - Date.now()) / 1000)));
      }
    }
  }
  const match = String(message || '').match(/(?:try again in|tenta de novo em)\s+(\d+)/i);
  if (match) return Math.min(600, Number(match[1]));
  return null;
}

class ProviderCircuitBreaker {
  constructor() {
    this.state = new Map();
  }

  isOpen(provider) {
    const s = this.state.get(provider);
    if (!s?.openUntil) return false;
    return Date.now() < s.openUntil;
  }

  recordFailure(provider, classification, retryAfterSec) {
    const s = this.state.get(provider) || { failures: 0, openUntil: 0 };
    s.failures += 1;
    s.lastErrorType = classification.errorType;

    if (classification.disableProvider) {
      s.openUntil = Date.now() + AUTH_DISABLE_MS;
      this.state.set(provider, s);
      return;
    }

    let cooldownMs = CIRCUIT_DEFAULT_COOLDOWN_MS;
    if (classification.isRateLimit || classification.errorType === ERROR_TYPES.RATE_LIMIT || classification.errorType === ERROR_TYPES.QUOTA) {
      cooldownMs = retryAfterSec
        ? retryAfterSec * 1000
        : Math.min(CIRCUIT_MAX_COOLDOWN_MS, 90 * 1000);
      s.openUntil = Date.now() + cooldownMs;
      this.state.set(provider, s);
      return;
    }

    if (s.failures >= CIRCUIT_FAILURE_THRESHOLD) {
      cooldownMs = Math.min(CIRCUIT_MAX_COOLDOWN_MS, CIRCUIT_DEFAULT_COOLDOWN_MS * s.failures);
      s.openUntil = Date.now() + cooldownMs;
      this.state.set(provider, s);
    }
  }

  recordSuccess(provider) {
    this.state.delete(provider);
  }

  snapshot() {
    const out = {};
    const now = Date.now();
    for (const [provider, s] of this.state.entries()) {
      if (s.openUntil > now) {
        out[provider] = { openUntil: s.openUntil, failures: s.failures, lastErrorType: s.lastErrorType };
      }
    }
    return out;
  }
}

const sharedCircuitBreaker = new ProviderCircuitBreaker();

async function fetchWithTimeout(url, options = {}, timeoutMs = ATTEMPT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err?.name === 'AbortError') {
      const e = new Error('Pedido expirou (tempo esgotado).');
      e.isTimeout = true;
      throw e;
    }
    const e = new Error(err?.message || 'Erro de rede.');
    e.isNetwork = true;
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function buildAttemptRecord(provider, model, classification, latencyMs, message, fallbackTo) {
  return {
    provider,
    model,
    error: classification.errorType,
    errorType: classification.errorType,
    latencyMs,
    message: String(message || '').slice(0, 240),
    fallbackTo: fallbackTo || null,
  };
}

function buildInterleavedAttemptQueue(providerList, resolveModels, circuitBreaker, quotaConserve) {
  const skipped = [];
  const active = [];

  for (const provider of providerList) {
    if (circuitBreaker?.isOpen(provider.name)) {
      skipped.push({
        provider: provider.name,
        model: '',
        error: 'CIRCUIT_OPEN',
        errorType: 'CIRCUIT_OPEN',
        latencyMs: 0,
        skipped: true,
      });
      continue;
    }
    let models = resolveModels(provider.name);
    if (quotaConserve) models = models.slice(0, 1);
    if (!models.length) continue;
    active.push({ provider, models });
  }

  const queue = [];
  let round = 0;
  let hasMore = true;
  while (hasMore) {
    hasMore = false;
    for (const row of active) {
      if (round < row.models.length) {
        queue.push({ provider: row.provider, model: row.models[round] });
        hasMore = true;
      }
    }
    round += 1;
  }

  return { queue, skipped };
}

async function runAiFallbackLoop({
  providerList,
  resolveModels,
  callAttempt,
  quotaConserve = false,
  circuitBreaker = sharedCircuitBreaker,
  totalTimeoutMs = TOTAL_TIMEOUT_MS,
  maxAttempts = MAX_FALLBACK_ATTEMPTS,
}) {
  const startedAt = Date.now();
  const attempts = [];
  const errors = [];
  const modelsAttempted = [];
  let attemptCount = 0;

  const { queue, skipped } = buildInterleavedAttemptQueue(
    providerList,
    resolveModels,
    circuitBreaker,
    quotaConserve,
  );
  attempts.push(...skipped);

  for (let i = 0; i < queue.length; i += 1) {
    if (Date.now() - startedAt >= totalTimeoutMs) break;
    if (attemptCount >= maxAttempts) break;

    const { provider, model } = queue[i];
    if (circuitBreaker?.isOpen(provider.name)) continue;

    attemptCount += 1;
    const attemptStarted = Date.now();
    modelsAttempted.push(`${provider.name}:${model}`);
    const nextEntry = queue[i + 1];
    const fallbackTo = nextEntry ? `${nextEntry.provider.name}:${nextEntry.model}` : null;

    try {
      const result = await callAttempt(provider, model, {
        timeoutMs: ATTEMPT_TIMEOUT_MS,
        remainingMs: Math.max(1000, totalTimeoutMs - (Date.now() - startedAt)),
      });
      circuitBreaker?.recordSuccess(provider.name);
      return {
        ok: true,
        result,
        provider: provider.name,
        model,
        attempts,
        modelsAttempted,
        providersTried: [...new Set(modelsAttempted.map((entry) => entry.split(':')[0]))],
        fallbackUsed: modelsAttempted.length > 1,
        totalLatencyMs: Date.now() - startedAt,
      };
    } catch (err) {
      const httpStatus = Number(err?.httpStatus) || 0;
      const classification = classifyProviderError(err, httpStatus);
      const retryAfterSec = parseRetryAfterSeconds(err?.headers, err?.message);
      const latencyMs = Date.now() - attemptStarted;

      const record = buildAttemptRecord(
        provider.name,
        model,
        classification,
        latencyMs,
        err instanceof Error ? err.message : String(err),
        fallbackTo,
      );
      attempts.push(record);
      errors.push({
        provider: provider.name,
        model,
        message: record.message,
        errorType: classification.errorType,
      });

      circuitBreaker?.recordFailure(provider.name, classification, retryAfterSec);

      if (classification.disableProvider) {
        // Saltar restantes entradas deste provider na fila intercalada.
        while (i + 1 < queue.length && queue[i + 1].provider.name === provider.name) {
          i += 1;
        }
      }
    }
  }

  return {
    ok: false,
    errors,
    attempts,
    modelsAttempted,
    providersTried: [...new Set(modelsAttempted.map((entry) => entry.split(':')[0]))],
    totalLatencyMs: Date.now() - startedAt,
  };
}

function summarizeAttemptsForTelemetry(attempts) {
  return (attempts || []).map((a) => ({
    provider: a.provider,
    model: a.model,
    error: a.error || a.errorType || '',
    errorType: a.errorType || '',
    latencyMs: a.latencyMs,
    fallbackTo: a.fallbackTo || null,
    skipped: !!a.skipped,
  }));
}

module.exports = {
  ATTEMPT_TIMEOUT_MS,
  TOTAL_TIMEOUT_MS,
  MAX_FALLBACK_ATTEMPTS,
  ERROR_TYPES,
  classifyProviderError,
  parseRetryAfterSeconds,
  ProviderCircuitBreaker,
  sharedCircuitBreaker,
  fetchWithTimeout,
  buildInterleavedAttemptQueue,
  runAiFallbackLoop,
  summarizeAttemptsForTelemetry,
};
