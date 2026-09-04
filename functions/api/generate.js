// Server-side proxy for the AI provider(s) — Cloudflare Pages Functions version
// (corre num Cloudflare Worker). Ficheiro colocado em functions/api/generate.js,
// que o Cloudflare Pages serve automaticamente em /api/generate — não é
// preciso nenhum redirect/configuração extra, ao contrário do Netlify.
//
// O API key(s) NUNCA são expostas ao browser.
// A função aceita a mesma forma de pedido que o jogo já usa e devolve
// sempre uma resposta no formato da Anthropic, para o frontend não precisar
// de saber qual foi o fornecedor que respondeu.
//
// Existe uma versão irmã desta função em netlify/functions/generate.js,
// escrita para o runtime Node.js do Netlify Functions. As duas ficam
// intencionalmente separadas (em vez de partilhar um módulo importado)
// porque os dois runtimes diferem na forma de aceder a variáveis de
// ambiente (process.env vs. context.env) e ao pedido/resposta HTTP — mas a
// LÓGICA (fornecedores, validações, formato de resposta) é mantida
// idêntica entre as duas. Se alterares o comportamento aqui, replica a
// mesma alteração lá.
//
// Suporta três fornecedores de IA, configuráveis por variáveis de ambiente
// (Cloudflare Pages → Settings → Environment variables):
//   GROQ_API_KEY       -> ativa o Groq (modelo Llama)
//   ANTHROPIC_API_KEY  -> ativa a Anthropic (modelo Claude)
//   OPENAI_API_KEY     -> ativa a OpenAI (modelo GPT)
//
// Podes configurar um, dois ou os três ao mesmo tempo. Com mais do que um
// configurado, a função tenta o fornecedor preferido primeiro e, se esse
// pedido falhar (erro de rede, limite atingido, etc.), tenta
// automaticamente o(s) seguinte(s) antes de devolver erro ao browser.
//
// Variáveis opcionais:
//   AI_PROVIDER         -> "groq", "anthropic" ou "openai" para forçar um único fornecedor
//   AI_PROVIDER_ORDER    -> ex.: "groq,openai,anthropic" para definir a ordem de tentativa
//   GROQ_MODEL           -> nome do modelo Groq (default: openai/gpt-oss-20b)
//   ANTHROPIC_MODEL      -> nome do modelo Anthropic (default: claude-haiku-4-5-20251001)
//   OPENAI_MODEL         -> nome do modelo OpenAI (default: gpt-4o-mini)

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  fetchWithTimeout,
  runAiFallbackLoop,
  summarizeAttemptsForTelemetry,
  ATTEMPT_TIMEOUT_MS,
  replenishCircuitBreaker,
} = require('../../netlify/functions/lib/ai-fallback.js');
const {
  resolveModelsForProvider: resolveActiveModelsForProvider,
  getActiveModelsSnapshot,
  isProviderEnabled,
} = require('../../netlify/functions/lib/ai-model-config.js');

const ANTHROPIC_VERSION = '2023-06-01';
const MAX_REQUEST_CHARS = 12000;
const MAX_OUTPUT_TOKENS = 500;
const MAX_REASONING_OUTPUT_TOKENS = 2048;
const REASONING_PROBE_MAX_TOKENS = 80;
const DEFAULT_PROVIDER_ORDER = 'groq,openai,anthropic';
const ALLOWED_PROVIDERS = ['groq', 'anthropic', 'openai'];
const ANTHROPIC_JSON_SYSTEM = 'Responde apenas com json válido, sem markdown nem texto antes ou depois.';
const GROQ_JSON_SYSTEM = ANTHROPIC_JSON_SYSTEM;
const OPENAI_JSON_SYSTEM = ANTHROPIC_JSON_SYSTEM;
const DEFAULT_MODELS = {
  groq: 'openai/gpt-oss-20b',
  anthropic: 'claude-haiku-4-5-20251001',
  openai: 'gpt-4o-mini',
};
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
const MODEL_FALLBACK_ORDER = {
  groq: ['qwen/qwen3.6-27b', 'openai/gpt-oss-20b', 'openai/gpt-oss-120b'],
  openai: ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4o'],
  anthropic: ['claude-haiku-4-5-20251001', 'claude-3-5-haiku-20241022', 'claude-sonnet-4-5-20250929'],
};

function isProviderRateLimitError(err) {
  if (!err) return false;
  if (err.isRateLimit) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /rate limit|limite de pedidos atingido|tokens per min|too many requests/i.test(msg);
}

// Best-effort per-isolate protection. Os Workers da Cloudflare podem criar
// vários isolates em paralelo, por isso isto não é uma quota global rígida,
// mas ajuda a prevenir loops de pedidos acidentais dentro do mesmo isolate.
const requestLog = new Map();
const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW_PROD = 45;
const MAX_REQUESTS_PER_WINDOW_DEV = 150;

function resolveMaxRequestsPerWindow(env = {}) {
  const explicit = Number(env.AI_MAX_REQUESTS_PER_MIN);
  if (Number.isFinite(explicit) && explicit > 0) {
    return Math.min(Math.round(explicit), 500);
  }
  const isDev = env.NETLIFY_DEV === 'true'
    || env.CONTEXT === 'dev'
    || env.NODE_ENV === 'development'
    || env.NODE_ENV === 'test';
  return isDev ? MAX_REQUESTS_PER_WINDOW_DEV : MAX_REQUESTS_PER_WINDOW_PROD;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json(400, { error: 'Pedido inválido: JSON malformado.' });
  }

  const clientPreference = typeof payload.provider_preference === 'string'
    ? payload.provider_preference
    : 'auto';
  const providerStrict = payload.provider_strict === true;

  const { providers, error: configError, attempted_providers: configAttempted } = resolveProviderOrder(env, clientPreference, providerStrict);
  if (!providers.length) {
    return json(500, {
      error: configError || 'Nenhuma chave de IA configurada no Cloudflare Pages. Adiciona GROQ_API_KEY, ANTHROPIC_API_KEY e/ou OPENAI_API_KEY em Settings → Environment variables e faz um novo deploy.',
      attempted_providers: configAttempted || (normalizeClientPreference(clientPreference) !== 'auto'
        ? [normalizeClientPreference(clientPreference)]
        : []),
      configured_providers: configuredProvidersMeta(env),
      provider_strict: providerStrict,
    });
  }

  const clientKey = request.headers.get('cf-connecting-ip') || 'unknown';
  const now = Date.now();
  const maxRequestsPerWindow = resolveMaxRequestsPerWindow(env);
  const previous = requestLog.get(clientKey) || [];
  const recent = previous.filter((t) => now - t < WINDOW_MS);
  if (recent.length >= maxRequestsPerWindow) {
    const oldest = recent[0] || now;
    const retryAfter = Math.max(1, Math.ceil((WINDOW_MS - (now - oldest)) / 1000));
    return json(429, {
      error: `Demasiados pedidos neste minuto (limite da app: ${maxRequestsPerWindow}/min, não da Groq/OpenAI). Espera cerca de ${retryAfter} s.`,
      retry_after: retryAfter,
      limit: maxRequestsPerWindow,
      error_kind: 'app_rate_limit',
    });
  }
  recent.push(now);
  requestLog.set(clientKey, recent);

  if (!Array.isArray(payload.messages) || payload.messages.length === 0) {
    return json(400, { error: 'Pedido inválido: messages é obrigatório.' });
  }

  const messages = payload.messages
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content }));

  if (!messages.length) {
    return json(400, { error: 'Pedido inválido: não existem mensagens válidas.' });
  }

  const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
  if (totalChars > MAX_REQUEST_CHARS) {
    return json(413, { error: 'Pedido demasiado grande.' });
  }

  const requestedTokens = Number(payload.max_tokens) || 300;
  const requestedModel = typeof payload.model === 'string' ? payload.model : 'auto';
  const requestContext = String(payload.request_context || '').trim().toLowerCase();
  const isReplenish = requestContext === 'replenish' || requestContext === 'bank-replenish';
  const quotaConserve = isReplenish ? false : payload.quota_conserve === true;
  const priorityProvider = resolvePriorityProvider(payload, clientPreference);
  let providerList = (quotaConserve && !providerStrict) ? providers.slice(0, 1) : providers;
  if (priorityProvider) {
    providerList = reorderProviderList(providerList, priorityProvider);
  }
  const activeModels = getActiveModelsSnapshot(env);
  if (activeModels.configured) {
    providerList = providerList.filter((provider) => (
      resolveModelsForProvider(provider.name, 'auto', env).length > 0
    ));
    if (!providerList.length) {
      return json(500, {
        error: 'Nenhum modelo IA activo configurado para os providers disponíveis.',
        detail: 'Define AI_ACTIVE_MODELS (ou AI_ACTIVE_MODELS_GROQ / _OPENAI / _ANTHROPIC) nas variáveis de ambiente.',
        active_models: activeModels,
        configured_providers: configuredProvidersMeta(env),
      });
    }
  }

  const errors = [];
  const circuitBreaker = requestContext === 'replenish' ? replenishCircuitBreaker : null;
  const fallback = await runAiFallbackLoop({
    providerList,
    quotaConserve,
    priorityProvider,
    circuitBreaker,
    resolveModels: (providerName) => resolveModelsForProvider(providerName, requestedModel, env),
    callAttempt: async (provider, model) => {
      const maxTokens = effectiveMaxTokens(provider.name, model, requestedTokens);
      return callProvider(provider.name, provider.apiKey, messages, maxTokens, model);
    },
  });

  if (fallback.ok) {
    const aiAttempts = summarizeAttemptsForTelemetry(fallback.attempts);
    return json(200, {
      ...fallback.result,
      provider: fallback.provider,
      model: fallback.model,
      providers_tried: fallback.providersTried,
      models_tried: fallback.modelsAttempted,
      ai_attempts: aiAttempts,
      fallback_used: fallback.fallbackUsed,
      active_models: activeModels,
      provider_strict: providerStrict,
      quota_conserve: quotaConserve,
      total_latency_ms: fallback.totalLatencyMs,
    });
  }

  for (const entry of fallback.errors || []) {
    errors.push(localizeProviderError(entry.provider, `${entry.model}: ${entry.message}`));
  }
  const attempted = fallback.providersTried || [];
  const modelsAttempted = fallback.modelsAttempted || [];
  return formatProviderFailure(errors, attempted, env, {
    providerStrict,
    modelsAttempted,
    aiAttempts: summarizeAttemptsForTelemetry(fallback.attempts),
    totalLatencyMs: fallback.totalLatencyMs,
    activeModels,
  });
}

// Qualquer método que não seja POST devolve 405, tal como na versão Netlify.
export async function onRequest(context) {
  if (context.request.method === 'POST') return onRequestPost(context);
  return json(405, { error: 'Método não permitido' });
}

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

function buildProviderList(available, order, firstProvider = null, env = {}) {
  const requestedOrder = order
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const enabled = (name) => available[name] && isProviderEnabled(name, env);
  const names = [];
  if (firstProvider && enabled(firstProvider)) names.push(firstProvider);
  for (const name of requestedOrder) {
    if (enabled(name) && !names.includes(name)) names.push(name);
  }
  for (const name of ALLOWED_PROVIDERS) {
    if (enabled(name) && !names.includes(name)) names.push(name);
  }
  return names.map((name) => ({ name, apiKey: available[name] }));
}

function configuredProvidersMeta(env = {}) {
  return {
    groq: !!(env.GROQ_API_KEY || '').trim() && isProviderEnabled('groq', env),
    openai: !!(env.OPENAI_API_KEY || '').trim() && isProviderEnabled('openai', env),
    anthropic: !!(env.ANTHROPIC_API_KEY || '').trim() && isProviderEnabled('anthropic', env),
  };
}

function resolveProviderOrder(env, clientPreference = 'auto', strict = false) {
  const groqKey = (env.GROQ_API_KEY || '').trim();
  const anthropicKey = (env.ANTHROPIC_API_KEY || '').trim();
  const openaiKey = (env.OPENAI_API_KEY || '').trim();
  const forced = (env.AI_PROVIDER || '').trim().toLowerCase();
  const pref = normalizeClientPreference(clientPreference);
  const order = env.AI_PROVIDER_ORDER || DEFAULT_PROVIDER_ORDER;

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
        error: `${providerLabels[pref]} não está configurado no servidor. Adiciona a chave nas variáveis de ambiente.`,
        attempted_providers: [pref],
      };
    }
    if (strict) {
      return { providers: [{ name: pref, apiKey: available[pref] }] };
    }
    return { providers: buildProviderList(available, order, pref, env) };
  }

  return { providers: buildProviderList(available, order, null, env) };
}

function normalizeClientPreference(value) {
  const pref = String(value || 'auto').trim().toLowerCase();
  return ALLOWED_PROVIDERS.includes(pref) ? pref : 'auto';
}

function resolvePriorityProvider(payload, clientPreference) {
  const pref = normalizeClientPreference(clientPreference);
  if (pref !== 'auto') return pref;
  const hinted = normalizeClientPreference(payload?.preferred_provider);
  return hinted !== 'auto' ? hinted : null;
}

function reorderProviderList(list, priorityName) {
  if (!priorityName || !Array.isArray(list) || !list.length) return list;
  const idx = list.findIndex((provider) => provider.name === priorityName);
  if (idx <= 0) return list;
  return [list[idx], ...list.filter((_, i) => i !== idx)];
}

function normalizeGroqModel(model, env) {
  const raw = String(model || env.GROQ_MODEL || DEFAULT_MODELS.groq).trim();
  return GROQ_MODEL_ALIASES[raw] || raw;
}

function defaultModelFor(provider, env) {
  if (provider === 'anthropic') return env.ANTHROPIC_MODEL || DEFAULT_MODELS.anthropic;
  if (provider === 'openai') return env.OPENAI_MODEL || DEFAULT_MODELS.openai;
  return normalizeGroqModel(env.GROQ_MODEL || DEFAULT_MODELS.groq, env);
}

function resolveModelForProvider(provider, requestedModel, env) {
  const models = resolveModelsForProvider(provider, requestedModel, env);
  return models[0];
}

function resolveModelsForProvider(provider, requestedModel, env) {
  return resolveActiveModelsForProvider(provider, requestedModel, env, {
    allowedModels: ALLOWED_MODELS,
    defaultOrder: MODEL_FALLBACK_ORDER,
    normalizeGroqModel,
    defaultModelFor,
    resolveModelForProviderSingle,
  });
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
async function callOpenAICompatible({ endpoint, apiKey, model, messages, maxTokens, providerLabel, providerName }) {
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

async function callOpenAICompatibleOnce({ endpoint, apiKey, model, messages, maxTokens, providerLabel, providerName, useJsonFormat }) {
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

  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
  }, ATTEMPT_TIMEOUT_MS);

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
    err.httpStatus = response.status;
    err.headers = response.headers;
    err.isRateLimit = response.status === 429 || /rate limit|too many requests/i.test(message);
    throw err;
  }

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
  };
}

async function callAnthropic(apiKey, messages, maxTokens, model) {
  const response = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
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
  }, ATTEMPT_TIMEOUT_MS);

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
    err.httpStatus = response.status;
    err.headers = response.headers;
    err.isRateLimit = response.status === 429 || /rate limit|too many requests/i.test(message);
    throw err;
  }

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
  };
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

function formatProviderFailure(errors, attempted = [], env = {}, opts = {}) {
  const localized = localizeProviderErrors(errors);
  const detail = localized.join(' | ');
  const configured = configuredProvidersMeta(env);
  const activeModels = opts.activeModels || getActiveModelsSnapshot(env);
  const meta = {
    attempted_providers: attempted,
    models_tried: opts.modelsAttempted || [],
    ai_attempts: opts.aiAttempts || [],
    total_latency_ms: opts.totalLatencyMs || null,
    configured_providers: configured,
    active_models: activeModels,
    provider_strict: opts.providerStrict === true,
    provider_errors: localized,
  };
  if (!detail) {
    return json(502, {
      error: 'Nenhuma tentativa de IA foi possível.',
      detail: 'Fila vazia: providers desactivados (AI_ACTIVE_MODELS_*), circuit-breaker, ou sem modelos activos. Com ANTHROPIC=NO não há pedidos Anthropic; activa GROQ/OPENAI com YES.',
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
    const openaiAlsoFailed = attempted.includes('openai') && localized.some((e) => /^openai:/i.test(String(e)));
    const fallbackHint = configured.openai || configured.anthropic
      ? ' O servidor tentou automaticamente os fornecedores configurados (Groq → OpenAI → Anthropic).'
      : ' Configura OPENAI_API_KEY no Netlify para ter reserva automática quando a Groq falhar.';
    const providerNotes = localized.length ? ` Detalhes: ${localized.join(' · ')}.` : '';
    return json(429, {
      error: openaiAlsoFailed ? 'Groq e OpenAI sem quota disponível.' : 'Limite diário da Groq atingido (plano gratuito).',
      detail: `${openaiAlsoFailed ? 'A Groq e a OpenAI falharam neste pedido.' : 'Atingiste o limite de tokens por dia no plano gratuito da Groq.'}${quotaHint}${wait}${fallbackHint}${providerNotes}`,
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
  return new Response(JSON.stringify(body), {
    status: statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
