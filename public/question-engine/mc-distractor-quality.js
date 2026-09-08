/**
 * Qualidade dos distractores MC em função da dificuldade.
 * Níveis altos pedem opções mais próximas da resposta; níveis baixos pedem erradas fáceis de eliminar.
 */
(function (global) {
  'use strict';

  const Issues = global.QuestionEngineIssues;
  const Config = global.QuestionEngineConfig;
  if (!Issues || !Config) {
    throw new Error('mc-distractor-quality: carrega issue-codes.js e engine-config.js antes deste módulo');
  }

  const { mkIssue, ISSUE_LAYER } = Issues;
  const { FORMAT_IDS } = Config;

  const ABSURD_OPTION = /^(banana|futebol|azul|verde|vermelho|nada|qualquer|abc|xyz|123|nenhum|desconhecido)$/i;

  const PROFILES = Object.freeze({
    1: Object.freeze({
      level: 1,
      label: 'fáceis de eliminar',
      yearMinGap: 5,
      yearMaxGap: 9999,
      maxNameDistance: 1,
      requireNear: false,
    }),
    2: Object.freeze({
      level: 2,
      label: 'plausíveis mas distintas',
      yearMinGap: 3,
      yearMaxGap: 80,
      maxNameDistance: 1,
      requireNear: false,
    }),
    3: Object.freeze({
      level: 3,
      label: 'confusões comuns',
      yearMinGap: 2,
      yearMaxGap: 45,
      maxNameDistance: 0,
      requireNear: false,
    }),
    4: Object.freeze({
      level: 4,
      label: 'próximas (o jogador hesita)',
      yearMinGap: 1,
      yearMaxGap: 25,
      maxNameDistance: 0,
      requireNear: true,
    }),
    5: Object.freeze({
      level: 5,
      label: 'near-miss (detalhe fino)',
      yearMinGap: 1,
      yearMaxGap: 15,
      maxNameDistance: 0,
      requireNear: true,
    }),
  });

  function getMcDistractorProfile(difficulty) {
    const level = Math.min(5, Math.max(1, Number(difficulty) || 3));
    return PROFILES[level];
  }

  function describeMcDistractorTarget(difficulty) {
    const profile = getMcDistractorProfile(difficulty);
    return `Nível ${profile.level}/5 — distractores ${profile.label}.`;
  }

  function levenshteinDistance(a, b) {
    const left = String(a || '');
    const right = String(b || '');
    if (left === right) return 0;
    if (!left.length) return right.length;
    if (!right.length) return left.length;
    const row = Array.from({ length: right.length + 1 }, (_, i) => i);
    for (let i = 1; i <= left.length; i += 1) {
      let prev = row[0];
      row[0] = i;
      for (let j = 1; j <= right.length; j += 1) {
        const tmp = row[j];
        const cost = left[i - 1] === right[j - 1] ? 0 : 1;
        row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost);
        prev = tmp;
      }
    }
    return row[right.length];
  }

  function extractYears(text) {
    const found = [];
    for (const m of String(text || '').match(/\b(\d{3,4})\b/g) || []) {
      const v = Number.parseInt(m, 10);
      if (Number.isFinite(v) && v >= 100 && v <= 2999) found.push(v);
    }
    return found;
  }

  function strip(value) {
    return String(value || '').replace(/<[^>]*>/g, '').trim();
  }

  function optionNorm(text) {
    return strip(text).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  function shouldSkipFormat(formatId) {
    return formatId === FORMAT_IDS.VERDADEIRO_FALSO || formatId === FORMAT_IDS.CURIOSIDADE;
  }

  function buildMcDistractorRules(difficulty, ageBandKey, formatId) {
    if (shouldSkipFormat(formatId)) return '';
    const profile = getMcDistractorProfile(difficulty);
    const ageNote = ageBandKey === '6-9'
      ? ' Aos 6–9 as opções erradas devem ser óbvias de eliminar, sem nomes quase iguais.'
      : '';
    return `OPÇÕES MC CALIBRADAS À DIFICULDADE ${profile.level}/5 (${profile.label}):
- Exactamente 4 opções no jogo: 1 correcta + 3 distractores da MESMA CLASSE conceptual que a resposta (4 cidades, 4 anos, 4 pessoas, 4 planetas…).
- NUNCA distractores absurdo (cores, desportos ou frutas misturados com o tema).
- Nível 1–2: erradas claramente distintas, fáceis de excluir, mas ainda do mesmo tipo.${ageNote}
- Nível 3: confusões comuns do tema (pares clássicos, vizinhos, contemporâneos).
- Nível 4–5: distractores PRÓXIMOS da resposta — entidades irmãs, anos próximos, nomes do mesmo domínio. A certa só se distingue por um detalhe. PROIBIDO opções óbvias ou desconexas.
- Campo JSON "distractors": exactamente 3 strings erradas, curtas, em PT-PT.`;
  }

  function validateMcDistractorProximity(parsed, ctx) {
    const { isMC, formatId, difficulty } = ctx;
    if (!isMC || shouldSkipFormat(formatId)) return [];
    const a = strip(parsed?.a || '');
    const options = Array.isArray(parsed?.options) ? parsed.options.map(strip).filter(Boolean) : [];
    if (options.length < 4) return [];

    const profile = getMcDistractorProfile(difficulty);
    const correctNorm = optionNorm(a);
    const wrong = options.filter((o) => optionNorm(o) !== correctNorm);
    if (wrong.length < 3) return [];

    const issues = [];

    const absurdCount = wrong.filter((o) => ABSURD_OPTION.test(o)).length;
    if (profile.requireNear && absurdCount >= 1) {
      issues.push(mkIssue(
        'MC_DISTRACTORS_TOO_FAR',
        ISSUE_LAYER.mcOptions,
        `distractores demasiado óbvios para dificuldade ${profile.level} — usa alternativas próximas da resposta`,
      ));
    }

    const correctYears = extractYears(a);
    const wrongYearGaps = wrong
      .map((o) => extractYears(o))
      .filter((ys) => ys.length && correctYears.length)
      .map((ys) => Math.min(...ys.map((y) => Math.abs(y - correctYears[0]))));
    if (correctYears.length && wrongYearGaps.length === wrong.length) {
      const minGap = Math.min(...wrongYearGaps);
      if (minGap < profile.yearMinGap) {
        issues.push(mkIssue(
          'MC_DISTRACTORS_TOO_CLOSE',
          ISSUE_LAYER.mcOptions,
          `anos demasiado próximos para dificuldade ${profile.level} — o jogador não consegue distinguir`,
        ));
      }
      if (profile.requireNear && minGap > profile.yearMaxGap) {
        issues.push(mkIssue(
          'MC_DISTRACTORS_TOO_FAR',
          ISSUE_LAYER.mcOptions,
          `anos demasiado afastados para dificuldade ${profile.level} — aproxima os distractores da data correcta`,
        ));
      }
    }

    if (profile.maxNameDistance > 0) {
      const confusing = wrong.some((o) => {
        const n = optionNorm(o);
        if (n.length < 5 || correctNorm.length < 5) return false;
        if (extractYears(o).length && extractYears(a).length) return false;
        return levenshteinDistance(n, correctNorm) <= profile.maxNameDistance;
      });
      if (confusing) {
        issues.push(mkIssue(
          'MC_DISTRACTORS_TOO_CLOSE',
          ISSUE_LAYER.mcOptions,
          `opções quase iguais à resposta — em dificuldade ${profile.level} os distractores devem ser fáceis de distinguir`,
        ));
      }
    }

    return issues;
  }

  global.QuestionEngineMcDistractorQuality = Object.freeze({
    getMcDistractorProfile,
    describeMcDistractorTarget,
    buildMcDistractorRules,
    validateMcDistractorProximity,
  });
})(typeof window !== 'undefined' ? window : globalThis);
