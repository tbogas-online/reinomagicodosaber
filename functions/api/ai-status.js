// Verifica quotas/limites de tokens por modelo (pedido mínimo a cada API).
// GET /api/ai-status

const GROQ_MODEL_ALIASES = {};

const PROBE_MODELS = {
  groq: ['qwen/qwen3.6-27b', 'openai/gpt-oss-20b', 'openai/gpt-oss-120b'],
  openai: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini'],
  anthropic: ['claude-haiku-4-5-20251001', 'claude-sonnet-4-5-20250929', 'claude-3-5-haiku-20241022'],
};

const PROVIDER_LABELS = { groq: 'Groq', openai: 'OpenAI', anthropic: 'Anthropic' };
const PRIMARY_MODELS = {
  groq: 'openai/gpt-oss-120b',
  openai: 'gpt-4o-mini',
  anthropic: 'claude-haiku-4-5-20251001',
};

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return json(405, { error: 'Método não permitido' });
  }

  const checkedAt = new Date().toISOString();
  const groqKey = (process.env.GROQ_API_KEY || '').trim();
  const openaiKey = (process.env.OPENAI_API_KEY || '').trim();
  const anthropicKey = (process.env.ANTHROPIC_API_KEY || '').trim();

  const providers = {};

  if (groqKey) {
    providers.groq = { label: PROVIDER_LABELS.groq, models: [] };
    const accountLimits = await probeGroqAccountLimits(groqKey);
    if (accountLimits) providers.groq.models.push(accountLimits);
    for (const model of PROBE_MODELS.groq) {
      providers.groq.models.push(await probeGroqModel(groqKey, model));
    }
    providers.groq.summary = summarizeProvider('groq', providers.groq.models);
  }

  if (openaiKey) {
    providers.openai = { label: PROVIDER_LABELS.openai, models: [] };
    for (const model of PROBE_MODELS.openai) {
      providers.openai.models.push(await probeOpenAiModel(openaiKey, model));
    }
    providers.openai.summary = summarizeProvider('openai', providers.openai.models);
  }

  if (anthropicKey) {
    providers.anthropic = { label: PROVIDER_LABELS.anthropic, models: [] };
    for (const model of PROBE_MODELS.anthropic) {
      providers.anthropic.models.push(await probeAnthropicModel(anthropicKey, model));
    }
    providers.anthropic.summary = summarizeProvider('anthropic', providers.anthropic.models);
  }

  return json(200, {
    checked_at: checkedAt,
    order: 'groq,openai,anthropic',
    configured: { groq: !!groqKey, openai: !!openaiKey, anthropic: !!anthropicKey },
    providers,
    note: 'Valores estimados a partir dos cabeçalhos de rate limit ou da última resposta de cada modelo.',
  });
};

function elapsedMs(started) {
  return Math.max(0, Math.round(Date.now() - started));
}

async function probeGroqAccountLimits(apiKey) {
  const started = Date.now();
  try {
    const response = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { authorization: `Bearer ${apiKey}` },
    });
    const headers = readOpenAiStyleHeaders(response.headers);
    const text = await response.text();
    let parsed = {};
    try { parsed = JSON.parse(text); } catch { parsed = {}; }
    const msg = parsed?.error?.message || text || '';
    return buildModelStatus({
      provider: 'groq',
      model: PRIMARY_MODELS.groq,
      resolved: PRIMARY_MODELS.groq,
      status: response.ok ? 'ok' : (response.status === 429 ? 'limited' : 'error'),
      http_status: response.status,
      message: response.ok ? null : localizeAiErrorText(msg),
      headers,
      fromBody: parseLimitFromBody(msg),
      latency_ms: elapsedMs(started),
    });
  } catch {
    return null;
  }
}

async function probeGroqModel(apiKey, model) {
  const resolved = GROQ_MODEL_ALIASES[model] || model;
  return probeOpenAiCompatible({
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    apiKey,
    model,
    resolved,
    provider: 'groq',
  });
}

async function probeOpenAiModel(apiKey, model) {
  return probeOpenAiCompatible({
    endpoint: 'https://api.openai.com/v1/chat/completions',
    apiKey,
    model,
    resolved: model,
    provider: 'openai',
  });
}

async function probeOpenAiCompatible({ endpoint, apiKey, model, resolved, provider }) {
  const started = Date.now();
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: resolved,
        messages: [{ role: 'user', content: 'ok' }],
        max_tokens: 1,
      }),
    });

    const headers = readOpenAiStyleHeaders(response.headers);
    const text = await response.text();
    let parsed = {};
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = {};
    }

    if (!response.ok) {
      const msg = parsed?.error?.message || text || `Erro HTTP ${response.status}`;
      const fromBody = parseLimitFromBody(msg);
      return buildModelStatus({
        provider,
        model,
        resolved,
        status: response.status === 429 ? 'limited' : 'error',
        http_status: response.status,
        message: localizeAiErrorText(msg),
        headers,
        fromBody,
        latency_ms: elapsedMs(started),
      });
    }

    return buildModelStatus({
      provider,
      model,
      resolved,
      status: 'ok',
      http_status: 200,
      headers,
      usage: parsed?.usage || null,
      latency_ms: elapsedMs(started),
    });
  } catch (err) {
    return buildModelStatus({
      provider,
      model,
      resolved,
      status: 'error',
      message: localizeAiErrorText(err instanceof Error ? err.message : String(err)),
      latency_ms: elapsedMs(started),
    });
  }
}

async function probeAnthropicModel(apiKey, model) {
  const started = Date.now();
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ok' }],
      }),
    });

    const headers = readAnthropicHeaders(response.headers);
    const text = await response.text();
    let parsed = {};
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = {};
    }

    if (!response.ok) {
      const msg = parsed?.error?.message || text || `Erro HTTP ${response.status}`;
      const fromBody = parseLimitFromBody(msg);
      return buildModelStatus({
        provider: 'anthropic',
        model,
        resolved: model,
        status: response.status === 429 ? 'limited' : 'error',
        http_status: response.status,
        message: localizeAiErrorText(msg),
        headers,
        fromBody,
        latency_ms: elapsedMs(started),
      });
    }

    return buildModelStatus({
      provider: 'anthropic',
      model,
      resolved: model,
      status: 'ok',
      http_status: 200,
      headers,
      usage: parsed?.usage || null,
      latency_ms: elapsedMs(started),
    });
  } catch (err) {
    return buildModelStatus({
      provider: 'anthropic',
      model,
      resolved: model,
      status: 'error',
      message: localizeAiErrorText(err instanceof Error ? err.message : String(err)),
      latency_ms: elapsedMs(started),
    });
  }
}

function buildModelStatus({ provider, model, resolved, status, http_status, message, headers = {}, fromBody = {}, usage = null, latency_ms = null }) {
  const minuteTokens = buildQuotaWindow({
    limit: fromBody.tokens_limit ?? headers.tokens_limit ?? null,
    remaining: fromBody.tokens_remaining ?? headers.tokens_remaining ?? null,
    resetRaw: headers.tokens_reset_raw ?? null,
    window: 'minute',
  });
  const dayTokens = buildQuotaWindow({
    limit: fromBody.tokens_limit_day ?? headers.tokens_day_limit ?? null,
    remaining: fromBody.tokens_remaining_day ?? headers.tokens_day_remaining ?? null,
    resetRaw: fromBody.retry_in ?? headers.tokens_day_reset_raw ?? null,
    window: 'day',
  });
  const dayRequests = buildQuotaWindow({
    limit: headers.requests_limit ?? headers.requests_day_limit ?? null,
    remaining: headers.requests_remaining ?? headers.requests_day_remaining ?? null,
    resetRaw: headers.requests_reset_raw ?? headers.requests_day_reset_raw ?? null,
    window: 'requests_day',
  });

  const blockers = [dayTokens, minuteTokens, dayRequests].filter((w) => w.exhausted);
  const display = pickDisplayWindow(dayTokens, minuteTokens, dayRequests, blockers, message);
  const blocking = blockers[0] || null;
  const effectiveStatus = status === 'ok' && blockers.length ? 'limited' : status;

  return {
    provider,
    id: model,
    resolved_model: resolved !== model ? resolved : undefined,
    status: effectiveStatus,
    http_status: http_status || null,
    tokens_limit: display.limit,
    tokens_used: display.used,
    tokens_remaining: display.remaining,
    tokens_used_pct: display.limit && display.used != null
      ? Math.min(100, Math.round((display.used / display.limit) * 100))
      : null,
    tokens_requested: fromBody.tokens_requested ?? null,
    tokens_day_limit: dayTokens.limit,
    tokens_day_used: dayTokens.used,
    tokens_day_remaining: dayTokens.remaining,
    tokens_day_reset_in_seconds: dayTokens.resetSeconds,
    tokens_day_reset_in_label: dayTokens.resetSeconds != null ? formatDurationPt(dayTokens.resetSeconds) : null,
    tokens_minute_reset_in_seconds: minuteTokens.resetSeconds,
    tokens_minute_reset_in_label: minuteTokens.resetSeconds != null ? formatDurationPt(minuteTokens.resetSeconds) : null,
    requests_limit: dayRequests.limit,
    requests_remaining: dayRequests.remaining,
    requests_used: dayRequests.used,
    requests_reset_in_seconds: dayRequests.resetSeconds,
    requests_reset_in_label: dayRequests.resetSeconds != null ? formatDurationPt(dayRequests.resetSeconds) : null,
    limit_window: display.window,
    blocking_window: blocking?.window || null,
    reset_in: minuteTokens.resetRaw,
    reset_in_seconds: minuteTokens.resetSeconds,
    reset_at: minuteTokens.resetAt,
    reset_at_label: minuteTokens.resetAt ? formatResetAtLabel(minuteTokens.resetAt) : null,
    reset_in_label: minuteTokens.resetSeconds != null ? formatDurationPt(minuteTokens.resetSeconds) : (minuteTokens.resetRaw || null),
    usable: blockers.length === 0 && effectiveStatus === 'ok',
    message: message || null,
    usage,
    latency_ms: Number.isFinite(latency_ms) ? Math.round(latency_ms) : null,
  };
}

function buildQuotaWindow({ limit, remaining, resetRaw, window }) {
  const used = limit != null && remaining != null ? Math.max(0, limit - remaining) : null;
  const resetSeconds = parseDurationToSeconds(resetRaw, null);
  const resetAt = resetSeconds != null
    ? new Date(Date.now() + resetSeconds * 1000).toISOString()
    : null;
  const exhausted = limit != null && limit > 0 && remaining === 0;
  return { window, limit, remaining, used, resetRaw, resetSeconds, resetAt, exhausted };
}

function pickDisplayWindow(dayTokens, minuteTokens, dayRequests, blockers, message) {
  if (blockers.length) {
    const primary = blockers.find((w) => w.window === 'day')
      || blockers.find((w) => w.window === 'requests_day')
      || blockers[0];
    return {
      window: primary.window === 'requests_day' ? 'day' : primary.window,
      limit: primary.limit,
      remaining: primary.remaining,
      used: primary.used,
      resetRaw: primary.resetRaw,
      resetSeconds: primary.resetSeconds,
      resetAt: primary.resetAt,
    };
  }
  if (/tokens por dia|\(TPD\)|tokens per day/i.test(String(message || '')) && dayTokens.limit != null) {
    return {
      window: 'day',
      limit: dayTokens.limit,
      remaining: dayTokens.remaining,
      used: dayTokens.used,
      resetRaw: dayTokens.resetRaw,
      resetSeconds: dayTokens.resetSeconds,
      resetAt: dayTokens.resetAt,
    };
  }
  if (dayTokens.limit != null) {
    return {
      window: 'day',
      limit: dayTokens.limit,
      remaining: dayTokens.remaining,
      used: dayTokens.used,
      resetRaw: dayTokens.resetRaw || minuteTokens.resetRaw,
      resetSeconds: dayTokens.resetSeconds ?? minuteTokens.resetSeconds,
      resetAt: dayTokens.resetAt || minuteTokens.resetAt,
    };
  }
  return {
    window: 'minute',
    limit: minuteTokens.limit,
    remaining: minuteTokens.remaining,
    used: minuteTokens.used,
    resetRaw: minuteTokens.resetRaw,
    resetSeconds: minuteTokens.resetSeconds,
    resetAt: minuteTokens.resetAt,
  };
}

function summarizeProvider(providerId, models) {
  if (!models?.length) return null;
  const model = pickSummaryModel(providerId, models);
  const billing = models.some((m) => /sem créditos|no credits remaining|insufficient_quota/i.test(m.message || ''))
    || /sem créditos|no credits remaining|insufficient_quota/i.test(model.message || '');
  const anyLimited = models.some((m) => m.usable === false || m.status === 'limited');
  let availability = 'unknown';
  if (billing) availability = 'billing';
  else if (anyLimited) availability = 'limited';
  else if (model.status === 'ok') availability = 'ok';
  else if (model.status === 'error') availability = 'error';

  return {
    provider: providerId,
    label: PROVIDER_LABELS[providerId] || providerId,
    model_id: model.id,
    availability,
    usable: availability === 'ok',
    tokens_limit: model.tokens_limit,
    tokens_used: model.tokens_used,
    tokens_remaining: model.tokens_remaining,
    tokens_used_pct: model.tokens_used_pct,
    tokens_day_limit: model.tokens_day_limit,
    tokens_day_used: model.tokens_day_used,
    tokens_day_remaining: model.tokens_day_remaining,
    tokens_day_reset_in_seconds: model.tokens_day_reset_in_seconds,
    tokens_day_reset_in_label: model.tokens_day_reset_in_label,
    tokens_minute_reset_in_seconds: model.tokens_minute_reset_in_seconds,
    tokens_minute_reset_in_label: model.tokens_minute_reset_in_label,
    requests_limit: model.requests_limit,
    requests_remaining: model.requests_remaining,
    requests_used: model.requests_used,
    requests_reset_in_seconds: model.requests_reset_in_seconds,
    requests_reset_in_label: model.requests_reset_in_label,
    limit_window: model.limit_window,
    blocking_window: model.blocking_window,
    reset_in: model.reset_in,
    reset_in_seconds: model.reset_in_seconds,
    reset_at: model.reset_at,
    reset_at_label: model.reset_at_label,
    reset_in_label: model.reset_in_label,
    message: model.message,
    latency_ms: model.latency_ms,
  };
}

function pickSummaryModel(providerId, models) {
  const primaryId = PRIMARY_MODELS[providerId];
  const score = (model) => {
    let value = 0;
    if (model.id === primaryId) value += 40;
    if (model.usable === false) value += 120;
    if (model.status === 'limited') value += 100;
    if (model.blocking_window === 'day') value += 90;
    if (model.limit_window === 'day') value += 80;
    if (model.tokens_day_remaining === 0) value += 110;
    if (model.tokens_remaining === 0) value += 70;
    if (model.requests_remaining === 0) value += 65;
    if (model.tokens_limit != null) value += 30;
    if (model.reset_in_seconds != null) value += 20;
    if (model.status === 'ok' && model.usable !== false) value += 15;
    if (/sem créditos|no credits remaining/i.test(model.message || '')) value += 70;
    return value;
  };
  return [...models].sort((a, b) => score(b) - score(a))[0];
}

function detectLimitWindow(tokensLimit, message) {
  const text = String(message || '');
  if (/tokens por dia|\(TPD\)|tokens per day/i.test(text)) return 'day';
  if (tokensLimit != null && tokensLimit >= 50000) return 'day';
  if (tokensLimit != null) return 'minute';
  return 'unknown';
}

function readOpenAiStyleHeaders(headers) {
  const tokensResetRaw = headers.get('x-ratelimit-reset-tokens');
  const requestsResetRaw = headers.get('x-ratelimit-reset-requests');
  const tokensDayResetRaw = headers.get('x-ratelimit-reset-tokens-day');
  const requestsDayResetRaw = headers.get('x-ratelimit-reset-requests-day');
  return {
    requests_limit: headerNumber(headers, 'x-ratelimit-limit-requests'),
    requests_remaining: headerNumber(headers, 'x-ratelimit-remaining-requests'),
    requests_reset_raw: requestsResetRaw,
    requests_day_limit: headerNumber(headers, 'x-ratelimit-limit-requests-day'),
    requests_day_remaining: headerNumber(headers, 'x-ratelimit-remaining-requests-day'),
    requests_day_reset_raw: requestsDayResetRaw,
    tokens_limit: headerNumber(headers, 'x-ratelimit-limit-tokens'),
    tokens_remaining: headerNumber(headers, 'x-ratelimit-remaining-tokens'),
    tokens_reset_raw: tokensResetRaw,
    tokens_day_limit: headerNumber(headers, 'x-ratelimit-limit-tokens-day'),
    tokens_day_remaining: headerNumber(headers, 'x-ratelimit-remaining-tokens-day'),
    tokens_day_reset_raw: tokensDayResetRaw,
    retry_in: headers.get('retry-after') || null,
  };
}

function readAnthropicHeaders(headers) {
  const tokensResetAt = headers.get('anthropic-ratelimit-tokens-reset');
  const requestsResetAt = headers.get('anthropic-ratelimit-requests-reset');
  return {
    requests_limit: headerNumber(headers, 'anthropic-ratelimit-requests-limit'),
    requests_remaining: headerNumber(headers, 'anthropic-ratelimit-requests-remaining'),
    tokens_limit: headerNumber(headers, 'anthropic-ratelimit-tokens-limit'),
    tokens_remaining: headerNumber(headers, 'anthropic-ratelimit-tokens-remaining'),
    tokens_reset_at: tokensResetAt,
    requests_reset_at: requestsResetAt,
    retry_in: headers.get('retry-after') || null,
  };
}

function headerNumber(headers, key) {
  const value = headers.get(key);
  if (value == null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function parseLimitFromBody(text) {
  const source = String(text || '');
  const limit = source.match(/\bLimit (\d+)/i);
  const used = source.match(/\bUsed (\d+)/i);
  const requested = source.match(/\bRequested (\d+)/i);
  const retry = source.match(/(?:try again in|please try again in|tenta de novo em)\s+([^.|\n]+)/i);
  const isDaily = /tokens por dia|\(TPD\)|tokens per day/i.test(source);
  const tokens_limit = limit ? Number(limit[1]) : null;
  const tokens_used = used ? Number(used[1]) : null;
  const remaining = tokens_limit != null && tokens_used != null
    ? Math.max(0, tokens_limit - tokens_used)
    : null;
  return {
    tokens_limit: isDaily ? null : tokens_limit,
    tokens_used: isDaily ? null : tokens_used,
    tokens_remaining: isDaily ? null : remaining,
    tokens_limit_day: isDaily ? tokens_limit : null,
    tokens_remaining_day: isDaily ? remaining : null,
    tokens_requested: requested ? Number(requested[1]) : null,
    retry_in: retry ? retry[1].trim() : null,
  };
}

function parseDurationToSeconds(raw, isoFallback = null) {
  if (raw != null && raw !== '') {
    const text = String(raw).trim();

    if (/^\d+(\.\d+)?$/.test(text)) {
      return Math.max(0, Math.ceil(Number(text)));
    }

    const iso = Date.parse(text);
    if (!Number.isNaN(iso) && /[T\-:]/i.test(text)) {
      return Math.max(0, Math.ceil((iso - Date.now()) / 1000));
    }

    // Groq: milissegundos — "547ms" (não confundir com minutos)
    if (/^\d+(?:\.\d+)?ms$/i.test(text)) {
      return Math.max(1, Math.ceil(parseFloat(text) / 1000));
    }

    // Segundos simples — "7.66s"
    if (/^\d+(?:\.\d+)?s$/i.test(text)) {
      return Math.max(0, Math.ceil(parseFloat(text)));
    }

    let total = 0;
    let matched = false;
    const hours = text.match(/(\d+(?:\.\d+)?)\s*h(?!\w)/i);
    const minutes = text.match(/(\d+(?:\.\d+)?)\s*m(?!s)/i);
    const seconds = text.match(/(\d+(?:\.\d+)?)\s*s(?!m)/i);
    if (hours) { total += parseFloat(hours[1]) * 3600; matched = true; }
    if (minutes) { total += parseFloat(minutes[1]) * 60; matched = true; }
    if (seconds) { total += parseFloat(seconds[1]); matched = true; }
    if (matched) return Math.max(0, Math.ceil(total));
  }
  if (isoFallback) {
    const iso = Date.parse(String(isoFallback));
    if (!Number.isNaN(iso)) return Math.max(0, Math.ceil((iso - Date.now()) / 1000));
  }
  return null;
}

function formatDurationPt(seconds) {
  if (seconds == null) return null;
  if (seconds <= 0) return 'agora';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts = [];
  if (h) parts.push(`${h} h`);
  if (m) parts.push(`${m} min`);
  if (!h && !m && s) parts.push(`${s} s`);
  return parts.join(' ') || 'em breve';
}

function formatResetAtLabel(iso) {
  try {
    return new Date(iso).toLocaleString('pt-PT', {
      timeZone: 'Europe/Lisbon',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function localizeAiErrorText(text) {
  return String(text || '')
    .replace(/rate limit reached/gi, 'Limite de pedidos atingido')
    .replace(/\bfor model\b/gi, 'para o modelo')
    .replace(/\bin organization\b/gi, 'na organização')
    .replace(/\bservice tier\b/gi, 'plano')
    .replace(/\bon_demand\b/gi, 'sob demanda')
    .replace(/\bon demand\b/gi, 'sob demanda')
    .replace(/please try again in/gi, 'Tenta de novo em')
    .replace(/try again in/gi, 'Tenta de novo em')
    .replace(/please try again later/gi, 'Tenta de novo mais tarde')
    .replace(/try again later/gi, 'Tenta de novo mais tarde')
    .replace(/tokens per day \(TPD\)/gi, 'tokens por dia (TPD)')
    .replace(/tokens per day/gi, 'tokens por dia')
    .replace(/you have no credits remaining/gi, 'não tens créditos na conta OpenAI')
    .replace(/no credits remaining/gi, 'sem créditos na conta OpenAI')
    .replace(/incorrect api key provided/gi, 'chave de API incorreta')
    .replace(/invalid api key/gi, 'chave de API inválida')
    .replace(/need more tokens\?/gi, 'Precisas de mais tokens?')
    .replace(/upgrade to dev tier today at/gi, 'Faz upgrade para o plano Dev em')
    .replace(/\bLimit (\d+)/g, 'Limite $1')
    .replace(/\bUsed (\d+)/g, 'Usados $1')
    .replace(/\bRequested (\d+)/g, 'Pedidos $1');
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
    body: JSON.stringify(body),
  };
}
