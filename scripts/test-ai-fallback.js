#!/usr/bin/env node
'use strict';

const {
  classifyProviderError,
  parseRetryAfterSeconds,
  ProviderCircuitBreaker,
  runAiFallbackLoop,
  ERROR_TYPES,
} = require('../netlify/functions/lib/ai-fallback');

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

(async () => {
  {
    const rate = classifyProviderError({ isRateLimit: true, message: 'rate limit' }, 429);
    assert('429 é RATE_LIMIT retryable', rate.errorType === ERROR_TYPES.RATE_LIMIT && rate.retryable);

    const auth = classifyProviderError(new Error('invalid api key'), 401);
    assert('401 desativa provider', auth.errorType === ERROR_TYPES.AUTH && auth.disableProvider);

    const timeout = classifyProviderError({ isTimeout: true, message: 'tempo esgotado' });
    assert('timeout é retryable', timeout.errorType === ERROR_TYPES.TIMEOUT && timeout.retryable);

    const srv = classifyProviderError(new Error('service unavailable'), 503);
    assert('503 é SERVER_ERROR', srv.errorType === ERROR_TYPES.SERVER_ERROR);
  }

  {
    const headers = new Map([['retry-after', '42']]);
    assert('Retry-After header', parseRetryAfterSeconds(headers) === 42);
    assert('Retry-After na mensagem', parseRetryAfterSeconds(null, 'Tenta de novo em 15s') === 15);
  }

  {
    const cb = new ProviderCircuitBreaker();
    cb.recordFailure('groq', { errorType: ERROR_TYPES.RATE_LIMIT, isRateLimit: true }, 30);
    assert('circuit abre em 429', cb.isOpen('groq'));
    assert('outro provider livre', !cb.isOpen('openai'));
    cb.recordSuccess('groq');
    assert('circuit fecha após sucesso', !cb.isOpen('groq'));
  }

  {
    let calls = 0;
    const result = await runAiFallbackLoop({
      providerList: [
        { name: 'groq', apiKey: 'k1' },
        { name: 'openai', apiKey: 'k2' },
      ],
      resolveModels: () => ['m1'],
      circuitBreaker: new ProviderCircuitBreaker(),
      callAttempt: async (provider) => {
        calls += 1;
        if (provider.name === 'groq') {
          const err = new Error('rate limit');
          err.isRateLimit = true;
          err.httpStatus = 429;
          throw err;
        }
        return { content: [{ type: 'text', text: '{"ok":true}' }] };
      },
    });
    assert('429 no Groq continua para OpenAI', result.ok && result.provider === 'openai', JSON.stringify(result));
    assert('duas tentativas', calls === 2, String(calls));
    assert('fallback_used', result.fallbackUsed === true);
  }

  {
    let calls = 0;
    const result = await runAiFallbackLoop({
      providerList: [{ name: 'groq', apiKey: 'k1' }],
      resolveModels: () => ['m1', 'm2'],
      circuitBreaker: new ProviderCircuitBreaker(),
      callAttempt: async (provider, model) => {
        calls += 1;
        if (model === 'm1') {
          const err = new Error('timeout');
          err.isTimeout = true;
          throw err;
        }
        return { ok: true };
      },
    });
    assert('timeout tenta próximo modelo', result.ok && result.model === 'm2');
    assert('duas chamadas no mesmo provider', calls === 2);
  }

  {
    const { resolveModelsForProvider, getActiveModelsSnapshot, parseProviderToggle } = require('../netlify/functions/lib/ai-model-config');
    const ALLOWED = {
      groq: new Set(['qwen/qwen3.6-27b', 'openai/gpt-oss-20b']),
      openai: new Set(['gpt-4o-mini']),
      anthropic: new Set(['claude-haiku-4-5-20251001']),
    };
    const ORDER = {
      groq: ['openai/gpt-oss-20b', 'qwen/qwen3.6-27b'],
      openai: ['gpt-4o-mini'],
      anthropic: ['claude-haiku-4-5-20251001'],
    };
    const deps = {
      allowedModels: ALLOWED,
      defaultOrder: ORDER,
      normalizeGroqModel: (m) => m,
      defaultModelFor: (p) => ORDER[p][0],
      resolveModelForProviderSingle: (_p, m) => m,
    };
    const listEnv = { AI_ACTIVE_MODELS_GROQ: 'qwen/qwen3.6-27b' };
    const listModels = resolveModelsForProvider('groq', 'auto', listEnv, deps);
    assert('lista explícita filtra modelos', listModels.length === 1 && listModels[0] === 'qwen/qwen3.6-27b', listModels.join(','));

    const toggleEnv = {
      AI_ACTIVE_MODELS_GROQ: 'YES',
      AI_ACTIVE_MODELS_OPENAI: 'YES',
      AI_ACTIVE_MODELS_ANTHROPIC: 'NO',
    };
    const groqModels = resolveModelsForProvider('groq', 'auto', toggleEnv, deps);
    assert('YES usa ordem default Groq', groqModels.length === 2, groqModels.join(','));
    const anthropicModels = resolveModelsForProvider('anthropic', 'auto', toggleEnv, deps);
    assert('NO desactiva Anthropic', anthropicModels.length === 0);
    const snap = getActiveModelsSnapshot(toggleEnv);
    assert('snapshot YES/NO', snap.groq === 'yes' && snap.openai === 'yes' && snap.anthropic === 'no');
    assert('parseProviderToggle YES', parseProviderToggle('YES')?.mode === 'default');
    assert('parseProviderToggle NO', parseProviderToggle('NO')?.mode === 'disabled');
  }

  console.log(`\nResultado: ${passed} passaram, ${failed} falharam`);
  process.exit(failed > 0 ? 1 : 0);
})();
