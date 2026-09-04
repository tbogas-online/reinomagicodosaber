/**
 * Configuração de modelos IA activos via variáveis de ambiente.
 *
 * Por provider (recomendado):
 *   AI_ACTIVE_MODELS_GROQ=YES      -> usa MODEL_FALLBACK_ORDER do código
 *   AI_ACTIVE_MODELS_OPENAI=YES
 *   AI_ACTIVE_MODELS_ANTHROPIC=NO   -> provider desactivado (sem pedidos)
 *
 * Valores aceites para activar/desactivar: YES/NO, TRUE/FALSE, 1/0, ON/OFF, SIM/NAO
 *
 * Lista explícita de modelos (opcional):
 *   AI_ACTIVE_MODELS_GROQ=qwen/qwen3.6-27b,openai/gpt-oss-20b
 *
 * Global (lista por provider; providers omitidos ficam desactivados):
 *   AI_ACTIVE_MODELS=groq:qwen/qwen3.6-27b;openai:gpt-4o-mini
 *
 * Se nenhuma estiver definida, usa MODEL_FALLBACK_ORDER do código.
 */

const PROVIDERS = ['groq', 'openai', 'anthropic'];

const ENABLE_VALUES = new Set(['YES', 'Y', 'TRUE', '1', 'ON', 'SIM']);
const DISABLE_VALUES = new Set(['NO', 'N', 'FALSE', '0', 'OFF', 'NAO', 'NÃO']);

function parseCsvModels(raw) {
  return String(raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseProviderToggle(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  const upper = text.toUpperCase();
  if (ENABLE_VALUES.has(upper)) return { mode: 'default', models: [] };
  if (DISABLE_VALUES.has(upper)) return { mode: 'disabled', models: [] };
  const models = parseCsvModels(text);
  if (!models.length) return null;
  return { mode: 'list', models };
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

function defaultProviderState() {
  return { mode: 'inherit', models: [] };
}

function parseActiveModelsConfig(env = process.env) {
  const providers = {
    groq: defaultProviderState(),
    openai: defaultProviderState(),
    anthropic: defaultProviderState(),
  };
  let hasExplicitConfig = false;
  let usedGlobal = false;

  const global = parseGlobalActiveModels(env.AI_ACTIVE_MODELS);
  if ((env.AI_ACTIVE_MODELS || '').trim()) {
    hasExplicitConfig = true;
    usedGlobal = true;
    for (const provider of PROVIDERS) {
      if (global[provider]?.length) {
        providers[provider] = { mode: 'list', models: global[provider] };
      } else {
        providers[provider] = { mode: 'disabled', models: [] };
      }
    }
  }

  for (const provider of PROVIDERS) {
    const key = `AI_ACTIVE_MODELS_${provider.toUpperCase()}`;
    const raw = (env[key] || '').trim();
    if (!raw) continue;
    const toggle = parseProviderToggle(raw);
    if (!toggle) continue;
    hasExplicitConfig = true;
    providers[provider] = toggle;
  }

  return { providers, hasExplicitConfig, usedGlobal };
}

function filterKnownModels(models, allowedSet) {
  if (!allowedSet) return models.slice();
  return models.filter((id) => allowedSet.has(id));
}

function buildDefaultOrder(provider, env, { allowedModels, defaultOrder, normalizeGroqModel, defaultModelFor }) {
  const allowed = allowedModels[provider];
  const order = [];
  for (const id of defaultOrder[provider] || []) {
    if (!allowed?.has(id)) continue;
    const resolved = provider === 'groq' ? normalizeGroqModel(id, env) : id;
    if (!order.includes(resolved)) order.push(resolved);
  }
  if (!order.length) order.push(defaultModelFor(provider, env));
  return order;
}

function buildModelFallbackOrder(provider, env, {
  allowedModels,
  defaultOrder,
  normalizeGroqModel,
  defaultModelFor,
}) {
  const active = parseActiveModelsConfig(env);
  const cfg = active.providers[provider];
  const allowed = allowedModels[provider];
  let order = [];

  if (cfg.mode === 'disabled') {
    order = [];
  } else if (cfg.mode === 'list') {
    order = cfg.models.map((id) => (
      provider === 'groq' ? normalizeGroqModel(id, env) : id
    ));
    order = filterKnownModels(order, allowed);
  } else if (cfg.mode === 'default' || (!active.hasExplicitConfig && cfg.mode === 'inherit')) {
    order = buildDefaultOrder(provider, env, {
      allowedModels, defaultOrder, normalizeGroqModel, defaultModelFor,
    });
  } else if (cfg.mode === 'inherit' && active.hasExplicitConfig) {
    order = buildDefaultOrder(provider, env, {
      allowedModels, defaultOrder, normalizeGroqModel, defaultModelFor,
    });
  }

  if (!order.length && !active.hasExplicitConfig) {
    order = [defaultModelFor(provider, env)];
  }

  return { models: order, activeConfig: active };
}

function isProviderEnabled(provider, env = process.env) {
  const active = parseActiveModelsConfig(env);
  const cfg = active.providers[provider];
  if (cfg.mode === 'disabled') return false;
  if (!active.hasExplicitConfig) return true;
  return cfg.mode === 'default' || cfg.mode === 'inherit' || cfg.mode === 'list';
}

function resolveModelsForProvider(provider, requestedModel, env, deps) {
  const { models, activeConfig } = buildModelFallbackOrder(provider, env, deps);
  const model = String(requestedModel || '').trim();
  const cfg = activeConfig.providers[provider];

  if (model && model !== 'auto') {
    const resolved = deps.resolveModelForProviderSingle(provider, model, env);
    if (!activeConfig.hasExplicitConfig || cfg.mode === 'default' || cfg.mode === 'inherit') {
      return models.length ? [resolved] : [deps.defaultModelFor(provider, env)];
    }
    if (cfg.mode === 'disabled') return [];
    const activeSet = new Set(models);
    if (activeSet.has(resolved)) return [resolved];
    if (models.length) return [models[0]];
    return [];
  }

  return models;
}

function providerStateLabel(cfg, models) {
  if (cfg.mode === 'disabled') return 'no';
  if (cfg.mode === 'default') return 'yes';
  if (cfg.mode === 'list') return models;
  if (cfg.mode === 'inherit') return 'inherit';
  return 'inherit';
}

function getActiveModelsSnapshot(env = process.env) {
  const active = parseActiveModelsConfig(env);
  const snap = { configured: active.hasExplicitConfig };
  for (const provider of PROVIDERS) {
    const cfg = active.providers[provider];
    snap[provider] = providerStateLabel(cfg, cfg.models);
  }
  return snap;
}

module.exports = {
  parseActiveModelsConfig,
  parseProviderToggle,
  buildModelFallbackOrder,
  resolveModelsForProvider,
  isProviderEnabled,
  getActiveModelsSnapshot,
};
