/**
 * Validadores PT-PT — ortografia, brasileirismos, futebol e inglês (Fase 7b).
 */
(function (global) {
  'use strict';

  const Issues = global.QuestionEngineIssues;
  const Config = global.QuestionEngineConfig;
  if (!Issues || !Config) {
    throw new Error('pt-pt-validators: carrega issue-codes.js e engine-config.js antes deste módulo');
  }
  const { mkIssue, ISSUE_LAYER } = Issues;
  const {
    RE_CJK, RE_CYRILLIC, RE_ARABIC, RE_MIXED_LATIN_CJK, RE_MIXED_WORD,
    RE_BRASILEIRISMO, isGenericTrueFalseAnswer,
  } = Config;

  function pushIssue(issues, code, layer, message) {
    issues.push(mkIssue(code, layer, message));
  }

  function pushPtBrIssue(issues, message) {
    pushIssue(issues, 'PT_BRASILISM', ISSUE_LAYER.ptPt, message);
  }

function hasInvalidScript(text) {
  const t = String(text || '');
  if (RE_CJK.test(t)) return true;
  if (RE_CYRILLIC.test(t)) return true;
  if (RE_ARABIC.test(t)) return true;
  if (RE_MIXED_LATIN_CJK.test(t)) return true;
  return false;
}
const COUNTRY_PT_ERRORS = [
  { re: /\bIrã\b/, correct: 'Irão' },
  { re: /\bIran\b/i, correct: 'Irão' },
  { re: /\bQatar\b/i, correct: 'Catar' },
  { re: /\bCape Verde\b/i, correct: 'Cabo Verde' },
  { re: /\bIvory Coast\b/i, correct: 'Costa do Marfim' },
  { re: /\bSouth Korea\b/i, correct: 'Coreia do Sul' },
  { re: /\bNorth Korea\b/i, correct: 'Coreia do Norte' },
  { re: /\bUnited States\b/i, correct: 'Estados Unidos' },
  { re: /\bUnited Kingdom\b/i, correct: 'Reino Unido' },
  { re: /\bCzech Republic\b/i, correct: 'Chéquia' },
  { re: /\bMyanmar\b/i, correct: 'Mianmar' },
  { re: /\bBurma\b/i, correct: 'Mianmar' },
  { re: /\bHolland\b/i, correct: 'Países Baixos' },
];

const EN_STOPWORDS = new Set([
  'the', 'and', 'or', 'a', 'an', 'is', 'are', 'was', 'were', 'of', 'to', 'in', 'for', 'on', 'with',
  'at', 'by', 'from', 'as', 'that', 'this', 'it', 'be', 'have', 'has', 'had', 'do', 'does', 'did',
  'will', 'would', 'could', 'should', 'may', 'might', 'not', 'but', 'if', 'then', 'than', 'when',
  'where', 'what', 'which', 'who', 'how', 'why', 'all', 'each', 'every', 'both', 'some', 'such',
  'no', 'only', 'same', 'so', 'too', 'very', 'can', 'just', 'because', 'about', 'into', 'through',
  'during', 'before', 'after', 'between', 'under', 'again', 'once',
]);

const EN_COMMON_WORDS = /\b(summer|winter|spring|autumn|fall|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|june|july|august|september|october|november|december|water|fire|earth|air|sun|moon|star|dog|cat|house|car|tree|flower|bird|fish|book|school|teacher|student|happy|sad|big|small|red|blue|green|yellow|black|white|because|always|never|sometimes|maybe|yes|no|hello|goodbye|friend|mother|father|brother|sister|boy|girl|man|woman|child|children|people|country|city|river|mountain|ocean|beach|food|drink|music|movie|game|play|run|walk|swim|fly|eat|sleep|read|write|learn|teach|think|know|want|need|like|love|hate|make|take|give|find|tell|ask|answer|question|true|false|right|wrong|hot|cold|warm|cool|new|old|young|long|short|high|low|fast|slow|easy|hard|good|bad|best|worst|first|last|next|many|much|few|little|lot|all|none|some|any|every|other|another|same|different|same)\b/i;

const PT_MARKERS = /\b(não|sim|uma|uns|umas|que|com|por|para|dos|das|num|numa|são|é|está|estão|foi|foram|pelo|pela|este|esta|esse|essa|muito|mais|menos|também|ainda|já|sempre|nunca|onde|quando|como|qual|quais|quem|porque|então|mas|ou|nem|sem|sobre|entre|desde|até|há|anos|ano|dias|dia|país|pais|cidade|festa|escola|livro|água|agua|sol|lua|mar|rio|montanha|floresta|animal|planta|cor|verde|azul|vermelho|amarelo|branco|preto|grande|pequeno|bom|mau|novo|velho)\b/i;

function isAllowedEnglishProperNoun(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (/^(The |DJ |Lady |Dr\.|MC )/i.test(t)) return true;
  if (/^[A-Z][\w'.-]+(\s+[A-Z][\w'.-]+)+/.test(t)) return true;
  if (/^\d{4}$/.test(t)) return true;
  if (/^(Beatles|Queen|ABBA|U2|Coldplay|Adele|Beyoncé|Beyonce|Madonna|Elvis|Nirvana|Metallica|Radiohead|Oasis|Blur)$/i.test(t)) return true;
  return false;
}

function looksPredominantlyEnglish(text) {
  const t = String(text || '').trim();
  if (!t || isAllowedEnglishProperNoun(t)) return false;
  if (PT_MARKERS.test(t)) return false;
  if (/[ãõâêôáéíóúç]/i.test(t)) return false;
  if (EN_COMMON_WORDS.test(t)) return true;
  const words = t.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return false;
  let enCount = 0;
  for (const w of words) {
    const core = w.replace(/[^a-z]/g, '');
    if (core && EN_STOPWORDS.has(core)) enCount++;
  }
  if (words.length >= 2 && enCount >= Math.ceil(words.length * 0.5)) return true;
  if (words.length === 1 && /^[a-z]+$/i.test(words[0]) && words[0].length <= 12 && EN_COMMON_WORDS.test(words[0])) return true;
  return false;
}

function validateCountryNamesPt(blob) {
  const issues = [];
  for (const { re, correct } of COUNTRY_PT_ERRORS) {
    if (re.test(blob)) {
      pushIssue(issues, 'PT_COUNTRY_NAME', ISSUE_LAYER.ptPt, `nome de país incorrecto — em PT-PT usa "${correct}"`);
      break;
    }
  }
  return issues;
}

function validatePortugueseNotEnglish(parts, ageBandKey) {
  if (ageBandKey !== '6-9' && ageBandKey !== '10-15') return [];
  const issues = [];
  for (const part of parts) {
    const t = String(part || '').trim();
    if (!t || isGenericTrueFalseAnswer(t)) continue;
    if (looksPredominantlyEnglish(t)) {
      pushIssue(issues, 'PT_ENGLISH_ONLY', ISSUE_LAYER.ptPt, 'resposta ou opção só em inglês — usa português de Portugal');
      break;
    }
  }
  return issues;
}

function validateFootballPtPt(parts) {
  const issues = [];
  const blob = (parts || []).join(' ');
  const football = /\b(futebol|baliza|golos?|campo|árbitro|arbitro|penálti|penalti|fora de jogo|remate|guarda.?redes|equipa|campeonato|liga|marcador|defesa|avançado|ponta|médio|treinador|relva|canto|jogador)\b/i.test(blob);
  if (!football) return issues;

  const alwaysBr = [
    [/\bgoleir[ao]s?\b/i, 'guarda-redes'],
    [/\bzagueir[ao]s?\b/i, 'defesa'],
    [/\b(atacante|centroavante|centro-avante)s?\b/i, 'avançado ou ponta-de-lança'],
    [/\bvolantes?\b/i, 'médio'],
    [/\bchutes?\b/i, 'remate'],
    [/\bchutar\b/i, 'rematar'],
    [/\bescanteios?\b/i, 'canto'],
    [/\bgramad[oa]s?\b/i, 'relva'],
    [/\btorcida\b/i, 'adeptos'],
    [/\bartilheiros?\b/i, 'melhor marcador'],
    [/\barremessos?\b/i, 'pontapé'],
  ];
  for (const [re, pt] of alwaysBr) {
    if (re.test(blob)) pushPtBrIssue(issues, `termo de futebol brasileiro — em PT-PT usa "${pt}"`);
  }

  if (/\bmeia[s]?\b/i.test(blob) && /\bfutebol\b/i.test(blob)) {
    pushPtBrIssue(issues, 'termo de futebol brasileiro — em PT-PT usa "médio" (não "meia")');
  }
  if (/\bt[eé]cnicos?\b/i.test(blob) && /\bfutebol\b/i.test(blob)) {
    pushPtBrIssue(issues, 'termo de futebol brasileiro — em PT-PT usa "treinador"');
  }
  if (/\btime\b/i.test(blob)) {
    pushPtBrIssue(issues, 'termo de futebol brasileiro — em PT-PT usa "equipa" (não "time")');
  }
  if (/\bju[ií]zes?\b/i.test(blob)) {
    pushPtBrIssue(issues, 'termo de futebol brasileiro — em PT-PT usa "árbitro"');
  }
  if (/\bcamisas?\b/i.test(blob) && /\b(futebol|jogador|equipa|clube|baliza|guarda.?redes)\b/i.test(blob)) {
    pushPtBrIssue(issues, 'termo de futebol brasileiro — em PT-PT usa "camisola" (não "camisa")');
  }
  if (/\buniformes?\b/i.test(blob) && /\bfutebol\b/i.test(blob)) {
    pushPtBrIssue(issues, 'termo de futebol brasileiro — em PT-PT usa "equipamento"');
  }
  if (/\bpartidas?\b/i.test(blob) && /\bfutebol\b/i.test(blob)) {
    pushPtBrIssue(issues, 'termo de futebol brasileiro — em PT-PT usa "jogo"');
  }
  if (/(?:^|[^\w])gols?(?:[^\w]|$)/i.test(blob) && !/\bgolfe\b/i.test(blob)) {
    pushPtBrIssue(issues, 'termo de futebol brasileiro — em PT-PT usa "golo"');
  }
  if (/\bcampo de grama\b/i.test(blob)) {
    pushPtBrIssue(issues, 'termo de futebol brasileiro — em PT-PT usa "relvado" ou "campo de relva"');
  }
  if (/\bgolead[ao]\b/i.test(blob) && /(?:^|[^\w])gols?(?:[^\w]|$)/i.test(blob) && !/\bgolfe\b/i.test(blob)) {
    pushPtBrIssue(issues, 'em PT-PT usa "golo/golos" (não "gol/gols"), mesmo com "goleada" ou "golear"');
  }
  if (/\bgolead[ao]\b/i.test(blob) && /\b(Brasileirão|Brasileirao|Campeonato Brasileiro|Série [AB] do Brasil)\b/i.test(blob)) {
    pushPtBrIssue(issues, 'goleada/golear em contexto de campeonato português — evita referências ao futebol brasileiro');
  }

  return issues;
}

function validatePortugueseText(blob) {
  const issues = [];
  if (hasInvalidScript(blob)) {
    pushIssue(issues, 'PT_INVALID_SCRIPT', ISSUE_LAYER.ptPt, 'texto com caracteres não portugueses (ex.: chinês ou outro alfabeto)');
  }
  if (RE_MIXED_WORD.test(blob)) {
    pushIssue(issues, 'PT_MIXED_WORD', ISSUE_LAYER.ptPt, 'palavra com letras misturadas de outro idioma');
  }
  if (/\bestilo\s+borboleta\b/i.test(blob)) {
    pushPtBrIssue(issues, 'vocabulário de natação brasileiro — em PT-PT usa "estilo mariposa"');
  }
  if (/\bvira\s+vapor\b/i.test(blob)) {
    pushPtBrIssue(issues, 'colquialismo brasileiro — em PT-PT diz "transforma-se em vapor" (não "vira vapor")');
  }
  if (/\btrem-baleiro\b/i.test(blob)) {
    pushPtBrIssue(issues, 'brasileirismo — em PT-PT usa "comboio maglev" ou "comboio de levitação magnética"');
  }
  if (/\btrem\b/i.test(blob) && /\b(carris|propulsão|propulsao|magnétic|magnetic|levita|veículo|veiculo|transporte)\b/i.test(blob)) {
    pushPtBrIssue(issues, 'brasileirismo — em PT-PT usa "comboio" (não "trem")');
  }
  if (/\bcomboio\b/i.test(blob) && /\btrilhos?\b/i.test(blob)) {
    pushPtBrIssue(issues, 'em PT-PT diz "carris" (não "trilhos") para o comboio');
  }
  if (/\bviés\b/i.test(blob)) {
    pushPtBrIssue(issues, 'brasileirismo — em PT-PT usa "enviesamento" ou "tendência de negatividade" (não "viés")');
  }
  if (/\bbolseiro\b/i.test(blob) && /\b(frodo|senhor dos an[eé]is|um anel|tolkien)\b/i.test(blob)) {
    pushPtBrIssue(issues, 'nome de personagem — em PT-PT usa "Sacova" ou mantém "Baggins" (não a tradução brasileira Bolseiro)');
  }
  if (/\bavoando\b/i.test(blob)) {
    pushPtBrIssue(issues, 'erro ortográfico — escreve "a voar" (não "avoando")');
  }
  if (/\bcamisetas?\b/i.test(blob)) {
    pushPtBrIssue(issues, 'brasileirismo — em PT-PT usa "camisola" (não "camiseta")');
  }
  if (RE_BRASILEIRISMO.test(blob)) {
    pushPtBrIssue(issues, 'brasileirismo detectado — usa português de Portugal');
  }
  issues.push(...validateFootballPtPt([blob]));
  return issues;
}

  function collectPtPtIssues(q, a, options, ageBandKey, clues = []) {
    const blob = [q, a, ...options].join(' ');
    const contentSafety = global.QuestionEngineContentSafety || global.QuestionEngineFamilySafeWords;
    const safetyIssues = contentSafety?.collectContentSafetyIssues
      ? contentSafety.collectContentSafetyIssues(q, a, options, clues).map((item) => mkIssue(item.code, ISSUE_LAYER.ptPt, item.message))
      : (contentSafety?.collectFamilySafeIssues
        ? contentSafety.collectFamilySafeIssues(q, a, options, clues).map((item) => mkIssue(item.code, ISSUE_LAYER.ptPt, item.message))
        : []);
    return [
      ...validatePortugueseText(blob),
      ...validateCountryNamesPt(blob),
      ...validatePortugueseNotEnglish([q, a, ...options], ageBandKey),
      ...safetyIssues,
    ];
  }

  global.QuestionEnginePtPt = Object.freeze({
    hasInvalidScript,
    validateCountryNamesPt,
    validatePortugueseNotEnglish,
    validateFootballPtPt,
    validatePortugueseText,
    collectPtPtIssues,
    looksPredominantlyEnglish,
  });
})(typeof window !== 'undefined' ? window : globalThis);
