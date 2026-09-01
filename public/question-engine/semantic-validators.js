/**
 * Validadores semânticos — leak, estereótipos, adivinha MC (Fase 7f).
 */
(function (global) {
  'use strict';

  const Issues = global.QuestionEngineIssues;
  const Config = global.QuestionEngineConfig;
  if (!Issues || !Config) {
    throw new Error('semantic-validators: carrega issue-codes.js e engine-config.js antes deste módulo');
  }
  const { mkIssue, ISSUE_LAYER } = Issues;
  const { FORMAT_IDS, isGenericTrueFalseAnswer } = Config;

  function pushIssue(issues, code, layer, message) {
    issues.push(mkIssue(code, layer, message));
  }

  function stripTrueFalsePromptSuffix(q) {
    return String(q || '')
      .replace(/\s*\.?\s*verdadeiro\s+ou\s+falso\s*\??\s*$/i, '')
      .trim();
  }

  function tokenize(text) {
    return String(text || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9àáâãäåèéêëìíîïòóôõöùúûüçñ\s-]/gi, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2);
  }

function answerLeakedInQuestion(q, a) {
  const al = String(a || '').trim().toLowerCase();
  if (!al || al.length < 3) return false;
  if (isGenericTrueFalseAnswer(a)) return false;

  const ql = stripTrueFalsePromptSuffix(q).trim().toLowerCase();
  if (!ql) return false;
  if (ql.includes(al)) return true;
  const aWords = tokenize(a).filter((w) => w.length >= 4);
  if (aWords.length >= 2 && ql.includes(aWords.join(' '))) return true;
  const hits = aWords.filter((w) => ql.includes(w));
  return aWords.length >= 2 && hits.length >= Math.ceil(aWords.length * 0.7);
}

function hasCulturalStereotype(q) {
  return /\b(os|as)\s+(portugueses|portuguesas|japoneses|japonesas|chineses|chinesas|franceses|francesas|alemães|alemãs|alemoes|alemas|italianos|italianas|brasileiros|brasileiras|ingleses|britânicos|britânicas|árabes|africanos|africanas|americanos|americanas|homens|mulheres|crianças|miúdos|miúdas|rapazes|raparigas)\s+são\b/i.test(q)
    || /\btodos\s+os\s+(portugueses|japoneses|franceses|alemães|homens|mulheres|crianças|miúdos)\s+(gostam|são|fazem)\b/i.test(q);
}



function validateAdivinhaMcAmbiguity(q, a, options, stripTags, formatId) {
  const issues = [];
  if (formatId !== FORMAT_IDS.ADIVINHA) return issues;
  const clean = (options || []).map((o) => stripTags(o).trim()).filter(Boolean);
  if (clean.length < 2) return issues;

  const mapGlobeRiddle = /\bcidades\b/i.test(q) && /\bn[aã]o\s+casas\b/i.test(q)
    && /\bmontanhas\b/i.test(q) && /\bn[aã]o\s+(árvores|arvores)\b/i.test(q)
    && /\b(água|agua)\b/i.test(q) && /\bn[aã]o\s+peixes\b/i.test(q);
  const hasMapa = clean.some((o) => /\bmapa\b/i.test(o));
  const hasGlobo = clean.some((o) => /\bglobo\b/i.test(o));
  if (mapGlobeRiddle && hasMapa && hasGlobo) {
    pushIssue(issues, 'ADIVINHA_MAP_GLOBE_AMBIGUOUS', ISSUE_LAYER.semantic, 'pergunta ambígua — mapa e globo terráqueo respondem às mesmas pistas; reformula ou usa distractores claramente errados');
  }

  const geoRepRiddle = /\b(tenho|tem)\b/i.test(q) && /\b(cidades|montanhas)\b/i.test(q)
    && /\bn[aã]o\s+(casas|árvores|arvores|peixes)\b/i.test(q);
  if (geoRepRiddle && hasMapa && hasGlobo && !mapGlobeRiddle) {
    pushIssue(issues, 'ADIVINHA_MAP_GLOBE_AMBIGUOUS', ISSUE_LAYER.semantic, 'pergunta ambígua — mapa e globo terráqueo são ambas defensáveis nesta adivinha');
  }

  return issues;
}

function collectSemanticIssues(parsed, ctx) {
  const {
    ageBandKey, stripTags, normalizeFn, formatId, isMC,
  } = ctx;
  const q = stripTags(parsed?.q || '').trim();
  const a = stripTags(parsed?.a || '').trim();
  const options = Array.isArray(parsed?.options) ? parsed.options : [];
  const issues = typeof ctx.runReportedFactRules === 'function' ? ctx.runReportedFactRules(q, a, options, formatId) : [];
  if (typeof ctx.validateObscureCharacter === 'function') issues.push(...ctx.validateObscureCharacter(q, a, ageBandKey));

  if (formatId !== FORMAT_IDS.VERDADEIRO_FALSO && !isGenericTrueFalseAnswer(a, normalizeFn)) {
    if (answerLeakedInQuestion(q, a)) {
      pushIssue(issues, 'ANSWER_LEAKED', ISSUE_LAYER.semantic, 'resposta revelada na pergunta');
    }
  }
  if (hasCulturalStereotype(q)) {
    pushIssue(issues, 'PT_STEREOTYPE', ISSUE_LAYER.semantic, 'estereótipo cultural');
  }
  if (/\b(pode ser|podem ser|várias respostas|duas respostas|tanto .+ como)\b/i.test(`${q} ${a}`)) {
    pushIssue(issues, 'MULTIPLE_ANSWERS', ISSUE_LAYER.semantic, 'possíveis múltiplas respostas');
  }
  return issues;
}
  global.QuestionEngineSemanticValidators = Object.freeze({
    hasCulturalStereotype,
    validateAdivinhaMcAmbiguity,
    answerLeakedInQuestion,
    collectSemanticIssues,
  });
})(typeof window !== 'undefined' ? window : globalThis);
