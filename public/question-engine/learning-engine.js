/**
 * Learning Engine — extrai regras de avaliações humanas (não copia perguntas).
 * Usado no teste, no prompt-builder e na API admin (Node).
 */
(function (global) {
  'use strict';

  const SCHEMA_VERSION = 2;
  const SESSION_HINT_LIMIT = 8;
  const MEDIUM_EVIDENCE = 3;
  const HIGH_EVIDENCE = 8;
  const LONG_TERM_MIN = 20;
  const MAX_HIGH_RULES = 12;
  const MAX_MEDIUM_RULES = 8;
  const COMMENT_HINT_MAX = 120;

  const LAYER_MAX = Object.freeze({
    structural: 10,
    format: 12,
    age: 12,
    difficulty: 8,
    category: 8,
    ptPt: 10,
    semantic: 15,
    repetition: 13,
    mcOptions: 12,
  });

  const LAYER_LABELS = Object.freeze({
    structural: 'Estrutura',
    format: 'Formato',
    age: 'Idade',
    difficulty: 'Dificuldade',
    category: 'Categoria',
    ptPt: 'PT-PT',
    semantic: 'Semântica',
    repetition: 'Repetição',
    mcOptions: 'Opções MC',
  });

  const ISSUE_GROUPS = Object.freeze([
    Object.freeze({
      id: 'content',
      label: 'Conteúdo',
      items: Object.freeze([
        Object.freeze({ id: 'factual', label: 'factual' }),
        Object.freeze({ id: 'ambiguous-answer', label: 'resposta ambígua' }),
        Object.freeze({ id: 'too-easy', label: 'pergunta demasiado fácil' }),
        Object.freeze({ id: 'too-hard', label: 'pergunta demasiado difícil' }),
        Object.freeze({ id: 'debatable-knowledge', label: 'conhecimento discutível' }),
        Object.freeze({ id: 'uninteresting', label: 'pergunta pouco interessante' }),
      ]),
    }),
    Object.freeze({
      id: 'language',
      label: 'Linguagem',
      items: Object.freeze([
        Object.freeze({ id: 'pt-br', label: 'PT-BR' }),
        Object.freeze({ id: 'awkward-pt', label: 'português estranho' }),
        Object.freeze({ id: 'confusing-stem', label: 'enunciado confuso' }),
        Object.freeze({ id: 'grammar', label: 'gramática' }),
      ]),
    }),
    Object.freeze({
      id: 'classification',
      label: 'Classificação',
      items: Object.freeze([
        Object.freeze({ id: 'wrong-category', label: 'categoria errada' }),
        Object.freeze({ id: 'wrong-age', label: 'idade errada' }),
        Object.freeze({ id: 'wrong-difficulty', label: 'dificuldade errada' }),
        Object.freeze({ id: 'wrong-format', label: 'formato errado' }),
      ]),
    }),
    Object.freeze({
      id: 'mc',
      label: 'MC',
      items: Object.freeze([
        Object.freeze({ id: 'obvious-distractor', label: 'distractor obviamente errado' }),
        Object.freeze({ id: 'too-close-distractor', label: 'distractor demasiado próximo' }),
        Object.freeze({ id: 'two-answers', label: 'duas respostas possíveis' }),
        Object.freeze({ id: 'ambiguous-correct', label: 'resposta correcta ambígua' }),
        Object.freeze({ id: 'unbalanced-options', label: 'opções desequilibradas' }),
        Object.freeze({ id: 'repeated-options', label: 'repetição entre opções' }),
      ]),
    }),
    Object.freeze({
      id: 'diversity',
      label: 'Diversidade',
      items: Object.freeze([
        Object.freeze({ id: 'repeated-question', label: 'pergunta repetida' }),
        Object.freeze({ id: 'repeated-knowledge', label: 'conhecimento repetido' }),
        Object.freeze({ id: 'repeated-structure', label: 'estrutura repetida' }),
        Object.freeze({ id: 'repeated-subtopic', label: 'subtema repetido' }),
      ]),
    }),
  ]);

  const ISSUE_LABELS = {};
  ISSUE_GROUPS.forEach((group) => {
    group.items.forEach((item) => {
      ISSUE_LABELS[item.id] = item.label;
    });
  });

  const LEGACY_ISSUE_MAP = Object.freeze({
    repeticao: 'repeated-question',
    idade: 'wrong-age',
    categoria: 'wrong-category',
    'pt-pt': 'pt-br',
    factual: 'factual',
    mc: 'obvious-distractor',
    outro: 'uninteresting',
  });

  const VERDICT_LABELS = Object.freeze({
    'motor-ok': 'Motor correcto',
    'false-negative': 'False negative (motor rejeitou, devia aceitar)',
    'false-positive': 'False positive (motor aceitou, devia rejeitar)',
    'ia-gen-error': 'Erro de geração IA',
    'ia-bad': 'Erro de geração IA',
  });

  let cachedRules = [];

  function clip(value, max) {
    return String(value || '').trim().slice(0, max);
  }

  function normalizeIssue(id) {
    const raw = String(id || '').trim();
    if (!raw) return '';
    return LEGACY_ISSUE_MAP[raw] || raw;
  }

  function normalizeIssues(list) {
    const seen = new Set();
    const out = [];
    (Array.isArray(list) ? list : []).forEach((id) => {
      const next = normalizeIssue(id);
      if (!next || seen.has(next)) return;
      seen.add(next);
      out.push(next);
    });
    return out;
  }

  function normalizeVerdict(verdict, schemaVersion) {
    const raw = String(verdict || '').trim();
    if (raw === 'ia-bad' || raw === 'ia-gen-error') return 'ia-gen-error';
    if (!schemaVersion || Number(schemaVersion) < 2) {
      if (raw === 'false-positive') return 'false-negative';
      if (raw === 'false-negative') return 'false-positive';
    }
    return raw;
  }

  function sameValue(a, b) {
    if (a == null && b == null) return true;
    if (Array.isArray(a) || Array.isArray(b)) {
      return JSON.stringify(a || []) === JSON.stringify(b || []);
    }
    return String(a) === String(b);
  }

  function addFieldError(list, field, aiValue, humanValue) {
    if (aiValue == null || humanValue == null) return;
    if (sameValue(aiValue, humanValue)) return;
    list.push({
      field,
      ai_value: aiValue,
      human_value: humanValue,
      error: true,
    });
  }

  function buildCorrections(original, current) {
    const orig = original || {};
    const cur = current || {};
    const fieldErrors = [];
    addFieldError(fieldErrors, 'category', orig.category, cur.category);
    addFieldError(fieldErrors, 'difficulty', orig.difficulty, cur.difficulty);
    addFieldError(fieldErrors, 'format', orig.format, cur.format);
    addFieldError(fieldErrors, 'age', orig.age, cur.age);
    addFieldError(fieldErrors, 'question', orig.question, cur.question);
    addFieldError(fieldErrors, 'answer', orig.answer, cur.answer);
    const corrections = {};
    fieldErrors.forEach((err) => {
      corrections[err.field] = err.human_value;
    });
    return { corrections, fieldErrors };
  }

  function layerOutcome(motor, tester, max) {
    const m = Number(motor);
    const t = Number(tester);
    const cap = Number(max) || 10;
    if (!Number.isFinite(m) || !Number.isFinite(t) || !cap) return 'unknown';
    const gap = Math.abs(m - t);
    if (gap <= 1) return 'ok';
    if (t / cap <= 0.6 && m / cap >= 0.8) return 'motor-high';
    if (m / cap <= 0.6 && t / cap >= 0.8) return 'motor-low';
    return 'warn';
  }

  function buildLayerMatrix(motorLayers, testerLayers) {
    const motor = motorLayers || {};
    const tester = testerLayers || {};
    const keys = Object.keys(LAYER_MAX);
    const matrix = {};
    keys.forEach((key) => {
      if (motor[key] == null && tester[key] == null) return;
      const max = LAYER_MAX[key];
      const motorPts = Number(motor[key]);
      const testerPts = tester[key] == null ? motorPts : Number(tester[key]);
      matrix[key] = {
        motor: Number.isFinite(motorPts) ? motorPts : null,
        tester: Number.isFinite(testerPts) ? testerPts : null,
        max,
        result: layerOutcome(motorPts, testerPts, max),
      };
    });
    return matrix;
  }

  function toLearningInput(entry) {
    if (!entry || typeof entry !== 'object') return null;
    if (entry.input && entry.engine && entry.human) {
      const human = { ...entry.human };
      human.verdict = normalizeVerdict(human.verdict, entry.schemaVersion || human.schemaVersion);
      human.issues = normalizeIssues(human.issues || human.tags);
      return {
        ...entry,
        schemaVersion: entry.schemaVersion || SCHEMA_VERSION,
        human,
      };
    }

    const origCat = entry.originalCategory || '';
    const corrCat = entry.category || origCat;
    const requested = entry.requestedDifficulty;
    const corrected = entry.correctedDifficulty ?? entry.difficulty;
    const origFormat = entry.originalFormat || '';
    const corrFormat = entry.format || origFormat;
    const { corrections, fieldErrors } = buildCorrections(
      {
        category: origCat || undefined,
        difficulty: requested,
        format: origFormat || undefined,
        question: entry.originalQuestion,
        answer: entry.originalAnswer,
      },
      {
        category: corrCat || undefined,
        difficulty: corrected,
        format: corrFormat || undefined,
        question: entry.question,
        answer: entry.answer,
      },
    );

    return {
      id: entry.id,
      schemaVersion: entry.schemaVersion || 1,
      evaluatedAt: entry.ts || entry.evaluatedAt,
      input: {
        category: origCat || corrCat || '',
        age: entry.age || '',
        difficulty: requested ?? null,
        format: origFormat || corrFormat || '',
        archetype: entry.archetype || '',
      },
      generated: {
        question: entry.originalQuestion || entry.question || '',
        answer: entry.originalAnswer || entry.answer || '',
        options: entry.originalOptions || entry.options || [],
      },
      engine: {
        accepted: !!entry.motorAccepted,
        score: entry.score ?? null,
        layers: entry.motorLayers || {},
        issues: entry.issues || [],
      },
      human: {
        verdict: normalizeVerdict(entry.verdict, entry.schemaVersion),
        rating: entry.humanRating ?? null,
        issues: normalizeIssues(entry.tags || entry.issues),
        corrections,
        fieldErrors,
        layerScores: entry.layerScores || {},
        applicableAges: entry.applicableAges || [],
        extraCategories: entry.extraCategories || [],
        comment: entry.comment || '',
      },
    };
  }

  function scopeLabel(scope) {
    const bits = [];
    if (scope?.age && scope.age !== '*') bits.push(scope.age);
    if (scope?.format && scope.format !== '*') bits.push(scope.format);
    if (scope?.category && scope.category !== '*') bits.push(scope.category);
    return bits.join(' / ');
  }

  function issueRuleText(issue, scope) {
    const label = ISSUE_LABELS[issue] || issue;
    const where = scopeLabel(scope);
    const prefix = where ? `${where}: ` : '';
    const map = {
      factual: `${prefix}garantir factos verificáveis; não inventar.`,
      'ambiguous-answer': `${prefix}cada pergunta deve ter uma única resposta inequívoca.`,
      'too-easy': `${prefix}evitar perguntas triviais para a faixa.`,
      'too-hard': `${prefix}evitar perguntas demasiado especializadas ou difíceis.`,
      'debatable-knowledge': `${prefix}evitar conhecimentos discutíveis ou opinativos.`,
      uninteresting: `${prefix}preferir perguntas interessantes e concretas.`,
      'pt-br': `${prefix}usar português de Portugal; evitar PT-BR.`,
      'awkward-pt': `${prefix}usar português natural de Portugal.`,
      'confusing-stem': `${prefix}enunciados claros, sem ambiguidade.`,
      grammar: `${prefix}corrigir gramática e concordância.`,
      'wrong-category': `${prefix}classificar na categoria correcta.`,
      'wrong-age': `${prefix}adequar conteúdo e linguagem à idade pedida.`,
      'wrong-difficulty': `${prefix}alinhar a dificuldade real com a pedida.`,
      'wrong-format': `${prefix}respeitar o formato pedido.`,
      'obvious-distractor': `${prefix}distractores MC devem ser plausíveis, não absurdos.`,
      'too-close-distractor': `${prefix}evitar distractores semanticamente equivalentes à resposta.`,
      'two-answers': `${prefix}não pode haver duas opções correctas.`,
      'ambiguous-correct': `${prefix}a opção correcta tem de ser inequívoca.`,
      'unbalanced-options': `${prefix}opções MC com comprimento e estilo semelhantes.`,
      'repeated-options': `${prefix}opções distintas, sem repetir a mesma ideia.`,
      'repeated-question': `${prefix}não repetir a mesma pergunta.`,
      'repeated-knowledge': `${prefix}variar o conhecimento testado.`,
      'repeated-structure': `${prefix}variar a estrutura da pergunta.`,
      'repeated-subtopic': `${prefix}variar o subtema dentro da categoria.`,
    };
    return map[issue] || `${prefix}evitar o problema «${label}».`;
  }

  function bump(buckets, key, payload) {
    const prev = buckets.get(key);
    if (prev) {
      prev.evidence += 1;
      return;
    }
    buckets.set(key, {
      rule_key: key,
      scope: payload.scope || {},
      type: payload.type,
      rule: payload.rule,
      evidence: 1,
    });
  }

  function deriveRules(results, opts = {}) {
    const mediumEvidence = Number(opts.mediumEvidence) || MEDIUM_EVIDENCE;
    const highEvidence = Number(opts.highEvidence) || HIGH_EVIDENCE;
    const buckets = new Map();
    (results || []).forEach((raw) => {
      const item = toLearningInput(raw);
      if (!item) return;
      const input = item.input || {};
      const human = item.human || {};
      const engine = item.engine || {};
      const age = input.age || '*';
      const format = input.format || '*';
      const category = input.category || '*';
      const issues = normalizeIssues(human.issues);

      issues.forEach((issue) => {
        const scopeAge = { age };
        bump(buckets, `issue|${age}|*|${issue}`, {
          scope: scopeAge,
          type: 'issue',
          rule: issueRuleText(issue, scopeAge),
        });
        if (format && format !== '*') {
          const scopeFmt = { age, format };
          bump(buckets, `issue|${age}|${format}|${issue}`, {
            scope: scopeFmt,
            type: 'issue',
            rule: issueRuleText(issue, scopeFmt),
          });
        }
      });

      const fieldErrors = Array.isArray(human.fieldErrors) ? human.fieldErrors : [];
      fieldErrors.forEach((err) => {
        if (err.field === 'difficulty') {
          const fromD = Number(err.ai_value);
          const toD = Number(err.human_value);
          if (!Number.isFinite(fromD) || !Number.isFinite(toD) || fromD === toD) return;
          bump(buckets, `difficulty|${age}|${fromD}->${toD}`, {
            scope: { age },
            type: 'difficulty',
            rule: `Em ${age}: dificuldade pedida D${fromD} foi corrigida para D${toD}. Preferir D${toD}.`,
          });
          if (toD < fromD) {
            bump(buckets, `difficulty-cap|${age}`, {
              scope: { age },
              type: 'difficulty',
              rule: `Em ${age}: evitar D${fromD}+; preferir dificuldade <= ${toD}.`,
            });
          }
        }
        if (err.field === 'category') {
          bump(buckets, `category|${err.ai_value}->${err.human_value}`, {
            scope: { category: err.ai_value },
            type: 'category',
            rule: `Perguntas classificadas como «${err.ai_value}» foram corrigidas para «${err.human_value}». Não misturar estes temas.`,
          });
        }
        if (err.field === 'format') {
          bump(buckets, `format|${age}|${err.ai_value}->${err.human_value}`, {
            scope: { age, format: err.ai_value },
            type: 'format',
            rule: `Em ${age}: formato «${err.ai_value}» foi corrigido para «${err.human_value}».`,
          });
        }
      });

      const matrix = buildLayerMatrix(engine.layers, human.layerScores);
      Object.entries(matrix).forEach(([layer, cell]) => {
        if (cell.result === 'motor-high') {
          bump(buckets, `layer-over|${layer}|${age}`, {
            scope: { age, layer },
            type: 'layer',
            rule: `O motor sobrevaloriza ${LAYER_LABELS[layer] || layer}${age !== '*' ? ` em ${age}` : ''}.`,
          });
        }
        if (cell.result === 'motor-low') {
          bump(buckets, `layer-under|${layer}|${age}`, {
            scope: { age, layer },
            type: 'layer',
            rule: `O motor subvaloriza ${LAYER_LABELS[layer] || layer}${age !== '*' ? ` em ${age}` : ''}.`,
          });
        }
      });

      if (Number(human.rating) <= 2 && issues.length) {
        bump(buckets, `quality|${age}|${format}`, {
          scope: { age, format, category },
          type: 'quality',
          rule: `${scopeLabel({ age, format }) || 'Geral'}: perguntas fracas (nota 1–2) — melhorar qualidade e evitar os problemas marcados.`,
        });
      }
    });

    const rules = [];
    buckets.forEach((row) => {
      if (row.evidence < mediumEvidence) return;
      const confidence = Math.min(0.99, Math.round((0.42 + row.evidence * 0.055) * 100) / 100);
      rules.push({
        rule_key: row.rule_key,
        scope: row.scope,
        type: row.type,
        rule: row.rule,
        confidence,
        evidence: row.evidence,
        level: row.evidence >= highEvidence ? 'high' : 'medium',
        active: true,
      });
    });
    rules.sort((a, b) => b.confidence - a.confidence || b.evidence - a.evidence);
    return rules;
  }

  function formatSessionHints(entries, opts = {}) {
    const limit = Number(opts.max) || SESSION_HINT_LIMIT;
    const recent = (entries || []).map(toLearningInput).filter(Boolean).slice(-limit);
    if (!recent.length) return '';
    const lines = [
      'APRENDIZAGEM DE CURTO PRAZO (esta sessão — padrões, não copies o texto das perguntas):',
    ];
    recent.forEach((item) => {
      const bits = [];
      const human = item.human || {};
      const input = item.input || {};
      const engine = item.engine || {};
      if (human.verdict) bits.push(VERDICT_LABELS[human.verdict] || human.verdict);
      if (human.rating) bits.push(`qualidade ${human.rating}/5`);
      bits.push(engine.accepted ? 'motor aceitou' : 'motor rejeitou');
      if (human.issues?.length) {
        bits.push('problemas: ' + human.issues.map((id) => ISSUE_LABELS[id] || id).join(', '));
      }
      (human.fieldErrors || []).forEach((err) => {
        if (err.field === 'question' || err.field === 'answer') return;
        bits.push(`${err.field}: ${err.ai_value} → ${err.human_value}`);
      });
      const matrix = buildLayerMatrix(engine.layers, human.layerScores);
      const layerBits = Object.entries(matrix)
        .filter(([, cell]) => cell.result === 'motor-high' || cell.result === 'motor-low' || cell.result === 'warn')
        .map(([key, cell]) => `${LAYER_LABELS[key] || key} motor ${cell.motor} → tester ${cell.tester}`);
      if (layerBits.length) bits.push('camadas: ' + layerBits.slice(0, 4).join(', '));
      if (input.age) bits.push('idade ' + input.age);
      if (human.comment) bits.push('nota: ' + clip(human.comment, COMMENT_HINT_MAX));
      lines.push('- ' + bits.join(' | '));
    });

    const catFixes = recent.flatMap((item) =>
      (item.human?.fieldErrors || []).filter((err) => err.field === 'category'),
    );
    if (catFixes.length) {
      lines.push('CATEGORIAS CORRIGIDAS: ' + catFixes.map((err) => `${err.ai_value} → ${err.human_value}`).join('; ') + '.');
    }
    const diffFixes = recent.flatMap((item) =>
      (item.human?.fieldErrors || []).filter((err) => err.field === 'difficulty'),
    );
    if (diffFixes.length) {
      lines.push('DIFICULDADE CORRIGIDA: ' + diffFixes.map((err) => `D${err.ai_value} → D${err.human_value}`).join('; ') + '.');
    }
    const avoidIssues = [...new Set(recent.flatMap((item) => item.human?.issues || []))];
    if (avoidIssues.length) {
      lines.push('EVITA: ' + avoidIssues.map((id) => ISSUE_LABELS[id] || id).join('; ') + '.');
    }
    return lines.join('\n');
  }

  function formatPersistentRules(rules, opts = {}) {
    const list = (rules || []).filter((r) => r && r.active !== false && r.rule);
    if (!list.length) return '';
    const high = list.filter((r) => (r.level || (r.evidence >= HIGH_EVIDENCE ? 'high' : 'medium')) === 'high')
      .slice(0, opts.maxHigh || MAX_HIGH_RULES);
    const medium = list.filter((r) => (r.level || (r.evidence >= HIGH_EVIDENCE ? 'high' : 'medium')) !== 'high')
      .slice(0, opts.maxMedium || MAX_MEDIUM_RULES);
    const lines = [
      'REGRAS APRENDIDAS (avaliações humanas persistentes — segue o padrão; não copies perguntas anteriores):',
    ];
    if (high.length) {
      lines.push('[ALTA CONFIANÇA]');
      high.forEach((r) => lines.push(`- ${r.rule}`));
    }
    if (medium.length) {
      lines.push('[MÉDIA CONFIANÇA]');
      medium.forEach((r) => lines.push(`- ${r.rule}`));
    }
    return lines.join('\n');
  }

  function setCachedRules(rules) {
    cachedRules = Array.isArray(rules) ? rules.filter((r) => r && r.active !== false) : [];
    return cachedRules;
  }

  function getCachedRules() {
    return cachedRules.slice();
  }

  function getPersistentPromptBlock() {
    return formatPersistentRules(cachedRules);
  }

  function longTermReady(count) {
    return Number(count) >= LONG_TERM_MIN;
  }

  const api = {
    SCHEMA_VERSION,
    SESSION_HINT_LIMIT,
    MEDIUM_EVIDENCE,
    HIGH_EVIDENCE,
    LONG_TERM_MIN,
    ISSUE_GROUPS,
    ISSUE_LABELS,
    VERDICT_LABELS,
    LAYER_MAX,
    LAYER_LABELS,
    normalizeIssue,
    normalizeIssues,
    normalizeVerdict,
    buildCorrections,
    buildLayerMatrix,
    toLearningInput,
    deriveRules,
    formatSessionHints,
    formatPersistentRules,
    setCachedRules,
    getCachedRules,
    getPersistentPromptBlock,
    longTermReady,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  global.QuestionEngineLearning = Object.freeze(api);
})(typeof window !== 'undefined' ? window : globalThis);
