/**
 * Estimativa de dificuldade — compara nível pedido vs conteúdo da pergunta.
 */
(function (global) {
  'use strict';

  const DIFFICULTY_RANGE = Object.freeze({
    '6-9': { min: 1, max: 3 },
    '10-15': { min: 1, max: 4 },
    '15+': { min: 1, max: 5 },
  });

  function clampDifficulty(value, ageBandKey) {
    const range = DIFFICULTY_RANGE[ageBandKey] || DIFFICULTY_RANGE['15+'];
    const n = Number(value);
    if (!Number.isFinite(n)) return range.min;
    return Math.max(range.min, Math.min(range.max, Math.round(n)));
  }

  function estimateDifficulty(q, a, ctx) {
    const ageBandKey = ctx?.ageBandKey || '15+';
    const range = DIFFICULTY_RANGE[ageBandKey] || DIFFICULTY_RANGE['15+'];
    const blob = `${String(q || '')} ${String(a || '')}`;
    const ql = blob.toLowerCase();
    let est = 3;
    let confidence = 0.45;

    const trivial = /\b(planeta onde vivemos|cor do céu|quantos dedos|quantas pernas tem um cão)\b/i;
    if (trivial.test(ql)) {
      est = Math.min(est, 1);
      confidence = Math.max(confidence, 0.88);
    }

    const basic = /\b(cores primárias|quantas patas|água ferve|lua orbita|quantos continentes)\b/i;
    if (basic.test(ql)) {
      est = Math.min(est, 2);
      confidence = Math.max(confidence, 0.72);
    }

    const advanced = /\b(teorema|algoritmo|revolução industrial|segunda guerra mundial|primeira guerra mundial|tratado de versalhes|mitocôndria|fotossíntese|imperialismo)\b/i;
    if (advanced.test(ql)) {
      est = Math.max(est, 4);
      confidence = Math.max(confidence, 0.82);
    }

    const obscureForYoung = /\b(picasso|playstation|mega\s*drive|nintendo\s*64|everest|merckx|babbage|máquina analítica|maquina analitica)\b/i;
    if (obscureForYoung.test(ql)) {
      est = ageBandKey === '6-9' ? Math.max(est, 4) : Math.max(est, 3);
      confidence = Math.max(confidence, 0.8);
    }

    const specialist = /\b(entropia|quantum|quântico|quantic|algoritmo genético|neurociência avançada)\b/i;
    if (specialist.test(ql)) {
      est = Math.max(est, 5);
      confidence = Math.max(confidence, 0.78);
    }

    const qWords = String(q || '').split(/\s+/).filter(Boolean).length;
    if (qWords > 28) est = Math.max(est, 3);
    if (qWords > 42) est = Math.max(est, 4);

    est = clampDifficulty(est, ageBandKey);
    if (est === range.min || est === range.max) confidence = Math.max(confidence, 0.55);

    return {
      estimatedDifficulty: est,
      difficultyConfidence: Math.min(0.95, confidence),
    };
  }

  function validateDifficultyMatch(requested, estimation, ageBandKey) {
    const issues = [];
    const req = Number(requested);
    if (!Number.isFinite(req)) return issues;
    const est = estimation?.estimatedDifficulty;
    const conf = estimation?.difficultyConfidence ?? 0.5;
    if (!Number.isFinite(est)) return issues;

    const range = DIFFICULTY_RANGE[ageBandKey] || DIFFICULTY_RANGE['15+'];
    const reqClamped = clampDifficulty(req, ageBandKey);
    const gap = reqClamped - est;
    const minGap = conf >= 0.75 ? 1 : 2;

    if (gap >= minGap) {
      issues.push({
        code: 'DIFFICULTY_EASIER_THAN_REQUESTED',
        layer: 'difficulty',
        message: `dificuldade pedida ${reqClamped} mas estimada ${est} — pergunta demasiado fácil para o nível pedido`,
      });
    } else if (-gap >= minGap) {
      issues.push({
        code: 'DIFFICULTY_HARDER_THAN_REQUESTED',
        layer: 'difficulty',
        message: `dificuldade pedida ${reqClamped} mas estimada ${est} — pergunta demasiado difícil para o nível pedido`,
      });
    }
    return issues;
  }

  global.QuestionEngineDifficultyEstimate = Object.freeze({
    DIFFICULTY_RANGE,
    estimateDifficulty,
    validateDifficultyMatch,
    clampDifficulty,
  });
})(typeof window !== 'undefined' ? window : globalThis);
