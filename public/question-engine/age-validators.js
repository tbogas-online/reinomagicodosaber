/**
 * Validadores de idade — adequação por faixa etária (Fase 7e).
 */
(function (global) {
  'use strict';

  const Issues = global.QuestionEngineIssues;
  const Config = global.QuestionEngineConfig;
  const PtPt = global.QuestionEnginePtPt;
  const McValidators = global.QuestionEngineMcValidators;
  if (!Issues || !Config || !PtPt || !McValidators) {
    throw new Error('age-validators: carrega issue-codes.js, engine-config.js, pt-pt-validators.js e mc-validators.js antes deste módulo');
  }
  const { mkIssue, ISSUE_LAYER } = Issues;
  const { FORMAT_IDS, getAgeLimits, isHardHistoricalWhenQuestion, isRelaxedAdivinhaAge } = Config;
  const { validatePortugueseNotEnglish } = PtPt;
  const { validateMcOptionsQuality, collapseOptionKey } = McValidators;

  function pushIssue(issues, code, layer, message) {
    issues.push(mkIssue(code, layer, message));
  }

  function pushAgeHardIssue(issues, message) {
    pushIssue(issues, 'AGE_TOO_HARD', ISSUE_LAYER.age, message);
  }

  function pushFormatViolation(issues, message) {
    pushIssue(issues, 'FORMAT_VIOLATION', ISSUE_LAYER.format, message);
  }

function validateAgeTopicFit(q, a, options, ageBandKey) {
  const issues = [];
  const blob = [q, a, ...(options || [])].join(' ');
  const lim = getAgeLimits(ageBandKey);
  if (lim.maxQuestionWordsTopic != null) {
    const adultTopics = /\b(tratado|imperialismo|dodecafonismo|mitocôndria|algoritmo|quântico|burocracia|constituição|epistemologia|hegel|nietzsche|versalhes|holocausto|genocídio)\b/i;
    if (adultTopics.test(blob)) pushAgeHardIssue(issues, 'tema inadequado para 6–9');
    if (/\b(apesar de|embora|contudo|por conseguinte|outrossim|consequentemente)\b/i.test(q)) {
      pushAgeHardIssue(issues, 'linguagem demasiado complexa para 6–9');
    }
    const qWords = q.split(/\s+/).filter(Boolean).length;
    if (qWords > lim.maxQuestionWordsTopic && !/completa/i.test(q)) {
      pushAgeHardIssue(issues, 'pergunta demasiado complexa para 6–9');
    }
  }
  if (lim.maxAnswerWordsTopic != null) {
    const gradTopics = /\b(epistemologia|fenomenologia|dialética materialista|dodecafonismo|hegeliano|nietzscheano)\b/i;
    if (gradTopics.test(blob)) pushAgeHardIssue(issues, 'tema inadequado para 10–15');
    const qWords = q.split(/\s+/).filter(Boolean).length;
    if (lim.maxQuestionWords != null && qWords > lim.maxQuestionWords) {
      pushAgeHardIssue(issues, 'pergunta demasiado complexa para 10–15');
    }
    const answerWords = a.split(/\s+/).filter(Boolean).length;
    if (answerWords > lim.maxAnswerWordsTopic) pushAgeHardIssue(issues, 'resposta demasiado longa para 10–15');
  }
  return issues;
}

function validateObscureCharacter(q, a, ageBandKey) {
  const issues = [];
  if (ageBandKey !== '6-9') return issues;
  if (/\b(cinderela|cinderella)\b/i.test(q) && /\b(rato|ratos)\b/i.test(q)) {
    if (/\b(jaquim|jaq|gus|névoa|nevoa)\b/i.test(a)) {
      pushAgeHardIssue(issues, 'personagem secundário obscuro para 6–9 — usa personagens principais');
    }
  }
  return issues;
}

function validateYoungAgeContent(q, a, options, formatId) {
  const issues = [];
  const blob = [q, a, ...(options || [])].join(' ');
  const obscurePeople = /\b(cristofori|bartolomeo|johann|sebastian|wolfgang|amadeus|ludwig|beethoven|bach|mozart|chopin|verdi|puccini|galileu|copérnico|copernico|arquimedes|pitágoras|pitagoras|darwin|pasteur|faraday)\b/i;
  if (obscurePeople.test(blob)) {
    pushAgeHardIssue(issues, 'personagem ou tema demasiado avançado para 6–9');
  }
  if (/quem\s+(é|e)\s+quem\b/i.test(q)) {
    pushFormatViolation(issues, 'formulação incorrecta — evita "Quem é quem"');
  }
  if (formatId === FORMAT_IDS.QUEM_E && /\b(inventou|criou|descobriu)\s+o\s+(piano|violino|gramofone|telefone)\b/i.test(q)) {
    pushAgeHardIssue(issues, 'inventor de instrumento demasiado avançado para 6–9');
  }
  if (/\bvan\s+gogh\b/i.test(blob) && /\bem\s+que\s+ano\b/i.test(q)) {
    pushAgeHardIssue(issues, 'data de obra pictórica demasiado avançada para 6–9');
  }
  if (/\bvan\s+gogh\b/i.test(blob) && /\bnoite\s+estrelada\b/i.test(blob)) {
    pushAgeHardIssue(issues, 'obra de arte histórica demasiado avançada para 6–9');
  }
  if (formatId === FORMAT_IDS.QUEM_E && /\b(escreveu|escreve|autor|autora)\b/i.test(q)) {
    pushAgeHardIssue(issues, 'para 6–9 prefere personagem, não autor (ex.: "Quem é o menino de Harry Potter?")');
  }
  if (formatId === FORMAT_IDS.QUEM_E && (/^[A-Z]\.[A-Z]\./.test(a.trim()) || /\b[A-Z]\.[A-Z]\.\s/.test(a))) {
    pushAgeHardIssue(issues, 'nome com iniciais difícil para 6–9 (ex.: evita "J.K. Rowling")');
  }
  if (formatId === FORMAT_IDS.QUEM_E) {
    const answerWords = a.split(/\s+/).filter(Boolean);
    if (answerWords.length >= 3) {
      pushAgeHardIssue(issues, 'nome de pessoa demasiado longo para 6–9 (máx. 2 palavras)');
    }
  }
  if (formatId === FORMAT_IDS.QUANDO && /\b(playstation|ps\s*one|ps1|xbox|mega\s*drive|super\s*nintendo|nintendo\s*64)\b/i.test(blob)) {
    pushAgeHardIssue(issues, 'data de lançamento de consola demasiado difícil para 6–9');
  }
  if (/\b(bob\s+marley|reggae)\b/i.test(blob)) {
    pushAgeHardIssue(issues, 'artista ou género musical demasiado avançado para 6–9');
  }
  if (formatId === FORMAT_IDS.O_QUE_E && q.length > 95) {
    pushFormatViolation(issues, 'pergunta O que é demasiado longa para 6–9');
  }
  if (options?.length) {
    const strip = (t) => String(t || '').replace(/<[^>]*>/g, '').trim();
    issues.push(...validateMcOptionsQuality(options, strip, collapseOptionKey, '6-9'));
  }
  return issues;
}

function validateAgeAppropriate(parsed, ageBandKey, stripTags, formatId) {
  const q = stripTags(parsed?.q || '').trim();
  const a = stripTags(parsed?.a || '').trim();
  const options = Array.isArray(parsed?.options) ? parsed.options : [];
  const issues = [];

  if (formatId === FORMAT_IDS.ADIVINHA && isRelaxedAdivinhaAge(ageBandKey)) {
    issues.push(...validatePortugueseNotEnglish([a, ...options], ageBandKey));
    return { ok: !issues.length, issues };
  }

  const blob = (q + ' ' + a + ' ' + options.join(' ')).toLowerCase();
  const lim = getAgeLimits(ageBandKey);
  const abstractMath = /(\d+\s*%|\bpercentagem\b|\bprobabilidade\b|\bfraç[ãõ]o\b|\bmédia\b)/i;
  const veryTechnical = /\b(mitocôndria|fotossíntese|condensação|eletromagnético|metamorfose celular)\b/i;
  const youngestTooHard = /\b(imperialismo|algoritmo|programador|programadora|engenheir|máquina analítica|maquina analitica|babbage|tratado de versalhes|segunda guerra mundial|primeira guerra mundial)\b/i;
  const isCompleta = formatId === FORMAT_IDS.COMPLETA || /_{2,}|…|\.{3}/.test(q);

  if (lim.maxQuestionChars != null && q.length > lim.maxQuestionChars) {
    pushAgeHardIssue(issues, 'pergunta demasiado longa');
  }
  if (lim.maxQuestionWords != null) {
    const qWordCount = q.split(/\s+/).filter(Boolean).length;
    if (qWordCount > lim.maxQuestionWords) pushAgeHardIssue(issues, 'pergunta demasiado longa');
  }
  if (lim.maxAnswerWords != null) {
    const maxAnswerWords = isCompleta && lim.maxCompletaAnswerWords
      ? lim.maxCompletaAnswerWords
      : lim.maxAnswerWords;
    if (a.split(/\s+/).filter(Boolean).length > maxAnswerWords) {
      pushAgeHardIssue(issues, isCompleta
        ? 'resposta COMPLETA demasiado longa para 6–9 (máx. 2 palavras)'
        : 'resposta demasiado longa');
    }
  }
  if (lim.rejectHardHistoricalWhen && formatId === FORMAT_IDS.QUANDO && isHardHistoricalWhenQuestion(q)) {
    pushAgeHardIssue(issues, 'data histórica demasiado difícil para 6–9');
  }
  if (lim.maxQuestionWordsTopic != null) {
    if (abstractMath.test(blob)) pushAgeHardIssue(issues, 'conceito matemático abstrato');
    if (veryTechnical.test(blob)) pushAgeHardIssue(issues, 'vocabulário técnico');
    if (youngestTooHard.test(blob)) pushAgeHardIssue(issues, 'tema avançado demais');
    issues.push(...validateYoungAgeContent(q, a, options, formatId));
    issues.push(...validateAgeTopicFit(q, a, options, ageBandKey));
    issues.push(...validatePortugueseNotEnglish([a, ...options], ageBandKey));
    if (lim.maxWordLength != null) {
      const longWords = q.split(/\s+/).filter((w) => w.replace(/[^a-zàáâãäåèéêëìíîïòóôõöùúûüçñ-]/gi, '').length > lim.maxWordLength);
      if (longWords.length) pushAgeHardIssue(issues, 'palavras demasiado complexas');
    }
  }
  if (lim.maxAnswerWordsTopic != null) {
    if (veryTechnical.test(a) && a.split(/\s+/).filter(Boolean).length > (lim.maxTechnicalAnswerWords || 8)) {
      pushAgeHardIssue(issues, 'resposta demasiado técnica');
    }
    issues.push(...validateAgeTopicFit(q, a, options, ageBandKey));
    issues.push(...validatePortugueseNotEnglish([a, ...options], ageBandKey));
    if (options.length) {
      issues.push(...validateMcOptionsQuality(options, stripTags, collapseOptionKey, ageBandKey));
    }
  }

  return { ok: !issues.length, issues };
}
  global.QuestionEngineAgeValidators = Object.freeze({
    validateAgeTopicFit,
    validateObscureCharacter,
    validateYoungAgeContent,
    validateAgeAppropriate,
  });
})(typeof window !== 'undefined' ? window : globalThis);
