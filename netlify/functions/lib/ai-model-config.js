/**
 * Configuração de modelos IA activos via variáveis de ambiente.
 *
 * AI_ACTIVE_MODELS (global):
 *   groq:qwen/qwen3.6-27b,openai/gpt-oss-20b;openai:gpt-4o-mini;anthropic:claude-haiku-4-5-20251001
 *
 * Ou por provider (sobrepõe o global para esse provider):
 *   AI_ACTIVE_MODELS_GROQ=qwen/qwen3.6-27b,openai/gpt-oss-20b
 *   AI_ACTIVE_MODELS_OPENAI=gpt-4o-mini
 *   AI_ACTIVE_MODELS_ANTHROPIC=claude-haiku-4-5-20251001
 *
 * Se nenhuma estiver definida, usa MODEL_FALLBACK_ORDER do código.
 */

const PROVIDERS = ['groq', 'openai', 'anthropic'];

function parseCsvModels(raw) {
  return String(raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseGlobalActiveModels(raw) {
  const out = { groq: [], openai: [], anthropic: [] };
  const text = String(raw || '').trim();
  if (!text) return out;

  for (const segment of text.split(';')) {
    const piece = segment.trim();
    if (!piece) continue;
    const colon = piece.indexOf(':');
    if (colon <= 0) continue;
    const provider = piece.slice(0, colon).trim().toLowerCase();
    if (!PROVIDERS.includes(provider)) continue;
    out[provider] = parseCsvModels(piece.slice(colon + 1));
  }
  return out;
}

function parseActiveModelsConfig(env = process.env) {
  const global = parseGlobalActiveModels(env.AI_ACTIVE_MODELS);
  const config = {
    groq: global.groq,
    openai: global.openai,
    anthropic: global.anthropic,
    hasExplicitConfig: false,
  };

  for (const provider of PROVIDERS) {
    const key = `AI_ACTIVE_MODELS_${provider.toUpperCase()}`;
    const raw = (env[key] || '').trim();
    if (!raw) continue;
    config[provider] = parseCsvModels(raw);
    config.hasExplicitConfig = true;
  }

  if ((env.AI_ACTIVE_MODELS || '').trim()) {
    config.hasExplicitConfig = true;
  }

  return config;
}

function filterKnownModels(provider, models, allowedSet) {
  if (!allowedSet) return models.slice();
  return models.filter((id) => allowedSet.has(id));
}

function buildModelFallbackOrder(provider, env, {
  allowedModels,
  defaultOrder,
  normalizeGroqModel,
  defaultModelFor,
}) {
  const active = parseActiveModelsConfig(env);
  const allowed = allowedModels[provider];
  let order = [];

  if (active[provider]?.length) {
    order = active[provider].map((id) => (
      provider === 'groq' ? normalizeGroqModel(id, env) : id
    ));
    order = filterKnownModels(provider, order, allowed);
  } else if (active.hasExplicitConfig) {
    order = [];
  } else {
    for (const id of defaultOrder[provider] || []) {
      if (!allowed?.has(id)) continue;
      const resolved = provider === 'groq' ? normalizeGroqModel(id, env) : id;
      if (!order.includes(resolved)) order.push(resolved);
    }
  }

  if (!order.length && !active.hasExplicitConfig) {
    order = [defaultModelFor(provider, env)];
  }

  return { models: order, activeConfig: active };
}

function resolveModelsForProvider(provider, requestedModel, env, deps) {
  const { models, activeConfig } = buildModelFallbackOrder(provider, env, deps);
  const model = String(requestedModel || '').trim();

  if (model && model !== 'auto') {
    const resolved = deps.resolveModelForProviderSingle(provider, model, env);
    if (!activeConfig.hasExplicitConfig || !activeConfig[provider]?.length) {
      return models.length ? [resolved] : [deps.defaultModelFor(provider, env)];
    }
    const activeSet = new Set(activeConfig[provider].map((id) => (
      provider === 'groq' ? deps.normalizeGroqModel(id, env) : id
    )));
    if (activeSet.has(resolved)) return [resolved];
    if (models.length) return [models[0]];
    return [];
  }

  return models;
}

function getActiveModelsSnapshot(env = process.env) {
  const active = parseActiveModelsConfig(env);
  return {
    configured: active.hasExplicitConfig,
    groq: active.groq,
    openai: active.openai,
    anthropic: active.anthropic,
  };
}

module.exports = {
  parseActiveModelsConfig,
  buildModelFallbackOrder,
  resolveModelsForProvider,
  getActiveModelsSnapshot,
};
