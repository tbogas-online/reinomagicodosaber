/**
 * Motor de perguntas — formatos, matriz categoria×formato, prompts em camadas e validação.
 */
(function (global) {
  'use strict';

  const Issues = global.QuestionEngineIssues;
  const KnowledgeKey = global.QuestionEngineKnowledgeKey;
  const Retry = global.QuestionEngineRetry;
  const Telemetry = global.QuestionEngineTelemetry;
  const KnownFacts = global.QuestionEngineKnownFacts;
  const FactualVerify = global.QuestionEngineFactualVerify;
  if (!Issues || !KnowledgeKey || !Retry || !Telemetry || !KnownFacts || !FactualVerify) {
    throw new Error('QuestionEngine: carrega issue-codes.js, knowledge-key.js, retry-strategy.js, telemetry.js, known-facts.js e factual-verify.js antes de question-engine.js');
  }
  const {
    mkIssue, issueMessage, issueCode, normalizeIssues, issueMessages,
    buildRetryHintFromIssues, ISSUE_LAYER,
  } = Issues;

  function pushIssue(arr, code, layer, message) {
    arr.push(mkIssue(code, layer, message));
  }

  function pushAgeHardIssue(issues, message) {
    pushIssue(issues, 'AGE_TOO_HARD', ISSUE_LAYER.age, message);
  }

  function pushPtBrIssue(issues, message) {
    pushIssue(issues, 'PT_BRASILISM', ISSUE_LAYER.ptPt, message);
  }

  function pushMcWrongClass(issues, message) {
    pushIssue(issues, 'MC_WRONG_CLASS', ISSUE_LAYER.mcOptions, message);
  }

  function pushCategoryMismatch(issues, message) {
    pushIssue(issues, 'CATEGORY_MISMATCH', ISSUE_LAYER.category, message);
  }

  function pushFormatViolation(issues, message) {
    pushIssue(issues, 'FORMAT_VIOLATION', ISSUE_LAYER.format, message);
  }

  const ENGINE_CONFIG = Object.freeze({
    TRUE_FALSE_CHANCE: 0.11,
    TRUE_FALSE_MIN_GAP: 4,
    FORMAT_MAX_CONSECUTIVE: 2,
    PERSISTENT_HISTORY_MAX: 400,
    MAX_RECENT_QUESTIONS: 30,
    MAX_RECENT_KNOWLEDGE_KEYS: 40,
    MAX_RECENT_FORMATS: 40,
    MAX_RETRIES: 5, // usado por test-questions.html (retry ao gerar); não lido dentro deste módulo
    QUESTION_JACCARD_THRESHOLD: 0.55,
    KNOWLEDGE_JACCARD_THRESHOLD: 0.42,
  });

  /** Pesos das camadas — somam exactamente 100. Apenas diagnóstico/UI em scoreQuestion; validateQuestion reprova se issues.length > 0 (gate binário). */
  const LAYER_WEIGHTS = Object.freeze({
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

  const TRUE_FALSE_CHANCE = ENGINE_CONFIG.TRUE_FALSE_CHANCE;
  const TRUE_FALSE_MIN_GAP = ENGINE_CONFIG.TRUE_FALSE_MIN_GAP;
  const FORMAT_MAX_CONSECUTIVE = ENGINE_CONFIG.FORMAT_MAX_CONSECUTIVE;
  const GENERIC_TRUE_FALSE_ANSWERS = new Set(['verdadeiro', 'falso']);
  const RE_CJK = /[\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF\u3040-\u30FF\u31F0-\u31FF\uAC00-\uD7AF]/;
  const RE_CYRILLIC = /[\u0400-\u04FF]/;
  const RE_ARABIC = /[\u0600-\u06FF]/;
  const RE_MIXED_LATIN_CJK = /[A-Za-zÀ-ÖØ-öø-ÿ][\u4E00-\u9FFF\u3040-\u30FF]|[\u4E00-\u9FFF\u3040-\u30FF][A-Za-zÀ-ÖØ-öø-ÿ]/;
  const RE_MIXED_WORD = /\b[A-Za-zÀ-ÖØ-öø-ÿ]*[\u4E00-\u9FFF\u3040-\u30FF][A-Za-zÀ-ÖØ-öø-ÿ\u4E00-\u9FFF\u3040-\u30FF]*/;
  const RE_BRASILEIRISMO = /(?:ônibus|onibus|metrô|metrópole|você|vocês|celular|geladeira|banheiro|\btime\b(?!\s+de)|\blegal\b(?!\s+como))/i;
  const RE_TECH_TRANSPORT = /\b(carro|carros|automóvel|automóveis|automovel|automoveis|avião|aviões|aviao|avioes|comboio|comboios|autocarro|autocarros|barco|navio|navios|mota|motas|bicicleta|bicicletas|elétrico|eléctrico|táxi|taxi|veículo|veículos|veiculo|veiculos|camião|camiões|caminhão|caminhões|camioneta|metropolitano|transporte público|transportes públicos)\b/i;
  const RE_TECH_SPACE = /\b(foguetão|foguete|foguetes|missão espacial|missão à lua|missao espacial|missao a lua|lançamento espacial|lançamento de foguete|nave espacial|astronauta)\b/i;

  function isGenericTrueFalseAnswer(answer, normalizeFn) {
    const raw = typeof answer === 'string' ? answer : '';
    const norm = normalizeFn ? normalizeFn(raw) : raw.trim().toLowerCase();
    if (GENERIC_TRUE_FALSE_ANSWERS.has(norm)) return true;
    const core = norm.replace(/[^a-záàâãéêíóôõúç]/gi, '').trim();
    return GENERIC_TRUE_FALSE_ANSWERS.has(core);
  }

  function filterKnowledgeAnswers(answers, normalizeFn) {
    return (answers || []).filter((a) => !isGenericTrueFalseAnswer(a, normalizeFn));
  }

  const FORMAT_IDS = {
    RESPOSTA_DIRETA: 'RESPOSTA_DIRETA',
    ESCOLHA_MULTIPLA: 'ESCOLHA_MULTIPLA',
    VERDADEIRO_FALSO: 'VERDADEIRO_FALSO',
    QUEM_E: 'QUEM_E',
    O_QUE_E: 'O_QUE_E',
    COMPLETA: 'COMPLETA',
    ONDE_FICA: 'ONDE_FICA',
    QUANDO: 'QUANDO',
    CAUSA_CONSEQUENCIA: 'CAUSA_CONSEQUENCIA',
    SITUACAO_PRATICA: 'SITUACAO_PRATICA',
    ADIVINHA: 'ADIVINHA',
    CURIOSIDADE: 'CURIOSIDADE',
  };

  const FORMAT_AGE_EXCLUDED = {
    '6-9': ['CAUSA_CONSEQUENCIA', 'SITUACAO_PRATICA'],
    '10-15': [],
    '15+': [],
  };

  const FORMAT_LABELS = {
    RESPOSTA_DIRETA: 'Resposta direta',
    ESCOLHA_MULTIPLA: 'Escolha múltipla',
    VERDADEIRO_FALSO: 'Verdadeiro ou falso',
    QUEM_E: 'Quem é',
    O_QUE_E: 'O que é',
    COMPLETA: 'Completa a frase',
    ONDE_FICA: 'Onde fica',
    QUANDO: 'Quando',
    CAUSA_CONSEQUENCIA: 'Causa e consequência',
    SITUACAO_PRATICA: 'Situação prática',
    ADIVINHA: 'Adivinha',
    CURIOSIDADE: 'Curiosidade',
  };

  /** Formatos compatíveis com cada modo de resposta (answerMode). */
  const ANSWER_MODE_OPEN_ONLY = new Set([FORMAT_IDS.RESPOSTA_DIRETA]);
  const ANSWER_MODE_MC_ONLY = new Set([FORMAT_IDS.ESCOLHA_MULTIPLA]);

  const DIFFICULTY_RANGE = {
    '6-9': { min: 1, max: 3 },
    '10-15': { min: 1, max: 4 },
    '15+': { min: 1, max: 5 },
  };

  const DIFFICULTY_LABELS = {
    1: 'muito fácil',
    2: 'fácil',
    3: 'médio',
    4: 'difícil',
    5: 'muito difícil (especialista)',
  };

  const AGE_LIMITS_BASE = Object.freeze({
    shortQ: '',
    completaYoung: '',
    completaOral: '',
    mcYoung: '',
    mcConcise: '',
    quemEExtra: '',
    oQueEExtra: '',
    maxCausaConsequenciaChars: 200,
    maxQuestionChars: 240,
    maxQuestionWords: null,
    maxQuestionWordsTopic: null,
    maxAnswerWords: null,
    maxCompletaAnswerWords: null,
    maxAnswerWordsTopic: null,
    maxTechnicalAnswerWords: null,
    maxMcOptionWords: 8,
    maxMcOptionChars: 72,
    maxWordLength: null,
    mcOptionsTooLongMsg: 'opções demasiado longas — usa termos mais curtos',
    rejectDifficultyGte: null,
    rejectEasyDifficultyLte: null,
    rejectMoonMission: false,
    rejectHardHistoricalWhen: false,
    rejectTrivialAtHighDiff: false,
    retryHintSuffix: '',
    promptDiffExtraEasy: '',
    promptDiffExtraHard: '',
    ageRulesText: '',
  });

  function defineAgeLimits(overrides) {
    return Object.freeze({ ...AGE_LIMITS_BASE, ...overrides });
  }

  const AGE_LIMITS = Object.freeze({
    '6-9': defineAgeLimits({
      shortQ: ' Frase MUITO curta (máx. 110 caracteres).',
      completaYoung: ' BOM 6–9: "Completa: A água da chuva vem das ___." (nuvens) / "Completa: As plantas precisam de ___." (água). UMA frase, máx. 12 palavras antes da lacuna, resposta de 1 palavra.',
      completaOral: ' Máx. 105 caracteres no total. Máx. 12 palavras antes de ___. Resposta: 1 palavra.',
      mcYoung: ' 6–9: 4 opções CLARAMENTE diferentes — sem duplicados nem variantes da mesma personagem (Woody/Wooody/Sheriff Woody), sem erros ortográficos nas opções.',
      mcConcise: ' Opções DIRECTAS: máx. 4 palavras cada — nome, lugar ou termo curto; sem frases explicativas nem parágrafos.',
      quemEExtra: ' PARA 6–9: pergunta pelo PERSONAGEM, não pelo autor — BOM: "Quem é o menino bruxo de Harry Potter?" (Harry Potter). MAU: "Quem escreveu Harry Potter?" (J.K. Rowling). Só nomes que uma criança reconheça de imediato. Opções MC: 4 personagens DIFERENTES, sem repetir a mesma (Woody/Wooody).',
      oQueEExtra: ' PARA 6–9: pergunta curta, resposta de 1–4 palavras simples (ex.: "O que é o Natal?" → "uma festa"). Opções MC também curtas e distintas — não repitas a mesma palavra em todas (ex.: evita quatro opções que comecem por "festa de…").',
      maxCausaConsequenciaChars: 120,
      maxQuestionChars: 110,
      maxQuestionWords: 18,
      maxQuestionWordsTopic: 16,
      maxAnswerWords: 4,
      maxCompletaAnswerWords: 2,
      maxMcOptionWords: 4,
      maxMcOptionChars: 38,
      maxWordLength: 13,
      mcOptionsTooLongMsg: 'opções demasiado longas para 6–9 (máx. 4 palavras)',
      rejectDifficultyGte: 4,
      rejectEasyDifficultyLte: 2,
      rejectMoonMission: true,
      rejectHardHistoricalWhen: true,
      retryHintSuffix: ' com frases curtas e vocabulário simples',
      promptDiffExtraEasy: '\nNível muito fácil (6–9): vocabulário do dia a dia, temas reconhecíveis por crianças de 7 anos.\n',
      ageRulesText: `LIMITES RÍGIDOS (6–9 anos):
- Pergunta: máx. 110 caracteres e 18 palavras — UMA frase curta.
- Resposta: máx. 4 palavras. Temas familiares do quotidiano.
- Personagens: nomes que uma criança de 7 anos reconheça de imediato — não inventores do século XVII nem compositores clássicos com nome completo.
- ADEQUAÇÃO: só temas que uma criança de 7 anos reconheça (escola, animais, festas, desenhos animados, desporto básico). Se duvidares, simplifica.
- Tudo em português — nunca respostas só em inglês.`,
    }),
    '10-15': defineAgeLimits({
      shortQ: '',
      completaYoung: '',
      completaOral: ' Máx. 120 caracteres antes da lacuna. Máx. 14 palavras antes de ___.',
      mcYoung: '',
      mcConcise: ' Opções DIRECTAS: máx. 6 palavras cada — evita frases completas; preferir nome, data ou termo curto.',
      quemEExtra: '',
      oQueEExtra: '',
      maxCausaConsequenciaChars: 180,
      maxQuestionChars: 180,
      maxQuestionWords: 22,
      maxAnswerWordsTopic: 6,
      maxTechnicalAnswerWords: 8,
      maxMcOptionWords: 6,
      maxMcOptionChars: 52,
      mcOptionsTooLongMsg: 'opções demasiado longas para 10–15 (máx. 6 palavras) — sê mais directo',
      ageRulesText: `LIMITES (10–15 anos):
- Pergunta até 180 caracteres e 22 palavras; linguagem clara, sem parágrafos.
- Resposta e opções em português de Portugal — traduz conceitos (ex.: "Verão", não "Summer").
- ADEQUAÇÃO: dificuldade intermédia — nem infantil nem universitária. Evita teoria avançada ou nomes obscuros.
- Opções MC curtas e directas (máx. 6 palavras).`,
    }),
    '15+': defineAgeLimits({
      shortQ: '',
      completaYoung: '',
      completaOral: ' Máx. 140 caracteres antes da lacuna. Máx. 16 palavras antes de ___.',
      mcYoung: '',
      mcConcise: ' Opções de escolha múltipla curtas e directas — evita frases longas quando um nome ou termo basta.',
      quemEExtra: '',
      oQueEExtra: '',
      maxCausaConsequenciaChars: 200,
      maxQuestionChars: 240,
      maxMcOptionWords: 8,
      maxMcOptionChars: 72,
      mcOptionsTooLongMsg: 'opções demasiado longas — usa termos mais curtos',
      rejectTrivialAtHighDiff: true,
      promptDiffExtraHard: '\nNível exigente/especialista (+15): evita factos óbvios de manual escolar; prefere detalhes precisos, contexto histórico/científico e raciocínio em dois passos.\n',
      ageRulesText: 'LIMITES (+15): pergunta até 240 caracteres; exigente mas legível em voz alta. Não simplifiques demasiado.',
    }),
  });

  function getAgeLimits(ageBandKey) {
    return AGE_LIMITS[ageBandKey] || AGE_LIMITS['15+'];
  }

  function isHardHistoricalWhenQuestion(q) {
    return /\b(nasceu|nascimento|subiram|escalada|primeira\s+vez)\b/i.test(q)
      && /\b(picasso|einstein|shakespeare|beethoven|mozart|darwin|galileu|newton|everest|monte\s+everest)\b/i.test(q);
  }

  /** Registo único por categoria — editar aqui ao adicionar/alterar categorias. */
  const CATEGORIES_RAW = {
    1: {
      formats: ["RESPOSTA_DIRETA","ESCOLHA_MULTIPLA","VERDADEIRO_FALSO","QUEM_E","O_QUE_E","COMPLETA","QUANDO","ONDE_FICA"],
      rules: "Cultura geral variada. Equilíbrio entre Portugal e mundo — não assumes cultura dos EUA como padrão.",
      subtopics: ["facto geral","comparação","sequência","cultura portuguesa","mundo"],
    },
    2: {
      formats: ["RESPOSTA_DIRETA","ESCOLHA_MULTIPLA","VERDADEIRO_FALSO","ONDE_FICA","COMPLETA","QUANDO"],
      rules: "Geografia: países, capitais, rios, montanhas, continentes, monumentos. Sem imagens, mapas ou bandeiras visíveis.",
      subtopics: ["localização","capital","rio","montanha","clima","comparação geográfica"],
    },
    3: {
      formats: ["RESPOSTA_DIRETA","ESCOLHA_MULTIPLA","VERDADEIRO_FALSO","QUEM_E","COMPLETA","QUANDO","CAUSA_CONSEQUENCIA"],
      rules: "História: Portugal e mundo. Datas e personagens com precisão. Evita controvérsias sem data de referência.",
      subtopics: ["personagem","data","acontecimento","causa","consequência","sequência temporal"],
    },
    4: {
      formats: ["RESPOSTA_DIRETA","ESCOLHA_MULTIPLA","VERDADEIRO_FALSO","O_QUE_E","COMPLETA","CAUSA_CONSEQUENCIA","SITUACAO_PRATICA"],
      rules: "Ciência: física, química, biologia. Qualifica o contexto (ex.: \"animal terrestre mais rápido\").",
      subtopics: ["facto científico","causa","aplicação","experiência","previsão","situação prática"],
    },
    5: {
      formats: ["RESPOSTA_DIRETA","ESCOLHA_MULTIPLA","VERDADEIRO_FALSO","O_QUE_E","COMPLETA","CAUSA_CONSEQUENCIA","SITUACAO_PRATICA"],
      rules: "Natureza: animais, plantas, ecossistemas. Respostas objetivas e verificáveis.",
      subtopics: ["animal","planta","ecossistema","comportamento","adaptação"],
    },
    6: {
      formats: ["RESPOSTA_DIRETA","ESCOLHA_MULTIPLA","VERDADEIRO_FALSO","O_QUE_E","COMPLETA","CAUSA_CONSEQUENCIA"],
      rules: "Espaço: planetas, estrelas, missões. Sem imagens nem mapas celestes.",
      subtopics: ["planeta","estrela","missão espacial","fenómeno celeste","astronauta"],
    },
    7: {
      formats: ["RESPOSTA_DIRETA","ESCOLHA_MULTIPLA","VERDADEIRO_FALSO","COMPLETA","CAUSA_CONSEQUENCIA","SITUACAO_PRATICA"],
      rules: "Matemática e Lógica: raciocínio e aplicação prática. Calcula internamente a resposta numérica antes de devolver.",
      subtopics: ["contagem","sequência","padrão","situação prática","problema"],
      weightBoost: {"SITUACAO_PRATICA":2,"CAUSA_CONSEQUENCIA":2},
    },
    8: {
      formats: ["RESPOSTA_DIRETA","ESCOLHA_MULTIPLA","VERDADEIRO_FALSO","QUEM_E","O_QUE_E","COMPLETA","QUANDO"],
      rules: "Literatura: autores, obras, personagens. Foco literário, não biografia geográfica.",
      subtopics: ["autor","obra","personagem literário","género","expressão idiomática"],
    },
    9: {
      formats: ["RESPOSTA_DIRETA","ESCOLHA_MULTIPLA","VERDADEIRO_FALSO","O_QUE_E","COMPLETA","SITUACAO_PRATICA"],
      rules: "Português: vocabulário, gramática, ortografia, provérbios, sinónimos, antónimos, expressões portuguesas. Revisa concordância e regência (ex.: «na estante», não «no estante»).",
      subtopics: ["vocabulário","gramática","ortografia","sinónimo","provérbio"],
    },
    10: {
      formats: ["RESPOSTA_DIRETA","ESCOLHA_MULTIPLA","VERDADEIRO_FALSO","QUEM_E","O_QUE_E","COMPLETA","QUANDO"],
      rules: "Arte: artistas, obras, estilos, técnicas. SEM imagens — nunca \"que quadro é este?\".",
      subtopics: ["artista","obra","estilo","técnica","movimento artístico"],
    },
    11: {
      formats: ["RESPOSTA_DIRETA","ESCOLHA_MULTIPLA","VERDADEIRO_FALSO","QUEM_E","O_QUE_E","COMPLETA","QUANDO"],
      rules: "Cinema e Séries: realizadores, atores, filmes, personagens. Sem imagens ou clips.",
      subtopics: ["filme","série","realizador","ator","personagem"],
    },
    12: {
      formats: ["RESPOSTA_DIRETA","ESCOLHA_MULTIPLA","VERDADEIRO_FALSO","QUEM_E","O_QUE_E","COMPLETA","QUANDO"],
      rules: "Música: VARIA o foco — bandas/grupos, canções (título), álbuns, artistas, compositores, instrumentos, géneros, festivais (Eurovisão, Rock in Rio). Evita repetir sempre \"que instrumento é\". Inclui artistas portugueses quando adequado. SEM áudio — nunca \"que música é esta?\".",
      subtopics: ["banda","canção","álbum","artista","instrumento","género","festival"],
    },
    13: {
      formats: ["RESPOSTA_DIRETA","ESCOLHA_MULTIPLA","VERDADEIRO_FALSO","QUEM_E","O_QUE_E","QUANDO"],
      rules: "Moda: peças, estilos, designers, tendências, tradições vestuárias.",
      subtopics: ["peça de roupa","estilo","designer","tendência","tradição"],
    },
    14: {
      formats: ["RESPOSTA_DIRETA","ESCOLHA_MULTIPLA","VERDADEIRO_FALSO","O_QUE_E","COMPLETA","ONDE_FICA","SITUACAO_PRATICA"],
      rules: "Gastronomia: ingredientes, pratos, tradições culinárias — privilegia gastronomia portuguesa. Confirma origens geográficas (ex.: pastel de nata → Belém/Lisboa, francesinha → Porto).",
      subtopics: ["ingrediente","prato","tradição culinária","origem geográfica"],
      weightBoost: {"SITUACAO_PRATICA":1.5},
    },
    15: {
      formats: ["RESPOSTA_DIRETA","ESCOLHA_MULTIPLA","VERDADEIRO_FALSO","QUEM_E","COMPLETA","QUANDO"],
      rules: "Desporto: atletas, modalidades, regras, recordes com data ou contexto. Sem imagens. Natação em PT-PT: estilo mariposa (nunca \"estilo borboleta\"), costas, peito, crawl/estilo livre. Futebol em PT-PT: guarda-redes (nunca \"goleiro\"), defesa (nunca \"zagueiro\"), avançado (nunca \"atacante\"), remate (nunca \"chute\"), canto (nunca \"escanteio\"), relva (nunca \"gramado\"), equipa (nunca \"time\"), adeptos (nunca \"torcida\"), treinador (nunca \"técnico\"), golo (nunca \"gol\").",
      subtopics: ["modalidade","atleta","regra","recorde com data","equipa"],
    },
    16: {
      formats: ["RESPOSTA_DIRETA","ESCOLHA_MULTIPLA","VERDADEIRO_FALSO","QUEM_E","O_QUE_E","COMPLETA","QUANDO"],
      rules: "Jogos: videojogos, tabuleiro, cartas, clássicos portugueses (Sueca, Damas, Dominó, etc.).",
      subtopics: ["videojogo","jogo de tabuleiro","personagem de jogo","consola"],
    },
    17: {
      formats: ["RESPOSTA_DIRETA","ESCOLHA_MULTIPLA","VERDADEIRO_FALSO","QUEM_E","O_QUE_E","COMPLETA","QUANDO","CAUSA_CONSEQUENCIA","SITUACAO_PRATICA"],
      rules: "Tecnologia: ABRANGENTE — invenções, energia, comunicações, medicina aplicada, robótica, electrodomésticos, materiais e o digital. Computadores/software são SÓ UM dos temas (no máximo ~1 em 4 perguntas).\nVARIA: electricidade e energias (solar, eólica, hidroeléctrica, nuclear), telefone/rádio/TV/satélite, fotografia, lâmpada, frigorífico, impressão 3D, raio-X, GPS, baterias, robôs, IA, internet.\nNÃO repetir sempre PC, RAM, HTML, Windows, teclado, rato, SSD ou empresas de software.\nEvita sobrepor Transportes (carros/aviões) e Espaço (foguetões) — isso são outras categorias.\nSITUACAO_PRATICA é bem-vinda (ex.: \"para que serve um fusível?\").",
      subtopics: ["invenção","energia","comunicações","medicina aplicada","robótica","digital"],
      weightBoost: {"SITUACAO_PRATICA":1.8},
    },
    18: {
      formats: ["RESPOSTA_DIRETA","ESCOLHA_MULTIPLA","VERDADEIRO_FALSO","O_QUE_E","ONDE_FICA","QUANDO"],
      rules: "Culturas do Mundo: tradições, festividades, línguas. EVITA generalizações sobre povos. Prefere factos específicos.",
      subtopics: ["tradição","festividade","língua","costume cultural"],
    },
    19: {
      formats: ["RESPOSTA_DIRETA","ESCOLHA_MULTIPLA","VERDADEIRO_FALSO","QUEM_E","O_QUE_E","COMPLETA","QUANDO","CAUSA_CONSEQUENCIA","SITUACAO_PRATICA"],
      rules: "Transportes: veículos, energia, história, regras de circulação, situações práticas.",
      subtopics: ["veículo","infraestrutura","regra de circulação","história dos transportes"],
    },
    20: {
      formats: ["ADIVINHA","CURIOSIDADE"],
      rules: "Categoria ESPECIAL — experiência diferente do resto do jogo. ADIVINHA: charadas/adivinhas tradicionais portuguesas, tom lúdico. CURIOSIDADE: factos surpreendentes (\"Não sabia disso!\"). NÃO uses perguntas normais de cultura geral aqui.",
      subtopics: ["adivinha tradicional","curiosidade surpreendente"],
      weightBoost: {"ADIVINHA":1.6,"CURIOSIDADE":1.4},
    },
  };

  function freezeCategories(raw) {
    const registry = {};
    for (const [n, def] of Object.entries(raw)) {
      const entry = {
        formats: Object.freeze(def.formats.slice()),
        rules: def.rules,
        subtopics: Object.freeze(def.subtopics.slice()),
      };
      if (def.weightBoost) entry.weightBoost = Object.freeze({ ...def.weightBoost });
      registry[Number(n)] = Object.freeze(entry);
    }
    return Object.freeze(registry);
  }

  const CATEGORIES = freezeCategories(CATEGORIES_RAW);

  function getCategoryDef(categoryNumber) {
    return CATEGORIES[categoryNumber] || CATEGORIES[1];
  }

  function filterFormatsForContext(formats, ageBandKey, answerMode) {
    const excluded = FORMAT_AGE_EXCLUDED[ageBandKey] || [];
    let out = formats.filter((f) => !excluded.includes(f));
    if (answerMode === 'open') out = out.filter((f) => !ANSWER_MODE_MC_ONLY.has(f));
    else if (answerMode === 'mc') out = out.filter((f) => !ANSWER_MODE_OPEN_ONLY.has(f));
    return out;
  }

  function defaultFormatForAnswerMode(answerMode) {
    if (answerMode === 'open') return FORMAT_IDS.RESPOSTA_DIRETA;
    return FORMAT_IDS.ESCOLHA_MULTIPLA;
  }

  const KNOWLEDGE_STOPWORDS = new Set([
    'qual', 'quais', 'que', 'quem', 'como', 'onde', 'quando', 'porque', 'porquê',
    'o', 'a', 'os', 'as', 'um', 'uma', 'uns', 'umas', 'de', 'do', 'da', 'dos', 'das',
    'em', 'no', 'na', 'nos', 'nas', 'por', 'para', 'com', 'sem', 'sobre', 'entre',
    'ser', 'são', 'foi', 'foram', 'está', 'estão', 'mais', 'menos', 'muito', 'nome',
    'chama', 'significa', 'país', 'pais', 'cidade', 'planeta', 'verdadeiro', 'falso',
    'tipo',
  ]);

  function getLocalStorage() {
    try {
      if (typeof localStorage !== 'undefined') return localStorage;
    } catch (err) {
      warnHistoryStorage('localStorage indisponível', err);
    }
    return null;
  }

  function warnHistoryStorage(context, err) {
    try {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn(`[QuestionEngine] ${context}`, err || '');
      }
    } catch { /* ignore */ }
  }

  function buildGlobalRules() {
    return `REGRAS GLOBAIS (obrigatórias):
- Português de Portugal (PT-PT), natural e fácil de ler em voz alta — como se fosse dita num jogo de tabuleiro.
- Uma pergunta = uma coisa. Uma resposta claramente correcta (sem várias respostas defensáveis).
- Dificuldade pelo conhecimento necessário, não pelo tamanho da pergunta nem por "rasteiras".
- Sem imagem, áudio, vídeo, mapa, bandeira ou elemento externo.
- Sem "rasteiras": evita "qual NÃO é", negações múltiplas, distrações absurdas.
- Sem inventar factos. Se houver dúvida factual, não geres a pergunta.
- Evita conhecimento excessivamente obscuro — difícil não significa inútil.
- Não infantilizar crianças mais velhas; não tornar tudo óbvio para adultos em +15.
- Perguntas de atualidade indicam período (ex.: "em 2026", "no Campeonato de 2024").
- Evita ambiguidade: especifica "maior em área", "mais comprido de Portugal", etc.
- Recordes e empates: não uses construções confusas como "qual tem mais X, empatado com Y?". Diz primeiro o facto conhecido e depois pergunta quem partilha o recorde.
  BOM: "A Rússia é o país com mais fronteiras terrestres. Qual é o outro país com o mesmo número de fronteiras?"
  MAU: "Que país tem mais fronteiras terrestres, empatado com a Rússia?"
- Equilíbrio Portugal/mundo: inclui cultura portuguesa quando adequado, mas também Europa, África, Ásia, América e Oceânia.
- Evita estereótipos culturais ("os japoneses são…") — prefere tradições ou factos específicos.
- Não repitas o mesmo conhecimento de perguntas anteriores (mesmo com palavras diferentes).
- Resposta curta e inequívoca no campo "a". Não reveles a resposta na pergunta nem nas opções erradas.
- Em matemática: calcula a resposta antes de devolver — o resultado tem de ser verificável.
- ADIVINHA e CURIOSIDADE só na categoria Adivinhas e Curiosidades — não as uses noutras categorias.
- Alterna vocabulário e estrutura — evita repetir o mesmo padrão de formulação.
- COMPLETA: frase curta com a lacuna "___" só no FINAL — fácil de ler em voz alta.
- Texto 100% em caracteres latinos portugueses — nunca chinês, japonês, coreano nem outro alfabeto misturado.
- Respostas e opções em português de Portugal — nunca só em inglês (ex.: "Summer" → "Verão"; "Water" → "Água"). Nomes próprios internacionais (The Beatles, Taylor Swift) são aceites.
- Nomes de países em PT-PT: "Irão" (nunca "Irã" nem "Iran"), "Catar" (nunca "Qatar"), "Cabo Verde", "Chéquia", "Coreia do Sul", "Estados Unidos", "Reino Unido".
- Ortografia correcta: "a voar" (nunca "avoando"), "a andar", "a correr" — verbo auxiliar separado.
- Situações de física do quotidiano: especifica o referencial ("em relação a ti", "dentro do avião"). Evita "para onde cai?" sem contexto — a resposta muda conforme o observador.`;
  }

  function buildFormatRules(formatId, ctx) {
    const { ageBandKey, isMC, isTrueFalse } = ctx;
    const age = getAgeLimits(ageBandKey);
    const mcNote = isMC
      ? ' O jogador vê 4 opções — TODAS do MESMO TIPO (ex.: 4 pessoas, 4 anos, 4 materiais, 4 conceitos do tema). NUNCA mistures títulos de filmes, anos soltos, países, marcas genéricas (SpaceX, NASA) ou provérbios com nomes ou termos pedidos.'
      : ' Modo resposta aberta — resposta muito curta no campo "a".';
    const notRiddle = ' NÃO é adivinha — pergunta factual directa.';
    const rules = {
      RESPOSTA_DIRETA: `FORMATO: RESPOSTA_DIRETA — pergunta factual directa, uma frase interrogativa completa terminada em "?".${notRiddle}${mcNote}`,
      ESCOLHA_MULTIPLA: `FORMATO: ESCOLHA_MULTIPLA — pergunta para 4 opções plausíveis (1 certa + 3 erradas credíveis, nunca absurdas). Distribui a resposta correcta aleatoriamente.${notRiddle}${age.mcYoung}${age.mcConcise}${mcNote}`,
      VERDADEIRO_FALSO: `FORMATO: VERDADEIRO_FALSO — afirmação inequívoca, terminando com "Verdadeiro ou Falso?". Campo "a" = exactamente "Verdadeiro" ou "Falso".${isMC ? ' Opções: ["Verdadeiro","Falso"].' : ''}`,
      QUEM_E: `FORMATO OBRIGATÓRIO: QUEM_E — pergunta sobre uma PESSOA associada a uma obra, descoberta, acontecimento, invenção ou feito (ex.: "Quem escreveu Os Lusíadas?", "Quem pintou a Mona Lisa?"). Começa por "Quem" (nunca "Quem é quem"). Resposta = nome de pessoa (pode ser monónimo, nome artístico ou com título). NÃO perguntes por conceitos, objectos nem lugares. NÃO é adivinha.${age.quemEExtra}${age.shortQ}${age.mcYoung}${mcNote}`,
      O_QUE_E: `FORMATO OBRIGATÓRIO: O_QUE_E — pergunta sobre um CONCEITO, fenómeno, processo, objecto ou termo a definir/explicar (ex.: "O que é a fotossíntese?", "O que significa 'metáfora'?"). NÃO perguntes por pessoas — isso é QUEM_E. NÃO é adivinha.${age.oQueEExtra}${age.shortQ}${mcNote}`,
      COMPLETA: `FORMATO OBRIGATÓRIO: COMPLETA — frase curta que termina com a lacuna "___" (só no FINAL da frase). Um jogador lê a frase e o outro completa a última palavra.
Estrutura: [contexto curto] ___. — NUNCA ponhas texto depois da lacuna.
BOM: "Completa: A capital de Portugal é ___." / "Completa: A Voyager 1 atravessou a fronteira da heliosfera em 2012, chamada ___."
MAU: "Completa: A Voyager 1 atravessou a ___ em 2012." (lacuna no meio — proibido).${age.completaYoung}${age.completaOral}${mcNote}`,
      ONDE_FICA: `FORMATO: ONDE_FICA — localização com UMA resposta inequívoca, sem mapa nem imagem.
BOM: "Em que país nasce o rio Tejo?" → "Espanha" / "Em que país desagua o Tejo?" → "Portugal" / "Qual é a capital de França?" → "Paris" / "Em que continente fica o Brasil?" → "América do Sul".
MAU: "Onde fica o rio Tejo?" com opções de países (o Tejo está em Espanha e Portugal — ambíguo). MAU: "Onde fica a cordilheira dos Alpes?" sem especificar país, capital ou continente.${notRiddle}${mcNote}`,
      QUANDO: `FORMATO OBRIGATÓRIO: QUANDO — pede data, mês, ano, século ou período. Resposta temporal — nunca país, cidade ou pessoa.${notRiddle}${mcNote}`,
      CAUSA_CONSEQUENCIA: `FORMATO: CAUSA_CONSEQUENCIA — relação causa-efeito objectiva e ensinável, frase curta legível em voz alta (máx. ~200 caracteres). Evita "a consequência mais importante…".${notRiddle}${mcNote}`,
      SITUACAO_PRATICA: `FORMATO: SITUACAO_PRATICA — cenário real e curto que exige raciocínio, com UMA resposta objectiva e curta.
Em física do quotidiano, especifica o referencial: "em relação a ti", "visto de dentro do avião", "para quem está a bordo".
BOM: "Num avião a voar em linha recta a velocidade constante, largas uma moeda. Em relação a ti, cai na vertical ou afasta-se para trás?" → resposta: "Na vertical" (ou V/F).
MAU: "Para onde cai a moeda?" (ambíguo — depende se medes em relação ao chão ou ao avião). MAU: "avoando" — escreve "a voar".
Em matemática, calcula internamente a resposta.${mcNote}`,
      ADIVINHA: `FORMATO: ADIVINHA — adivinha ou charada tradicional portuguesa, tom lúdico, adequada à idade. NÃO transformes um facto directo numa adivinha forçada.
Usa "Que animal…" / "O que é…" — NÃO "Quem é o animal". A resposta tem de encaixar claramente nas pistas (ex.: instrumento batido → tambor, não bola).`,
      CURIOSIDADE: `FORMATO OBRIGATÓRIO: CURIOSIDADE — facto surpreendente em PT-PT claro, que provoque "Não sabia disso!". Frase curta e natural em voz alta.
BOM: "Sabias que os Jogos Olímpicos de Tóquio de 2020 só se realizaram em 2021 por causa da pandemia?" / "É verdade que um polvo tem três corações? Verdadeiro ou Falso?"
MAU: "Em que ano foram os Jogos Olímpicos em Tóquio?" (isso é QUANDO, não curiosidade). MAU: misturar palavras em chinês ou outro idioma (ex.: «延期») — só português.`,
    };
    return rules[formatId] || rules.RESPOSTA_DIRETA;
  }

  function buildAgeRules(ageBandKey, ageBandPromptText) {
    const { ageRulesText } = getAgeLimits(ageBandKey);
    return `IDADE E DIFICULDADE (${ageBandKey}): ${ageBandPromptText}
${ageRulesText}`;
  }

  function buildHistoryRules(ctx) {
    const parts = [];
    const {
      usedQuestions, usedFormats, usedAnswers, persistentQuestions, persistentAnswers,
      usedKnowledgeKeys, persistentKnowledgeKeys, normalizeFn,
    } = ctx;

    if (usedFormats?.length) {
      const last = usedFormats[usedFormats.length - 1];
      const consec = countConsecutiveFormat(usedFormats, last);
      parts.push(`Último formato: ${FORMAT_LABELS[last] || last}${consec >= FORMAT_MAX_CONSECUTIVE ? ' (já repetido — alterna)' : ''}. Alterna formatos — máximo ${FORMAT_MAX_CONSECUTIVE} seguidos iguais.`);
    }
    if (usedQuestions?.length) {
      parts.push(`NÃO repitas estas perguntas: ${usedQuestions.slice(-10).join(' | ')}.`);
    }
    const knowledgeAnswers = filterKnowledgeAnswers(usedAnswers, normalizeFn);
    if (knowledgeAnswers.length) {
      parts.push(`Evita testar o mesmo conhecimento destas respostas: ${knowledgeAnswers.slice(-8).join(', ')}.`);
    }
    const recentKeys = (usedKnowledgeKeys || []).slice(-8);
    const persistentKeys = (persistentKnowledgeKeys || []).slice(-8);
    const allKeys = [...new Set([...recentKeys, ...persistentKeys])].slice(-12);
    if (allKeys.length) {
      parts.push(`NÃO repitas este conhecimento (knowledgeKey): ${allKeys.join(' | ')}.`);
    }
    if (persistentQuestions?.length) {
      parts.push('Evita reformular perguntas de sessões anteriores.');
    }
    const persistentKnowledgeAnswers = filterKnowledgeAnswers(persistentAnswers, normalizeFn);
    if (persistentKnowledgeAnswers.length) {
      parts.push(`Respostas recentes de sessões anteriores a evitar: ${persistentKnowledgeAnswers.slice(-8).join(', ')}.`);
    }
    return parts.length ? `HISTÓRICO E VARIEDADE:\n${parts.join('\n')}` : '';
  }

  function countConsecutiveFormat(recent, formatId) {
    let n = 0;
    for (let i = recent.length - 1; i >= 0; i--) {
      if (recent[i] === formatId) n++;
      else break;
    }
    return n;
  }

  function fisherYates(arr) {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  function chooseDifficulty(ageBandKey, recentDifficulties) {
    const range = DIFFICULTY_RANGE[ageBandKey] || DIFFICULTY_RANGE['15+'];
    const recent = (recentDifficulties || []).filter((d) => d >= range.min && d <= range.max);
    const avg = recent.length
      ? recent.reduce((s, d) => s + d, 0) / recent.length
      : (range.min + range.max) / 2;
    let target = Math.round(avg);
    if (Math.random() < 0.45) target += Math.random() < 0.5 ? -1 : 1;
    return Math.min(range.max, Math.max(range.min, target));
  }

  function chooseSubtopic(categoryNumber, recentSubtopics) {
    const pool = getCategoryDef(categoryNumber).subtopics;
    const recent = new Set(recentSubtopics || []);
    const fresh = pool.filter((t) => !recent.has(t));
    const pickFrom = fresh.length ? fresh : pool;
    return pickFrom[Math.floor(Math.random() * pickFrom.length)];
  }

  function stripTagsInternal(text) {
    return String(text || '').replace(/<[^>]*>/g, '').trim();
  }

  function computeKnowledgeKey(q, a, formatId, normalizeFn, opts) {
    const options = opts && typeof opts === 'object' ? opts : {};
    const knowledgeMeta = options.knowledgeMeta || options.knowledge || null;
    const categoryNumber = options.categoryNumber;
    if (knowledgeMeta?.entity && knowledgeMeta?.concept) {
      const structured = KnowledgeKey.buildStructuredKey(knowledgeMeta, categoryNumber, normalizeFn);
      if (structured) return structured;
    }
    const norm = normalizeFn || ((s) => String(s || '').trim().toLowerCase());
    const answer = stripTagsInternal(a || '').trim();
    const question = stripFormatLabel(stripTagsInternal(q || '').trim());
    if (isGenericTrueFalseAnswer(answer, norm)) {
      const statement = stripTrueFalsePromptSuffix(question);
      return norm(statement).slice(0, 80);
    }
    const answerKey = norm(answer).replace(/\s+/g, ' ').trim();
    const aTokens = tokenize(answer).filter((w) => !KNOWLEDGE_STOPWORDS.has(w));

    if (/\bcapital\b/i.test(question) && aTokens.length <= 3) {
      return `capital ${answerKey}`;
    }
    if (/\b(planeta|rio|montanha|oceano|país|pais)\b/i.test(question) && aTokens.length <= 3) {
      return `${aTokens[0] || answerKey} ${tokenize(question).filter((w) => !KNOWLEDGE_STOPWORDS.has(w)).slice(0, 2).join(' ')}`.trim();
    }
    if (aTokens.length <= 2 && answerKey.length >= 3) {
      return answerKey;
    }

    const qTokens = tokenize(question).filter((w) => !KNOWLEDGE_STOPWORDS.has(w));
    const core = [...new Set([...aTokens, ...qTokens.slice(0, 3)])].slice(0, 5).join(' ');
    return core || answerKey || norm(question).slice(0, 60);
  }

  function knowledgeKeysMatch(keyA, keyB, normalizeFn) {
    return KnowledgeKey.knowledgeKeysMatch(
      keyA,
      keyB,
      normalizeFn,
      jaccardSimilarity,
      ENGINE_CONFIG.KNOWLEDGE_JACCARD_THRESHOLD,
    );
  }

  function resolveMcPositionHistory(mcPositionHistory) {
    return Array.isArray(mcPositionHistory) ? mcPositionHistory : null;
  }

  function recordMcAnswerPosition(positionIndex, mcPositionHistory) {
    if (typeof positionIndex !== 'number' || positionIndex < 0) return;
    const history = resolveMcPositionHistory(mcPositionHistory);
    if (!history) return;
    history.push(positionIndex);
    if (history.length > 24) history.shift();
  }

  function resetMcPositions(mcPositionHistory) {
    const history = resolveMcPositionHistory(mcPositionHistory);
    if (history) history.length = 0;
  }

  function assembleMcOptions(correctAnswer, distractors) {
    const correct = String(correctAnswer || '').trim();
    const wrong = (Array.isArray(distractors) ? distractors : [])
      .map((d) => String(d || '').trim())
      .filter((d) => d && d.toLowerCase() !== correct.toLowerCase())
      .slice(0, 3);
    if (wrong.length < 3) return null;
    return fisherYates([correct, ...wrong]);
  }

  function shuffleMcOptions(options, correctAnswer, normalizeFn, mcPositionHistory) {
    if (!Array.isArray(options) || options.length < 2) return options;
    const norm = normalizeFn || ((s) => String(s || '').trim().toLowerCase());
    const correct = norm(correctAnswer);
    const shuffled = fisherYates(options.slice());
    let pos = shuffled.findIndex((o) => norm(o) === correct);
    if (pos < 0) return shuffled;

    const history = resolveMcPositionHistory(mcPositionHistory);
    const slotCount = Math.min(4, shuffled.length);
    if (history) {
      const posCounts = Array.from({ length: slotCount }, () => 0);
      history.forEach((p) => { if (p >= 0 && p < slotCount) posCounts[p] += 1; });
      const minCount = Math.min(...posCounts);
      const targetCandidates = posCounts
        .map((c, i) => (c === minCount ? i : -1))
        .filter((i) => i >= 0);
      const targetPos = targetCandidates[Math.floor(Math.random() * targetCandidates.length)];
      if (targetPos !== pos) {
        [shuffled[pos], shuffled[targetPos]] = [shuffled[targetPos], shuffled[pos]];
        pos = targetPos;
      }
      recordMcAnswerPosition(pos, history);
    }
    return shuffled;
  }

  function getAllowedFormats(categoryNumber, ageBandKey, answerMode) {
    const primary = filterFormatsForContext(getCategoryDef(categoryNumber).formats.slice(), ageBandKey, answerMode);
    if (primary.length) return primary;
    return filterFormatsForContext(getCategoryDef(1).formats.slice(), ageBandKey, answerMode);
  }

  function weightedPick(items, weights) {
    const total = weights.reduce((s, w) => s + w, 0);
    let r = Math.random() * total;
    for (let i = 0; i < items.length; i++) {
      r -= weights[i];
      if (r <= 0) return items[i];
    }
    return items[items.length - 1];
  }

  function chooseFormat(categoryNumber, ageBandKey, answerMode, recentFormats) {
    const allowed = getAllowedFormats(categoryNumber, ageBandKey, answerMode);
    if (!allowed.length) return defaultFormatForAnswerMode(answerMode);

    const recent = recentFormats || [];
    const vfRecentlyUsed = recent.slice(-TRUE_FALSE_MIN_GAP).includes(FORMAT_IDS.VERDADEIRO_FALSO);

    if (allowed.includes(FORMAT_IDS.VERDADEIRO_FALSO) && !vfRecentlyUsed && Math.random() < TRUE_FALSE_CHANCE) {
      return FORMAT_IDS.VERDADEIRO_FALSO;
    }

    let pool = allowed.filter((f) => {
      if (f === FORMAT_IDS.VERDADEIRO_FALSO && vfRecentlyUsed) return false;
      if (countConsecutiveFormat(recent, f) >= FORMAT_MAX_CONSECUTIVE) return false;
      return true;
    });
    if (!pool.length) {
      pool = allowed.filter((f) => countConsecutiveFormat(recent, f) < FORMAT_MAX_CONSECUTIVE + 1);
    }
    if (!pool.length) pool = allowed.slice();

    const last = recent[recent.length - 1];
    if (last) {
      const withoutLast = pool.filter((f) => f !== last);
      if (withoutLast.length) pool = withoutLast;
    }
    if (pool.length > 1 && recent.length >= 2) {
      const prev2 = new Set(recent.slice(-2));
      const withoutPrev2 = pool.filter((f) => !prev2.has(f));
      if (withoutPrev2.length) pool = withoutPrev2;
    }

    const boost = getCategoryDef(categoryNumber).weightBoost || {};
    const weights = pool.map((f) => {
      const recentCount = (recent || []).filter((r) => r === f).length;
      return (boost[f] || 1) / (1 + recentCount * 0.4);
    });
    return weightedPick(pool, weights);
  }

  /**
   * Contexto partilhado por buildPrompt, scoreQuestion e validateQuestion.
   * Campos principais: formatId, ageBandKey, categoryNumber, isMC, difficulty,
   * stripTags, normalizeFn, usedQuestions, usedAnswers, usedKnowledgeKeys,
   * persistentQuestions, persistentAnswers, recentFormats, recentDifficulties,
   * recentSubtopics, answerMode, category, ageBandPromptText, helpers.
   */
  function buildPrompt(ctx) {
    const {
      category, ageBandKey, ageBandPromptText, formatId, ptPtRules, isMC, isTrueFalse,
      usedQuestions, usedFormats, usedAnswers, persistentQuestions, persistentAnswers,
      usedKnowledgeKeys, persistentKnowledgeKeys,
      ageDifficultyExtra, openModeExtra, mcInstruction, jsonFormat,
      difficulty, subtopic, retryHint,
    } = ctx;

    const formatLabel = FORMAT_LABELS[formatId] || formatId;
    const diff = difficulty || chooseDifficulty(ageBandKey, ctx.recentDifficulties);
    const diffLabel = DIFFICULTY_LABELS[diff] || 'médio';
    const sub = subtopic || chooseSubtopic(category?.n || 1, ctx.recentSubtopics);
    const retryBlock = (retryHint || ctx.formatRetryHint)
      ? `\n${retryHint || ctx.formatRetryHint}\n`
      : '';
    const musicFocusBlock = ctx.category?.n === 12
      ? `\nFOCO DESTA RODADA (Música): ${pickMusicFocus()}. Alterna entre bandas, canções, álbuns, artistas, instrumentos e géneros — não repitas sempre o mesmo tipo.\n`
      : '';
    const techFocusBlock = ctx.category?.n === 17
      ? `\nFOCO DESTA RODADA (Tecnologia): ${pickTechFocus()}. NÃO faças a pergunta sobre computadores, programação, RAM, HTML ou sistemas operativos a menos que o foco desta ronda seja o digital.\n`
      : '';
    const lim = getAgeLimits(ageBandKey);
    const diffExtra = (lim.promptDiffExtraHard && diff >= 4)
      ? lim.promptDiffExtraHard
      : (lim.promptDiffExtraEasy && diff <= 2 ? lim.promptDiffExtraEasy : '');

    return `Cria UMA pergunta de trivia EXCLUSIVAMENTE sobre a categoria "${category.name}" (${category.desc}), para ${ageBandPromptText}.

FORMATO OBRIGATÓRIO DESTA RODADA: ${formatLabel} (${formatId}) — não uses outro tipo de pergunta.
SUBTÓPICO DESTA RODADA: ${sub} — a pergunta deve reflectir este subtipo dentro da categoria.
DIFICULDADE: ${diff}/5 (${diffLabel}) — adequada à faixa etária.
${retryBlock}${musicFocusBlock}${techFocusBlock}${diffExtra}
${buildGlobalRules()}

REGRAS DA CATEGORIA:
${getCategoryDef(category.n).rules}

${buildFormatRules(formatId, { ageBandKey, isMC, isTrueFalse })}

${buildAgeRules(ageBandKey, ageBandPromptText)}
${ageDifficultyExtra || ''}

A pergunta tem de depender directamente da categoria indicada. Não mudes de tema nem de categoria.
${ptPtRules}

${buildHistoryRules({
  usedQuestions, usedFormats, usedAnswers, persistentQuestions, persistentAnswers,
  usedKnowledgeKeys, persistentKnowledgeKeys, normalizeFn: ctx.normalizeFn,
})}

${openModeExtra || ''}
${mcInstruction || ''}

Só json válido, sem markdown: ${jsonFormat}`;
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

  function jaccardSimilarity(a, b) {
    const sa = new Set(tokenize(a));
    const sb = new Set(tokenize(b));
    if (!sa.size || !sb.size) return 0;
    let inter = 0;
    for (const w of sa) if (sb.has(w)) inter++;
    return inter / (sa.size + sb.size - inter);
  }

  function stripTrueFalsePromptSuffix(q) {
    return String(q || '')
      .replace(/\s*\.?\s*verdadeiro\s+ou\s+falso\s*\??\s*$/i, '')
      .trim();
  }

  function normalizeForRepetitionCheck(q, formatId) {
    const body = stripFormatLabel(stripTagsInternal(q || ''));
    if (formatId === FORMAT_IDS.VERDADEIRO_FALSO) {
      return stripTrueFalsePromptSuffix(body);
    }
    return body;
  }

  function normalizeKnowledgeKeyForMatch(key, normalizeFn) {
    const norm = normalizeFn || ((s) => String(s || '').trim().toLowerCase());
    return norm(stripTrueFalsePromptSuffix(norm(key)));
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

  function hasInvalidScript(text) {
    const t = String(text || '');
    if (RE_CJK.test(t)) return true;
    if (RE_CYRILLIC.test(t)) return true;
    if (RE_ARABIC.test(t)) return true;
    if (RE_MIXED_LATIN_CJK.test(t)) return true;
    return false;
  }

  const MUSIC_FOCUS_AREAS = [
    'uma BANDA ou GRUPO musical (nacional ou internacional)',
    'uma CANÇÃO ou MÚSICA concreta (título)',
    'um ÁLBUM musical',
    'um ARTISTA ou COMPOSITOR',
    'um INSTRUMENTO musical',
    'um GÉNERO musical',
    'um FESTIVAL ou prémio musical (ex.: Eurovisão)',
  ];

  const TECH_FOCUS_AREAS = [
    'uma INVENÇÃO do quotidiano (lâmpada, telefone, frigorífico, relógio, máquina de lavar)',
    'ENERGIA (solar, eólica, hidroeléctrica, nuclear, pilhas, electricidade)',
    'COMUNICAÇÕES (rádio, televisão, satélite, telefone, fibra óptica) — não software',
    'TECNOLOGIA MÉDICA (raio-X, vacina, desfibrilhador, termómetro, ressonância)',
    'ROBÓTICA ou AUTOMAÇÃO (robôs, drones, electrodomésticos inteligentes)',
    'MATERIAIS ou FABRICO (plástico, aço, impressão 3D, vidro, papel)',
    'o DIGITAL (internet, IA, telemóvel, GPS) — só nesta ronda; pergunta curta e de cultura geral, não de informática avançada',
  ];

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

  function pickMusicFocus() {
    return MUSIC_FOCUS_AREAS[Math.floor(Math.random() * MUSIC_FOCUS_AREAS.length)];
  }

  function pickTechFocus() {
    return TECH_FOCUS_AREAS[Math.floor(Math.random() * TECH_FOCUS_AREAS.length)];
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

  function validateCuriosidade(q) {
    const issues = [];
    const body = stripFormatLabel(q);
    const surpriseFrame = /\b(sabias que|sabias|é verdade que|curiosamente|surpreendentemente|incrível|poucas pessoas sabem)\b/i.test(body)
      || /verdadeiro\s+ou\s+falso/i.test(body);

    if (/^em que ano\b|^qual é o ano\b|^em que ano foram\b|^quando foram realizados\b/i.test(body) && !surpriseFrame) {
      issues.push('CURIOSIDADE não deve ser pergunta simples de ano/data');
    }
    if (/^em que (país|cidade|continente)\b/i.test(body) && !surpriseFrame) {
      issues.push('CURIOSIDADE não deve ser pergunta geográfica banal');
    }
    if (body.length > 200) issues.push('CURIOSIDADE demasiado longa para ler em voz alta');
    return issues;
  }

  function hasCulturalStereotype(q) {
    return /\b(os|as)\s+(portugueses|portuguesas|japoneses|japonesas|chineses|chinesas|franceses|francesas|alemães|alemãs|alemoes|alemas|italianos|italianas|brasileiros|brasileiras|ingleses|britânicos|britânicas|árabes|africanos|africanas|americanos|americanas|homens|mulheres|crianças|miúdos|miúdas|rapazes|raparigas)\s+são\b/i.test(q)
      || /\btodos\s+os\s+(portugueses|japoneses|franceses|alemães|homens|mulheres|crianças|miúdos)\s+(gostam|são|fazem)\b/i.test(q);
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
      issues.push('COMPLETA: a lacuna deve ficar no final da frase (sem texto depois)');
    }

    const body = q.replace(/^completa:\s*/i, '').trim();
    if (!/_{2,}\s*[.?!…]?\s*$|…\s*[.?!…]?\s*$|\.{3}\s*[.?!…]?\s*$/i.test(body)) {
      issues.push('COMPLETA: a lacuna tem de ser a última parte da frase');
    }

    const before = q.slice(0, blank.index).replace(/^completa:\s*/i, '').trim();
    const beforeWords = before.split(/\s+/).filter(Boolean).length;
    if (q.length > lim.total) issues.push('COMPLETA demasiado longa para ler em voz alta');
    if (beforeWords > lim.before) issues.push('COMPLETA: demasiado texto antes da lacuna');

    return issues;
  }

  function validateSituationPractical(q) {
    const issues = [];
    const motion = /\b(avião|aviao|comboio|autocarro|carro|elevador|barco)\b.*\b(a voar|voar|and|corre|move)\b/i.test(q)
      || /\b(largas?|deixas?\s+cair|soltas?)\b.*\b(moeda|bola|objecto|objeto)\b/i.test(q);
    const vagueWhere = /\bpara onde\b.*\b(cai|cair|vai|ir)\b/i.test(q);
    const hasFrame = /\bem relação\b|\brelativamente\b|\bcontigo\b|\ba bordo\b|\bdentro do\b|\bvisto de dentro\b|\bpara ti\b/i.test(q);
    if (motion && vagueWhere && !hasFrame) {
      issues.push('situação prática ambígua — especifica o referencial (ex.: "em relação a ti")');
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
      issues.push('ONDE_FICA ambíguo — especifica país de origem, desagua, capital ou continente');
    }
    if (countryishOptions && vague && multiPlaceFeature && !specific) {
      issues.push('ONDE_FICA com países/continentes exige localização inequívoca');
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
      pushIssue(issues, 'ADIVINHA_WEAK_RIDDLE', ISSUE_LAYER.format, 'ADIVINHA: charada fraca — a resposta não encaixa bem nas pistas');
    }
    if (/\b(faz|fazem)\s+barulho\b/i.test(q) && /\bcorre\b/i.test(q) && /\b(cala|calou)\b/i.test(q)) {
      if (/\b(cavalo|cabra|vaca|ovelha|carneiro|porco|rato)\b/i.test(a) && !/\b(apito|pião|piao|flauta|corneta|reco-reco)\b/i.test(a)) {
        pushIssue(issues, 'ADIVINHA_WHISTLE_RIDDLE', ISSUE_LAYER.format, 'ADIVINHA: charada clássica do apito — a resposta não deve ser um animal');
      }
    }
    return issues;
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
      issues.push('opções parecem respostas de perguntas diferentes — todas devem ser do mesmo tipo');
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

  /** Factos reportados — ver question-engine/known-facts.js */
  function runReportedFactRules(q, a, options, formatId) {
    return KnownFacts.runReportedFactRules(q, a, options, formatId, mkIssue);
  }
  const CONFUSING_FACT_PREFIXES = ['pergunta confusa', 'formulação', 'resposta ambígua — asfalto', 'pergunta circular'];

  function isConfusingFactIssue(issue) {
    const code = issueCode(issue);
    if (code && KnownFacts.CONFUSING_FACT_CODES.has(code)) return true;
    return CONFUSING_FACT_PREFIXES.some((prefix) => issueMessage(issue).startsWith(prefix));
  }

  function validateCategoryTopicFit(q, categoryN, ageBandKey) {
    const issues = [];
    const lim = getAgeLimits(ageBandKey);
    if (categoryN === 2 && /\b(homem|pessoa|astronauta).{0,40}\blua\b|\bprimeira\s+vez.{0,30}\blua\b|\bprimeiro\s+homem\b.*\blua\b/i.test(q)) {
      pushCategoryMismatch(issues, 'missão à Lua é Espaço/História, não Geografia');
    }
    if (categoryN === 17) {
      if (RE_TECH_TRANSPORT.test(q)) {
        pushCategoryMismatch(issues, 'veículos/transportes são Categoria 19 (Transportes), não Tecnologia');
      }
      if (RE_TECH_SPACE.test(q)) {
        pushCategoryMismatch(issues, 'espaço/foguetões são Categoria 6 (Espaço), não Tecnologia');
      }
    }
    if (lim.rejectMoonMission && /\b(homem|pessoa).{0,25}\blua\b|\bfoi\s+à\s+lua\b/i.test(q)) {
      pushAgeHardIssue(issues, 'missão à Lua demasiado avançada para 6–9');
    }
    if (categoryN === 5 && /\b(solidifica[çc][ãa]o|congelamento|fundir|derreter|evapora[çc][ãa]o|estados?\s+(f[íi]sicos?|da\s+mat[ée]ria)|l[íi]quido\s+ao\s+s[óo]lido)\b/i.test(q)) {
      pushCategoryMismatch(issues, 'fenómenos físicos da água/matéria são Ciência (4), não Natureza (5)');
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

  function validateObscureCharacter(q, a, ageBandKey) {
    const issues = [];
    if (ageBandKey !== '6-9') return issues;
    if (/\b(cinderela|cinderella)\b/i.test(q) && /\b(rato|ratos)\b/i.test(q)) {
      if (/\b(jaquim|jaq|gus|névoa|nevoa)\b/i.test(a)) {
        issues.push('personagem secundário obscuro para 6–9 — usa personagens principais');
      }
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

  function hasNearDuplicateMcOptions(options) {
    const keys = (options || []).map((o) => optionDedupeKey(o));
    if (new Set(keys).size !== keys.length) return true;
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        const a = keys[i];
        const b = keys[j];
        if (!a || !b || a === b) return true;
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

  function validateYoungAgeContent(q, a, options, formatId) {
    const issues = [];
    const blob = [q, a, ...(options || [])].join(' ');
    const obscurePeople = /\b(cristofori|bartolomeo|johann|sebastian|wolfgang|amadeus|ludwig|beethoven|bach|mozart|chopin|verdi|puccini|galileu|copérnico|copernico|arquimedes|pitágoras|pitagoras|darwin|pasteur|faraday)\b/i;
    if (obscurePeople.test(blob)) {
      issues.push('personagem ou tema demasiado avançado para 6–9');
    }
    if (/quem\s+(é|e)\s+quem\b/i.test(q)) {
      issues.push('formulação incorrecta — evita "Quem é quem"');
    }
    if (formatId === FORMAT_IDS.QUEM_E && /\b(inventou|criou|descobriu)\s+o\s+(piano|violino|gramofone|telefone)\b/i.test(q)) {
      issues.push('inventor de instrumento demasiado avançado para 6–9');
    }
    if (formatId === FORMAT_IDS.QUEM_E && /\b(escreveu|escreve|autor|autora)\b/i.test(q)) {
      issues.push('para 6–9 prefere personagem, não autor (ex.: "Quem é o menino de Harry Potter?")');
    }
    if (formatId === FORMAT_IDS.QUEM_E && (/^[A-Z]\.[A-Z]\./.test(a.trim()) || /\b[A-Z]\.[A-Z]\.\s/.test(a))) {
      issues.push('nome com iniciais difícil para 6–9 (ex.: evita "J.K. Rowling")');
    }
    if (formatId === FORMAT_IDS.QUEM_E) {
      const answerWords = a.split(/\s+/).filter(Boolean);
      if (answerWords.length >= 3) {
        issues.push('nome de pessoa demasiado longo para 6–9 (máx. 2 palavras)');
      }
    }
    if (formatId === FORMAT_IDS.QUANDO && /\b(playstation|ps\s*one|ps1|xbox|mega\s*drive|super\s*nintendo|nintendo\s*64)\b/i.test(blob)) {
      issues.push('data de lançamento de consola demasiado difícil para 6–9');
    }
    if (/\b(bob\s+marley|reggae)\b/i.test(blob)) {
      issues.push('artista ou género musical demasiado avançado para 6–9');
    }
    if (formatId === FORMAT_IDS.O_QUE_E && q.length > 95) {
      issues.push('pergunta O que é demasiado longa para 6–9');
    }
    if (options?.length) {
      const strip = (t) => String(t || '').replace(/<[^>]*>/g, '').trim();
      issues.push(...validateMcOptionsQuality(options, strip, collapseOptionKey, '6-9'));
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

    if (formatId === FORMAT_IDS.CURIOSIDADE && /verdadeiro\s+ou\s+falso/i.test(q)) {
      const vf = validateTrueFalseQuestion(parsed);
      if (!vf.ok) return vf;
    }

    if (formatId === FORMAT_IDS.QUEM_E) {
      if (!/^quem\b/i.test(q) && !/qual\s+(é|e)\s+o\s+nome\b/i.test(q)) {
        issues.push('QUEM_E deve começar por "Quem"');
      }
      if (/quem\s+(é|e)\s+quem\b/i.test(q)) issues.push('QUEM_E: evita "Quem é quem"');
      if (/^o\s+que\s+(é|e)\b/i.test(q)) issues.push('QUEM_E não deve usar "O que é"');
      if (isObviouslyNotAPerson(a)) issues.push('QUEM_E: resposta deve ser uma pessoa');
      if (/\b(a|uma)\s+(engenheira|actriz|atriz|inventora|escritora|diretora|realizadora)\b/i.test(q)
        && /\b(dario|martin|james|john|robert|leonardo|quentin|stanley|heath|elon|ray|hiroshi)\b/i.test(a.toLowerCase())) {
        issues.push('inconsistência de género — a pergunta pede uma mulher mas a resposta é um nome masculino');
      }
    }

    if (formatId === FORMAT_IDS.O_QUE_E) {
      if (!/^o\s+que\b|^que\s+significa\b|^qual\s+é\s+o\s+(termo|significado|nome do)\b/i.test(q)) {
        issues.push('O_QUE_E deve perguntar por conceito/termo/fenómeno');
      }
      if (/^quem\b/i.test(q)) issues.push('O_QUE_E não deve perguntar por pessoa');
    }

    if (formatId === FORMAT_IDS.COMPLETA) {
      if (!/_{2,}|…|\.{3}|completa|falta/i.test(q)) {
        issues.push('COMPLETA deve ter lacuna visível');
      } else {
        issues.push(...validateCompletaOral(q, ageBandKey || '15+'));
      }
    }

    if (formatId === FORMAT_IDS.ONDE_FICA) {
      if (!/\bonde\b|\bem\s+que\s+(país|cidade|continente|região|regiao)\b/i.test(q)) {
        issues.push('ONDE_FICA deve perguntar por localização');
      }
      issues.push(...validateOndeFica(q, parsed?.options, stripTags));
    }

    if (formatId === FORMAT_IDS.QUANDO && !looksLikeWhenQuestion(q, a)) {
      issues.push('QUANDO deve pedir tempo/data/período');
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
    }

    if (formatId === FORMAT_IDS.CURIOSIDADE) {
      issues.push(...validateCuriosidade(q));
    }

    if (formatId === FORMAT_IDS.CAUSA_CONSEQUENCIA) {
      const maxQ = getAgeLimits(ageBandKey).maxCausaConsequenciaChars;
      if (q.length > maxQ) issues.push('pergunta CAUSA_CONSEQUENCIA demasiado longa para ler em voz alta');
    }

    if (formatId === FORMAT_IDS.SITUACAO_PRATICA) {
      issues.push(...validateSituationPractical(q));
    }

    if ((formatId === FORMAT_IDS.RESPOSTA_DIRETA || formatId === FORMAT_IDS.ESCOLHA_MULTIPLA)) {
      if (q.includes('→') || q.includes('->')) issues.push('sem setas de associação');
      if (/qual\s+destes.*\bnão\b/i.test(q)) issues.push('evitar "qual não é"');
    }

    if (/\bqual\s+destas\s+afirmações\s+não\s+é\s+incorreta\b/i.test(q)) {
      issues.push('negação múltipla');
    }

    return { ok: !issues.length, issues };
  }

  function validateAgeAppropriate(parsed, ageBandKey, stripTags, formatId) {
    const q = stripTags(parsed?.q || '').trim();
    const a = stripTags(parsed?.a || '').trim();
    const options = Array.isArray(parsed?.options) ? parsed.options : [];
    const blob = (q + ' ' + a + ' ' + options.join(' ')).toLowerCase();
    const issues = [];
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

  function validateDifficultyFit(difficulty, ageBandKey, q) {
    const issues = [];
    const lim = getAgeLimits(ageBandKey);
    const range = DIFFICULTY_RANGE[ageBandKey] || DIFFICULTY_RANGE['15+'];
    const diff = Number(difficulty) || range.min;
    if (diff < range.min || diff > range.max) {
      pushIssue(issues, 'DIFFICULTY_OUT_OF_RANGE', ISSUE_LAYER.difficulty, `dificuldade ${diff} incompatível com faixa ${ageBandKey}`);
    }
    if (lim.rejectDifficultyGte != null && diff >= lim.rejectDifficultyGte) {
      pushAgeHardIssue(issues, 'demasiado difícil para 6–9');
    }
    if (lim.rejectTrivialAtHighDiff && diff >= 4) {
      const tooEasy = /\b(planeta onde vivemos|cor do céu|quantos dedos|quantas pernas tem um cão)\b/i;
      if (tooEasy.test(q)) pushIssue(issues, 'AGE_TOO_EASY', ISSUE_LAYER.difficulty, 'demasiado fácil para +15 nível exigente');
    }
    if (lim.rejectEasyDifficultyLte != null && diff <= lim.rejectEasyDifficultyLte) {
      const tooHard = /\b(teorema|algoritmo|revolução industrial|segunda guerra)\b/i;
      if (tooHard.test(q)) pushAgeHardIssue(issues, 'demasiado difícil para 6–9');
    }
    return issues;
  }

  function validateFactualConsistency(q, a) {
    return runReportedFactRules(q, a, [], null)
      .filter((i) => !isConfusingFactIssue(i) && !issueMessage(i).startsWith('pergunta ambígua'));
  }

  function shouldRequestFactualVerify(ctx) {
    return FactualVerify.shouldRequestFactualVerify(ctx);
  }

  function buildFactualVerifyPrompt(parsed, ctx) {
    return FactualVerify.buildFactualVerifyPrompt(parsed, ctx);
  }

  function parseFactualVerifyResponse(text) {
    return FactualVerify.parseFactualVerifyResponse(text);
  }

  function buildRetryHint(issues, formatId, ageBandKey) {
    return buildRetryHintFromIssues(issues, formatId, ageBandKey, { FORMAT_LABELS, getAgeLimits });
  }

  function buildAdaptiveRetryHint(issues, formatId, ageBandKey, attempt, opts) {
    return Retry.buildAdaptiveRetryHint(issues, formatId, ageBandKey, attempt, {
      FORMAT_LABELS,
      getAgeLimits,
      issueDetails: opts?.issueDetails,
    });
  }

  function shouldRotateSubtopicForRetry(issueDetails, attempt) {
    return Retry.shouldRotateSubtopic(issueDetails, attempt);
  }

  function recordGenerationTelemetry(event) {
    return Telemetry.recordGenerationEvent(event);
  }

  function getGenerationTelemetrySummary() {
    return Telemetry.getTelemetrySummary();
  }

  function clearGenerationTelemetry() {
    return Telemetry.clearTelemetry();
  }

  function collectPtPtIssues(q, a, options, ageBandKey) {
    const blob = [q, a, ...options].join(' ');
    return [
      ...validatePortugueseText(blob),
      ...validateCountryNamesPt(blob),
      ...validatePortugueseNotEnglish([q, a, ...options], ageBandKey),
    ];
  }

  function collectSemanticIssues(parsed, ctx) {
    const {
      ageBandKey, stripTags, normalizeFn, formatId, isMC,
    } = ctx;
    const q = stripTags(parsed?.q || '').trim();
    const a = stripTags(parsed?.a || '').trim();
    const options = Array.isArray(parsed?.options) ? parsed.options : [];
    const issues = runReportedFactRules(q, a, options, formatId);
    issues.push(...validateObscureCharacter(q, a, ageBandKey));

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
      ...validateMcTrivialMath(q, options, a, stripTags),
      ...validateMcOptionsQuality(options, stripTags, collapseOptionKey, ageBandKey),
      ...validateDisneyCharacterAliases(options, a),
      ...validateAdivinhaMcAmbiguity(q, a, options, stripTags, formatId),
    ];
    if (options.length === 4) {
      issues.push(...validateMcOptionsCoherence(q, options, stripTags));
      const absurd = /^(banana|futebol|azul|verde|vermelho|nada|qualquer|abc|xyz|123|nenhum|desconhecido)$/i;
      const wrong = options.filter((o) => stripTags(o).trim().toLowerCase() !== a.toLowerCase());
      if (wrong.filter((o) => absurd.test(stripTags(o).trim())).length >= 2) {
        pushIssue(issues, 'MC_ABSURD_DISTRACTORS', ISSUE_LAYER.mcOptions, 'distratores demasiado absurdos');
      }
      const qTokens = new Set(tokenize(q));
      for (const opt of wrong) {
        const ot = tokenize(opt);
        if (ot.length >= 2 && ot.every((w) => qTokens.has(w))) {
          pushIssue(issues, 'MC_OPTION_LEAKS_QUESTION', ISSUE_LAYER.mcOptions, 'opção errada contém pista da pergunta');
          break;
        }
      }
    }
    return issues;
  }

  function collectRepetitionIssues(q, a, formatId, ctx, normalizeFn) {
    const issues = [];
    const knowledgeMeta = ctx.knowledgeMeta || KnowledgeKey.parseKnowledgeMeta(ctx.parsed) || null;
    const keyOpts = {
      knowledgeMeta,
      categoryNumber: ctx.categoryNumber,
    };
    const knowledgeKey = ctx.knowledgeKey || computeKnowledgeKey(q, a, formatId, normalizeFn, keyOpts);
    const recentKeys = [...(ctx.usedKnowledgeKeys || []), ...(ctx.persistentKnowledgeKeys || [])];
    if (recentKeys.some((k) => knowledgeKeysMatch(k, knowledgeKey, normalizeFn))) {
      pushIssue(issues, 'KNOWLEDGE_REPEATED', ISSUE_LAYER.repetition, 'conhecimento já testado recentemente (knowledgeKey)');
    }
    for (const prev of (ctx.usedQuestions || []).slice(-8)) {
      const qNorm = normalizeForRepetitionCheck(q, formatId);
      const prevNorm = normalizeForRepetitionCheck(prev, formatId);
      if (jaccardSimilarity(qNorm, prevNorm) >= ENGINE_CONFIG.QUESTION_JACCARD_THRESHOLD) {
        pushIssue(issues, 'QUESTION_SIMILAR', ISSUE_LAYER.repetition, 'pergunta semelhante a uma recente');
        break;
      }
    }
    const skipAnswerHistory = formatId === FORMAT_IDS.VERDADEIRO_FALSO || isGenericTrueFalseAnswer(a, normalizeFn);
    if (!skipAnswerHistory) {
      const normA = normalizeFn ? normalizeFn(a) : a.toLowerCase();
      const recentA = filterKnowledgeAnswers(ctx.usedAnswers || [], normalizeFn)
        .map((x) => (normalizeFn ? normalizeFn(x) : x.toLowerCase()));
      if (normA && recentA.includes(normA)) {
        pushIssue(issues, 'ANSWER_REPEATED', ISSUE_LAYER.repetition, 'resposta já usada recentemente');
      }
    }
    return { issues, knowledgeKey };
  }

  function layerScore(points, layerIssues) {
    return layerIssues.length ? 0 : points;
  }

  function scoreQuestion(parsed, ctx) {
    const {
      formatId, ageBandKey, categoryNumber, isMC, stripTags, normalizeFn, helpers, difficulty,
    } = ctx;
    const q = stripTags(parsed?.q || '').trim();
    const a = stripTags(parsed?.a || '').trim();
    const options = Array.isArray(parsed?.options) ? parsed.options : [];
    const issues = [];
    const layers = {};

    if (!q || !a) {
      const issueDetails = [mkIssue('STRUCTURE_INCOMPLETE', ISSUE_LAYER.structural, 'estrutura incompleta')];
      return {
        score: 0,
        issues: issueMessages(issueDetails),
        issueDetails,
        layers: { structural: 0 },
        knowledgeKey: '',
      };
    }

    layers.structural = LAYER_WEIGHTS.structural;

    const formatCheck = validateByFormat(parsed, formatId, {
      ...(helpers || {}),
      ageBandKey,
      stripTags,
      validateTrueFalseQuestion: helpers?.validateTrueFalseQuestion,
    });
    layers.format = layerScore(LAYER_WEIGHTS.format, formatCheck.issues);
    issues.push(...formatCheck.issues);

    const ageCheck = validateAgeAppropriate(parsed, ageBandKey, stripTags, formatId);
    layers.age = layerScore(LAYER_WEIGHTS.age, ageCheck.issues);
    issues.push(...ageCheck.issues);

    const diffIssues = validateDifficultyFit(difficulty, ageBandKey, q);
    layers.difficulty = layerScore(LAYER_WEIGHTS.difficulty, diffIssues);
    issues.push(...diffIssues);

    const catIssues = categoryNumber ? validateCategoryTopicFit(q, categoryNumber, ageBandKey) : [];
    layers.category = layerScore(LAYER_WEIGHTS.category, catIssues);
    issues.push(...catIssues);

    const ptIssues = collectPtPtIssues(q, a, options, ageBandKey);
    layers.ptPt = layerScore(LAYER_WEIGHTS.ptPt, ptIssues);
    issues.push(...ptIssues);

    const semanticIssues = collectSemanticIssues(parsed, { ...ctx, stripTags, normalizeFn, formatId, isMC });
    layers.semantic = layerScore(LAYER_WEIGHTS.semantic, semanticIssues);
    issues.push(...semanticIssues);

    const { issues: repetitionIssues, knowledgeKey } = collectRepetitionIssues(q, a, formatId, {
      ...ctx,
      parsed,
      knowledgeMeta: KnowledgeKey.parseKnowledgeMeta(parsed),
    }, normalizeFn);
    layers.repetition = layerScore(LAYER_WEIGHTS.repetition, repetitionIssues);
    issues.push(...repetitionIssues);

    const mcIssues = collectMcIssues(parsed, { ...ctx, stripTags, normalizeFn, ageBandKey, isMC });
    layers.mcOptions = isMC ? layerScore(LAYER_WEIGHTS.mcOptions, mcIssues) : LAYER_WEIGHTS.mcOptions;
    issues.push(...mcIssues);

    const factualOnly = semanticIssues.filter((i) => /facto|factual|errad|incorret|ortográfico/i.test(issueMessage(i)));
    layers.factual = layerScore(LAYER_WEIGHTS.semantic, factualOnly);

    const score = Object.keys(LAYER_WEIGHTS).reduce((sum, key) => sum + (Number(layers[key]) || 0), 0);
    const normalized = normalizeIssues(issues);
    const seen = new Set();
    const issueDetails = normalized.filter((i) => {
      const m = issueMessage(i);
      if (seen.has(m)) return false;
      seen.add(m);
      return true;
    });
    return {
      score,
      issues: issueMessages(issueDetails),
      issueDetails,
      layers,
      knowledgeKey,
    };
  }

  function validateSemanticQuality(parsed, ctx) {
    const { stripTags, normalizeFn, formatId, skipRepetition } = ctx;
    const q = stripTags(parsed?.q || '').trim();
    const a = stripTags(parsed?.a || '').trim();
    const issues = [
      ...collectSemanticIssues(parsed, ctx),
      ...collectMcIssues(parsed, ctx),
    ];
    if (!skipRepetition) {
      issues.push(...collectRepetitionIssues(q, a, formatId, ctx, normalizeFn).issues);
    }
    return { ok: !issues.length, issues: [...new Set(issues)] };
  }

  function validateQuestion(parsed, ctx) {
    const scored = scoreQuestion(parsed, ctx);
    // Gate binário: qualquer issue reprova. Score (0–100) é só diagnóstico/UI.
    if (scored.issues.length > 0) {
      return {
        ok: false,
        issues: scored.issues,
        issueDetails: scored.issueDetails,
        score: scored.score,
        layers: scored.layers,
        knowledgeKey: scored.knowledgeKey,
      };
    }
    return {
      ok: true,
      issues: [],
      issueDetails: [],
      score: scored.score,
      layers: scored.layers,
      knowledgeKey: scored.knowledgeKey,
    };
  }

  const PERSISTENT_HISTORY_KEY = 'reino_magico_q_history_v3';
  const PERSISTENT_HISTORY_KEY_V2 = 'reino_magico_q_history_v2';
  const PERSISTENT_HISTORY_MAX = ENGINE_CONFIG.PERSISTENT_HISTORY_MAX;

  function migrateHistoryV2() {
    const storage = getLocalStorage();
    if (!storage) return;
    try {
      const raw = storage.getItem(PERSISTENT_HISTORY_KEY_V2);
      if (!raw || storage.getItem(PERSISTENT_HISTORY_KEY)) return;
      const v2 = JSON.parse(raw);
      const v3 = {};
      for (const [age, bucket] of Object.entries(v2)) {
        const entries = [];
        const qs = bucket.questions || [];
        const as = bucket.answers || [];
        for (let i = 0; i < Math.max(qs.length, as.length); i += 1) {
          entries.push({
            q: qs[i] || '',
            a: as[i] || '',
            category: 0,
            format: '',
            knowledgeKey: computeKnowledgeKey(qs[i] || '', as[i] || '', FORMAT_IDS.RESPOSTA_DIRETA),
            difficulty: 2,
            subtopic: '',
            ts: Date.now() - (Math.max(qs.length, as.length) - i) * 1000,
          });
        }
        v3[age] = { entries };
      }
      storage.setItem(PERSISTENT_HISTORY_KEY, JSON.stringify(v3));
    } catch (err) {
      warnHistoryStorage('migração de histórico persistente falhou', err);
    }
  }

  function loadPersistentHistory() {
    migrateHistoryV2();
    const storage = getLocalStorage();
    if (!storage) return {};
    try { return JSON.parse(storage.getItem(PERSISTENT_HISTORY_KEY) || '{}'); }
    catch (err) {
      warnHistoryStorage('histórico persistente corrompido ou ilegível', err);
      return {};
    }
  }

  function trimHistoryEntries(entries) {
    while (entries.length > PERSISTENT_HISTORY_MAX) entries.shift();
    return entries;
  }

  function getPersistentSlice(ageBandKey) {
    const bucket = loadPersistentHistory()[ageBandKey] || { entries: [] };
    const entries = (bucket.entries || []).slice(-ENGINE_CONFIG.MAX_RECENT_QUESTIONS);
    return {
      questions: entries.map((e) => e.q).filter(Boolean),
      answers: entries.map((e) => e.a).filter(Boolean),
      knowledgeKeys: entries.map((e) => e.knowledgeKey).filter(Boolean).slice(-ENGINE_CONFIG.MAX_RECENT_KNOWLEDGE_KEYS),
      formats: entries.map((e) => e.format).filter(Boolean).slice(-ENGINE_CONFIG.MAX_RECENT_FORMATS),
      categories: entries.map((e) => e.category).filter((c) => c > 0),
      subtopics: entries.map((e) => e.subtopic).filter(Boolean),
      difficulties: entries.map((e) => e.difficulty).filter((d) => d > 0),
      entries,
    };
  }

  function persistQuestion(ageBandKey, question, answer, normalizeFn, meta) {
    const storage = getLocalStorage();
    if (!storage) return;
    try {
      const store = loadPersistentHistory();
      if (!store[ageBandKey]) store[ageBandKey] = { entries: [] };
      const normQ = normalizeFn(question);
      const normA = normalizeFn(answer);
      const formatId = meta?.format || '';
      const entry = {
        q: question,
        a: answer,
        category: meta?.category || 0,
        format: formatId,
        knowledgeKey: meta?.knowledgeKey || computeKnowledgeKey(question, answer, formatId, normalizeFn, {
          knowledgeMeta: meta?.knowledge,
          categoryNumber: meta?.category,
        }),
        difficulty: meta?.difficulty || 2,
        subtopic: meta?.subtopic || '',
        ts: Date.now(),
      };
      const entries = store[ageBandKey].entries || [];
      const kKey = meta?.knowledgeKey || computeKnowledgeKey(question, answer, formatId, normalizeFn, {
        knowledgeMeta: meta?.knowledge,
        categoryNumber: meta?.category,
      });
      const dup = entries.some((e) => normalizeFn(e.q) === normQ)
        || entries.some((e) => e.knowledgeKey && knowledgeKeysMatch(e.knowledgeKey, kKey, normalizeFn));
      if (!dup) entries.push(entry);
      store[ageBandKey].entries = trimHistoryEntries(entries);
      storage.setItem(PERSISTENT_HISTORY_KEY, JSON.stringify(store));
    } catch (err) {
      warnHistoryStorage('persistência de pergunta falhou (quota ou storage cheio?)', err);
    }
  }

  global.QuestionEngine = {
    ENGINE_CONFIG,
    LAYER_WEIGHTS,
    FORMAT_IDS: Object.freeze({ ...FORMAT_IDS }),
    FORMAT_LABELS: Object.freeze({ ...FORMAT_LABELS }),
    CATEGORIES,
    getCategoryDef,
    AGE_LIMITS,
    getAgeLimits,
    CATEGORY_FORMAT_MATRIX: Object.freeze(Object.fromEntries(
      Object.entries(CATEGORIES).map(([n, def]) => [n, def.formats]),
    )),
    CATEGORY_SUBTOPICS: Object.freeze(Object.fromEntries(
      Object.entries(CATEGORIES).map(([n, def]) => [n, def.subtopics]),
    )),
    CATEGORY_RULES: Object.freeze(Object.fromEntries(
      Object.entries(CATEGORIES).map(([n, def]) => [n, def.rules]),
    )),
    CATEGORY_WEIGHT_BOOST: Object.freeze(Object.fromEntries(
      Object.entries(CATEGORIES).filter(([, def]) => def.weightBoost).map(([n, def]) => [n, def.weightBoost]),
    )),
    DIFFICULTY_RANGE: Object.freeze({ ...DIFFICULTY_RANGE }),
    DIFFICULTY_LABELS: Object.freeze({ ...DIFFICULTY_LABELS }),
    TRUE_FALSE_CHANCE,
    TRUE_FALSE_MIN_GAP,
    FORMAT_MAX_CONSECUTIVE,
    getAllowedFormats,
    filterFormatsForContext,
    defaultFormatForAnswerMode,
    chooseFormat,
    chooseDifficulty,
    chooseSubtopic,
    buildPrompt,
    buildRetryHint,
    buildAdaptiveRetryHint,
    shouldRotateSubtopicForRetry,
    recordGenerationTelemetry,
    getGenerationTelemetrySummary,
    clearGenerationTelemetry,
    validateByFormat,
    validateAgeAppropriate,
    validateSemanticQuality,
    validateQuestion,
    validateFactualConsistency,
    shouldRequestFactualVerify,
    buildFactualVerifyPrompt,
    parseFactualVerifyResponse,
    scoreQuestion,
    computeKnowledgeKey,
    knowledgeKeysMatch,
    parseKnowledgeMeta: KnowledgeKey.parseKnowledgeMeta,
    buildStructuredKnowledgeKey: KnowledgeKey.buildStructuredKey,
    isStructuredKnowledgeKey: KnowledgeKey.isStructuredKey,
    KNOWLEDGE_JSON_HINT: ',"knowledge":{"entity":"entidade principal (país, pessoa, obra)","concept":"conhecimento testado (capital, inventor, data)","relation":"relação opcional (é, venceu, descobriu)"}',
    assembleMcOptions,
    shuffleMcOptions,
    recordMcAnswerPosition,
    resetMcPositions,
    getPersistentSlice,
    persistQuestion,
    PERSISTENT_HISTORY_KEY,
    isGenericTrueFalseAnswer,
    buildGlobalRules,
    buildFormatRules,
    ISSUE_LAYER,
    mkIssue,
    issueMessage,
    issueCode,
  };
})(typeof window !== 'undefined' ? window : globalThis);
