/**
 * Validadores de formato — QUEM_E, COMPLETA, ADIVINHA, etc. (Fase 7c).
 */
(function (global) {
  'use strict';

  const Issues = global.QuestionEngineIssues;
  const Config = global.QuestionEngineConfig;
  const AdivinhaVerify = global.QuestionEngineAdivinhaVerify;
  if (!Issues || !Config || !AdivinhaVerify) {
    throw new Error('format-validators: carrega issue-codes.js, engine-config.js e adivinha-verify.js antes deste módulo');
  }
  const { mkIssue, ISSUE_LAYER } = Issues;
  const { FORMAT_IDS, getAgeLimits, isHardHistoricalWhenQuestion } = Config;
  const { parseAdivinhaClues: parseAdivinhaCluesFromVerify } = AdivinhaVerify;

  function pushIssue(issues, code, layer, message) {
    issues.push(mkIssue(code, layer, message));
  }

  function pushFormatViolation(issues, message) {
    pushIssue(issues, 'FORMAT_VIOLATION', ISSUE_LAYER.format, message);
  }

  function pushAgeHardIssue(issues, message) {
    pushIssue(issues, 'AGE_TOO_HARD', ISSUE_LAYER.age, message);
  }

function isObviouslyNotAPerson(answer) {
  const a = String(answer || '').trim().toLowerCase();
  if (!a) return true;
  if (/^(verdadeiro|falso|água|agua|fogo|terra|ar|sol|lua|lisboa|portugal|espanha|frança|franca|democracia|capitalismo|fotossíntese|fotossintese)$/.test(a)) return true;
  if (/^\d+$/.test(a)) return true;
  return /\b(processo|fenómeno|fenomeno|teoria|sistema|planeta|país|pais|cidade|rio|montanha|oceano)\b/i.test(a);
}

function looksLikeWhenQuestion(q, a) {
  const anti = /\bem\s+que\s+pa[ií]s\b|\bonde\s+fica\b|\bquem\s+(é|e|foi|inventou|escreveu|pintou|comp[oô]s)\b|\bqual\s+destes\s+(pa[ií]s|paises|países)\b|\bo\s+que\s+é\b/i;
  if (anti.test(q)) return false;
  const timeQ = /\b(quando\b|em\s+que\s+(ano|anos|m[eê]s|mes|dia|data|[eé]poca|epoca|per[ií]odo|periodo|s[eé]culo|seculo|d[eé]cada|decada)|que\s+(ano|m[eê]s|mes|d[eé]cada|decada|s[eé]culo|seculo)\b|a\s+que\s+(ano|[eé]poca|epoca)|em\s+qual\s+(ano|m[eê]s|mes|s[eé]culo|seculo))\b/i;
  if (timeQ.test(q)) return true;
  const at = String(a || '').trim();
  if (/^\d{3,4}$/.test(at)) return true;
  if (/^(s[eé]culo|seculo)\s+/i.test(at)) return true;
  if (/^(janeiro|fevereiro|mar[cç]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)$/i.test(at)) return true;
  return /^\d{1,2}\s+de\s+\w+/i.test(at);
}

function stripFormatLabel(q) {
  return String(q || '').replace(/^(curiosidade|adivinha|completa|quem é|o que é):\s*/i, '').trim();
}

function validateCuriosidade(q) {
  const issues = [];
  const body = stripFormatLabel(q);
  const surpriseFrame = /\b(sabias que|sabias|é verdade que|curiosamente|surpreendentemente|incrível|poucas pessoas sabem)\b/i.test(body)
    || /verdadeiro\s+ou\s+falso/i.test(body);

  if (/^em que ano\b|^qual é o ano\b|^em que ano foram\b|^quando foram realizados\b/i.test(body) && !surpriseFrame) {
    pushFormatViolation(issues, 'CURIOSIDADE não deve ser pergunta simples de ano/data');
  }
  if (/^em que (país|cidade|continente)\b/i.test(body) && !surpriseFrame) {
    pushFormatViolation(issues, 'CURIOSIDADE não deve ser pergunta geográfica banal');
  }
  if (body.length > 200) pushFormatViolation(issues, 'CURIOSIDADE demasiado longa para ler em voz alta');
  return issues;
}

function validateCuriosidadeTrueFalse(parsed, helpers) {
  const issues = [];
  const { stripTags, validateTrueFalseQuestion } = helpers || {};
  const a = stripTags(parsed?.a || '').trim().toLowerCase();
  if (a !== 'verdadeiro' && a !== 'falso') {
    pushFormatViolation(issues, 'CURIOSIDADE: resposta tem de ser Verdadeiro ou Falso');
  }
  const vf = validateTrueFalseQuestion?.(parsed);
  if (vf && !vf.ok) issues.push(...vf.issues.map((msg) => mkIssue('FORMAT_VIOLATION', ISSUE_LAYER.format, msg)));

  const opts = Array.isArray(parsed?.options) ? parsed.options : [];
  if (opts.length !== 2) {
    pushFormatViolation(issues, 'CURIOSIDADE: exactamente 2 opções — Verdadeiro e Falso');
  }
  const forbidden = /\b(não sei|nao sei|às vezes|as vezes|talvez|depende|não tenho a certeza)\b/i;
  for (const opt of opts) {
    const text = stripTags(opt).trim();
    if (forbidden.test(text)) {
      pushFormatViolation(issues, 'CURIOSIDADE: opções inválidas — só Verdadeiro e Falso');
      break;
    }
  }
  const normOpts = opts.map((o) => stripTags(o).toLowerCase());
  if (normOpts.length === 2 && (normOpts[0] !== 'verdadeiro' || normOpts[1] !== 'falso')) {
    const hasV = normOpts.includes('verdadeiro');
    const hasF = normOpts.includes('falso');
    if (!hasV || !hasF || new Set(normOpts).size !== 2) {
      pushFormatViolation(issues, 'CURIOSIDADE: opções têm de ser Verdadeiro e Falso');
    }
  }
  return issues;
}

function validateCompletaOral(q, ageBandKey) {
  const issues = [];
  const blank = q.match(/_{2,}|…|\.{3}/);
  if (!blank) return issues;

  const limits = {
    '6-9': { total: 105, before: 12 },
    '10-15': { total: 125, before: 14 },
    '15+': { total: 145, before: 16 },
  };
  const lim = limits[ageBandKey] || limits['15+'];

  const afterBlank = q.slice(blank.index + blank[0].length).trim();
  if (afterBlank && !/^[.?!…]+$/.test(afterBlank)) {
    pushFormatViolation(issues, 'COMPLETA: a lacuna deve ficar no final da frase (sem texto depois)');
  }

  const body = q.replace(/^completa:\s*/i, '').trim();
  if (!/_{2,}\s*[.?!…]?\s*$|…\s*[.?!…]?\s*$|\.{3}\s*[.?!…]?\s*$/i.test(body)) {
    pushFormatViolation(issues, 'COMPLETA: a lacuna tem de ser a última parte da frase');
  }

  const before = q.slice(0, blank.index).replace(/^completa:\s*/i, '').trim();
  const beforeWords = before.split(/\s+/).filter(Boolean).length;
  if (q.length > lim.total) pushFormatViolation(issues, 'COMPLETA demasiado longa para ler em voz alta');
  if (beforeWords > lim.before) pushFormatViolation(issues, 'COMPLETA: demasiado texto antes da lacuna');

  return issues;
}

function validateSituationPractical(q) {
  const issues = [];
  const motion = /\b(avião|aviao|comboio|autocarro|carro|elevador|barco)\b.*\b(a voar|voar|and|corre|move)\b/i.test(q)
    || /\b(largas?|deixas?\s+cair|soltas?)\b.*\b(moeda|bola|objecto|objeto)\b/i.test(q);
  const vagueWhere = /\bpara onde\b.*\b(cai|cair|vai|ir)\b/i.test(q);
  const hasFrame = /\bem relação\b|\brelativamente\b|\bcontigo\b|\ba bordo\b|\bdentro do\b|\bvisto de dentro\b|\bpara ti\b/i.test(q);
  if (motion && vagueWhere && !hasFrame) {
    pushFormatViolation(issues, 'situação prática ambígua — especifica o referencial (ex.: "em relação a ti")');
  }
  return issues;
}

function validateOndeFica(q, options, stripTags) {
  const issues = [];
  const ql = q.toLowerCase();
  const specific = /\b(em\s+que\s+(país|pais|cidade|continente|região|regiao|estado|província|provincia)|qual\s+é\s+a\s+capital|capital\s+de|nasce|nascer|desagua|desaguar|desemboca|localiza-se|situad[oa])\b/i.test(q);
  const vague = /\bonde\s+(fica|está|esta|se\s+encontra)\b/i.test(ql);
  const multiPlaceFeature = /\b(rio|rios|montanha|montanhas|cordilheira|deserto|selva|floresta|planície|planicie|vale|arquipélago|arquipelago)\b/i.test(q);
  const cleanOpts = (options || []).map((o) => stripTags(o).trim()).filter(Boolean);
  const countryOptionPattern = /\b(portugal|espanha|frança|franca|itália|italia|alemanha|brasil|angola|moçambique|mozambique|china|japão|japao|índia|india|europa|áfrica|africa|ásia|asia|américa|america)\b/i;
  const countryishOptions = cleanOpts.length >= 3
    && cleanOpts.filter((o) => countryOptionPattern.test(o)).length >= 2;

  if (multiPlaceFeature && vague && !specific) {
    pushFormatViolation(issues, 'ONDE_FICA ambíguo — especifica país de origem, desagua, capital ou continente');
  }
  if (countryishOptions && vague && multiPlaceFeature && !specific) {
    pushFormatViolation(issues, 'ONDE_FICA com países/continentes exige localização inequívoca');
  }
  return issues;
}

function validateAdivinhaQuality(q, a) {
  const issues = [];
  if (/\bquem\s+é\s+o\s+(animal|bicho|pássaro|passaro|peixe|insecto|inseto)\b/i.test(q)) {
    pushIssue(issues, 'ADIVINHA_ANIMAL_PHRASING', ISSUE_LAYER.format, 'ADIVINHA: usa "Que animal…" em vez de "Quem é o animal"');
  }
  if (/\b(canta|som)\b.*\b(batid|bate)\b|\b(batid|bate).*\b(canta|som)\b/i.test(q)) {
    if (!/\b(tambor|caixa|pandeiro|instrumento|musical)\b/i.test(a)) {
      pushIssue(issues, 'ADIVINHA_PERCUSSION', ISSUE_LAYER.format, 'ADIVINHA: objecto que "canta quando é batido" deve ser instrumento de percussão');
    }
  }
  if (/\bpernas\b.*\bnão\s+anda\b/i.test(q) && /\b(bola|cadeira|mesa)\b/i.test(a)) {
    pushIssue(issues, 'ADIVINHA_WEAK_RIDDLE', ISSUE_LAYER.format, 'ADIVINHA: adivinha fraca — a resposta não encaixa bem nas pistas');
  }
  if (/\b(faz|fazem)\s+barulho\b/i.test(q) && /\bcorre\b/i.test(q) && /\b(cala|calou)\b/i.test(q)) {
    if (/\b(cavalo|cabra|vaca|ovelha|carneiro|porco|rato)\b/i.test(a) && !/\b(apito|pião|piao|flauta|corneta|reco-reco)\b/i.test(a)) {
      pushIssue(issues, 'ADIVINHA_WHISTLE_RIDDLE', ISSUE_LAYER.format, 'ADIVINHA: adivinha clássica do apito — a resposta não deve ser um animal');
    }
  }
  return issues;
}

function validateAdivinhaClues(parsed, stripTags) {
  const issues = [];
  const clues = parseAdivinhaCluesFromVerify(parsed);
  const answer = stripTags(parsed?.a || '').trim().toLowerCase();
  if (clues.length < 2) {
    pushIssue(issues, 'ADIVINHA_MISSING_CLUES', ISSUE_LAYER.format, 'ADIVINHA deve incluir array "clues" com pelo menos 2 pistas curtas');
    return issues;
  }
  const seen = new Set();
  for (const clue of clues) {
    const c = stripTags(clue).trim();
    const norm = c.toLowerCase();
    if (!norm) continue;
    if (seen.has(norm)) {
      pushFormatViolation(issues, 'ADIVINHA: pistas duplicadas no array clues');
      continue;
    }
    seen.add(norm);
    if (norm === answer || (answer.length >= 3 && norm.includes(answer))) {
      pushIssue(issues, 'ADIVINHA_CLUE_LEAKS_ANSWER', ISSUE_LAYER.format, 'ADIVINHA: uma pista revela ou repete a resposta');
    }
  }
  return issues;
}

function validateByFormat(parsed, formatId, helpers) {
  const { stripTags, validateTrueFalseQuestion, ageBandKey } = helpers;
  const q = stripTags(parsed?.q || '').trim();
  const a = stripTags(parsed?.a || '').trim();
  const issues = [];

  if (formatId === FORMAT_IDS.VERDADEIRO_FALSO) {
    const vf = validateTrueFalseQuestion(parsed);
    return vf.ok ? { ok: true, issues: [] } : vf;
  }

  if (formatId === FORMAT_IDS.CURIOSIDADE) {
    issues.push(...validateCuriosidade(q));
    issues.push(...validateCuriosidadeTrueFalse(parsed, helpers));
  }

  if (formatId === FORMAT_IDS.QUEM_E) {
    if (!/^quem\b/i.test(q) && !/qual\s+(é|e)\s+o\s+nome\b/i.test(q)) {
      pushFormatViolation(issues, 'QUEM_E deve começar por "Quem"');
    }
    if (/quem\s+(é|e)\s+quem\b/i.test(q)) pushFormatViolation(issues, 'QUEM_E: evita "Quem é quem"');
    if (/^o\s+que\s+(é|e)\b/i.test(q)) pushFormatViolation(issues, 'QUEM_E não deve usar "O que é"');
    if (isObviouslyNotAPerson(a)) pushFormatViolation(issues, 'QUEM_E: resposta deve ser uma pessoa');
    if (/\b(a|uma)\s+(engenheira|actriz|atriz|inventora|escritora|diretora|realizadora)\b/i.test(q)
      && /\b(dario|martin|james|john|robert|leonardo|quentin|stanley|heath|elon|ray|hiroshi)\b/i.test(a.toLowerCase())) {
      pushFormatViolation(issues, 'inconsistência de género — a pergunta pede uma mulher mas a resposta é um nome masculino');
    }
  }

  if (formatId === FORMAT_IDS.O_QUE_E) {
    if (!/^o\s+que\b|^que\s+significa\b|^qual\s+é\s+o\s+(termo|significado|nome do)\b/i.test(q)) {
      pushFormatViolation(issues, 'O_QUE_E deve perguntar por conceito/termo/fenómeno');
    }
    if (/^quem\b/i.test(q)) pushFormatViolation(issues, 'O_QUE_E não deve perguntar por pessoa');
  }

  if (formatId === FORMAT_IDS.COMPLETA) {
    if (!/_{2,}|…|\.{3}|completa|falta/i.test(q)) {
      pushFormatViolation(issues, 'COMPLETA deve ter lacuna visível');
    } else {
      issues.push(...validateCompletaOral(q, ageBandKey || '15+'));
    }
  }

  if (formatId === FORMAT_IDS.ONDE_FICA) {
    if (!/\bonde\b|\bem\s+que\s+(país|cidade|continente|região|regiao)\b/i.test(q)) {
      pushFormatViolation(issues, 'ONDE_FICA deve perguntar por localização');
    }
    issues.push(...validateOndeFica(q, parsed?.options, stripTags));
  }

  if (formatId === FORMAT_IDS.QUANDO && !looksLikeWhenQuestion(q, a)) {
    pushFormatViolation(issues, 'QUANDO deve pedir tempo/data/período');
  }
  if (formatId === FORMAT_IDS.QUANDO && getAgeLimits(ageBandKey).rejectHardHistoricalWhen
    && isHardHistoricalWhenQuestion(q)) {
    pushAgeHardIssue(issues, 'data histórica demasiado difícil para 6–9');
  }

  if (formatId === FORMAT_IDS.ADIVINHA && /^qual\s+é\s+a\s+capital\b|^quem\s+descobriu\b/i.test(q)) {
    pushIssue(issues, 'ADIVINHA_FACTUAL_DIRECT', ISSUE_LAYER.format, 'ADIVINHA não deve ser pergunta factual directa');
  }
  if (formatId === FORMAT_IDS.ADIVINHA) {
    issues.push(...validateAdivinhaQuality(q, a));
    issues.push(...validateAdivinhaClues(parsed, stripTags));
  }

  if (formatId === FORMAT_IDS.CAUSA_CONSEQUENCIA) {
    const maxQ = getAgeLimits(ageBandKey).maxCausaConsequenciaChars;
    if (q.length > maxQ) pushFormatViolation(issues, 'pergunta CAUSA_CONSEQUENCIA demasiado longa para ler em voz alta');
  }

  if (formatId === FORMAT_IDS.SITUACAO_PRATICA) {
    issues.push(...validateSituationPractical(q));
  }

  if ((formatId === FORMAT_IDS.RESPOSTA_DIRETA || formatId === FORMAT_IDS.ESCOLHA_MULTIPLA)) {
    if (q.includes('→') || q.includes('->')) pushFormatViolation(issues, 'sem setas de associação');
    if (/qual\s+destes.*\bnão\b/i.test(q)) pushFormatViolation(issues, 'evitar "qual não é"');
  }

  if (/\bqual\s+destas\s+afirmações\s+não\s+é\s+incorreta\b/i.test(q)) {
    pushFormatViolation(issues, 'negação múltipla');
  }

  return { ok: !issues.length, issues };
}
  global.QuestionEngineFormatValidators = Object.freeze({
    stripFormatLabel,
    isObviouslyNotAPerson,
    looksLikeWhenQuestion,
    validateCuriosidade,
    validateCompletaOral,
    validateSituationPractical,
    validateOndeFica,
    validateAdivinhaQuality,
    validateAdivinhaClues,
    validateByFormat,
  });
})(typeof window !== 'undefined' ? window : globalThis);
