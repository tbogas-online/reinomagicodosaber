/**
 * Motor de perguntas — formatos, matriz categoria×formato, prompts em camadas e validação.
 */
(function (global) {
  'use strict';

  const ENGINE_CONFIG = Object.freeze({
    TRUE_FALSE_CHANCE: 0.11,
    TRUE_FALSE_MIN_GAP: 4,
    FORMAT_MAX_CONSECUTIVE: 2,
    PERSISTENT_HISTORY_MAX: 400,
    MAX_RECENT_QUESTIONS: 30,
    MAX_RECENT_KNOWLEDGE_KEYS: 40,
    MAX_RECENT_FORMATS: 40,
    MAX_RETRIES: 5,
    QUESTION_JACCARD_THRESHOLD: 0.55,
    KNOWLEDGE_JACCARD_THRESHOLD: 0.42,
  });

  /** Pesos das camadas — somam exactamente 100. Gate de aprovação = zero issues (binário). */
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

  /** ADIVINHA e CURIOSIDADE apenas na categoria 20 */
  const CATEGORY_FORMAT_MATRIX = {
    1: ['RESPOSTA_DIRETA', 'ESCOLHA_MULTIPLA', 'VERDADEIRO_FALSO', 'QUEM_E', 'O_QUE_E', 'COMPLETA', 'QUANDO', 'ONDE_FICA'],
    2: ['RESPOSTA_DIRETA', 'ESCOLHA_MULTIPLA', 'VERDADEIRO_FALSO', 'ONDE_FICA', 'COMPLETA', 'QUANDO'],
    3: ['RESPOSTA_DIRETA', 'ESCOLHA_MULTIPLA', 'VERDADEIRO_FALSO', 'QUEM_E', 'COMPLETA', 'QUANDO', 'CAUSA_CONSEQUENCIA'],
    4: ['RESPOSTA_DIRETA', 'ESCOLHA_MULTIPLA', 'VERDADEIRO_FALSO', 'O_QUE_E', 'COMPLETA', 'CAUSA_CONSEQUENCIA', 'SITUACAO_PRATICA'],
    5: ['RESPOSTA_DIRETA', 'ESCOLHA_MULTIPLA', 'VERDADEIRO_FALSO', 'O_QUE_E', 'COMPLETA', 'CAUSA_CONSEQUENCIA', 'SITUACAO_PRATICA'],
    6: ['RESPOSTA_DIRETA', 'ESCOLHA_MULTIPLA', 'VERDADEIRO_FALSO', 'O_QUE_E', 'COMPLETA', 'CAUSA_CONSEQUENCIA'],
    7: ['RESPOSTA_DIRETA', 'ESCOLHA_MULTIPLA', 'VERDADEIRO_FALSO', 'COMPLETA', 'CAUSA_CONSEQUENCIA', 'SITUACAO_PRATICA'],
    8: ['RESPOSTA_DIRETA', 'ESCOLHA_MULTIPLA', 'VERDADEIRO_FALSO', 'QUEM_E', 'O_QUE_E', 'COMPLETA', 'QUANDO'],
    9: ['RESPOSTA_DIRETA', 'ESCOLHA_MULTIPLA', 'VERDADEIRO_FALSO', 'O_QUE_E', 'COMPLETA', 'SITUACAO_PRATICA'],
    10: ['RESPOSTA_DIRETA', 'ESCOLHA_MULTIPLA', 'VERDADEIRO_FALSO', 'QUEM_E', 'O_QUE_E', 'COMPLETA', 'QUANDO'],
    11: ['RESPOSTA_DIRETA', 'ESCOLHA_MULTIPLA', 'VERDADEIRO_FALSO', 'QUEM_E', 'O_QUE_E', 'COMPLETA', 'QUANDO'],
    12: ['RESPOSTA_DIRETA', 'ESCOLHA_MULTIPLA', 'VERDADEIRO_FALSO', 'QUEM_E', 'O_QUE_E', 'COMPLETA', 'QUANDO'],
    13: ['RESPOSTA_DIRETA', 'ESCOLHA_MULTIPLA', 'VERDADEIRO_FALSO', 'QUEM_E', 'O_QUE_E', 'QUANDO'],
    14: ['RESPOSTA_DIRETA', 'ESCOLHA_MULTIPLA', 'VERDADEIRO_FALSO', 'O_QUE_E', 'COMPLETA', 'ONDE_FICA', 'SITUACAO_PRATICA'],
    15: ['RESPOSTA_DIRETA', 'ESCOLHA_MULTIPLA', 'VERDADEIRO_FALSO', 'QUEM_E', 'COMPLETA', 'QUANDO'],
    16: ['RESPOSTA_DIRETA', 'ESCOLHA_MULTIPLA', 'VERDADEIRO_FALSO', 'QUEM_E', 'O_QUE_E', 'COMPLETA', 'QUANDO'],
    17: ['RESPOSTA_DIRETA', 'ESCOLHA_MULTIPLA', 'VERDADEIRO_FALSO', 'QUEM_E', 'O_QUE_E', 'COMPLETA', 'QUANDO', 'CAUSA_CONSEQUENCIA', 'SITUACAO_PRATICA'],
    18: ['RESPOSTA_DIRETA', 'ESCOLHA_MULTIPLA', 'VERDADEIRO_FALSO', 'O_QUE_E', 'ONDE_FICA', 'QUANDO'],
    19: ['RESPOSTA_DIRETA', 'ESCOLHA_MULTIPLA', 'VERDADEIRO_FALSO', 'QUEM_E', 'O_QUE_E', 'COMPLETA', 'QUANDO', 'CAUSA_CONSEQUENCIA', 'SITUACAO_PRATICA'],
    20: ['ADIVINHA', 'CURIOSIDADE'],
  };

  const FORMAT_AGE_EXCLUDED = {
    '6-9': ['CAUSA_CONSEQUENCIA', 'SITUACAO_PRATICA'],
    '10-15': [],
    '15+': [],
  };

  const CATEGORY_WEIGHT_BOOST = {
    7: { SITUACAO_PRATICA: 2, CAUSA_CONSEQUENCIA: 2 },
    20: { ADIVINHA: 1.6, CURIOSIDADE: 1.4 },
    17: { SITUACAO_PRATICA: 1.8 },
    14: { SITUACAO_PRATICA: 1.5 },
  };

  const CATEGORY_RULES = {
    1: 'Cultura geral variada. Equilíbrio entre Portugal e mundo — não assumes cultura dos EUA como padrão.',
    2: 'Geografia: países, capitais, rios, montanhas, continentes, monumentos. Sem imagens, mapas ou bandeiras visíveis.',
    3: 'História: Portugal e mundo. Datas e personagens com precisão. Evita controvérsias sem data de referência.',
    4: 'Ciência: física, química, biologia. Qualifica o contexto (ex.: "animal terrestre mais rápido").',
    5: 'Natureza: animais, plantas, ecossistemas. Respostas objetivas e verificáveis.',
    6: 'Espaço: planetas, estrelas, missões. Sem imagens nem mapas celestes.',
    7: 'Matemática e Lógica: raciocínio e aplicação prática. Calcula internamente a resposta numérica antes de devolver.',
    8: 'Literatura: autores, obras, personagens. Foco literário, não biografia geográfica.',
    9: 'Português: vocabulário, gramática, ortografia, provérbios, sinónimos, antónimos, expressões portuguesas. Revisa concordância e regência (ex.: «na estante», não «no estante»).',
    10: 'Arte: artistas, obras, estilos, técnicas. SEM imagens — nunca "que quadro é este?".',
    11: 'Cinema e Séries: realizadores, atores, filmes, personagens. Sem imagens ou clips.',
    12: 'Música: VARIA o foco — bandas/grupos, canções (título), álbuns, artistas, compositores, instrumentos, géneros, festivais (Eurovisão, Rock in Rio). Evita repetir sempre "que instrumento é". Inclui artistas portugueses quando adequado. SEM áudio — nunca "que música é esta?".',
    13: 'Moda: peças, estilos, designers, tendências, tradições vestuárias.',
    14: 'Gastronomia: ingredientes, pratos, tradições culinárias — privilegia gastronomia portuguesa. Confirma origens geográficas (ex.: pastel de nata → Belém/Lisboa, francesinha → Porto).',
    15: 'Desporto: atletas, modalidades, regras, recordes com data ou contexto. Sem imagens. Natação em PT-PT: estilo mariposa (nunca "estilo borboleta"), costas, peito, crawl/estilo livre. Futebol em PT-PT: guarda-redes (nunca "goleiro"), defesa (nunca "zagueiro"), avançado (nunca "atacante"), remate (nunca "chute"), canto (nunca "escanteio"), relva (nunca "gramado"), equipa (nunca "time"), adeptos (nunca "torcida"), treinador (nunca "técnico"), golo (nunca "gol").',
    16: 'Jogos: videojogos, tabuleiro, cartas, clássicos portugueses (Sueca, Damas, Dominó, etc.).',
    17: `Tecnologia: ABRANGENTE — invenções, energia, comunicações, medicina aplicada, robótica, electrodomésticos, materiais e o digital. Computadores/software são SÓ UM dos temas (no máximo ~1 em 4 perguntas).
VARIA: electricidade e energias (solar, eólica, hidroeléctrica, nuclear), telefone/rádio/TV/satélite, fotografia, lâmpada, frigorífico, impressão 3D, raio-X, GPS, baterias, robôs, IA, internet.
NÃO repetir sempre PC, RAM, HTML, Windows, teclado, rato, SSD ou empresas de software.
Evita sobrepor Transportes (carros/aviões) e Espaço (foguetões) — isso são outras categorias.
SITUACAO_PRATICA é bem-vinda (ex.: "para que serve um fusível?").`,
    18: 'Culturas do Mundo: tradições, festividades, línguas. EVITA generalizações sobre povos. Prefere factos específicos.',
    19: 'Transportes: veículos, energia, história, regras de circulação, situações práticas.',
    20: 'Categoria ESPECIAL — experiência diferente do resto do jogo. ADIVINHA: charadas/adivinhas tradicionais portuguesas, tom lúdico. CURIOSIDADE: factos surpreendentes ("Não sabia disso!"). NÃO uses perguntas normais de cultura geral aqui.',
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

  const CATEGORY_SUBTOPICS = {
    1: ['facto geral', 'comparação', 'sequência', 'cultura portuguesa', 'mundo'],
    2: ['localização', 'capital', 'rio', 'montanha', 'clima', 'comparação geográfica'],
    3: ['personagem', 'data', 'acontecimento', 'causa', 'consequência', 'sequência temporal'],
    4: ['facto científico', 'causa', 'aplicação', 'experiência', 'previsão', 'situação prática'],
    5: ['animal', 'planta', 'ecossistema', 'comportamento', 'adaptação'],
    6: ['planeta', 'estrela', 'missão espacial', 'fenómeno celeste', 'astronauta'],
    7: ['contagem', 'sequência', 'padrão', 'situação prática', 'problema'],
    8: ['autor', 'obra', 'personagem literário', 'género', 'expressão idiomática'],
    9: ['vocabulário', 'gramática', 'ortografia', 'sinónimo', 'provérbio'],
    10: ['artista', 'obra', 'estilo', 'técnica', 'movimento artístico'],
    11: ['filme', 'série', 'realizador', 'ator', 'personagem'],
    12: ['banda', 'canção', 'álbum', 'artista', 'instrumento', 'género', 'festival'],
    13: ['peça de roupa', 'estilo', 'designer', 'tendência', 'tradição'],
    14: ['ingrediente', 'prato', 'tradição culinária', 'origem geográfica'],
    15: ['modalidade', 'atleta', 'regra', 'recorde com data', 'equipa'],
    16: ['videojogo', 'jogo de tabuleiro', 'personagem de jogo', 'consola'],
    17: ['invenção', 'energia', 'comunicações', 'medicina aplicada', 'robótica', 'digital'],
    18: ['tradição', 'festividade', 'língua', 'costume cultural'],
    19: ['veículo', 'infraestrutura', 'regra de circulação', 'história dos transportes'],
    20: ['adivinha tradicional', 'curiosidade surpreendente'],
  };

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
    } catch { /* ignore */ }
    return null;
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
    const shortQ = ageBandKey === '6-9' ? ' Frase MUITO curta (máx. 110 caracteres).' : '';
    const mcNote = isMC
      ? ' O jogador vê opções na app — gera opções plausíveis e distintas.'
      : ' Modo resposta aberta — resposta muito curta no campo "a".';
    const notRiddle = ' NÃO é adivinha — pergunta factual directa.';

    const completaYoung = ageBandKey === '6-9'
      ? ' BOM 6–9: "Completa: A água da chuva vem das ___." (nuvens) / "Completa: As plantas precisam de ___." (água). UMA frase, máx. 12 palavras antes da lacuna, resposta de 1 palavra.'
      : '';
    const completaOral = ageBandKey === '6-9'
      ? ' Máx. 105 caracteres no total. Máx. 12 palavras antes de ___. Resposta: 1 palavra.'
      : (ageBandKey === '10-15'
        ? ' Máx. 120 caracteres antes da lacuna. Máx. 14 palavras antes de ___.'
        : ' Máx. 140 caracteres antes da lacuna. Máx. 16 palavras antes de ___.');

    const mcYoung = ageBandKey === '6-9'
      ? ' 6–9: 4 opções CLARAMENTE diferentes — sem duplicados nem variantes da mesma personagem (Woody/Wooody/Sheriff Woody), sem erros ortográficos nas opções.'
      : '';
    const mcConcise = ageBandKey === '6-9'
      ? ' Opções DIRECTAS: máx. 4 palavras cada — nome, lugar ou termo curto; sem frases explicativas nem parágrafos.'
      : (ageBandKey === '10-15'
        ? ' Opções DIRECTAS: máx. 6 palavras cada — evita frases completas; preferir nome, data ou termo curto.'
        : ' Opções de escolha múltipla curtas e directas — evita frases longas quando um nome ou termo basta.');
    const rules = {
      RESPOSTA_DIRETA: `FORMATO: RESPOSTA_DIRETA — pergunta factual directa, uma frase interrogativa completa terminada em "?".${notRiddle}${mcNote}`,
      ESCOLHA_MULTIPLA: `FORMATO: ESCOLHA_MULTIPLA — pergunta para 4 opções plausíveis (1 certa + 3 erradas credíveis, nunca absurdas). Distribui a resposta correcta aleatoriamente.${notRiddle}${mcYoung}${mcConcise}${mcNote}`,
      VERDADEIRO_FALSO: `FORMATO: VERDADEIRO_FALSO — afirmação inequívoca, terminando com "Verdadeiro ou Falso?". Campo "a" = exactamente "Verdadeiro" ou "Falso".${isMC ? ' Opções: ["Verdadeiro","Falso"].' : ''}`,
      QUEM_E: `FORMATO OBRIGATÓRIO: QUEM_E — pergunta sobre uma PESSOA associada a uma obra, descoberta, acontecimento, invenção ou feito (ex.: "Quem escreveu Os Lusíadas?", "Quem pintou a Mona Lisa?"). Começa por "Quem" (nunca "Quem é quem"). Resposta = nome de pessoa (pode ser monónimo, nome artístico ou com título). NÃO perguntes por conceitos, objectos nem lugares. NÃO é adivinha.${ageBandKey === '6-9' ? ' PARA 6–9: pergunta pelo PERSONAGEM, não pelo autor — BOM: "Quem é o menino bruxo de Harry Potter?" (Harry Potter). MAU: "Quem escreveu Harry Potter?" (J.K. Rowling). Só nomes que uma criança reconheça de imediato. Opções MC: 4 personagens DIFERENTES, sem repetir a mesma (Woody/Wooody).' : ''}${shortQ}${mcYoung}${mcNote}`,
      O_QUE_E: `FORMATO OBRIGATÓRIO: O_QUE_E — pergunta sobre um CONCEITO, fenómeno, processo, objecto ou termo a definir/explicar (ex.: "O que é a fotossíntese?", "O que significa 'metáfora'?"). NÃO perguntes por pessoas — isso é QUEM_E. NÃO é adivinha.${ageBandKey === '6-9' ? ' PARA 6–9: pergunta curta, resposta de 1–4 palavras simples (ex.: "O que é o Natal?" → "uma festa"). Opções MC também curtas e distintas — não repitas a mesma palavra em todas (ex.: evita quatro opções que comecem por "festa de…").' : ''}${shortQ}${mcNote}`,
      COMPLETA: `FORMATO OBRIGATÓRIO: COMPLETA — frase curta que termina com a lacuna "___" (só no FINAL da frase). Um jogador lê a frase e o outro completa a última palavra.
Estrutura: [contexto curto] ___. — NUNCA ponhas texto depois da lacuna.
BOM: "Completa: A capital de Portugal é ___." / "Completa: A Voyager 1 atravessou a fronteira da heliosfera em 2012, chamada ___."
MAU: "Completa: A Voyager 1 atravessou a ___ em 2012." (lacuna no meio — proibido).${completaYoung}${completaOral}${mcNote}`,
      ONDE_FICA: `FORMATO: ONDE_FICA — localização com UMA resposta inequívoca, sem mapa nem imagem.
BOM: "Em que país nasce o rio Tejo?" → "Espanha" / "Em que país desagua o Tejo?" → "Portugal" / "Qual é a capital de França?" → "Paris" / "Em que continente fica o Brasil?" → "América do Sul".
MAU: "Onde fica o rio Tejo?" com opções de países (o Tejo está em Espanha e Portugal — ambíguo). MAU: "Onde fica a cordilheira dos Alpes?" sem especificar país, capital ou continente.${notRiddle}${mcNote}`,
      QUANDO: `FORMATO OBRIGATÓRIO: QUANDO — pede data, mês, ano, século ou período. Resposta temporal — nunca país, cidade ou pessoa.${notRiddle}${mcNote}`,
      CAUSA_CONSEQUENCIA: `FORMATO: CAUSA_CONSEQUENCIA — relação causa-efeito objectiva e ensinável. Evita "a consequência mais importante…".${notRiddle}${mcNote}`,
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
    const limits = {
      '6-9': `LIMITES RÍGIDOS (6–9 anos):
- Pergunta: máx. 110 caracteres e 18 palavras — UMA frase curta.
- Resposta: máx. 4 palavras. Temas familiares do quotidiano.
- Personagens: nomes que uma criança de 7 anos reconheça de imediato — não inventores do século XVII nem compositores clássicos com nome completo.
- ADEQUAÇÃO: só temas que uma criança de 7 anos reconheça (escola, animais, festas, desenhos animados, desporto básico). Se duvidares, simplifica.
- Tudo em português — nunca respostas só em inglês.`,
      '10-15': `LIMITES (10–15 anos):
- Pergunta até 180 caracteres e 22 palavras; linguagem clara, sem parágrafos.
- Resposta e opções em português de Portugal — traduz conceitos (ex.: "Verão", não "Summer").
- ADEQUAÇÃO: dificuldade intermédia — nem infantil nem universitária. Evita teoria avançada ou nomes obscuros.
- Opções MC curtas e directas (máx. 6 palavras).`,
      '15+': `LIMITES (+15): pergunta até 240 caracteres; exigente mas legível em voz alta. Não simplifiques demasiado.`,
    };
    return `IDADE E DIFICULDADE (${ageBandKey}): ${ageBandPromptText}
${limits[ageBandKey] || limits['15+']}`;
  }

  function buildHistoryRules(ctx) {
    const parts = [];
    const {
      usedQuestions, usedFormats, usedAnswers, persistentQuestions, persistentAnswers,
      usedKnowledgeKeys, persistentKnowledgeKeys,
    } = ctx;

    if (usedFormats?.length) {
      const last = usedFormats[usedFormats.length - 1];
      const consec = countConsecutiveFormat(usedFormats, last);
      parts.push(`Último formato: ${FORMAT_LABELS[last] || last}${consec >= FORMAT_MAX_CONSECUTIVE ? ' (já repetido — alterna)' : ''}. Alterna formatos — máximo ${FORMAT_MAX_CONSECUTIVE} seguidos iguais.`);
    }
    if (usedQuestions?.length) {
      parts.push(`NÃO repitas estas perguntas: ${usedQuestions.slice(-10).join(' | ')}.`);
    }
    const knowledgeAnswers = filterKnowledgeAnswers(usedAnswers);
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
    const persistentKnowledgeAnswers = filterKnowledgeAnswers(persistentAnswers);
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
    const pool = CATEGORY_SUBTOPICS[categoryNumber] || CATEGORY_SUBTOPICS[1];
    const recent = new Set(recentSubtopics || []);
    const fresh = pool.filter((t) => !recent.has(t));
    const pickFrom = fresh.length ? fresh : pool;
    return pickFrom[Math.floor(Math.random() * pickFrom.length)];
  }

  function stripTagsInternal(text) {
    return String(text || '').replace(/<[^>]*>/g, '').trim();
  }

  function computeKnowledgeKey(q, a, formatId, normalizeFn) {
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
    const norm = normalizeFn || ((s) => String(s || '').trim().toLowerCase());
    const a = normalizeKnowledgeKeyForMatch(keyA, norm);
    const b = normalizeKnowledgeKeyForMatch(keyB, norm);
    if (!a || !b) return false;
    if (a === b) return true;
    if (a.includes(b) || b.includes(a)) return true;
    return jaccardSimilarity(a, b) >= ENGINE_CONFIG.KNOWLEDGE_JACCARD_THRESHOLD;
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
    let formats = (CATEGORY_FORMAT_MATRIX[categoryNumber] || CATEGORY_FORMAT_MATRIX[1]).slice();
    const excluded = FORMAT_AGE_EXCLUDED[ageBandKey] || [];
    formats = formats.filter((f) => !excluded.includes(f));
    if (answerMode === 'open') {
      formats = formats.filter((f) => !ANSWER_MODE_MC_ONLY.has(f));
    } else if (answerMode === 'mc') {
      formats = formats.filter((f) => !ANSWER_MODE_OPEN_ONLY.has(f));
    }
    return formats.length ? formats : (CATEGORY_FORMAT_MATRIX[categoryNumber] || CATEGORY_FORMAT_MATRIX[1]).slice().filter((f) => {
      if (answerMode === 'open') return !ANSWER_MODE_MC_ONLY.has(f);
      if (answerMode === 'mc') return !ANSWER_MODE_OPEN_ONLY.has(f);
      return true;
    });
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
    if (!allowed.length) return FORMAT_IDS.RESPOSTA_DIRETA;

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

    const boost = CATEGORY_WEIGHT_BOOST[categoryNumber] || {};
    const weights = pool.map((f) => {
      const recentCount = (recent || []).filter((r) => r === f).length;
      return (boost[f] || 1) / (1 + recentCount * 0.4);
    });
    return weightedPick(pool, weights);
  }

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
    const diffExtra = ageBandKey === '15+' && diff >= 4
      ? '\nNível exigente/especialista (+15): evita factos óbvios de manual escolar; prefere detalhes precisos, contexto histórico/científico e raciocínio em dois passos.\n'
      : (ageBandKey === '6-9' && diff <= 2
        ? '\nNível muito fácil (6–9): vocabulário do dia a dia, temas reconhecíveis por crianças de 7 anos.\n'
        : '');

    return `Cria UMA pergunta de trivia EXCLUSIVAMENTE sobre a categoria "${category.name}" (${category.desc}), para ${ageBandPromptText}.

FORMATO OBRIGATÓRIO DESTA RODADA: ${formatLabel} (${formatId}) — não uses outro tipo de pergunta.
SUBTÓPICO DESTA RODADA: ${sub} — a pergunta deve reflectir este subtipo dentro da categoria.
DIFICULDADE: ${diff}/5 (${diffLabel}) — adequada à faixa etária.
${retryBlock}${musicFocusBlock}${techFocusBlock}${diffExtra}
${buildGlobalRules()}

REGRAS DA CATEGORIA:
${CATEGORY_RULES[category.n] || ''}

${buildFormatRules(formatId, { ageBandKey, isMC, isTrueFalse })}

${buildAgeRules(ageBandKey, ageBandPromptText)}
${ageDifficultyExtra || ''}

A pergunta tem de depender directamente da categoria indicada. Não mudes de tema nem de categoria.
${ptPtRules}

${buildHistoryRules({
  usedQuestions, usedFormats, usedAnswers, persistentQuestions, persistentAnswers,
  usedKnowledgeKeys, persistentKnowledgeKeys,
})}

${openModeExtra || ''}
${mcInstruction || ''}

Só JSON, sem markdown: ${jsonFormat}`;
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
        issues.push(`nome de país incorrecto — em PT-PT usa "${correct}"`);
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
        issues.push('resposta ou opção só em inglês — usa português de Portugal');
        break;
      }
    }
    return issues;
  }

  function validateAgeTopicFit(q, a, options, ageBandKey) {
    const issues = [];
    const blob = [q, a, ...(options || [])].join(' ');
    if (ageBandKey === '6-9') {
      const adultTopics = /\b(tratado|imperialismo|dodecafonismo|mitocôndria|algoritmo|quântico|burocracia|constituição|epistemologia|hegel|nietzsche|versalhes|holocausto|genocídio)\b/i;
      if (adultTopics.test(blob)) issues.push('tema inadequado para 6–9');
      if (/\b(apesar de|embora|contudo|por conseguinte|outrossim|consequentemente)\b/i.test(q)) {
        issues.push('linguagem demasiado complexa para 6–9');
      }
      const qWords = q.split(/\s+/).filter(Boolean).length;
      if (qWords > 16 && !/completa/i.test(q)) issues.push('pergunta demasiado complexa para 6–9');
    } else if (ageBandKey === '10-15') {
      const gradTopics = /\b(epistemologia|fenomenologia|dialética materialista|dodecafonismo|hegeliano|nietzscheano)\b/i;
      if (gradTopics.test(blob)) issues.push('tema inadequado para 10–15');
      const qWords = q.split(/\s+/).filter(Boolean).length;
      if (qWords > 22) issues.push('pergunta demasiado complexa para 10–15');
      const answerWords = a.split(/\s+/).filter(Boolean).length;
      if (answerWords > 6) issues.push('resposta demasiado longa para 10–15');
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
      if (re.test(blob)) issues.push(`termo de futebol brasileiro — em PT-PT usa "${pt}"`);
    }

    if (/\bmeia[s]?\b/i.test(blob) && /\bfutebol\b/i.test(blob)) {
      issues.push('termo de futebol brasileiro — em PT-PT usa "médio" (não "meia")');
    }
    if (/\bt[eé]cnicos?\b/i.test(blob) && /\bfutebol\b/i.test(blob)) {
      issues.push('termo de futebol brasileiro — em PT-PT usa "treinador"');
    }
    if (/\btime\b/i.test(blob)) {
      issues.push('termo de futebol brasileiro — em PT-PT usa "equipa" (não "time")');
    }
    if (/\bju[ií]zes?\b/i.test(blob)) {
      issues.push('termo de futebol brasileiro — em PT-PT usa "árbitro"');
    }
    if (/\bcamisas?\b/i.test(blob) && /\b(futebol|jogador|equipa|clube|baliza|guarda.?redes)\b/i.test(blob)) {
      issues.push('termo de futebol brasileiro — em PT-PT usa "camisola" (não "camisa")');
    }
    if (/\buniformes?\b/i.test(blob) && /\bfutebol\b/i.test(blob)) {
      issues.push('termo de futebol brasileiro — em PT-PT usa "equipamento"');
    }
    if (/\bpartidas?\b/i.test(blob) && /\bfutebol\b/i.test(blob)) {
      issues.push('termo de futebol brasileiro — em PT-PT usa "jogo"');
    }
    if (/(?:^|[^\w])gols?(?:[^\w]|$)/i.test(blob) && !/\bgolfe\b/i.test(blob)) {
      issues.push('termo de futebol brasileiro — em PT-PT usa "golo"');
    }
    if (/\bcampo de grama\b/i.test(blob)) {
      issues.push('termo de futebol brasileiro — em PT-PT usa "relvado" ou "campo de relva"');
    }
    if (/\bgolead[ao]\b/i.test(blob) && /(?:^|[^\w])gols?(?:[^\w]|$)/i.test(blob) && !/\bgolfe\b/i.test(blob)) {
      issues.push('em PT-PT usa "golo/golos" (não "gol/gols"), mesmo com "goleada" ou "golear"');
    }
    if (/\bgolead[ao]\b/i.test(blob) && /\b(Brasileirão|Brasileirao|Campeonato Brasileiro|Série [AB] do Brasil)\b/i.test(blob)) {
      issues.push('goleada/golear em contexto de campeonato português — evita referências ao futebol brasileiro');
    }

    return issues;
  }

  function validatePortugueseText(blob) {
    const issues = [];
    if (hasInvalidScript(blob)) issues.push('texto com caracteres não portugueses (ex.: chinês ou outro alfabeto)');
    if (RE_MIXED_WORD.test(blob)) {
      issues.push('palavra com letras misturadas de outro idioma');
    }
    if (/\bestilo\s+borboleta\b/i.test(blob)) {
      issues.push('vocabulário de natação brasileiro — em PT-PT usa "estilo mariposa"');
    }
    if (/\bavoando\b/i.test(blob)) {
      issues.push('erro ortográfico — escreve "a voar" (não "avoando")');
    }
    if (/\bcamisetas?\b/i.test(blob)) {
      issues.push('brasileirismo — em PT-PT usa "camisola" (não "camiseta")');
    }
    if (RE_BRASILEIRISMO.test(blob)) {
      issues.push('brasileirismo detectado — usa português de Portugal');
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
      issues.push('ADIVINHA: usa "Que animal…" em vez de "Quem é o animal"');
    }
    if (/\b(canta|som)\b.*\b(batid|bate)\b|\b(batid|bate).*\b(canta|som)\b/i.test(q)) {
      if (!/\b(tambor|caixa|pandeiro|instrumento|musical)\b/i.test(a)) {
        issues.push('ADIVINHA: objecto que "canta quando é batido" deve ser instrumento de percussão');
      }
    }
    if (/\bpernas\b.*\bnão\s+anda\b/i.test(q) && /\b(bola|cadeira|mesa)\b/i.test(a)) {
      issues.push('ADIVINHA: charada fraca — a resposta não encaixa bem nas pistas');
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
      issues.push('pergunta ambígua — mapa e globo terráqueo respondem às mesmas pistas; reformula ou usa distractores claramente errados');
    }

    const geoRepRiddle = /\b(tenho|tem)\b/i.test(q) && /\b(cidades|montanhas)\b/i.test(q)
      && /\bn[aã]o\s+(casas|árvores|arvores|peixes)\b/i.test(q);
    if (geoRepRiddle && hasMapa && hasGlobo && !mapGlobeRiddle) {
      issues.push('pergunta ambígua — mapa e globo terráqueo são ambas defensáveis nesta adivinha');
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
        issues.push('opções incoerentes — misturam temas diferentes (ex.: animal com ilusão de ótica ou números)');
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
      issues.push('opções parecem respostas de perguntas diferentes — todas devem ser do mesmo tipo');
    }

    return issues;
  }

  /** Factos/ambiguidades reportados (feedback, CSV) — ver testes 7–8, 21–23 */
  const REPORTED_FACT_RULES = [
    { when: (q, a, opts) => /\btoy\s*story\b/i.test(q) && /\b(chapéu|chapeu)\b/i.test(q) && /\b(cowboy|vaqueir|xerife)\b/i.test(q), issue: 'pergunta ambígua — Woody e Jessie usam chapéu de cowboy; especifica "xerife", "vaqueira" ou outro detalhe único' },
    { when: (q, a, opts) => /\b(ursinho|urso)\b.*\bmel\b|\bmel\b.*\b(ursinho|urso)\b/i.test(q) && /\b(disney|desenho)\b/i.test(q) && (/\b(pooh|winnie|puff)\b/i.test(a) || opts.some((o) => /\b(pooh|winnie|puff)\b/i.test(o))), issue: 'pergunta ambígua — em PT-PT usa "Ursinho Puff" de forma única (não Pooh/Winnie em separado)' },
    { when: (q, a, opts) => /\bqual\s+(personagem|herói|heroi)\b/i.test(q) && /\b(chapéu|chapeu|óculos|oculos|veste|usa)\b/i.test(q) && !/\b(único|unico|só\s+ele|so\s+ele|principal|xerife|vaqueira)\b/i.test(q) && /\bwoody\b/i.test(a) && opts.some((o) => /\bjessie\b/i.test(o)), issue: 'pergunta ambígua — mais do que um personagem encaixa na descrição' },
    { when: (q, a) => /\b(olho aberto|metade do cérebro|metade do cerebro|unihemisfério|unihemisferio)\b/i.test(q) && /\b(golfinho|baleia|pato|foca)\b/i.test(a), issue: 'pergunta ambígua — vários animais marinhos/aves dormem com um olho aberto; especifica espécie ou contexto' },
    { when: (q, a) => /\b(primeira\s+mulher|primeira\s+realizadora)\b/i.test(q) && /\b(steven|spielberg|scorsese|nolan|cameron|tarantino|hitchcock|kubrick)\b/i.test(a), issue: 'resposta masculina incompatível com "primeira mulher"' },
    { when: (q) => /\b(primeira\s+mulher|primeira\s+realizadora)\b/i.test(q) && /\brealizador\b/i.test(q) && !/\brealizadora\b/i.test(q), issue: 'pergunta contraditória — "primeira mulher" com "realizador"' },
    { when: (q) => /\blista de schindler\b/i.test(q) && /\bprimeira\s+mulher\b/i.test(q), issue: 'facto incorreto — A Lista de Schindler não se liga ao primeiro Óscar de melhor realizadora' },
    { when: (q, a) => /\b(4[,.]5\s*metros?|metros?\s+de\s+altura|mais\s+alto|altura.*ombros)\b/i.test(q) && /\b(maior|animal\s+terrestre)\b/i.test(q) && /\bzebra\b/i.test(a) && /\b(giraf|elefant|altura|ombros|4)\b/i.test(q), issue: 'resposta não corresponde à descrição de tamanho' },
    { when: (q, a) => /\bmaior animal terrestre\b/i.test(q) && /\bzebra\b/i.test(a), issue: 'zebra não é o maior animal terrestre' },
    { when: (q, a) => /\b(chove|chuva)\b/i.test(q) && /\b(mãos|maos)\b/i.test(q) && /\bacessório\b/i.test(q) && /\b(luvas|gorro|cachecol)\b/i.test(a), issue: 'na chuva, o acessório usual é guarda-chuva ou impermeável, não luvas' },
    { when: (q) => /\b(cabelo|olhos)\s+(castanh|azul|verde|loiro|ruivo)\b/i.test(q) && /\b(artista|cantor|pianista|músico|música)\b/i.test(q), issue: 'pergunta vaga — traço físico genérico não identifica uma pessoa de forma única' },
    { when: (q, a) => /^o\s+que\s+é\s+(um|uma)\s+/i.test(q) && /^(imagem\s+de|tipo\s+de|forma\s+de)\b/i.test(a), issue: 'definição circular ou demasiado vaga no "O que é"' },
    { when: (q, a) => /\barco[-\s]?íris|arco[-\s]?iris\b/i.test(q) && /\b(desenho|pintura|nuvem|animal|fruta|planta)\b/i.test(a), issue: 'resposta factualmente errada — arco-íris é um fenómeno da luz e da água no céu' },
    { when: (q, a) => /^o\s+que\s+é\s+(um|uma)\s+/i.test(q) && /\b(desenho|pintura)\s+de\s+(cores|luz)\b/i.test(a), issue: 'definição errada — não confundir fenómeno natural com "desenho" ou "pintura"' },
    { when: (q, a) => /\b(bica|galão)\b/i.test(q) && /\balém\b.*\bproporção\b/i.test(q) && /\bcafé\b/i.test(a), issue: 'bica e galão diferem sobretudo na proporção de leite — pergunta ambígua' },
    { when: (q, a, opts) => {
      const mapGlobeRiddle = /\bcidades\b/i.test(q) && /\bn[aã]o\s+casas\b/i.test(q)
        && /\bmontanhas\b/i.test(q) && /\bn[aã]o\s+(árvores|arvores)\b/i.test(q)
        && /\b(água|agua)\b/i.test(q) && /\bn[aã]o\s+peixes\b/i.test(q);
      if (!mapGlobeRiddle) return false;
      const hasMapa = opts.some((o) => /\bmapa\b/i.test(o)) || /\bmapa\b/i.test(a);
      const hasGlobo = opts.some((o) => /\bglobo\b/i.test(o));
      return hasMapa && hasGlobo;
    }, issue: 'pergunta ambígua — mapa e globo terráqueo respondem às mesmas pistas' },
    { when: (q, a) => /\bpastel\s+de\s+nata\b/i.test(q) && /\b(cidade|onde|fica|nasceu|origem|populariz|criado|inventado)\b/i.test(q) && !/\b(lisboa|bel[eé]m)\b/i.test(String(a || '')), issue: 'facto incorreto — o pastel de nata associa-se a Belém/Lisboa' },
    { when: (q, a) => /\bfrancesinha\b/i.test(q) && /\b(cidade|onde|fica|origem|nasceu|típic[ao])\b/i.test(q) && !/\bporto\b/i.test(String(a || '')), issue: 'facto incorreto — a francesinha é típica do Porto' },
    { when: (q) => /\broald\s+dahl\b/i.test(q) && /\brato\b/i.test(q) && /\b(queria\s+ser|ser)\s+rei\b/i.test(q), issue: 'facto incorreto — Roald Dahl não escreveu "O rato que queria ser rei"' },
    { when: (q, a) => /\basfato\b/i.test(a) && !/\basfalto\b/i.test(a), issue: 'erro ortográfico — escreve "asfalto" (não "asfato")' },
    { when: (q) => /\bestrada\s+para\s+os\s+carros\b/i.test(q), issue: 'formulação estranha — diz "estrada" ou "piso da estrada", não "estrada para os carros"' },
    { when: (q, a) => /\b(estrad|autoestrada)\b/i.test(q) && /\bfeit[ao]\s+de\b/i.test(q) && /\b(asfalto|alcatrão|alcatrao|betume)\b/i.test(a), issue: 'resposta ambígua — asfalto e alcatrão são ambos aceitáveis em PT-PT; reformula ou escolhe outro tema' },
    { when: (q, _a, _o, _ql, _al, formatId) => formatId === FORMAT_IDS.O_QUE_E && /^o\s+que\s+é\s+(?:a|o|um|uma)\s+(flor|folha|raiz|tronco|casca|semente|fruto|galho)\s+(?:d[aeo]s?\s+)(?:planta|árvore|arvore|flor)\b/i.test(q), issue: 'pergunta confusa — evita "O que é a [parte] da planta/árvore?"; reformula (ex.: "Para que serve a flor?")' },
    { when: (q, a, _o, _ql, _al, formatId) => {
      if (formatId !== FORMAT_IDS.O_QUE_E) return false;
      const circular = q.match(/^o\s+que\s+é\s+(?:a|o|um|uma)\s+(\w+)\s+(?:d[aeo]s?\s+)(\w+)/i);
      if (!circular) return false;
      const term = circular[1].toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const answerFirst = String(a || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/\s+/)[0];
      return term && answerFirst && term === answerFirst;
    }, issue: 'pergunta circular — a resposta repete a palavra que se pede para definir' },
  ];

  function runReportedFactRules(q, a, options, formatId) {
    const opts = (options || []).map((o) => String(o).toLowerCase());
    const issues = [];
    for (const rule of REPORTED_FACT_RULES) {
      if (rule.when(q, a, opts, q.toLowerCase(), a.toLowerCase(), formatId)) issues.push(rule.issue);
    }
    return issues;
  }

  const CONFUSING_FACT_PREFIXES = ['pergunta confusa', 'formulação', 'resposta ambígua — asfalto', 'pergunta circular'];

  function isConfusingFactIssue(issue) {
    return CONFUSING_FACT_PREFIXES.some((prefix) => issue.startsWith(prefix));
  }

  function validateCategoryTopicFit(q, categoryN, ageBandKey) {
    const issues = [];
    if (categoryN === 2 && /\b(homem|pessoa|astronauta).{0,40}\blua\b|\bprimeira\s+vez.{0,30}\blua\b|\bprimeiro\s+homem\b.*\blua\b/i.test(q)) {
      issues.push('missão à Lua é Espaço/História, não Geografia');
    }
    if (categoryN === 17) {
      if (RE_TECH_TRANSPORT.test(q)) {
        issues.push('veículos/transportes são Categoria 19 (Transportes), não Tecnologia');
      }
      if (RE_TECH_SPACE.test(q)) {
        issues.push('espaço/foguetões são Categoria 6 (Espaço), não Tecnologia');
      }
    }
    if (ageBandKey === '6-9' && /\b(homem|pessoa).{0,25}\blua\b|\bfoi\s+à\s+lua\b/i.test(q)) {
      issues.push('missão à Lua demasiado avançada para 6–9');
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
      if (hasA && hasB) issues.push('opções ambíguas — alcunha e nome do mesmo personagem');
    }
    if (/\b(pooh|winnie)\b/i.test(a) && norms.filter((o) => /\b(pooh|winnie|ursinho)\b/i.test(o)).length >= 2) {
      issues.push('nome ambíguo — em PT-PT usa "Ursinho Puff" de forma consistente');
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
      issues.push('opções repetidas ou quase iguais (ex.: Woody / Wooody / Sheriff Woody)');
    }
    const limits = {
      '6-9': { maxWords: 4, maxChars: 38 },
      '10-15': { maxWords: 6, maxChars: 52 },
      '15+': { maxWords: 8, maxChars: 72 },
    };
    const lim = limits[ageBandKey] || limits['15+'];
    const tooLong = clean.filter((o) => {
      const words = o.split(/\s+/).filter(Boolean).length;
      return words > lim.maxWords || o.length > lim.maxChars;
    });
    if (tooLong.length) {
      issues.push(ageBandKey === '6-9'
        ? 'opções demasiado longas para 6–9 (máx. 4 palavras)'
        : (ageBandKey === '10-15'
          ? 'opções demasiado longas para 10–15 (máx. 6 palavras) — sê mais directo'
          : 'opções demasiado longas — usa termos mais curtos'));
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

    if (formatId === FORMAT_IDS.ADIVINHA && /^qual\s+é\s+a\s+capital\b|^quem\s+descobriu\b/i.test(q)) {
      issues.push('ADIVINHA não deve ser pergunta factual directa');
    }
    if (formatId === FORMAT_IDS.ADIVINHA) {
      issues.push(...validateAdivinhaQuality(q, a));
    }

    if (formatId === FORMAT_IDS.CURIOSIDADE) {
      issues.push(...validateCuriosidade(q));
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
    const abstractMath = /(\d+\s*%|\bpercentagem\b|\bprobabilidade\b|\bfraç[ãõ]o\b|\bmédia\b)/i;
    const veryTechnical = /\b(mitocôndria|fotossíntese|condensação|eletromagnético|metamorfose celular)\b/i;
    const youngestTooHard = /\b(imperialismo|algoritmo|programador|programadora|engenheir|máquina analítica|maquina analitica|babbage|tratado de versalhes|segunda guerra mundial|primeira guerra mundial)\b/i;
    const isCompleta = formatId === FORMAT_IDS.COMPLETA || /_{2,}|…|\.{3}/.test(q);

    if (ageBandKey === '6-9') {
      if (q.length > 110) issues.push('pergunta demasiado longa');
      if (q.split(/\s+/).filter(Boolean).length > 18) issues.push('pergunta demasiado longa');
      const maxAnswerWords = isCompleta ? 2 : 4;
      if (a.split(/\s+/).filter(Boolean).length > maxAnswerWords) {
        issues.push(isCompleta ? 'resposta COMPLETA demasiado longa para 6–9 (máx. 2 palavras)' : 'resposta demasiado longa');
      }
      if (abstractMath.test(blob)) issues.push('conceito matemático abstrato');
      if (veryTechnical.test(blob)) issues.push('vocabulário técnico');
      if (youngestTooHard.test(blob)) issues.push('tema avançado demais');
      issues.push(...validateYoungAgeContent(q, a, options, formatId));
      issues.push(...validateAgeTopicFit(q, a, options, ageBandKey));
      issues.push(...validatePortugueseNotEnglish([a, ...options], ageBandKey));
      const longWords = q.split(/\s+/).filter((w) => w.replace(/[^a-zàáâãäåèéêëìíîïòóôõöùúûüçñ-]/gi, '').length > 13);
      if (longWords.length) issues.push('palavras demasiado complexas');
    } else if (ageBandKey === '10-15') {
      if (q.length > 180) issues.push('pergunta demasiado longa');
      if (veryTechnical.test(a) && a.split(/\s+/).filter(Boolean).length > 8) {
        issues.push('resposta demasiado técnica');
      }
      issues.push(...validateAgeTopicFit(q, a, options, ageBandKey));
      issues.push(...validatePortugueseNotEnglish([a, ...options], ageBandKey));
      if (options.length) {
        issues.push(...validateMcOptionsQuality(options, stripTags, collapseOptionKey, ageBandKey));
      }
    } else if (q.length > 240) {
      issues.push('pergunta demasiado longa');
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
    const correctBucket = classifyConceptBucket(correct);
    const wrongBuckets = clean
      .filter((o) => o.toLowerCase() !== correct.toLowerCase())
      .map(classifyConceptBucket)
      .filter((b) => b !== 'entity' && b !== 'geo_science' && b !== 'nature');
    const absurdBuckets = new Set(['color', 'sport', 'food', 'place', 'number']);
    const absurdWrong = wrongBuckets.filter((b) => absurdBuckets.has(b));
    if (absurdWrong.length >= 2 && !absurdBuckets.has(correctBucket)) {
      issues.push('distratores de classes conceptuais diferentes (ex.: cores, cidades ou desportos misturados com o tema)');
      return issues;
    }
    const distinctWrong = new Set(wrongBuckets.filter((b) => b !== 'entity'));
    if (distinctWrong.size >= 3 && correctBucket === 'entity') {
      issues.push('distratores incoerentes — devem pertencer à mesma classe conceptual que a resposta');
    }
    return issues;
  }

  function validateMcSingleCorrect(options, correctAnswer, normalizeFn) {
    const norm = normalizeFn || ((s) => String(s || '').trim().toLowerCase());
    const correct = norm(correctAnswer);
    const matches = (options || []).filter((o) => norm(o) === correct);
    if (matches.length !== 1) return ['deve haver exactamente uma opção correcta'];
    return [];
  }

  function validateDifficultyFit(difficulty, ageBandKey, q) {
    const issues = [];
    const range = DIFFICULTY_RANGE[ageBandKey] || DIFFICULTY_RANGE['15+'];
    const diff = Number(difficulty) || range.min;
    if (diff < range.min || diff > range.max) {
      issues.push(`dificuldade ${diff} incompatível com faixa ${ageBandKey}`);
    }
    if (ageBandKey === '6-9' && diff >= 4) issues.push('demasiado difícil para 6–9');
    if (ageBandKey === '15+' && diff >= 4) {
      const tooEasy = /\b(planeta onde vivemos|cor do céu|quantos dedos|quantas pernas tem um cão)\b/i;
      if (tooEasy.test(q)) issues.push('demasiado fácil para +15 nível exigente');
    }
    if (ageBandKey === '6-9' && diff <= 2) {
      const tooHard = /\b(teorema|algoritmo|revolução industrial|segunda guerra)\b/i;
      if (tooHard.test(q)) issues.push('demasiado difícil para 6–9');
    }
    return issues;
  }

  function validateFactualConsistency(q, a) {
    return runReportedFactRules(q, a, [], null).filter((i) => !isConfusingFactIssue(i) && !i.startsWith('pergunta ambígua'));
  }

  const RETRY_HINT_RULES = [
    { re: /ambígu|múltiplas respostas|várias respostas/i, hint: 'Evita respostas ambíguas. Gera uma pergunta com apenas uma resposta inequívoca.' },
    { re: /opções repetidas|quase iguais|semelhantes/i, hint: 'Gera distractores claramente diferentes mas pertencentes à mesma classe conceptual.' },
    { re: /demasiado difícil|tema avançado|vocabulário técnico/i, hint: 'Reduz a dificuldade e utiliza vocabulário adequado à faixa etária.' },
    { re: /demasiado fácil|senso comum/i, hint: 'Aumenta a exigência com factos menos óbvios mas verificáveis.' },
    { re: /repetid|semelhante|knowledgeKey|conhecimento/i, hint: 'Não repitas conhecimento já testado — escolhe outro tema dentro da mesma categoria.' },
    { re: /distratores|incoerentes|classes conceptuais/i, hint: 'Os distractores devem ser plausíveis e da mesma classe que a resposta correcta.' },
    { re: /revelada na pergunta/i, hint: 'A resposta não pode aparecer nem ser deduzível directamente da pergunta.' },
    { re: /português|brasileir|inglês|PT-PT|futebol|goleiro|guarda-redes/i, hint: 'Revisa português de Portugal: vocabulário, ortografia e nomes de países.' },
    { re: /categoria|tema|Geografia|Espaço/i, hint: 'Mantém a pergunta estritamente dentro da categoria indicada.' },
    { re: /factual|facto incorreto|errada/i, hint: 'Confirma o facto antes de responder — evita inventar ou confundir conceitos.' },
    { re: /confus|circular|formulação estranha/i, hint: 'Reformula a pergunta de forma clara e directa, sem repetir a resposta nem usar construções ambíguas.' },
    { re: /asfalto|alcatrão|ambígu/i, hint: 'Evita perguntas com várias respostas igualmente correctas — escolhe um facto inequívoco.' },
  ];

  function buildRetryHint(issues, formatId, ageBandKey) {
    const list = Array.isArray(issues) ? issues : [];
    const hints = new Set();
    const blob = list.join(' ');
    for (const rule of RETRY_HINT_RULES) {
      if (rule.re.test(blob)) hints.add(rule.hint);
    }
    if (!hints.size && list.length) hints.add(`Corrige: ${list.slice(0, 3).join('; ')}.`);
    const formatLabel = FORMAT_LABELS[formatId] || formatId;
    return `ERRO NA VALIDAÇÃO: ${list.slice(0, 4).join('; ')}.\n${[...hints].join('\n')}\nMantém o formato "${formatLabel}" (${formatId})${ageBandKey === '6-9' ? ' com frases curtas e vocabulário simples' : ''}.`;
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
      if (answerLeakedInQuestion(q, a)) issues.push('resposta revelada na pergunta');
    }
    if (hasCulturalStereotype(q)) issues.push('estereótipo cultural');
    if (/\b(pode ser|podem ser|várias respostas|duas respostas|tanto .+ como)\b/i.test(`${q} ${a}`)) {
      issues.push('possíveis múltiplas respostas');
    }
    return issues;
  }

  function collectMcIssues(parsed, ctx) {
    const { isMC, stripTags, normalizeFn, ageBandKey, formatId } = ctx;
    if (!isMC) return [];
    const q = stripTags(parsed?.q || '').trim();
    const a = stripTags(parsed?.a || '').trim();
    const options = Array.isArray(parsed?.options) ? parsed.options : [];
    if (options.length < 2) return ['opções MC insuficientes'];
    const issues = [
      ...validateMcSingleCorrect(options, a, normalizeFn),
      ...validateMcConceptualClass(options, a, stripTags),
      ...validateMcOptionsQuality(options, stripTags, collapseOptionKey, ageBandKey),
      ...validateDisneyCharacterAliases(options, a),
      ...validateAdivinhaMcAmbiguity(q, a, options, stripTags, formatId),
    ];
    if (options.length === 4) {
      issues.push(...validateMcOptionsCoherence(q, options, stripTags));
      const absurd = /^(banana|futebol|azul|verde|vermelho|nada|qualquer|abc|xyz|123|nenhum|desconhecido)$/i;
      const wrong = options.filter((o) => stripTags(o).trim().toLowerCase() !== a.toLowerCase());
      if (wrong.filter((o) => absurd.test(stripTags(o).trim())).length >= 2) {
        issues.push('distratores demasiado absurdos');
      }
      const qTokens = new Set(tokenize(q));
      for (const opt of wrong) {
        const ot = tokenize(opt);
        if (ot.length >= 2 && ot.every((w) => qTokens.has(w))) {
          issues.push('opção errada contém pista da pergunta');
          break;
        }
      }
    }
    return issues;
  }

  function collectRepetitionIssues(q, a, formatId, ctx, normalizeFn) {
    const issues = [];
    const knowledgeKey = ctx.knowledgeKey || computeKnowledgeKey(q, a, formatId, normalizeFn);
    const recentKeys = [...(ctx.usedKnowledgeKeys || []), ...(ctx.persistentKnowledgeKeys || [])];
    if (recentKeys.some((k) => knowledgeKeysMatch(k, knowledgeKey, normalizeFn))) {
      issues.push('conhecimento já testado recentemente (knowledgeKey)');
    }
    for (const prev of (ctx.usedQuestions || []).slice(-8)) {
      const qNorm = normalizeForRepetitionCheck(q, formatId);
      const prevNorm = normalizeForRepetitionCheck(prev, formatId);
      if (jaccardSimilarity(qNorm, prevNorm) >= ENGINE_CONFIG.QUESTION_JACCARD_THRESHOLD) {
        issues.push('pergunta semelhante a uma recente');
        break;
      }
    }
    const skipAnswerHistory = formatId === FORMAT_IDS.VERDADEIRO_FALSO || isGenericTrueFalseAnswer(a, normalizeFn);
    if (!skipAnswerHistory) {
      const normA = normalizeFn ? normalizeFn(a) : a.toLowerCase();
      const recentA = filterKnowledgeAnswers(ctx.usedAnswers || [], normalizeFn)
        .map((x) => (normalizeFn ? normalizeFn(x) : x.toLowerCase()));
      if (normA && recentA.includes(normA)) issues.push('resposta já usada recentemente');
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
      return { score: 0, issues: ['estrutura incompleta'], layers: { structural: 0 }, knowledgeKey: '' };
    }

    layers.structural = LAYER_WEIGHTS.structural;

    const formatCheck = validateByFormat(parsed, formatId, helpers || ctx);
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

    const { issues: repetitionIssues, knowledgeKey } = collectRepetitionIssues(q, a, formatId, ctx, normalizeFn);
    layers.repetition = layerScore(LAYER_WEIGHTS.repetition, repetitionIssues);
    issues.push(...repetitionIssues);

    const mcIssues = collectMcIssues(parsed, { ...ctx, stripTags, normalizeFn, ageBandKey, isMC });
    layers.mcOptions = isMC ? layerScore(LAYER_WEIGHTS.mcOptions, mcIssues) : LAYER_WEIGHTS.mcOptions;
    issues.push(...mcIssues);

    const factualOnly = semanticIssues.filter((i) => /facto|factual|errad|incorret|ortográfico/i.test(i));
    layers.factual = layerScore(LAYER_WEIGHTS.semantic, factualOnly);

    const score = Object.keys(LAYER_WEIGHTS).reduce((sum, key) => sum + (Number(layers[key]) || 0), 0);
    return { score, issues: [...new Set(issues)], layers, knowledgeKey };
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
        score: scored.score,
        layers: scored.layers,
        knowledgeKey: scored.knowledgeKey,
      };
    }
    return { ok: true, issues: [], score: scored.score, layers: scored.layers, knowledgeKey: scored.knowledgeKey };
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
    } catch { /* ignore */ }
  }

  function loadPersistentHistory() {
    migrateHistoryV2();
    const storage = getLocalStorage();
    if (!storage) return {};
    try { return JSON.parse(storage.getItem(PERSISTENT_HISTORY_KEY) || '{}'); }
    catch { return {}; }
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
        knowledgeKey: meta?.knowledgeKey || computeKnowledgeKey(question, answer, formatId, normalizeFn),
        difficulty: meta?.difficulty || 2,
        subtopic: meta?.subtopic || '',
        ts: Date.now(),
      };
      const entries = store[ageBandKey].entries || [];
      const kKey = meta?.knowledgeKey || computeKnowledgeKey(question, answer, formatId, normalizeFn);
      const dup = entries.some((e) => normalizeFn(e.q) === normQ)
        || entries.some((e) => e.knowledgeKey && knowledgeKeysMatch(e.knowledgeKey, kKey, normalizeFn));
      if (!dup) entries.push(entry);
      store[ageBandKey].entries = trimHistoryEntries(entries);
      storage.setItem(PERSISTENT_HISTORY_KEY, JSON.stringify(store));
    } catch { /* ignore */ }
  }

  global.QuestionEngine = {
    ENGINE_CONFIG,
    LAYER_WEIGHTS,
    FORMAT_IDS,
    FORMAT_LABELS,
    CATEGORY_FORMAT_MATRIX,
    CATEGORY_SUBTOPICS,
    DIFFICULTY_RANGE,
    DIFFICULTY_LABELS,
    TRUE_FALSE_CHANCE,
    TRUE_FALSE_MIN_GAP,
    FORMAT_MAX_CONSECUTIVE,
    getAllowedFormats,
    chooseFormat,
    chooseDifficulty,
    chooseSubtopic,
    buildPrompt,
    buildRetryHint,
    validateByFormat,
    validateAgeAppropriate,
    validateSemanticQuality,
    validateQuestion,
    validateFactualConsistency,
    scoreQuestion,
    computeKnowledgeKey,
    knowledgeKeysMatch,
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
    CATEGORY_RULES,
  };
})(typeof window !== 'undefined' ? window : globalThis);
