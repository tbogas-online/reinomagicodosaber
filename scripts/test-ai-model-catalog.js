#!/usr/bin/env node
'use strict';

const {
  isMissingModelMessage,
  resolveGroqModelId,
  resolveProviderModelId,
  rebuildGroqFallbackOrder,
  rebuildFallbackOrder,
  expandGroqAllowedSet,
  expandAllowedSet,
  groqCatalogOptions,
  catalogOptions,
  fetchGroqCatalogIds,
  fetchProviderCatalogIds,
  resetGroqCatalogCache,
  resetCatalogCache,
  labelGroqModel,
  labelOpenAiModel,
  labelAnthropicModel,
} = require('../netlify/functions/lib/ai-model-catalog');

let passed = 0;
let failed = 0;

function assert(name, cond, detail = '') {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const catalog = [
  'qwen/qwen3.8-27b',
  'openai/gpt-oss-20b',
  'openai/gpt-oss-120b',
  'llama-3.1-8b-instant',
  'whisper-large-v3',
];

assert(
  'Qwen 3.6 mapeia para o Qwen vivo no catálogo',
  resolveGroqModelId('qwen/qwen3.6-27b', catalog) === 'qwen/qwen3.8-27b',
  resolveGroqModelId('qwen/qwen3.6-27b', catalog),
);
assert(
  'Qwen sobe de versão sem alterar o código',
  resolveGroqModelId('qwen/qwen3.8-27b', [...catalog, 'qwen/qwen3.9-27b']) === 'qwen/qwen3.9-27b',
);
assert(
  'sem catálogo mantém o ID pedido',
  resolveGroqModelId('qwen/qwen3.6-27b', []) === 'qwen/qwen3.6-27b',
);
assert(
  'whisper não é escolhido para qwen',
  resolveGroqModelId('qwen/qwen3.6-27b', ['whisper-large-v3']) == null,
);

const order = rebuildGroqFallbackOrder(
  ['qwen/qwen3.6-27b', 'openai/gpt-oss-20b', 'openai/gpt-oss-120b'],
  catalog,
);
assert(
  'fallback começa no Qwen vivo',
  order[0] === 'qwen/qwen3.8-27b',
  order.join(','),
);
assert('inclui gpt-oss-20b', order.includes('openai/gpt-oss-20b'));
assert('não inclui llama se as famílias preferidas existem', !order.includes('llama-3.1-8b-instant'));

const allowed = expandGroqAllowedSet(new Set(['qwen/qwen3.6-27b', 'openai/gpt-oss-20b']), catalog);
assert('allowed inclui Qwen 3.8 do catálogo', allowed.has('qwen/qwen3.8-27b'));
assert('allowed não inclui whisper', !allowed.has('whisper-large-v3'));

const options = groqCatalogOptions(catalog);
assert('UI lista Qwen actual', options.some((row) => row.id === 'qwen/qwen3.8-27b' && /Qwen 3\.8/i.test(row.label)));
assert('rótulo GPT-OSS 20B', labelGroqModel('openai/gpt-oss-20b') === 'GPT-OSS 20B');

assert(
  'mensagem Groq de modelo inexistente',
  isMissingModelMessage('The model `qwen/qwen3.6-27b` does not exist or you do not have access to it.'),
);
assert(
  'mensagem PT de modelo indisponível',
  isMissingModelMessage('modelo indisponível ou não encontrado'),
);
assert('429 não é modelo em falta', !isMissingModelMessage('Rate limit reached', 429));

resetGroqCatalogCache();
(async () => {
  const ids = await fetchGroqCatalogIds('gsk_test', {
    now: 1,
    fetchImpl: async () => ({
      ok: true,
      text: async () => JSON.stringify({
        data: [{ id: 'qwen/qwen3.8-27b' }, { id: 'openai/gpt-oss-20b' }],
      }),
    }),
  });
  assert('fetch catálogo lê IDs', ids.includes('qwen/qwen3.8-27b') && ids.includes('openai/gpt-oss-20b'));

  const cached = await fetchGroqCatalogIds('gsk_test', {
    now: 2,
    fetchImpl: async () => { throw new Error('não deve chamar'); },
  });
  assert('catálogo usa cache TTL', cached.includes('qwen/qwen3.8-27b'));

  const openaiCatalog = ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4o', 'whisper-1'];
  assert(
    'OpenAI 4o-mini mantém-se se a família ainda existe',
    resolveProviderModelId('openai', 'gpt-4o-mini', openaiCatalog) === 'gpt-4o-mini',
  );
  assert(
    'OpenAI mini passa à família seguinte se 4o-mini desaparecer',
    resolveProviderModelId('openai', 'gpt-4o-mini', ['gpt-4.1-mini', 'gpt-5-mini', 'whisper-1']) === 'gpt-5-mini',
  );
  assert(
    'OpenAI snapshot mapeia para alias',
    resolveProviderModelId('openai', 'gpt-4o-mini-2024-07-18', openaiCatalog) === 'gpt-4o-mini',
  );
  assert(
    'OpenAI prefere alias sem data se o snapshot também existe',
    resolveProviderModelId('openai', 'gpt-4o-mini', ['gpt-4o-mini', 'gpt-4o-mini-2024-07-18']) === 'gpt-4o-mini',
  );
  assert(
    'OpenAI ignora whisper',
    !expandAllowedSet('openai', new Set(['gpt-4o-mini']), openaiCatalog).has('whisper-1'),
  );
  assert(
    'OpenAI UI lista 4o mini',
    catalogOptions('openai', openaiCatalog).some((row) => row.id === 'gpt-4o-mini' && /4o mini/i.test(row.label)),
  );
  assert('rótulo GPT-4.1 mini', labelOpenAiModel('gpt-4.1-mini') === 'GPT-4.1 mini');

  const anthropicCatalog = ['claude-haiku-4-5', 'claude-sonnet-5', 'claude-haiku-4-5-20251001'];
  assert(
    'Anthropic Haiku reformado mapeia para 4.5',
    resolveProviderModelId('anthropic', 'claude-3-5-haiku-20241022', anthropicCatalog) === 'claude-haiku-4-5',
  );
  assert(
    'Anthropic snapshot dated mapeia para alias',
    resolveProviderModelId('anthropic', 'claude-haiku-4-5-20251001', anthropicCatalog) === 'claude-haiku-4-5',
  );
  assert(
    'Anthropic Haiku sobe de versão sem alterar o código',
    resolveProviderModelId('anthropic', 'claude-haiku-4-5', [...anthropicCatalog, 'claude-haiku-4-6']) === 'claude-haiku-4-6',
  );
  const anthropicOrder = rebuildFallbackOrder(
    'anthropic',
    ['claude-3-5-haiku-20241022', 'claude-sonnet-4-5-20250929'],
    anthropicCatalog,
  );
  assert(
    'Anthropic fallback evita ID reformado',
    anthropicOrder[0] === 'claude-haiku-4-5' && !anthropicOrder.includes('claude-3-5-haiku-20241022'),
    anthropicOrder.join(','),
  );
  assert('rótulo Claude Haiku 4.5', labelAnthropicModel('claude-haiku-4-5') === 'Claude Haiku 4.5');

  resetCatalogCache('openai');
  const openaiIds = await fetchProviderCatalogIds('openai', 'sk-test', {
    now: 1,
    fetchImpl: async () => ({
      ok: true,
      text: async () => JSON.stringify({
        data: [{ id: 'gpt-4o-mini' }, { id: 'whisper-1' }],
      }),
    }),
  });
  assert('fetch OpenAI lê IDs', openaiIds.includes('gpt-4o-mini') && openaiIds.includes('whisper-1'));

  console.log(`\nResultado: ${passed} passaram, ${failed} falharam`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
