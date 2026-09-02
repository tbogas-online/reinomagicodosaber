/**
 * Construção de prompts — regras globais, formato, histórico e escolha de formato (Fase 9).
 */
(function (global) {
  'use strict';

  const Config = global.QuestionEngineConfig;
  if (!Config) {
    throw new Error('prompt-builder: carrega engine-config.js antes deste módulo');
  }
  const {
    TRUE_FALSE_CHANCE,
    TRUE_FALSE_MIN_GAP,
    FORMAT_MAX_CONSECUTIVE,
    FORMAT_IDS,
    FORMAT_LABELS,
    DIFFICULTY_RANGE,
    DIFFICULTY_LABELS,
    getAgeLimits,
    getCategoryDef,
    filterFormatsForContext,
    defaultFormatForAnswerMode,
    filterKnowledgeAnswers,
  } = Config;

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

  function pickMusicFocus() {
    return MUSIC_FOCUS_AREAS[Math.floor(Math.random() * MUSIC_FOCUS_AREAS.length)];
  }

  function pickTechFocus() {
    return TECH_FOCUS_AREAS[Math.floor(Math.random() * TECH_FOCUS_AREAS.length)];
  }

  function buildGlobalRules() {
    const contentSafetyRules = global.QuestionEngineContentSafety?.buildContentSafetyPromptRules
      ? global.QuestionEngineContentSafety.buildContentSafetyPromptRules()
      : '';
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
${contentSafetyRules ? `\n${contentSafetyRules}\n` : ''}- Não repitas o mesmo conhecimento de perguntas anteriores (mesmo com palavras diferentes).
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
      ADIVINHA: (ageBandKey === '6-9' || ageBandKey === '10-15')
        ? `FORMATO: ADIVINHA — adivinha tradicional portuguesa de cultura popular (ditados, brincadeiras de infância). Tom lúdico; podes usar linguagem e imagens poéticas típicas das adivinhas clássicas, mesmo que a frase seja mais longa ou a resposta seja uma palavra menos óbvia para quem não conhece o ditado.
NÃO transformes um facto escolar directo numa adivinha forçada. Inclui array "clues" com 2–5 pistas curtas.`
        : (ageBandKey === '15+'
          ? `FORMATO: ADIVINHA — adivinha tradicional portuguesa, tom lúdico. Resposta ABERTA (o jogador escreve/pensa a resposta — sem opções de escolha múltipla). Inclui array "clues" com 2–5 pistas curtas validadas semanticamente.`
          : `FORMATO: ADIVINHA — adivinha tradicional portuguesa, tom lúdico, adequada à idade. NÃO transformes um facto directo numa adivinha forçada.
Usa "Que animal…" / "O que é…" — NÃO "Quem é o animal". A resposta tem de encaixar claramente nas pistas (ex.: instrumento batido → tambor, não bola).
Inclui array "clues" com 2–5 pistas curtas (frases ou fragmentos) que apontam unicamente para a resposta — serão validadas semanticamente.`),
      CURIOSIDADE: `FORMATO OBRIGATÓRIO: CURIOSIDADE — facto surpreendente em PT-PT claro, que provoque "Não sabia disso!". Frase curta e natural em voz alta.
SEMPRE Verdadeiro ou Falso: afirmação + "Verdadeiro ou Falso?" no final. Campo "a" = exactamente "Verdadeiro" ou "Falso". Opções: ["Verdadeiro","Falso"] — PROIBIDO "Não sei", "Às vezes", distractores de escolha múltipla.
BOM: "Sabias que os Jogos Olímpicos de Tóquio de 2020 só se realizaram em 2021 por causa da pandemia? Verdadeiro ou Falso?" / "É verdade que um polvo tem três corações? Verdadeiro ou Falso?"
MAU: "Em que ano foram os Jogos Olímpicos em Tóquio?" (isso é QUANDO, não curiosidade). MAU: opções como "Não sei" ou "Às vezes". MAU: misturar palavras em chinês ou outro idioma (ex.: «延期») — só português.`,
    };
    return rules[formatId] || rules.RESPOSTA_DIRETA;
  }

  function buildAgeRules(ageBandKey, ageBandPromptText) {
    const { ageRulesText } = getAgeLimits(ageBandKey);
    return `IDADE E DIFICULDADE (${ageBandKey}): ${ageBandPromptText}
${ageRulesText}`;
  }

  function countConsecutiveFormat(recent, formatId) {
    let n = 0;
    for (let i = recent.length - 1; i >= 0; i--) {
      if (recent[i] === formatId) n++;
      else break;
    }
    return n;
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

    const formatMix = getCategoryDef(categoryNumber).formatMix;
    if (formatMix) {
      const mixPool = allowed.filter((f) => (formatMix[f] || 0) > 0);
      const pickFrom = mixPool.length ? mixPool : allowed;
      const weights = pickFrom.map((f) => formatMix[f] || 0);
      return weightedPick(pickFrom, weights);
    }

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

  /**
   * Resposta esperada para validação — curiosidades V/F usam isTrue; adivinhas usam answer.
   */
  function getRepositoryExpectedAnswer(record) {
    if (!record) return '';
    if (record.isTrue === false) return 'Falso';
    if (record.isTrue === true) return 'Verdadeiro';
    return String(record.answer || '');
  }

  /**
   * Prompt restrito — IA formula a pergunta a partir de um facto verificado (KR-1 / KR-2).
   * Proíbe inventar factos; a resposta "a" tem de coincidir com o registo.
   */
  function buildPromptFromFact(record, ctx) {
    const {
      category, ageBandKey, ageBandPromptText, formatId, ptPtRules, isMC, isTrueFalse,
      ageDifficultyExtra, openModeExtra, mcInstruction, jsonFormat, retryHint,
    } = ctx;

    if (!record?.fact) {
      throw new Error('buildPromptFromFact: registo incompleto');
    }

    const formatLabel = FORMAT_LABELS[formatId] || formatId;
    const retryBlock = retryHint ? `\n${retryHint}\n` : '';
    const sourceLine = record.sourceId
      ? `${record.source} · ${record.sourceId}`
      : String(record.source || 'repositório');
    const expectedAnswer = getRepositoryExpectedAnswer(record);

    if (formatId === FORMAT_IDS.ADIVINHA) {
      if (!record.answer) throw new Error('buildPromptFromFact: adivinha sem resposta');
      const cluesJson = JSON.stringify(Array.isArray(record.clues) ? record.clues : []);
      return `Formulas UMA adivinha em português de Portugal a partir do FACTO VERIFICADO abaixo.
NÃO inventes factos, respostas nem pistas novas — usa apenas o material fornecido.

FACTO VERIFICADO (fonte: ${sourceLine}):
- Resposta correcta OBRIGATÓRIA no campo "a": ${record.answer}
- Base/facto: ${record.fact}
- Pistas oficiais (podes reordenar em "clues", sem inventar nem alterar o sentido): ${cluesJson}

REGRAS DO REPOSITÓRIO (obrigatórias):
- O campo "a" tem de ser EXACTAMENTE "${record.answer}" — sem sinónimos nem variantes.
- Reformula apenas "q" como adivinha natural em PT-PT; podes reordenar as pistas oficiais em "clues" (2–5 entradas).
- NÃO mudes a resposta nem o significado do facto.
- NÃO cries curiosidades factuais nem perguntas directas de cultura geral.

CATEGORIA: ${category.name} (${category.desc})
FORMATO: ${formatLabel} (${formatId})
IDADE: ${ageBandPromptText}
${retryBlock}
${buildGlobalRules()}

${buildFormatRules(formatId, { ageBandKey, isMC, isTrueFalse })}

${buildAgeRules(ageBandKey, ageBandPromptText)}
${ageDifficultyExtra || ''}

${ptPtRules || ''}
${openModeExtra || ''}
${mcInstruction || ''}

Só json válido, sem markdown: ${jsonFormat}`;
    }

    if (formatId === FORMAT_IDS.CURIOSIDADE || formatId === FORMAT_IDS.VERDADEIRO_FALSO) {
      const statementHint = record.statement
        ? `- Afirmação de referência (podes adaptar ligeiramente em "q"): ${record.statement}`
        : '';
      const presentation = formatId === FORMAT_IDS.VERDADEIRO_FALSO
        ? 'afirmação factual directa terminada em "Verdadeiro ou Falso?"'
        : 'curiosidade surpreendente com "Sabias que…" ou "É verdade que…" e "Verdadeiro ou Falso?" no final';
      return `Formulas UMA curiosidade em português de Portugal a partir do FACTO VERIFICADO abaixo.
NÃO inventes factos nem alteres a verdade do registo — só reformula em PT-PT natural.

FACTO VERIFICADO (fonte: ${sourceLine}):
- Resposta correcta OBRIGATÓRIA no campo "a": ${expectedAnswer}
- Facto/base: ${record.fact}
${statementHint}

REGRAS DO REPOSITÓRIO (obrigatórias):
- O campo "a" tem de ser EXACTAMENTE "${expectedAnswer}" — só "Verdadeiro" ou "Falso".
- Apresentação: ${presentation}.
- NÃO transformes em pergunta de ano, capital ou geografia banal.
- NÃO inventes dados novos nem contradigas o facto verificado.

CATEGORIA: ${category.name} (${category.desc})
FORMATO: ${formatLabel} (${formatId})
IDADE: ${ageBandPromptText}
${retryBlock}
${buildGlobalRules()}

${buildFormatRules(formatId === FORMAT_IDS.VERDADEIRO_FALSO ? FORMAT_IDS.CURIOSIDADE : formatId, { ageBandKey, isMC, isTrueFalse: true })}

${buildAgeRules(ageBandKey, ageBandPromptText)}
${ageDifficultyExtra || ''}

${ptPtRules || ''}
${openModeExtra || ''}
${mcInstruction || ''}

Só json válido, sem markdown: ${jsonFormat}`;
    }

    throw new Error(`buildPromptFromFact: formato não suportado (${formatId})`);
  }

  global.QuestionEnginePromptBuilder = {
    buildGlobalRules,
    buildFormatRules,
    buildAgeRules,
    buildHistoryRules,
    countConsecutiveFormat,
    fisherYates,
    chooseDifficulty,
    chooseSubtopic,
    getAllowedFormats,
    chooseFormat,
    buildPrompt,
    buildPromptFromFact,
    getRepositoryExpectedAnswer,
    pickMusicFocus,
    pickTechFocus,
  };
})(typeof window !== 'undefined' ? window : globalThis);
