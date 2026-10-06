/**
 * Resolução resiliente de modelos IA.
 * IDs concretos mudam (Groq Qwen, snapshots Anthropic, aliases OpenAI);
 * o jogo escolhe a família e actualiza contra o catálogo vivo da API.
 */

const CATALOG_TTL_MS = 10 * 60 * 1000;

const PROVIDER_SPECS = {
  groq: {
    url: 'https://api.groq.com/openai/v1/models',
    headers: (key) => ({ authorization: `Bearer ${key}` }),
    families: [
      { key: 'qwen', test: /^qwen\//i, prefer: /27b/i, seed: 'qwen/qwen3.8-27b' },
      { key: 'gpt-oss-20b', test: /^openai\/gpt-oss-20b/i, seed: 'openai/gpt-oss-20b' },
      { key: 'gpt-oss-120b', test: /^openai\/gpt-oss-120b/i, seed: 'openai/gpt-oss-120b' },
      { key: 'llama-instant', test: /llama-.*instant/i, prefer: /8b/i, seed: 'llama-3.1-8b-instant' },
    ],
    allowed: /^(qwen\/|openai\/gpt-oss-|llama-)/i,
    preferred: ['qwen', 'gpt-oss-20b', 'gpt-oss-120b'],
    label: labelGroqModel,
  },
  openai: {
    url: 'https://api.openai.com/v1/models',
    headers: (key) => ({ authorization: `Bearer ${key}` }),
    families: [
      { key: 'gpt-4o-mini', test: /^gpt-4o-mini/i, seed: 'gpt-4o-mini' },
      { key: 'gpt-4.1-mini', test: /^gpt-4\.1-mini/i, seed: 'gpt-4.1-mini' },
      { key: 'gpt-5-mini', test: /^gpt-5-mini/i, seed: 'gpt-5-mini' },
      { key: 'gpt-mini', test: /^gpt-[\w.]+-mini/i, seed: 'gpt-4o-mini' },
      { key: 'gpt-4o', test: /^gpt-4o(?!-mini)/i, seed: 'gpt-4o' },
      { key: 'gpt-4.1', test: /^gpt-4\.1(?!-mini|-nano)/i, seed: 'gpt-4.1' },
      { key: 'gpt-main', test: /^gpt-[\w.]+$/i, seed: 'gpt-4o' },
    ],
    allowed: /^(gpt-[\w.]+)(?!.*-(audio|realtime|search|transcribe|tts|instruct))/i,
    preferred: ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4o'],
    label: labelOpenAiModel,
  },
  anthropic: {
    url: 'https://api.anthropic.com/v1/models?limit=100',
    headers: (key) => ({
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    }),
    families: [
      { key: 'haiku', test: /haiku/i, seed: 'claude-haiku-4-5' },
      { key: 'sonnet', test: /sonnet/i, seed: 'claude-sonnet-5' },
    ],
    allowed: /^claude-(haiku|sonnet)/i,
    preferred: ['haiku', 'sonnet'],
    label: labelAnthropicModel,
  },
};

const catalogCache = {
  groq: { at: 0, payload: null },
  openai: { at: 0, payload: null },
  anthropic: { at: 0, payload: null },
};

function isMissingModelMessage(message, httpStatus = 0) {
  const status = Number(httpStatus) || 0;
  const msg = String(message || '');
  if (/does not exist|do not have access|model_not_found|modelo indispon[ií]vel|n[aã]o (tens? )?acesso|invalid_model|not_found_error/i.test(msg)
    && /model|modelo/i.test(msg)) {
    return true;
  }
  if ((status === 404 || status === 400) && /model|modelo/i.test(msg) && /not found|n[aã]o encontrado|does not exist|invalid/i.test(msg)) {
    return true;
  }
  return false;
}

function numericTokens(id) {
  return String(id || '').match(/\d+(?:\.\d+)?/g)?.map(Number) || [];
}

function compareVersionDesc(a, b) {
  const aa = numericTokens(a);
  const bb = numericTokens(b);
  const n = Math.max(aa.length, bb.length);
  for (let i = 0; i < n; i += 1) {
    const d = (bb[i] || 0) - (aa[i] || 0);
    if (d) return d;
  }
  return String(b).localeCompare(String(a));
}

function isDatedSnapshot(id) {
  return /\d{8}/.test(String(id || '')) || /\d{4}-\d{2}-\d{2}/.test(String(id || ''));
}

function stripSnapshot(id) {
  return String(id || '')
    .replace(/-\d{8}$/i, '')
    .replace(/-\d{4}-\d{2}-\d{2}$/i, '');
}

function pickFamilyMember(ids, family) {
  const list = (ids || []).filter((id) => family.test.test(id));
  if (!list.length) return null;
  const preferred = family.prefer ? list.filter((id) => family.prefer.test(id)) : list;
  const pool = preferred.length ? preferred : list;
  const aliases = pool.filter((id) => !isDatedSnapshot(id));
  const use = aliases.length ? aliases : pool;
  return use.slice().sort(compareVersionDesc)[0] || null;
}

function specFor(provider) {
  return PROVIDER_SPECS[provider] || null;
}

function familyByKey(provider, key) {
  const spec = specFor(provider);
  return spec?.families.find((family) => family.key === key) || null;
}

function matchingFamilies(provider, id) {
  const spec = specFor(provider);
  return (spec?.families || []).filter((family) => family.test.test(id));
}

function familyForId(provider, id) {
  return matchingFamilies(provider, id)[0] || null;
}

function applyAlias(provider, id) {
  return stripSnapshot(id);
}

function isAllowedFamily(provider, id) {
  const spec = specFor(provider);
  return !!(spec && spec.allowed.test(String(id || '')));
}

function labelGroqModel(id) {
  const raw = String(id || '');
  if (/^openai\/gpt-oss-20b/i.test(raw)) return 'GPT-OSS 20B';
  if (/^openai\/gpt-oss-120b/i.test(raw)) return 'GPT-OSS 120B';
  const qwen = raw.match(/^qwen\/qwen([\d.]+)-(\d+b)/i);
  if (qwen) return `Qwen ${qwen[1]} ${qwen[2].toUpperCase()}`;
  const llama = raw.match(/llama-([\d.]+)-(\d+b)/i);
  if (llama) return `Llama ${llama[1]} ${llama[2].toUpperCase()} Instant`;
  return raw;
}

function labelOpenAiModel(id) {
  const raw = stripSnapshot(id);
  const mini = raw.match(/^gpt-([\w.]+)-mini$/i);
  if (mini) return `GPT-${mini[1]} mini`;
  const main = raw.match(/^gpt-([\w.]+)$/i);
  if (main) return `GPT-${main[1]}`;
  return raw;
}

function labelAnthropicModel(id) {
  const raw = stripSnapshot(id);
  const ver = raw.match(/(\d+(?:-\d+)*)/);
  const pretty = ver ? ver[1].replace(/-/g, '.') : '';
  if (/haiku/i.test(raw)) return pretty ? `Claude Haiku ${pretty}` : 'Claude Haiku';
  if (/sonnet/i.test(raw)) return pretty ? `Claude Sonnet ${pretty}` : 'Claude Sonnet';
  return raw;
}

function labelModel(provider, id) {
  const spec = specFor(provider);
  return spec?.label ? spec.label(id) : String(id || '');
}

function resolveProviderModelId(provider, requested, catalogIds) {
  const spec = specFor(provider);
  const raw = String(requested || '').trim();
  if (!spec || !raw || raw === 'auto') return null;
  const stripped = stripSnapshot(raw);
  const catalog = Array.isArray(catalogIds) ? catalogIds : [];
  if (!catalog.length) return stripped || raw;

  const seen = new Set();
  for (const candidate of [raw, stripped]) {
    for (const family of matchingFamilies(provider, candidate)) {
      if (seen.has(family.key)) continue;
      seen.add(family.key);
      const picked = pickFamilyMember(catalog, family);
      if (picked) return picked;
    }
  }
  if (catalog.includes(stripped)) return stripped;
  if (catalog.includes(raw)) return raw;
  return null;
}

function resolvePreferredToken(provider, token, catalogIds) {
  const catalog = Array.isArray(catalogIds) ? catalogIds : [];
  const family = familyByKey(provider, token);
  if (family) {
    if (catalog.length) return pickFamilyMember(catalog, family);
    return family.seed || null;
  }
  return resolveProviderModelId(provider, token, catalog);
}

function rebuildFallbackOrder(provider, preferredOrder, catalogIds) {
  const spec = specFor(provider);
  const preferred = preferredOrder?.length ? preferredOrder : (spec?.preferred || []);
  const catalog = Array.isArray(catalogIds) ? catalogIds : [];
  const out = [];
  const seen = new Set();
  for (const token of preferred) {
    const resolved = resolvePreferredToken(provider, token, catalog);
    if (!resolved || seen.has(resolved)) continue;
    seen.add(resolved);
    out.push(resolved);
  }
  if (!out.length && catalog.length && spec) {
    for (const family of spec.families) {
      const picked = pickFamilyMember(catalog, family);
      if (picked && !seen.has(picked)) {
        seen.add(picked);
        out.push(picked);
      }
    }
  }
  return out;
}

function expandAllowedSet(provider, baseSet, catalogIds) {
  const out = new Set(baseSet || []);
  for (const id of [...out]) {
    const stripped = stripSnapshot(id);
    if (stripped) out.add(stripped);
  }
  for (const id of catalogIds || []) {
    if (isAllowedFamily(provider, id)) out.add(id);
  }
  return out;
}

function catalogOptions(provider, catalogIds) {
  const spec = specFor(provider);
  const ids = rebuildFallbackOrder(provider, spec?.preferred, catalogIds);
  return ids.map((id) => ({ id, label: labelModel(provider, id) }));
}

function emptyPayload(provider) {
  return {
    ids: catalogCache[provider]?.payload?.ids || [],
    ok: false,
    status: 0,
    headers: null,
    message: '',
    latencyMs: 0,
  };
}

function parseModelIds(parsed) {
  return (parsed.data || [])
    .map((row) => row?.id)
    .filter((id) => typeof id === 'string' && id);
}

async function fetchProviderCatalog(provider, apiKey, { fetchImpl = fetch, now = Date.now() } = {}) {
  const spec = specFor(provider);
  const cache = catalogCache[provider];
  if (!spec || !cache) return emptyPayload(provider);
  if (cache.payload && (now - cache.at) < CATALOG_TTL_MS) {
    return cache.payload;
  }
  const key = String(apiKey || '').trim();
  if (!key) return emptyPayload(provider);
  const started = Date.now();
  try {
    const response = await fetchImpl(spec.url, { headers: spec.headers(key) });
    const text = await response.text();
    let parsed = {};
    try { parsed = JSON.parse(text); } catch { parsed = {}; }
    const ids = parseModelIds(parsed);
    const payload = {
      ids: response.ok && ids.length ? ids : (cache.payload?.ids || []),
      ok: response.ok,
      status: response.status,
      headers: response.headers || null,
      message: parsed?.error?.message || parsed?.error?.type || (!response.ok ? text : ''),
      latencyMs: Math.max(0, Date.now() - started),
    };
    if (response.ok && ids.length) {
      catalogCache[provider] = { at: now, payload };
    }
    return payload;
  } catch (err) {
    return {
      ...emptyPayload(provider),
      message: err instanceof Error ? err.message : String(err || ''),
      latencyMs: Math.max(0, Date.now() - started),
    };
  }
}

async function fetchProviderCatalogIds(provider, apiKey, opts = {}) {
  const payload = await fetchProviderCatalog(provider, apiKey, opts);
  return payload.ids || [];
}

function resetCatalogCache(provider) {
  if (provider && catalogCache[provider]) {
    catalogCache[provider] = { at: 0, payload: null };
    return;
  }
  Object.keys(catalogCache).forEach((id) => {
    catalogCache[id] = { at: 0, payload: null };
  });
}

const GROQ_FAMILIES = PROVIDER_SPECS.groq.families;
const GROQ_CATALOG_TTL_MS = CATALOG_TTL_MS;
const GROQ_MODEL_ALIASES = {};

function isAllowedGroqFamily(id) {
  return isAllowedFamily('groq', id);
}

function applyGroqAlias(id) {
  return applyAlias('groq', id);
}

function resolveGroqModelId(requested, catalogIds) {
  return resolveProviderModelId('groq', requested, catalogIds);
}

function rebuildGroqFallbackOrder(preferredOrder, catalogIds) {
  return rebuildFallbackOrder('groq', preferredOrder, catalogIds);
}

function expandGroqAllowedSet(baseSet, catalogIds) {
  return expandAllowedSet('groq', baseSet, catalogIds);
}

function groqCatalogOptions(catalogIds) {
  return catalogOptions('groq', catalogIds);
}

function resetGroqCatalogCache() {
  resetCatalogCache('groq');
}

async function fetchGroqCatalog(apiKey, opts = {}) {
  return fetchProviderCatalog('groq', apiKey, opts);
}

async function fetchGroqCatalogIds(apiKey, opts = {}) {
  return fetchProviderCatalogIds('groq', apiKey, opts);
}

module.exports = {
  PROVIDER_SPECS,
  GROQ_MODEL_ALIASES,
  GROQ_FAMILIES,
  GROQ_CATALOG_TTL_MS,
  isMissingModelMessage,
  isAllowedFamily,
  isAllowedGroqFamily,
  labelModel,
  labelGroqModel,
  labelOpenAiModel,
  labelAnthropicModel,
  stripSnapshot,
  applyAlias,
  applyGroqAlias,
  resolveProviderModelId,
  resolveGroqModelId,
  rebuildFallbackOrder,
  rebuildGroqFallbackOrder,
  expandAllowedSet,
  expandGroqAllowedSet,
  catalogOptions,
  groqCatalogOptions,
  fetchProviderCatalog,
  fetchProviderCatalogIds,
  fetchGroqCatalog,
  fetchGroqCatalogIds,
  resetCatalogCache,
  resetGroqCatalogCache,
  compareVersionDesc,
  pickFamilyMember,
};
