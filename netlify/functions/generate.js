const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-20b';
const { validateGameClient } = require('./lib/report-utils');
const { recordAiRequest, extractUsageTokens, quotaUsedFromRateLimitHeaders } = require('./lib/ai-usage-store');

function trackAiUsage(ok, enabled, meta = {}) {
  if (!enabled) return;
  recordAiRequest({
    ok: !!ok,
    provider: meta.provider || '',
    model: meta.model || '',
    tokens: meta.tokens || 0,
    latencyMs: meta.latencyMs,
    limitHit: !!meta.limitHit,
    quotaTokensUsed: meta.quotaTokensUsed,
  }).catch((err) => {
    console.warn('[generate] usage bucket:', err?.message || err);
  });
}

function isProviderRateLimitError(err) {
  if (!err) return false;
  if (err.isRateLimit) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /rate limit|limite de pedidos atingido|tokens per min|too many requests/i.test(msg);
}

function parseModelsAttemptedTail(modelsAttempted = []) {
  const last = Array.isArray(modelsAttempted) ? modelsAttempted[modelsAttempted.length - 1] : '';
  if (!last || !String(last).includes(':')) return { provider: '', model: '' };
  const [provider, ...modelParts] = String(last).split(':');
  return { provider: provider || '', model: modelParts.join(':') || '' };
}
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const ANTHROPIC_VERSION = '2023-06-01';

const MAX_REQUEST_CHARS = 12000;
const MAX_OUTPUT_TOKENS = 500;
const MAX_REASONING_OUTPUT_TOKENS = 2048;
const REASONING_PROBE_MAX_TOKENS = 80;
const DEFAULT_PROVIDER_ORDER = 'groq,openai,anthropic';
const API_FEATURES = { provider_strict: true, version: '20260815-7' };
const ALLOWED_PROVIDERS = ['groq', 'anthropic', 'openai'];
const ANTHROPIC_JSON_SYSTEM = 'Responde apenas com json válido, sem markdown nem texto antes ou depois.';
const GROQ_JSON_SYSTEM = ANTHROPIC_JSON_SYSTEM;
const OPENAI_JSON_SYSTEM = ANTHROPIC_JSON_SYSTEM;
const GROQ_MODEL_ALIASES = {};
const GROQ_REASONING_MODELS = new Set(['openai/gpt-oss-120b', 'openai/gpt-oss-20b']);
const GROQ_QWEN_MODEL_PATTERN = /^qwen\//i;
const ALLOWED_MODELS = {
  groq: new Set([
    'openai/gpt-oss-120b',
    'openai/gpt-oss-20b',
    'qwen/qwen3.6-27b',
  ]),
  anthropic: new Set(['claude-haiku-4-5-20251001', 'claude-sonnet-4-5-20250929', 'claude-3-5-haiku-20241022']),
  openai: new Set(['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini']),
};
// Em modo "auto", tenta estes modelos por fornecedor antes de saltar para o próximo.
const MODEL_FALLBACK_ORDER = {
  groq: ['qwen/qwen3.6-27b', 'openai/gpt-oss-20b', 'openai/gpt-oss-120b'],
  openai: ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4o'],
  anthropic: ['claude-haiku-4-5-20251001', 'claude-3-5-haiku-20241022', 'claude-sonnet-4-5-20250929'],
};

// Best-effort per-instance protection. Serverless instances are ephemeral, so this
// is not a hard global quota, but it helps prevent accidental request loops.
const requestLog = new Map();
const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 45;

exports.handler = async (event) => {
  let trackUsage = false;
  try {
    if (event.httpMethod !== 'POST') {
      return json(405, { error: 'Método não permitido' });
    }

    const clientAuth = validateGameClient(event);
    if (!clientAuth.ok) {
      return json(clientAuth.status, { error: clientAuth.error });
    }
    trackUsage = true;

    let payload;
    try {
      payload = JSON.parse(event.body || '{}');
    } catch {
      trackAiUsage(false, trackUsage);
      return json(400, { error: 'Pedido inválido: JSON malformado.' });
    }

    const clientPreference = typeof payload.provider_preference === 'string'
      ? payload.provider_preference
      : 'auto';
    const providerStrict = payload.provider_strict === true;

    const { providers, error: configError, attempted_providers: configAttempted } = resolveProviderOrder(clientPreference, providerStrict);
    if (!providers.length) {
      trackAiUsage(false, trackUsage);
      return json(500, {
        error: configError || 'Nenhuma chave de IA configurada no Netlify. Adiciona GROQ_API_KEY, ANTHROPIC_API_KEY e/ou OPENAI_API_KEY em Environment variables e faz um novo deploy.',
        attempted_providers: configAttempted || (normalizeClientPreference(clientPreference) !== 'auto'
          ? [normalizeClientPreference(clientPreference)]
          : []),
        configured_providers: {
          groq: !!(process.env.GROQ_API_KEY || '').trim(),
          openai: !!(process.env.OPENAI_API_KEY || '').trim(),
          anthropic: !!(process.env.ANTHROPIC_API_KEY || '').trim(),
        },
        provider_strict: providerStrict,
        api_features: API_FEATURES,
      });
    }

    const clientKey = event.headers?.['x-nf-client-connection-ip'] ||
      event.headers?.['client-ip'] ||
      event.headers?.['x-forwarded-for']?.split(',')[0]?.trim() ||
      'unknown';

    const now = Date.now();
    const previous = requestLog.get(clientKey) || [];
    const recent = previous.filter((t) => now - t < WINDOW_MS);
    if (recent.length >= MAX_REQUESTS_PER_WINDOW) {
      const oldest = recent[0] || now;
      const retryAfter = Math.max(1, Math.ceil((WINDOW_MS - (now - oldest)) / 1000));
      trackAiUsage(false, trackUsage);
      return json(429, {
        error: `Demasiados pedidos neste minuto (limite da app: ${MAX_REQUESTS_PER_WINDOW}/min, não da Groq/OpenAI). Espera cerca de ${retryAfter} s.`,
        retry_after: retryAfter,
        limit: MAX_REQUESTS_PER_WINDOW,
      });
    }
    recent.push(now);
    requestLog.set(clientKey, recent);

    if (!Array.isArray(payload.messages) || payload.messages.length === 0) {
      trackAiUsage(false, trackUsage);
      return json(400, { error: 'Pedido inválido: messages é obrigatório.' });
    }

    const messages = payload.messages
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .map((m) => ({ role: m.role, content: m.content }));

    if (!messages.length) {
      trackAiUsage(false, trackUsage);
      return json(400, { error: 'Pedido inválido: não existem mensagens válidas.' });
    }

    const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
    if (totalChars > MAX_REQUEST_CHARS) {
      trackAiUsage(false, trackUsage);
      return json(413, { error: 'Pedido demasiado grande.' });
    }

    const requestedTokens = Number(payload.max_tokens) || 300;
    const requestedModel = typeof payload.model === 'string' ? payload.model : 'auto';

    const errors = [];
    const attempted = [];
    const modelsAttempted = [];
    for (const provider of providers) {
      const models = resolveModelsForProvider(provider.name, requestedModel, process.env);
      for (const model of models) {
        modelsAttempted.push(`${provider.name}:${model}`);
        try {
          const maxTokens = effectiveMaxTokens(provider.name, model, requestedTokens);
          const started = Date.now();
          const result = await callProvider(provider.name, provider.apiKey, messages, maxTokens, model);
          trackAiUsage(true, trackUsage, {
            provider: provider.name,
            model,
            tokens: extractUsageTokens(result.usage),
            latencyMs: Date.now() - started,
            quotaTokensUsed: result.quotaTokensUsed,
          });
          return json(200, {
            ...result,
            provider: provider.name,
            model,
            providers_tried: [...new Set(modelsAttempted.map((entry) => entry.split(':')[0]))],
            models_tried: modelsAttempted,
            fallback_used: modelsAttempted.length > 1,
            provider_strict: providerStrict,
            api_features: API_FEATURES,
          });
        } catch (err) {
          console.error(`${provider.name}/${model} request failed:`, err);
          const message = err instanceof Error ? err.message : String(err);
          if (isProviderRateLimitError(err)) {
            trackAiUsage(false, trackUsage, {
              provider: provider.name,
              model,
              limitHit: true,
              quotaTokensUsed: err.quotaTokensUsed,
            });
          }
          errors.push(localizeProviderError(provider.name, `${model}: ${message}`));
        }
      }
      attempted.push(provider.name);
    }

    trackAiUsage(false, trackUsage, parseModelsAttemptedTail(modelsAttempted));
    return formatProviderFailure(errors, attempted, { providerStrict, modelsAttempted });
  } catch (err) {
    console.error('generate handler error:', err);
    trackAiUsage(false, trackUsage);
    return json(500, {
      error: 'Erro interno na função de IA.',
      detail: err instanceof Error ? err.message : String(err),
    });
  }
};

function callProvider(name, apiKey, messages, maxTokens, model) {
  if (name === 'anthropic') return callAnthropic(apiKey, messages, maxTokens, model);
  if (name === 'openai') return callOpenAICompatible({
    endpoint: 'https://api.openai.com/v1/chat/completions',
    apiKey, model, messages, maxTokens, providerLabel: 'OpenAI', providerName: 'openai',
  });
  return callOpenAICompatible({
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    apiKey, model, messages, maxTokens, providerLabel: 'Groq', providerName: 'groq',
  });
}

function buildProviderList(available, order, firstProvider = null) {
  const requestedOrder = order
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const names = [];
  if (firstProvider && available[firstProvider]) names.push(firstProvider);
  for (const name of requestedOrder) {
    if (available[name] && !names.includes(name)) names.push(name);
  }
  for (const name of ALLOWED_PROVIDERS) {
    if (available[name] && !names.includes(name)) names.push(name);
  }
  return names.map((name) => ({ name, apiKey: available[name] }));
}

function resolveProviderOrder(clientPreference = 'auto', strict = false) {
  const groqKey = (process.env.GROQ_API_KEY || '').trim();
  const anthropicKey = (process.env.ANTHROPIC_API_KEY || '').trim();
  const openaiKey = (process.env.OPENAI_API_KEY || '').trim();
  const forced = (process.env.AI_PROVIDER || '').trim().toLowerCase();
  const pref = normalizeClientPreference(clientPreference);
  const order = process.env.AI_PROVIDER_ORDER || DEFAULT_PROVIDER_ORDER;

  const available = { groq: groqKey, anthropic: anthropicKey, openai: openaiKey };
  const providerLabels = { groq: 'Groq', anthropic: 'Anthropic', openai: 'OpenAI' };

  if (forced) {
    if (available[forced]) return { providers: [{ name: forced, apiKey: available[forced] }] };
    return {
      providers: [],
      error: `AI_PROVIDER="${forced}" é inválido ou sem chave configurada. Usa "groq", "anthropic" ou "openai".`,
    };
  }

  if (pref !== 'auto') {
    if (!available[pref]) {
      return {
        providers: [],
        error: `${providerLabels[pref]} não está configurado no servidor. Adiciona a chave nas variáveis de ambiente do Netlify.`,
        attempted_providers: [pref],
      };
    }
    if (strict) {
      return { providers: [{ name: pref, apiKey: available[pref] }] };
    }
    return { providers: buildProviderList(available, order, pref) };
  }

  return { providers: buildProviderList(available, order) };
}

function normalizeClientPreference(value) {
  const pref = String(value || 'auto').trim().toLowerCase();
  return ALLOWED_PROVIDERS.includes(pref) ? pref : 'auto';
}

function normalizeGroqModel(model, env) {
  const raw = String(model || env.GROQ_MODEL || GROQ_MODEL).trim();
  return GROQ_MODEL_ALIASES[raw] || raw;
}

function defaultModelFor(provider, env) {
  if (provider === 'anthropic') return env.ANTHROPIC_MODEL || ANTHROPIC_MODEL;
  if (provider === 'openai') return env.OPENAI_MODEL || OPENAI_MODEL;
  return normalizeGroqModel(env.GROQ_MODEL || GROQ_MODEL, env);
}

function resolveModelForProvider(provider, requestedModel, env) {
  const models = resolveModelsForProvider(provider, requestedModel, env);
  return models[0];
}

function resolveModelsForProvider(provider, requestedModel, env) {
  const model = String(requestedModel || '').trim();
  if (model && model !== 'auto') {
    return [resolveModelForProviderSingle(provider, model, env)];
  }

  const allowed = ALLOWED_MODELS[provider];
  const order = MODEL_FALLBACK_ORDER[provider] || [];
  const models = [];
  for (const id of order) {
    if (!allowed?.has(id)) continue;
    const resolved = provider === 'groq' ? normalizeGroqModel(id, env) : id;
    if (!models.includes(resolved)) models.push(resolved);
  }
  if (!models.length) models.push(defaultModelFor(provider, env));
  return models;
}

function resolveModelForProviderSingle(provider, requestedModel, env) {
  const model = String(requestedModel || '').trim();
  if (!model || model === 'auto') return defaultModelFor(provider, env);
  const allowed = ALLOWED_MODELS[provider];
  if (allowed && allowed.has(model)) {
    return provider === 'groq' ? normalizeGroqModel(model, env) : model;
  }
  return defaultModelFor(provider, env);
}

function effectiveMaxTokens(provider, model, requested) {
  const base = Math.min(Math.max(Number(requested) || 300, 50), MAX_OUTPUT_TOKENS);
  if (provider === 'groq' && GROQ_REASONING_MODELS.has(model)) {
    // Modelos gpt-oss gastam tokens em raciocínio interno; probes curtos mantêm o pedido pequeno.
    if (base <= REASONING_PROBE_MAX_TOKENS) return base;
    return Math.min(Math.max(base, 800), MAX_REASONING_OUTPUT_TOKENS);
  }
  return base;
}

function isGroqQwenModel(model) {
  return GROQ_QWEN_MODEL_PATTERN.test(String(model || ''));
}

function sanitizeAssistantContent(text) {
  let out = String(text || '');
  out = out.replace(/<think>[\s\S]*?<\/redacted_thinking>/gi, '');
  out = out.replace(/<think>[\s\S]*/gi, '');
  out = out.replace(/[\s\S]*?<\/think>/gi, '');
  return out.replace(/```json|```/g, '').trim();
}

function extractAssistantText(message, { skipReasoning = false } = {}) {
  if (!message) return '';
  const direct = message.content;
  if (typeof direct === 'string' && direct.trim()) return sanitizeAssistantContent(direct);
  if (Array.isArray(direct)) {
    const text = direct.map((part) => (typeof part === 'string' ? part : part?.text || '')).join('');
    if (text.trim()) return sanitizeAssistantContent(text);
  }
  if (!skipReasoning) {
    for (const key of ['reasoning', 'reasoning_content']) {
      const value = message[key];
      if (typeof value === 'string' && value.trim()) return sanitizeAssistantContent(value);
    }
  }
  return sanitizeAssistantContent(typeof direct === 'string' ? direct : '');
}

function isEmptyLengthError(err) {
  return /resposta vazia \(limite de tokens/i.test(err instanceof Error ? err.message : String(err));
}

// Groq e OpenAI expõem uma API de chat compatível com o formato da OpenAI,
// por isso partilham esta mesma função de pedido.
async function callOpenAICompatible({ endpoint, apiKey, model, messages, maxTokens, providerLabel, providerName }){
  const isGroq = providerLabel === 'Groq';
  const tokenAttempts = [maxTokens];
  if (isGroq && GROQ_REASONING_MODELS.has(model) && maxTokens < MAX_REASONING_OUTPUT_TOKENS) {
    tokenAttempts.push(MAX_REASONING_OUTPUT_TOKENS);
  }

  let lastErr;
  for (const tokens of tokenAttempts) {
  try {
    return await callOpenAICompatibleOnce({
      endpoint, apiKey, model, messages, maxTokens: tokens, providerLabel, providerName,
      useJsonFormat: !isGroq,
    });
  } catch (err) {
    lastErr = err;
    const msg = err instanceof Error ? err.message : String(err);
    if (isGroq && /failed to validate json|validate json/i.test(msg)) {
      try {
        return await callOpenAICompatibleOnce({
          endpoint, apiKey, model, messages, maxTokens: tokens, providerLabel, providerName,
          useJsonFormat: false,
        });
      } catch (retryErr) {
        lastErr = retryErr;
        if (isEmptyLengthError(retryErr) && tokens !== tokenAttempts[tokenAttempts.length - 1]) continue;
        throw retryErr;
      }
    }
    if (isEmptyLengthError(err) && tokens !== tokenAttempts[tokenAttempts.length - 1]) continue;
    throw err;
  }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function callOpenAICompatibleOnce({ endpoint, apiKey, model, messages, maxTokens, providerLabel, providerName, useJsonFormat }){
  const isGroq = providerLabel === 'Groq';
  const apiMessages = isGroq
    ? [{ role: 'system', content: GROQ_JSON_SYSTEM }, ...messages]
    : (useJsonFormat
      ? [{ role: 'system', content: OPENAI_JSON_SYSTEM }, ...messages]
      : messages);
  const requestBody = {
    model,
    messages: apiMessages,
    temperature: 0.7,
    max_completion_tokens: maxTokens,
  };
  if (useJsonFormat) requestBody.response_format = { type: 'json_object' };
  if (isGroq) requestBody.max_tokens = maxTokens;
  if (isGroq && isGroqQwenModel(model)) {
    requestBody.reasoning_effort = 'none';
    if (useJsonFormat) requestBody.reasoning_format = 'hidden';
  }
  if (isGroq && GROQ_REASONING_MODELS.has(model)) {
    requestBody.reasoning_effort = 'low';
    requestBody.include_reasoning = false;
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
  });

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { error: text || 'Resposta inválida do serviço de IA.' };
  }

  if (!response.ok) {
    const message = data?.error?.message || data?.error || `Erro do serviço ${providerLabel} (${response.status})`;
    console.error(`${providerLabel} API error:`, response.status, data);
    const err = new Error(localizeAiErrorText(message));
    err.isRateLimit = response.status === 429 || /rate limit|too many requests/i.test(message);
    if (err.isRateLimit) {
      err.quotaTokensUsed = quotaUsedFromRateLimitHeaders(readOpenAiStyleHeaders(response.headers));
    }
    throw err;
  }

  const rateLimit = readOpenAiStyleHeaders(response.headers);
  const quotaTokensUsed = quotaUsedFromRateLimitHeaders(rateLimit);

  const choice = data?.choices?.[0];
  const rawContent = choice?.message?.content || '';
  const content = extractAssistantText(choice?.message, { skipReasoning: isGroq });
  if (content && !/\{/.test(content) && /<redacted_thinking|thinking process/i.test(`${rawContent}`)) {
    throw new Error(`${providerLabel}: o modelo devolveu raciocínio em vez de JSON.`);
  }
  if (!content.trim() && choice?.finish_reason === 'length') {
    throw new Error(`${providerLabel}: resposta vazia (limite de tokens atingido). Tenta outro modelo.`);
  }

  return {
    id: data.id,
    type: 'message',
    role: 'assistant',
    provider: providerName,
    model,
    content: [{ type: 'text', text: content }],
    usage: data.usage || undefined,
    quotaTokensUsed,
  };
}

async function callAnthropic(apiKey, messages, maxTokens, model) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: ANTHROPIC_JSON_SYSTEM,
      messages,
    }),
  });

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { error: text || 'Resposta inválida do serviço de IA.' };
  }

  if (!response.ok) {
    const message = data?.error?.message || data?.error || `Erro do serviço Anthropic (${response.status})`;
    console.error('Anthropic API error:', response.status, data);
    const err = new Error(localizeAiErrorText(message));
    err.isRateLimit = response.status === 429 || /rate limit|too many requests/i.test(message);
    if (err.isRateLimit) {
      err.quotaTokensUsed = quotaUsedFromRateLimitHeaders(readAnthropicHeaders(response.headers));
    }
    throw err;
  }

  const quotaTokensUsed = quotaUsedFromRateLimitHeaders(readAnthropicHeaders(response.headers));

  // A resposta da Anthropic já vem no formato { content: [{type:'text', text:'...'}] },
  // que é exatamente o que o frontend do jogo já espera.
  return {
    id: data.id,
    type: 'message',
    role: 'assistant',
    provider: 'anthropic',
    model,
    content: data.content || [],
    usage: data.usage || undefined,
    quotaTokensUsed,
  };
}

function headerNumber(headers, key) {
  const value = headers.get(key);
  if (value == null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function readOpenAiStyleHeaders(headers) {
  return {
    requests_limit: headerNumber(headers, 'x-ratelimit-limit-requests'),
    requests_remaining: headerNumber(headers, 'x-ratelimit-remaining-requests'),
    tokens_limit: headerNumber(headers, 'x-ratelimit-limit-tokens'),
    tokens_remaining: headerNumber(headers, 'x-ratelimit-remaining-tokens'),
    tokens_day_limit: headerNumber(headers, 'x-ratelimit-limit-tokens-day'),
    tokens_day_remaining: headerNumber(headers, 'x-ratelimit-remaining-tokens-day'),
  };
}

function readAnthropicHeaders(headers) {
  return {
    requests_limit: headerNumber(headers, 'anthropic-ratelimit-requests-limit'),
    requests_remaining: headerNumber(headers, 'anthropic-ratelimit-requests-remaining'),
    tokens_limit: headerNumber(headers, 'anthropic-ratelimit-tokens-limit'),
    tokens_remaining: headerNumber(headers, 'anthropic-ratelimit-tokens-remaining'),
  };
}

function localizeAiErrorText(text) {
  return String(text || '')
    .replace(/failed to validate json/gi, 'falha ao validar JSON')
    .replace(/please adjust your prompt/gi, 'ajusta o pedido')
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
    .replace(/incorrect api key provided/gi, 'chave de API incorreta')
    .replace(/invalid api key/gi, 'chave de API inválida')
    .replace(/invalid x-api-key/gi, 'chave x-api-key inválida')
    .replace(/authentication failed/gi, 'falha na autenticação')
    .replace(/unauthorized/gi, 'não autorizado')
    .replace(/exceeded your current quota/gi, 'quota atual esgotada')
    .replace(/you have no credits remaining/gi, 'não tens créditos na conta OpenAI')
    .replace(/no credits remaining/gi, 'sem créditos na conta OpenAI')
    .replace(/insufficient_quota/gi, 'quota insuficiente')
    .replace(/model `.+?` does not exist/gi, 'modelo indisponível ou não encontrado')
    .replace(/model not found/gi, 'modelo não encontrado')
    .replace(/overloaded_error/gi, 'serviço sobrecarregado')
    .replace(/overloaded/gi, 'sobrecarregado')
    .replace(/internal server error/gi, 'erro interno do serviço')
    .replace(/bad gateway/gi, 'gateway inválido')
    .replace(/service unavailable/gi, 'serviço temporariamente indisponível')
    .replace(/request timed out/gi, 'pedido expirou')
    .replace(/timed out/gi, 'tempo esgotado')
    .replace(/network error/gi, 'erro de rede')
    .replace(/need more tokens\?/gi, 'Precisas de mais tokens?')
    .replace(/upgrade to dev tier today at/gi, 'Faz upgrade para o plano Dev em')
    .replace(/\bLimit (\d+)/g, 'Limite $1')
    .replace(/\bUsed (\d+)/g, 'Usados $1')
    .replace(/\bRequested (\d+)/g, 'Necessários $1')
    .replace(/Environment variables/gi, 'variáveis de ambiente');
}

const AI_PROVIDER_LABELS_PT = { groq: 'Groq', anthropic: 'Anthropic', openai: 'OpenAI' };

function localizeProviderError(provider, message) {
  const label = AI_PROVIDER_LABELS_PT[provider] || provider || 'Serviço';
  const pt = localizeAiErrorText(message);
  return provider ? `${label}: ${pt}` : pt;
}

function localizeProviderErrors(errors) {
  return errors.map((entry) => {
    const match = String(entry).match(/^(groq|anthropic|openai):\s*(.+)$/i);
    if (!match) return localizeAiErrorText(entry);
    return localizeProviderError(match[1].toLowerCase(), match[2]);
  });
}

function formatProviderFailure(errors, attempted = [], opts = {}) {
  const localized = localizeProviderErrors(errors);
  const detail = localized.join(' | ');
  const configured = {
    groq: !!(process.env.GROQ_API_KEY || '').trim(),
    openai: !!(process.env.OPENAI_API_KEY || '').trim(),
    anthropic: !!(process.env.ANTHROPIC_API_KEY || '').trim(),
  };
  const meta = {
    attempted_providers: attempted,
    models_tried: opts.modelsAttempted || [],
    configured_providers: configured,
    provider_strict: opts.providerStrict === true,
    provider_errors: localized,
    api_features: API_FEATURES,
  };
  if (!detail) {
    return json(502, {
      error: 'Nenhum serviço de IA configurado.',
      detail: 'Adiciona GROQ_API_KEY, OPENAI_API_KEY ou ANTHROPIC_API_KEY nas variáveis de ambiente do Netlify e faz redeploy.',
      ...meta,
    });
  }
  if (/resposta vazia \(limite de tokens/i.test(detail)) {
    const reasoningHint = attempted.includes('groq')
      ? ' Os modelos Groq gpt-oss usam tokens internos de raciocínio; o servidor já tentou aumentar o limite automaticamente.'
      : '';
    return json(429, {
      error: 'Limite de tokens de saída atingido neste pedido.',
      detail: `${detail}${reasoningHint} Tenta outro modelo (ex.: qwen/qwen3.6-27b) ou reduz o tamanho do pedido.`,
      ...meta,
    });
  }
  if (/rate limit|limite de pedidos atingido/i.test(detail)) {
    const waitMatch = detail.match(/(?:try again in|tenta de novo em)\s+([^.]+)/i);
    const wait = waitMatch ? ` Tenta de novo em ${waitMatch[1].trim()}.` : ' Tenta de novo mais tarde.';
    const tpdMatch = detail.match(/Limite (\d+), Usados (\d+), Necessários (\d+)/i)
      || detail.match(/Limit (\d+), Used (\d+), Requested (\d+)/i);
    let quotaHint = '';
    if (tpdMatch) {
      const limit = Number(tpdMatch[1]);
      const used = Number(tpdMatch[2]);
      const need = Number(tpdMatch[3]);
      const left = Math.max(0, limit - used);
      quotaHint = ` Restam cerca de ${left} tokens hoje; este pedido precisa de ${need}.`;
    }
    const onlyGroq = attempted.length === 1 && attempted[0] === 'groq';
    const openaiAlsoFailed = attempted.includes('openai') && localized.some((e) => /^openai:/i.test(String(e)));
    const openaiFirstThenGroq = attempted[0] === 'openai' && attempted.includes('groq');
    let errorTitle = 'Limite diário da Groq atingido (plano gratuito).';
    let extra = '';
    if (openaiAlsoFailed) {
      errorTitle = 'Groq e OpenAI sem quota disponível.';
    } else if (opts.providerStrict && attempted[0] === 'openai') {
      errorTitle = 'OpenAI falhou neste teste (modo estrito — Groq não foi usada).';
      extra = ' Verifica OPENAI_API_KEY no Netlify e faz redeploy com Clear cache.';
    } else if (openaiFirstThenGroq) {
      errorTitle = 'OpenAI falhou primeiro; depois a Groq também falhou (limite).';
      extra = ' Na página de teste, com OpenAI selecionado, só deve tentar OpenAI após deploy recente.';
    } else if (onlyGroq && opts.providerStrict) {
      errorTitle = 'Erro inesperado: modo estrito mas só Groq foi tentada.';
      extra = ' Faz redeploy do zip completo (pasta netlify/functions).';
    }
    const fallbackHint = configured.openai || configured.anthropic
      ? (opts.providerStrict
        ? ''
        : ' O servidor tentou automaticamente os fornecedores configurados (Groq → OpenAI → Anthropic).')
      : ' Configura OPENAI_API_KEY no Netlify e faz redeploy com Clear cache.';
    const providerNotes = localized.length ? ` Detalhes: ${localized.join(' · ')}.` : '';
    return json(429, {
      error: errorTitle,
      detail: `${openaiFirstThenGroq ? 'A OpenAI falhou antes do fallback para a Groq.' : (openaiAlsoFailed ? 'A Groq e a OpenAI falharam neste pedido.' : 'Atingiste o limite de tokens por dia no plano gratuito da Groq.')}${quotaHint}${wait}${extra}${fallbackHint}${providerNotes}`,
      ...meta,
    });
  }
  if (/invalid api key|incorrect api key|chave de api|authentication|unauthorized|401|403|não autorizado|falha na autenticação/i.test(detail)) {
    return json(502, {
      error: 'Chave de API inválida ou em falta.',
      detail,
      ...meta,
    });
  }
  return json(502, {
    error: 'Falha ao contactar o serviço de IA.',
    detail,
    ...meta,
  });
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
