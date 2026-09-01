/**
 * Verificação factual IA — segunda passagem selectiva (categorias de alto risco).
 */
(function (global) {
  'use strict';

  const FACT_VERIFY_CATEGORIES = new Set([2, 3, 4, 5, 6, 14, 15, 17, 18, 19]);
  const SKIP_FORMATS = new Set(['ADIVINHA', 'CURIOSIDADE']);

  function stripPlain(text, stripTags) {
    const fn = typeof stripTags === 'function' ? stripTags : (s) => String(s || '').replace(/<[^>]*>/g, '');
    return fn(text).replace(/\s+/g, ' ').trim();
  }

  function shouldRequestFactualVerify(ctx) {
    if (!ctx || ctx.enabled === false) return false;
    const cat = Number(ctx.categoryNumber);
    if (!cat || !FACT_VERIFY_CATEGORIES.has(cat)) return false;
    const formatId = String(ctx.formatId || '');
    if (formatId && SKIP_FORMATS.has(formatId)) return false;
    return true;
  }

  function buildFactualVerifyPrompt(parsed, ctx) {
    const stripTags = ctx?.stripTags;
    const q = stripPlain(parsed?.q, stripTags);
    const a = stripPlain(parsed?.a, stripTags);
    const options = Array.isArray(parsed?.options)
      ? parsed.options.map((o) => stripPlain(o, stripTags)).filter(Boolean)
      : [];
    const lines = [
      'Verifica factualmente esta pergunta de quiz para crianças/jovens em português de Portugal.',
      '',
      `Categoria: ${ctx?.categoryName || ctx?.categoryNumber || '—'}`,
      `Faixa etária: ${ctx?.ageBandKey || '—'}`,
      `Formato: ${ctx?.formatId || '—'}`,
      '',
      `Pergunta: ${q}`,
      `Resposta indicada como correta: ${a}`,
    ];
    if (options.length) lines.push(`Opções: ${options.join(' | ')}`);
    lines.push(
      '',
      'Responde APENAS com JSON válido, sem markdown:',
      '{"ok":true} — se a resposta está factualmente correcta e inequívoca para a pergunta.',
      '{"ok":false,"issues":["motivo curto em português"]} — se houver erro factual, ambiguidade ou resposta contestável.',
      '',
      'Não critiques estilo, comprimento ou dificuldade — só factos verificáveis.',
    );
    return lines.join('\n');
  }

  function parseFactualVerifyResponse(text) {
    const raw = String(text || '').replace(/```json|```/g, '').trim();
    if (!raw) return { ok: true, issues: [], skipped: true };
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) return { ok: true, issues: [], parseError: true };
      try {
        parsed = JSON.parse(match[0]);
      } catch {
        return { ok: true, issues: [], parseError: true };
      }
    }
    if (parsed?.ok === true) return { ok: true, issues: [] };
    const issues = Array.isArray(parsed?.issues)
      ? parsed.issues.map((i) => String(i || '').trim()).filter(Boolean).slice(0, 4)
      : [];
    if (!issues.length && parsed?.reason) issues.push(String(parsed.reason).trim());
    if (!issues.length) issues.push('verificação factual rejeitou a pergunta');
    return { ok: false, issues };
  }

  global.QuestionEngineFactualVerify = Object.freeze({
    FACT_VERIFY_CATEGORIES,
    SKIP_FORMATS,
    shouldRequestFactualVerify,
    buildFactualVerifyPrompt,
    parseFactualVerifyResponse,
  });
})(typeof window !== 'undefined' ? window : globalThis);
