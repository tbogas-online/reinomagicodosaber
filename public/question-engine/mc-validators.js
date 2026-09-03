/**
 * Validadores de escolha múltipla — distractores, duplicados, coerência (Fase 7d).
 */
(function (global) {
  'use strict';

  const Issues = global.QuestionEngineIssues;
  const Config = global.QuestionEngineConfig;
  const FormatValidators = global.QuestionEngineFormatValidators;
  if (!Issues || !Config || !FormatValidators) {
    throw new Error('mc-validators: carrega issue-codes.js, engine-config.js e format-validators.js antes deste módulo');
  }
  const { mkIssue, ISSUE_LAYER } = Issues;
  const { FORMAT_IDS, getAgeLimits } = Config;
  const { looksLikeWhenQuestion } = FormatValidators;

  function pushIssue(issues, code, layer, message) {
    issues.push(mkIssue(code, layer, message));
  }

  function pushMcWrongClass(issues, message) {
    pushIssue(issues, 'MC_WRONG_CLASS', ISSUE_LAYER.mcOptions, message);
  }

  function tokenizeMc(text) {
    return String(text || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9àáâãäåèéêëìíîïòóôõöùúûüçñ\s-]/gi, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2);
  }

function looksLikeProverbOption(text) {
  const t = String(text || '').trim();
  const words = t.split(/\s+/).filter(Boolean);
  return words.length > 12 || /\b(é melhor|quem espera|devagar se vai|água mole)\b/i.test(t);
}

function looksLikeFilmTitle(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (/^(o|a|os|as)\s+[«"']?[A-ZÀÁÂÃÉÊÍÓÔÕÚÇ]/i.test(t) && t.split(/\s+/).length >= 2) return true;
  if (/\b(matrix|origem|chihiro|trevas|driver|titanic|avatar|inception|vingadores|pantera|tarzan)\b/i.test(t)) return true;
  return false;
}

function looksLikePersonNameOption(text) {
  const t = String(text || '').trim();
  if (!t || looksLikeFilmTitle(t) || /^\d/.test(t)) return false;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length < 1 || words.length > 5) return false;
  const nameLike = words.filter((w) => /^[A-ZÀÁÂÃÉÊÍÓÔÕÚÇ][a-zàáâãçéêíóôõú'-]+$/.test(w)
    || /^(de|da|do|dos|das|van|von)$/i.test(w));
  return nameLike.length >= 1 && (words.length === 1 ? t.length <= 28 : nameLike.length >= 2);
}

function classifyMcOptionKind(text) {
  const t = String(text || '').trim();
  if (!t) return 'empty';
  if (/^(cerca de\s+)?\d{3,4}s?$/i.test(t)) return 'year';
  if (/^(portugal|espanha|frança|franca|alemanha|japão|japao|itália|italia|brasil|china|índia|india|catar|inglaterra|eua|estados unidos)$/i.test(t)) return 'country';
  if (/^(spacex|nasa|esa|agência espacial europeia|google|apple|meta|tesla|brt)$/i.test(t)) return 'brand';
  if (looksLikeProverbOption(t)) return 'proverb';
  if (looksLikeFilmTitle(t)) return 'film';
  if (/\b(arcadismo|barroco|romantismo|modernismo|pós-modernismo|simbolismo|surrealismo|realismo|impressionismo|expressionismo)\b/i.test(t)) return 'literary_movement';
  if (looksLikePersonNameOption(t)) return 'person';
  if (/^\d/.test(t) || /\b(milhões|mil milhões|cerca de)\b/i.test(t)) return 'quantity';
  if (/\b(nylon|algodão|algodao|lã|la|seda|poliéster|poliester|linho|couro|borracha|plástico|plastico|lycra|elastano|acrílico|acrilico)\b/i.test(t)) return 'material';
  if (/\b(moda ética|moda genderless|vogue|fast fashion)\b/i.test(t)) return 'fashion_concept';
  if (/\b(tratado|missão|canal|narrador|viés|sistema|efeito|fenómeno|fenomeno|rotação|unidade|elipse)\b/i.test(t)) return 'concept';
  return 'other';
}

function questionExpectsPersonOptions(q, formatId) {
  return formatId === FORMAT_IDS.QUEM_E
    || /\b(quem\s+(interpretou|realizou|dirigiu|escreveu|inventou|compôs|compôs|pintou)|qual\s+(ator|actriz|realizador|cineasta))\b/i.test(q);
}

function validateMcDistractorMixing(q, options, correctAnswer, stripTags, formatId) {
  const issues = [];
  const clean = (options || []).map((o) => stripTags(o).trim()).filter(Boolean);
  if (clean.length < 4) return issues;

  const correct = stripTags(correctAnswer).trim();
  const kinds = clean.map(classifyMcOptionKind);
  const correctKind = classifyMcOptionKind(correct);
  const asksPerson = questionExpectsPersonOptions(q, formatId);
  const isTimeQ = formatId === FORMAT_IDS.QUANDO || looksLikeWhenQuestion(q, correct);
  const isGeoQ = formatId === FORMAT_IDS.ONDE_FICA
    || /\b(em que país|em que continente|capital de|onde fica)\b/i.test(q);

  if (asksPerson || correctKind === 'person') {
    const badKinds = kinds.filter((k) => ['film', 'year', 'country', 'brand', 'proverb', 'literary_movement', 'fashion_concept'].includes(k));
    if (badKinds.length) {
      pushMcWrongClass(issues, 'opções incoerentes — com pessoa pedida, todas as opções devem ser nomes de pessoas (não filmes, anos, países nem provérbios)');
    }
  }

  if (/\bnarrador\b/i.test(q)) {
    const bad = kinds.filter((k) => ['literary_movement', 'film', 'year', 'country'].includes(k));
    if (bad.length) {
      pushMcWrongClass(issues, 'opções incoerentes — distractores devem ser tipos de narrador, não movimentos literários nem autores soltos');
    }
  }

  if (/\b(feminino|masculino)\s+de\s+r[eé]u\b/i.test(q) || /\br[eé]u\b/i.test(q) && /\bfeminino\b/i.test(q)) {
    const bad = kinds.filter((k) => ['literary_movement', 'film', 'year', 'country', 'brand'].includes(k));
    if (bad.length) {
      pushMcWrongClass(issues, 'opções incoerentes — distractores devem ser formas gramaticais (ré/ré), não movimentos literários nem outros temas');
    }
  }

  if (/\bneur[oó]nio|c[eé]rebro humano\b/i.test(q)) {
    const badOpts = clean.filter((o) => o.toLowerCase() !== correct.toLowerCase())
      .filter((o) => /\bilus[aã]o|óptica|optica|müller|mueller|esfinge|d[eé]j[aà]\s*vu|enigma|filosof/i.test(o));
    if (badOpts.length) {
      pushMcWrongClass(issues, 'opções incoerentes — distractores devem ser quantidades ou conceitos de neurociência, não filosofia ou ilusões de ótica');
    }
  }

  if (/\bmissão\b/i.test(q) && /\b(sonda|cometa|espacial|marte|lua)\b/i.test(q)) {
    const bad = kinds.filter((k) => ['country', 'brand', 'proverb', 'literary_movement', 'fashion_concept'].includes(k));
    if (bad.length) {
      pushMcWrongClass(issues, 'opções incoerentes — distractores devem ser missões ou programas espaciais');
    }
  }

  if (/\bunidade\s+astron[oó]mic/i.test(q) || (/\bunidade\b/i.test(q) && /\b(terra|sol|dist[aâ]ncia)\b/i.test(q))) {
    const bad = kinds.filter((k) => ['film', 'person', 'country', 'brand', 'proverb'].includes(k));
    if (bad.length) {
      pushMcWrongClass(issues, 'opções incoerentes — distractores devem ser unidades ou conceitos astronómicos');
    }
  }

  if (/\brota[çc][ãa]o\b/i.test(q) && /\b(v[eé]nus|planeta)\b/i.test(q)) {
    const badOpts = clean.filter((o) => o.toLowerCase() !== correct.toLowerCase())
      .filter((o) => !/\b(rota[çc][ãa]o|órbita|transla[çc][ãa]o|revolu[çc][ãa]o|movimento|eixo|dia|ano|lentid)\b/i.test(o));
    if (badOpts.length >= 2) {
      pushMcWrongClass(issues, 'opções incoerentes — distractores devem descrever movimentos ou rotações planetárias');
    }
  }

  if (!isTimeQ && kinds.includes('year') && correctKind !== 'year') {
    pushMcWrongClass(issues, 'opções incoerentes — anos isolados não servem de distractores fora de perguntas QUANDO');
  }

  if (!isGeoQ && !isTimeQ) {
    if (kinds.includes('country') && correctKind !== 'country') {
      pushMcWrongClass(issues, 'opções incoerentes — países isolados não encaixam nesta pergunta');
    }
    if (kinds.includes('brand') && correctKind !== 'brand' && !/\b(empresa|marca|spacex|nasa|esa)\b/i.test(q)) {
      pushMcWrongClass(issues, 'opções incoerentes — marcas ou empresas genéricas (ex.: SpaceX) não encaixam nesta pergunta');
    }
  }

  if (kinds.includes('proverb')) {
    pushMcWrongClass(issues, 'opções incoerentes — não uses provérbios ou frases longas como opção de escolha múltipla');
  }

  const foreignKinds = ['film', 'year', 'country', 'brand', 'proverb', 'literary_movement', 'fashion_concept'];
  const distinctForeign = new Set(kinds.filter((k) => foreignKinds.includes(k)));
  if (distinctForeign.size >= 2) {
    pushMcWrongClass(issues, 'opções parecem respostas de perguntas diferentes — todas devem ser do mesmo tipo');
  }

  if (/\b(material|tecido|fibr[ao]|sintétic|sintetic)\b/i.test(q)) {
    const wrong = clean.filter((o) => o.toLowerCase() !== correct.toLowerCase());
    if (wrong.some((o) => classifyMcOptionKind(o) === 'fashion_concept')) {
      pushMcWrongClass(issues, 'distratores devem ser materiais ou tecidos, não conceitos de moda');
    }
  }

  return issues;
}

function validateMcTrivialMath(q, options, correctAnswer, stripTags) {
  const issues = [];
  const question = stripTags(q).trim();
  const m = question.match(/\b(\d+)\s+dividido\s+por\s+(\d+)\b/i);
  if (!m) return issues;
  const dividend = Number(m[1]);
  const divisor = Number(m[2]);
  if (!dividend || !divisor || dividend % divisor !== 0) return issues;
  const correct = stripTags(correctAnswer).trim();
  const quotient = String(dividend / divisor);
  if (correct === String(divisor) || correct === m[2]) {
    pushIssue(issues, 'MC_TRIVIAL_MATH', ISSUE_LAYER.mcOptions, 'resposta matemática incorrecta ou demasiado óbvia — confirma o quociente da divisão');
    return issues;
  }
  const wrong = (options || []).map((o) => stripTags(o).trim()).filter((o) => o.toLowerCase() !== correct.toLowerCase());
  if (wrong.some((o) => o === m[1]) && wrong.some((o) => o === String(divisor))) {
    pushIssue(issues, 'MC_TRIVIAL_MATH', ISSUE_LAYER.mcOptions, 'opções de divisão demasiado óbvias — os distractores não devem incluir dividendo e divisor');
  }
  if (correct === quotient && wrong.every((o) => /^\d+$/.test(o))) {
    const nums = wrong.map(Number);
    if (nums.includes(dividend) || nums.includes(divisor)) {
      pushIssue(issues, 'MC_TRIVIAL_MATH', ISSUE_LAYER.mcOptions, 'opções de divisão demasiado óbvias — evita dividendo e divisor como distractores');
    }
  }
  return issues;
}

function detectSportSurfaceContext(q) {
  const t = String(q || '').toLowerCase();
  if (/\bgelo\b|\bpista de gelo\b|\bno gelo\b|\bpatins\b.*\bdisco\b|\bdisco\b.*\bpatins\b/i.test(t)) return 'ice';
  if (/\bágua\b|\bagua\b|\bpiscina\b|\bmar\b|\bnatação\b|\bnatacao\b/i.test(t)) return 'water';
  if (/\brelva\b|\bcampo\b|\bgrama\b/i.test(t) && /\bdesporto\b/i.test(t)) return 'field';
  return null;
}

function isIceSportOption(text) {
  const t = String(text || '').toLowerCase();
  return /\bhóquei\b|\bhoquei\b|\bpatinag|\bcurling\b|\bbobsleigh\b|\bluge\b|\bpatins\b/i.test(t);
}

function isClearlyNonIceSport(text) {
  const t = String(text || '').toLowerCase();
  if (isIceSportOption(t)) return false;
  return /\bténis\b|\btenis\b|\bfutebol\b|\bbasquetebol\b|\bsalto\b|\bmaratona\b|\bciclismo\b|\bgolfe\b|\bvoleibol\b|\bandebol\b|\batletismo\b/i.test(t);
}

function validateMcSportSurfaceMismatch(q, options, correctAnswer, stripTags) {
  const issues = [];
  if (!/\b(que|qual)\s+desporto\b/i.test(q)) return issues;
  const surface = detectSportSurfaceContext(q);
  if (!surface || surface !== 'ice') return issues;
  const clean = (options || []).map((o) => stripTags(o).trim()).filter(Boolean);
  if (clean.length < 4) return issues;
  const correct = stripTags(correctAnswer).trim().toLowerCase();
  const wrong = clean.filter((o) => stripTags(o).trim().toLowerCase() !== correct);
  const nonIce = wrong.filter((o) => isClearlyNonIceSport(o));
  if (nonIce.length >= 2) {
    pushMcWrongClass(issues, 'distratores demasiado óbvios — com pergunta sobre gelo, as opções erradas devem ser outros desportos de gelo plausíveis');
  }
  return issues;
}

function validateMcTooObvious(options, correctAnswer, stripTags) {
  const issues = [];
  const correct = stripTags(correctAnswer).trim();
  const clean = (options || []).map((o) => stripTags(o).trim()).filter(Boolean);
  if (clean.length < 4) return issues;
  const wrong = clean.filter((o) => o.toLowerCase() !== correct.toLowerCase());
  const cWords = correct.split(/\s+/).filter(Boolean).length;
  const isShortAcronym = cWords <= 2 && correct.length <= 8 && /^[A-Za-zÀ-ú]{2,8}$/.test(correct.replace(/\s/g, ''));
  if (!isShortAcronym) return issues;
  const avgWrongLen = wrong.reduce((s, o) => s + o.length, 0) / wrong.length;
  const avgWrongWords = wrong.reduce((s, o) => s + o.split(/\s+/).filter(Boolean).length, 0) / wrong.length;
  if (avgWrongWords >= 2 && avgWrongLen > correct.length * 2
    && wrong.every((o) => o.length > correct.length)) {
    pushIssue(issues, 'MC_TOO_OBVIOUS', ISSUE_LAYER.mcOptions, 'demasiado óbvio — a resposta correcta destoa dos distractores; torna os errados plausíveis e do mesmo estilo');
  }
  return issues;
}

function validateMcOptionsCoherence(q, options, stripTags) {
  const issues = [];
  const clean = (options || []).map((o) => stripTags(o).trim()).filter(Boolean);
  if (clean.length < 4) return issues;

  const asksAnimal = /\b(que animal|qual animal|que bicho|qual bicho|que mamífero|qual mamífero|que mamifero|qual mamifero)\b/i.test(q);
  if (asksAnimal) {
    const foreignOptionPatterns = [
      /\bilusão\b/i,
      /\bóptica\b|\boptica\b/i,
      /\bmüller|\bmueller\b/i,
      /\b\d+\s*a\s*\d+\b/i,
      /\bpercentagem\b/i,
      /\bminut/i,
      /\bsegund/i,
      /\bvezes\b/i,
    ];
    if (clean.some((opt) => foreignOptionPatterns.some((pattern) => pattern.test(opt)))) {
      pushMcWrongClass(issues, 'opções incoerentes — misturam temas diferentes (ex.: animal com ilusão de ótica ou números)');
    }
  }

  const looksLikeFrequency = (text) => /\b\d+\s*(a|–|-)\s*\d+\b/i.test(text) || /\bcerca de\s+\d+/i.test(text);
  const looksLikeOptical = (text) => /\bilusão\b|\bóptica\b|\boptica\b/i.test(text);
  const thematicBuckets = clean.map((opt) => {
    if (looksLikeOptical(opt)) return 'optical';
    if (looksLikeFrequency(opt)) return 'frequency';
    if (/\b(golfinho|salamandra|tigre|leão|leao|gato|cão|cao|pássaro|passaro|baleia|foca|pato)\b/i.test(opt)) return 'animal';
    return 'other';
  });
  const distinctBuckets = new Set(thematicBuckets.filter((bucket) => bucket !== 'other'));
  if (distinctBuckets.size >= 3) {
    pushMcWrongClass(issues, 'opções parecem respostas de perguntas diferentes — todas devem ser do mesmo tipo');
  }

  return issues;
}

function validateDisneyCharacterAliases(options, a) {
  const issues = [];
  if (!options?.length) return issues;
  const norms = options.map((o) => String(o).toLowerCase());
  const aliasGroups = [
    ['winnie', 'pooh'],
    ['ursinho', 'pooh'],
    ['mickey', 'rato mickey'],
  ];
  for (const [partA, partB] of aliasGroups) {
    const hasA = norms.some((o) => o.includes(partA));
    const hasB = norms.some((o) => o.includes(partB));
    if (hasA && hasB) pushMcWrongClass(issues, 'opções ambíguas — alcunha e nome do mesmo personagem');
  }
  if (/\b(pooh|winnie)\b/i.test(a) && norms.filter((o) => /\b(pooh|winnie|ursinho)\b/i.test(o)).length >= 2) {
    pushMcWrongClass(issues, 'nome ambíguo — em PT-PT usa "Ursinho Puff" de forma consistente');
  }
  return issues;
}

function levenshteinDistance(a, b) {
  const s = String(a || '');
  const t = String(b || '');
  if (s === t) return 0;
  if (!s.length) return t.length;
  if (!t.length) return s.length;
  const row = Array.from({ length: t.length + 1 }, (_, i) => i);
  for (let i = 1; i <= s.length; i += 1) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= t.length; j += 1) {
      const tmp = row[j];
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost);
      prev = tmp;
    }
  }
  return row[t.length];
}

function optionDedupeKey(text) {
  let s = String(text || '').trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  s = s.replace(/[^a-z0-9\s]/gi, ' ');
  // Typos com 3+ letras iguais → reduz a 2 (Wooody→Woody); duplos normais (Carro) mantêm-se.
  s = s.replace(/(.)\1+/g, (run, ch) => (run.length >= 3 ? ch + ch : run));
  return s.replace(/\s+/g, ' ').trim();
}

function collapseOptionKey(text, normalizeFn) {
  let s = normalizeFn ? normalizeFn(text) : String(text || '').trim().toLowerCase();
  s = s.replace(/[^a-zàáâãéêíóôõúç0-9\s]/gi, ' ');
  s = s.replace(/(.)\1+/g, (run, ch) => (run.length >= 3 ? ch + ch : run));
  return s.replace(/\s+/g, ' ').trim();
}

function looksLikeYearOrDateOption(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (/^(cerca de\s+)?\d{3,4}s?$/i.test(t)) return true;
  if (/^\d{1,2}\s+de\s+[a-zà-ú]+\s+de\s+\d{3,4}$/i.test(t)) return true;
  if (/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(t)) return true;
  if (/^(século|seculo)\s+/i.test(t)) return true;
  if (/^(ano\s+)?\d{3,4}$/i.test(t)) return true;
  return false;
}

function hasNearDuplicateMcOptions(options) {
  const raw = (options || []).map((o) => String(o || '').trim());
  const keys = raw.map((o) => optionDedupeKey(o));
  if (new Set(keys).size !== keys.length) return true;
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const a = keys[i];
      const b = keys[j];
      if (!a || !b || a === b) return true;
      // Anos/datas próximos são distractores válidos em QUANDO — só rejeitar duplicados exactos.
      if (looksLikeYearOrDateOption(raw[i]) && looksLikeYearOrDateOption(raw[j])) continue;
      if (a.length >= 4 && b.length >= 4) {
        const minLen = Math.min(a.length, b.length);
        const maxLen = Math.max(a.length, b.length);
        if (minLen / maxLen >= 0.9 && levenshteinDistance(a, b) <= 1) return true;
      }
    }
  }
  return false;
}

function validateMcOptionsQuality(options, stripTags, normalizeFn, ageBandKey) {
  const issues = [];
  const clean = (options || []).map((o) => stripTags(o).trim()).filter(Boolean);
  if (clean.length < 2) return issues;
  if (hasNearDuplicateMcOptions(clean)) {
    pushIssue(issues, 'MC_NEAR_DUPLICATE', ISSUE_LAYER.mcOptions, 'opções repetidas ou quase iguais (ex.: Woody / Wooody / Sheriff Woody)');
  }
  const lim = getAgeLimits(ageBandKey);
  const tooLong = clean.filter((o) => {
    const words = o.split(/\s+/).filter(Boolean).length;
    return words > lim.maxMcOptionWords || o.length > lim.maxMcOptionChars;
  });
  if (tooLong.length) {
    pushIssue(issues, 'MC_OPTIONS_TOO_LONG', ISSUE_LAYER.mcOptions, lim.mcOptionsTooLongMsg || 'opções demasiado longas — usa termos mais curtos');
  }
  return issues;
}

function classifyConceptBucket(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return 'empty';
  if (/^(azul|verde|vermelho|amarelo|preto|branco|rosa|roxo|laranja|castanho|cinzento|dourado|prateado)$/i.test(t)) return 'color';
  if (/^(futebol|basquetebol|natação|natacao|ténis|tenis|andebol|hóquei|hoquei|voleibol|atletismo)$/i.test(t)) return 'sport';
  if (/^(banana|maçã|maca|laranja|pão|pao|arroz|sopa|bolo)$/i.test(t)) return 'food';
  if (/^(lisboa|porto|paris|madrid|roma|berlim|londres|nova iorque|tóquio|toquio|évora|evora|coimbra|faro|braga|aveiro|guimarães|guimaraes|setúbal|setubal)$/i.test(t)) return 'place';
  if (/^\d+$/.test(t)) return 'number';
  if (/\b(cidade|país|pais|capital|continente|rio|montanha|planeta|oceano)\b/i.test(t)) return 'geo_science';
  if (/\b(animal|planta|árvore|arvore|mamífero|mamifero|pássaro|passaro|peixe)\b/i.test(t)) return 'nature';
  return 'entity';
}

function validateMcConceptualClass(options, correctAnswer, stripTags) {
  const issues = [];
  const clean = (options || []).map((o) => stripTags(o).trim()).filter(Boolean);
  if (clean.length < 4) return issues;
  const correct = stripTags(correctAnswer).trim();
  const correctKind = classifyMcOptionKind(correct);
  const wrongKinds = clean
    .filter((o) => o.toLowerCase() !== correct.toLowerCase())
    .map(classifyMcOptionKind)
    .filter((k) => k !== 'other' && k !== 'concept' && k !== 'empty');
  const correctBucket = classifyConceptBucket(correct);
  const wrongBuckets = clean
    .filter((o) => o.toLowerCase() !== correct.toLowerCase())
    .map(classifyConceptBucket)
    .filter((b) => b !== 'entity' && b !== 'geo_science' && b !== 'nature');
  const absurdBuckets = new Set(['color', 'sport', 'food', 'place', 'number']);
  const absurdWrong = wrongBuckets.filter((b) => absurdBuckets.has(b));
  if (absurdWrong.length >= 2 && !absurdBuckets.has(correctBucket)) {
    pushMcWrongClass(issues, 'distratores de classes conceptuais diferentes (ex.: cores, cidades ou desportos misturados com o tema)');
    return issues;
  }
  const distinctWrong = new Set(wrongBuckets.filter((b) => b !== 'entity'));
  if (distinctWrong.size >= 3 && correctBucket === 'entity') {
    pushMcWrongClass(issues, 'distratores incoerentes — devem pertencer à mesma classe conceptual que a resposta');
  }
  const foreignKinds = ['film', 'year', 'country', 'brand', 'proverb', 'literary_movement', 'fashion_concept'];
  const foreignWrong = wrongKinds.filter((k) => foreignKinds.includes(k));
  if (foreignWrong.length >= 2 && !foreignKinds.includes(correctKind)) {
    pushMcWrongClass(issues, 'distratores incoerentes — mistura tipos incompatíveis (filmes, anos, países, marcas…)');
  }
  return issues;
}

function validateMcSingleCorrect(options, correctAnswer, normalizeFn) {
  const norm = normalizeFn || ((s) => String(s || '').trim().toLowerCase());
  const correct = norm(correctAnswer);
  const matches = (options || []).filter((o) => norm(o) === correct);
  if (matches.length !== 1) {
    return [mkIssue('MC_MULTIPLE_CORRECT', ISSUE_LAYER.mcOptions, 'deve haver exactamente uma opção correcta')];
  }
  return [];
}

function collectMcIssues(parsed, ctx) {
  const { isMC, stripTags, normalizeFn, ageBandKey, formatId } = ctx;
  if (!isMC) return [];
  const q = stripTags(parsed?.q || '').trim();
  const a = stripTags(parsed?.a || '').trim();
  const options = Array.isArray(parsed?.options) ? parsed.options : [];
  if (options.length < 2) {
    return [mkIssue('MC_INSUFFICIENT_OPTIONS', ISSUE_LAYER.mcOptions, 'opções MC insuficientes')];
  }
  const issues = [
    ...validateMcSingleCorrect(options, a, normalizeFn),
    ...validateMcConceptualClass(options, a, stripTags),
    ...validateMcDistractorMixing(q, options, a, stripTags, formatId),
    ...validateMcTooObvious(options, a, stripTags),
    ...validateMcSportSurfaceMismatch(q, options, a, stripTags),
    ...validateMcTrivialMath(q, options, a, stripTags),
    ...validateMcOptionsQuality(options, stripTags, collapseOptionKey, ageBandKey),
    ...validateDisneyCharacterAliases(options, a),
    ...(typeof ctx.adivinhaMcAmbiguity === 'function' ? ctx.adivinhaMcAmbiguity(q, a, options, stripTags, formatId) : []),
    ...(formatId === 'ADIVINHA' && global.QuestionEngineAdivinhaDistractors
      ? global.QuestionEngineAdivinhaDistractors.validateAdivinhaMcDistractors(options, a, stripTags)
      : []),
  ];
  if (options.length === 4) {
    issues.push(...validateMcOptionsCoherence(q, options, stripTags));
    const absurd = /^(banana|futebol|azul|verde|vermelho|nada|qualquer|abc|xyz|123|nenhum|desconhecido)$/i;
    const wrong = options.filter((o) => stripTags(o).trim().toLowerCase() !== a.toLowerCase());
    if (wrong.filter((o) => absurd.test(stripTags(o).trim())).length >= 2) {
      pushIssue(issues, 'MC_ABSURD_DISTRACTORS', ISSUE_LAYER.mcOptions, 'distratores demasiado absurdos');
    }
    const qTokens = new Set(tokenizeMc(q));
    for (const opt of wrong) {
      const ot = tokenizeMc(opt);
      if (ot.length >= 2 && ot.every((w) => qTokens.has(w))) {
        pushIssue(issues, 'MC_OPTION_LEAKS_QUESTION', ISSUE_LAYER.mcOptions, 'opção errada contém pista da pergunta');
        break;
      }
    }
  }
  return issues;
}
  global.QuestionEngineMcValidators = Object.freeze({
    classifyMcOptionKind,
    collapseOptionKey,
    validateMcDistractorMixing,
    validateMcTrivialMath,
    validateMcTooObvious,
    validateMcSportSurfaceMismatch,
    detectSportSurfaceContext,
    validateMcOptionsCoherence,
    validateMcOptionsQuality,
    validateDisneyCharacterAliases,
    validateMcConceptualClass,
    validateMcSingleCorrect,
    collectMcIssues,
  });
})(typeof window !== 'undefined' ? window : globalThis);
