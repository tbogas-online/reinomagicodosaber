/**
 * Códigos de validação estruturados — Fase 1 modularização do QuestionEngine.
 */
(function (global) {
  'use strict';

  const ISSUE_LAYER = Object.freeze({
    structural: 'structural',
    format: 'format',
    age: 'age',
    difficulty: 'difficulty',
    category: 'category',
    ptPt: 'ptPt',
    semantic: 'semantic',
    repetition: 'repetition',
    mcOptions: 'mcOptions',
    factual: 'factual',
    unknown: 'unknown',
  });

  /** Dicas de retry por code (preferido sobre regex em mensagens). */
  const RETRY_HINT_BY_CODE = Object.freeze({
    MC_NEAR_DUPLICATE: 'Gera distractores claramente diferentes mas pertencentes à mesma classe conceptual.',
    MC_WRONG_CLASS: 'Os distractores devem ser plausíveis e da mesma classe que a resposta correcta (4 pessoas, 4 anos, 4 materiais…).',
    MC_INSUFFICIENT_OPTIONS: 'Devolve JSON completo com 4 opções MC distintas e uma única resposta correcta.',
    MC_MULTIPLE_CORRECT: 'Gera exactamente uma opção correcta — as outras três devem ser claramente erradas.',
    KNOWLEDGE_REPEATED: 'Não repitas conhecimento já testado — escolhe outro tema dentro da mesma categoria.',
    QUESTION_REPEATED: 'Não repitas conhecimento já testado — escolhe outro tema dentro da mesma categoria.',
    QUESTION_SIMILAR: 'Não repitas conhecimento já testado — escolhe outro tema dentro da mesma categoria.',
    ANSWER_REPEATED: 'Não repitas conhecimento já testado — escolhe outro tema dentro da mesma categoria.',
    STRUCTURE_INCOMPLETE: 'Devolve JSON completo com "q" (pergunta inteira terminada em ?), "a" (resposta) e "distractors" (exactamente 3 opções erradas).',
    STRUCTURE_MISSING_Q: 'Devolve JSON completo com "q" (pergunta inteira terminada em ?), "a" (resposta) e "distractors" (exactamente 3 opções erradas).',
    STRUCTURE_MISSING_A: 'Devolve JSON completo com "q" (pergunta inteira terminada em ?), "a" (resposta) e "distractors" (exactamente 3 opções erradas).',
    AGE_TOO_HARD: 'Reduz a dificuldade e utiliza vocabulário adequado à faixa etária.',
    AGE_TOO_EASY: 'Aumenta a exigência com factos menos óbvios mas verificáveis.',
    PT_BRASILISM: 'Revisa português de Portugal: vocabulário, ortografia e nomes de países.',
    PT_ENGLISH_ONLY: 'Revisa português de Portugal: vocabulário, ortografia e nomes de países.',
    ANSWER_AMBIGUOUS: 'Evita respostas ambíguas. Gera uma pergunta com apenas uma resposta inequívoca.',
    ANSWER_LEAKED: 'A resposta não pode aparecer nem ser deduzível directamente da pergunta.',
    FACT_AI_REJECT: 'Confirma o facto antes de responder — evita inventar ou confundir conceitos.',
    CATEGORY_MISMATCH: 'Mantém a pergunta estritamente dentro da categoria indicada.',
    MULTIPLE_ANSWERS: 'Evita respostas ambíguas. Gera uma pergunta com apenas uma resposta inequívoca.',
  });

  /** Fallback regex → hint (issues sem code ou UNSPECIFIED). */
  const RETRY_HINT_RULES = [
    { re: /ambígu|múltiplas respostas|várias respostas/i, hint: RETRY_HINT_BY_CODE.ANSWER_AMBIGUOUS },
    { re: /opções repetidas|quase iguais|semelhantes/i, hint: RETRY_HINT_BY_CODE.MC_NEAR_DUPLICATE },
    { re: /demasiado difícil|tema avançado|vocabulário técnico/i, hint: RETRY_HINT_BY_CODE.AGE_TOO_HARD },
    { re: /demasiado fácil|senso comum/i, hint: RETRY_HINT_BY_CODE.AGE_TOO_EASY },
    { re: /repetid|semelhante|knowledgeKey|conhecimento/i, hint: RETRY_HINT_BY_CODE.KNOWLEDGE_REPEATED },
    { re: /distratores|incoerentes|classes conceptuais|mesmo tipo|filmes|anos|países|marcas/i, hint: RETRY_HINT_BY_CODE.MC_WRONG_CLASS },
    { re: /revelada na pergunta/i, hint: RETRY_HINT_BY_CODE.ANSWER_LEAKED },
    { re: /português|brasileir|inglês|PT-PT|futebol|goleiro|guarda-redes/i, hint: RETRY_HINT_BY_CODE.PT_BRASILISM },
    { re: /categoria|tema|Geografia|Espaço/i, hint: RETRY_HINT_BY_CODE.CATEGORY_MISMATCH },
    { re: /factual|facto incorreto|errada/i, hint: 'Confirma o facto antes de responder — evita inventar ou confundir conceitos.' },
    { re: /confus|circular|formulação estranha/i, hint: 'Reformula a pergunta de forma clara e directa, sem repetir a resposta nem usar construções ambíguas.' },
    { re: /asfalto|alcatrão|ambígu/i, hint: 'Evita perguntas com várias respostas igualmente correctas — escolhe um facto inequívoco.' },
    { re: /campo "q"|pergunta incompleta|falta.*\bq\b|json incompleto/i, hint: RETRY_HINT_BY_CODE.STRUCTURE_INCOMPLETE },
  ];

  function mkIssue(code, layer, message) {
    return Object.freeze({ code: code || 'UNSPECIFIED', layer: layer || ISSUE_LAYER.unknown, message: String(message || '') });
  }

  function issueMessage(issue) {
    if (issue == null) return '';
    if (typeof issue === 'string') return issue;
    return issue.message || String(issue.code || '');
  }

  function issueCode(issue) {
    if (issue && typeof issue === 'object' && issue.code) return issue.code;
    return null;
  }

  function issueLayer(issue) {
    if (issue && typeof issue === 'object' && issue.layer) return issue.layer;
    return ISSUE_LAYER.unknown;
  }

  function normalizeIssues(issues) {
    return (issues || []).map((item) => {
      if (item && typeof item === 'object' && item.message != null) return item;
      return mkIssue('UNSPECIFIED', ISSUE_LAYER.unknown, issueMessage(item));
    });
  }

  function issueMessages(issues) {
    return normalizeIssues(issues).map(issueMessage);
  }

  function buildRetryHintFromIssues(issues, formatId, ageBandKey, deps) {
    const { FORMAT_LABELS, getAgeLimits } = deps;
    const details = normalizeIssues(issues);
    const hints = new Set();
    for (const iss of details) {
      const hint = RETRY_HINT_BY_CODE[iss.code];
      if (hint) hints.add(hint);
    }
    const blob = details.map(issueMessage).join(' ');
    for (const rule of RETRY_HINT_RULES) {
      if (rule.re.test(blob)) hints.add(rule.hint);
    }
    const messages = details.map(issueMessage);
    if (!hints.size && messages.length) hints.add(`Corrige: ${messages.slice(0, 3).join('; ')}.`);
    const lim = getAgeLimits(ageBandKey);
    const formatLabel = FORMAT_LABELS[formatId] || formatId;
    return `ERRO NA VALIDAÇÃO: ${messages.slice(0, 4).join('; ')}.\n${[...hints].join('\n')}\nMantém o formato "${formatLabel}" (${formatId})${lim.retryHintSuffix || ''}.`;
  }

  global.QuestionEngineIssues = Object.freeze({
    ISSUE_LAYER,
    RETRY_HINT_BY_CODE,
    mkIssue,
    issueMessage,
    issueCode,
    issueLayer,
    normalizeIssues,
    issueMessages,
    buildRetryHintFromIssues,
  });
})(typeof window !== 'undefined' ? window : globalThis);
