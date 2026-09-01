/**
 * Verificação semântica de ADIVINHA — segunda passagem IA (pistas → resposta única).
 */
(function (global) {
  'use strict';

  function stripPlain(text, stripTags) {
    const fn = typeof stripTags === 'function' ? stripTags : (s) => String(s || '').replace(/<[^>]*>/g, '');
    return fn(text).replace(/\s+/g, ' ').trim();
  }

  function parseAdivinhaClues(raw) {
    const arr = raw?.clues || raw?.pistas || raw?.hints;
    if (!Array.isArray(arr)) return [];
    return arr.map((item) => String(item || '').trim()).filter(Boolean);
  }

  function shouldRequestAdivinhaVerify(ctx) {
    if (!ctx || ctx.enabled === false) return false;
    return String(ctx.formatId || '') === 'ADIVINHA';
  }

  function buildAdivinhaVerifyPrompt(parsed, ctx) {
    const stripTags = ctx?.stripTags;
    const q = stripPlain(parsed?.q, stripTags);
    const a = stripPlain(parsed?.a, stripTags);
    const clues = parseAdivinhaClues(parsed);
    const lines = [
      'Verifica se esta adivinha portuguesa tem UMA única resposta logicamente determinada pelas pistas.',
      '',
      `Faixa etária: ${ctx?.ageBandKey || '—'}`,
      '',
      `Pergunta/adivinha: ${q}`,
      `Resposta indicada: ${a}`,
      `Pistas (clues): ${clues.length ? clues.map((c, i) => `${i + 1}. ${c}`).join(' | ') : '(nenhuma)'}`,
    ];
    if (Array.isArray(parsed?.options) && parsed.options.length) {
      lines.push(`Opções MC: ${parsed.options.map((o) => stripPlain(o, stripTags)).join(' | ')}`);
    }
    lines.push(
      '',
      'Responde APENAS com JSON válido, sem markdown:',
      '{"ok":true} — se a resposta encaixa claramente nas pistas e não há outra resposta igualmente defensável.',
      '{"ok":false,"issues":["motivo curto em português"]} — se a adivinha é fraca, ambígua, ou a resposta não segue das pistas.',
      '',
      'Não critiques estilo ou comprimento — só coerência lógica entre pistas e resposta.',
    );
    return lines.join('\n');
  }

  function parseAdivinhaVerifyResponse(text) {
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
    if (!issues.length) issues.push('verificação semântica da adivinha rejeitou a pergunta');
    return { ok: false, issues };
  }

  global.QuestionEngineAdivinhaVerify = Object.freeze({
    parseAdivinhaClues,
    shouldRequestAdivinhaVerify,
    buildAdivinhaVerifyPrompt,
    parseAdivinhaVerifyResponse,
  });
})(typeof window !== 'undefined' ? window : globalThis);
