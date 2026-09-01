/**
 * Configuração central — formatos, categorias, idades e dificuldade (Fase 7 modularização).
 */
(function (global) {
  'use strict';

  const ENGINE_CONFIG = Object.freeze({
    TRUE_FALSE_CHANCE: 0.11,
    TRUE_FALSE_MIN_GAP: 4,
    FORMAT_MAX_CONSECUTIVE: 2,
    PERSISTENT_HISTORY_MAX: 400,
    /** Janela anti-reuso entre sessões (mesmo browser / dispositivo). */
    ANTI_REUSE_DAYS: 30,
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
      rules: "Categoria ESPECIAL — experiência diferente do resto do jogo. ADIVINHA: adivinhas tradicionais portuguesas, tom lúdico. CURIOSIDADE: factos surpreendentes (\"Não sabia disso!\"). NÃO uses perguntas normais de cultura geral aqui.",
      subtopics: ["adivinha tradicional","curiosidade surpreendente"],
      formatMix: {"ADIVINHA":0.7,"CURIOSIDADE":0.3},
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
      if (def.formatMix) entry.formatMix = Object.freeze({ ...def.formatMix });
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

  global.QuestionEngineConfig = Object.freeze({
    ENGINE_CONFIG,
    LAYER_WEIGHTS,
    TRUE_FALSE_CHANCE,
    TRUE_FALSE_MIN_GAP,
    FORMAT_MAX_CONSECUTIVE,
    FORMAT_IDS: Object.freeze({ ...FORMAT_IDS }),
    FORMAT_LABELS: Object.freeze({ ...FORMAT_LABELS }),
    FORMAT_AGE_EXCLUDED: Object.freeze({ ...FORMAT_AGE_EXCLUDED }),
    ANSWER_MODE_OPEN_ONLY,
    ANSWER_MODE_MC_ONLY,
    DIFFICULTY_RANGE: Object.freeze({ ...DIFFICULTY_RANGE }),
    DIFFICULTY_LABELS: Object.freeze({ ...DIFFICULTY_LABELS }),
    AGE_LIMITS_BASE,
    AGE_LIMITS,
    getAgeLimits,
    isHardHistoricalWhenQuestion,
    CATEGORIES_RAW,
    CATEGORIES,
    getCategoryDef,
    freezeCategories,
    filterFormatsForContext,
    defaultFormatForAnswerMode,
    isGenericTrueFalseAnswer,
    filterKnowledgeAnswers,
    RE_CJK,
    RE_CYRILLIC,
    RE_ARABIC,
    RE_MIXED_LATIN_CJK,
    RE_MIXED_WORD,
    RE_BRASILEIRISMO,
    RE_TECH_TRANSPORT,
    RE_TECH_SPACE,
  });
})(typeof window !== 'undefined' ? window : globalThis);
