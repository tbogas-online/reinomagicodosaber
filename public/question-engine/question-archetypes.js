/**
 * Question Archetypes — intenção cognitiva da pergunta (ortogonal a formato e subtópico).
 */
(function (global) {
  'use strict';

  const Config = global.QuestionEngineConfig;
  if (!Config) {
    throw new Error('question-archetypes: carrega engine-config.js antes deste módulo');
  }
  const { FORMAT_IDS, getCategoryDef, filterFormatsForContext } = Config;

  const COGNITIVE_LEVELS = Object.freeze({
    L1_RECORDAR: 'L1_RECORDAR',
    L2_COMPREENDER: 'L2_COMPREENDER',
    L3_APLICAR: 'L3_APLICAR',
    L4_ANALISAR: 'L4_ANALISAR',
    L5_RACIOCINAR: 'L5_RACIOCINAR',
  });

  const COGNITIVE_LEVEL_LABELS = Object.freeze({
    L1_RECORDAR: 'Recordar',
    L2_COMPREENDER: 'Compreender',
    L3_APLICAR: 'Aplicar',
    L4_ANALISAR: 'Analisar',
    L5_RACIOCINAR: 'Raciocinar',
  });

  const ARCHETYPE_IDS = Object.freeze({
    IDENTIFICACAO: 'IDENTIFICACAO',
    DEFINICAO: 'DEFINICAO',
    LOCALIZACAO: 'LOCALIZACAO',
    TEMPORAL: 'TEMPORAL',
    CAUSA_EFEITO: 'CAUSA_EFEITO',
    COMPARACAO: 'COMPARACAO',
    SUPERLATIVO: 'SUPERLATIVO',
    SEQUENCIA: 'SEQUENCIA',
    APLICACAO: 'APLICACAO',
    MITO_VS_FACTO: 'MITO_VS_FACTO',
    ESTIMATIVA: 'ESTIMATIVA',
    PISTAS: 'PISTAS',
    RELACAO: 'RELACAO',
    FUNCAO: 'FUNCAO',
    PREVISAO: 'PREVISAO',
    CURIOSIDADE_FACTUAL: 'CURIOSIDADE_FACTUAL',
    CONTEXTO: 'CONTEXTO',
    REGRA: 'REGRA',
  });

  function defineArchetype(id, spec) {
    return Object.freeze({
      id,
      label: spec.label,
      cognitiveLevel: spec.cognitiveLevel,
      compatibleFormats: Object.freeze(spec.compatibleFormats.slice()),
      promptHint: spec.promptHint,
    });
  }

  const ARCHETYPES = Object.freeze({
    IDENTIFICACAO: defineArchetype(ARCHETYPE_IDS.IDENTIFICACAO, {
      label: 'Identificação',
      cognitiveLevel: COGNITIVE_LEVELS.L1_RECORDAR,
      compatibleFormats: [
        FORMAT_IDS.RESPOSTA_DIRETA, FORMAT_IDS.ESCOLHA_MULTIPLA,
        FORMAT_IDS.QUEM_E, FORMAT_IDS.O_QUE_E,
      ],
      promptHint: 'Pede para identificar UMA entidade concreta (pessoa, lugar, obra, termo). Resposta inequívoca. Não compares nem peças causas.',
    }),
    DEFINICAO: defineArchetype(ARCHETYPE_IDS.DEFINICAO, {
      label: 'Definição',
      cognitiveLevel: COGNITIVE_LEVELS.L1_RECORDAR,
      compatibleFormats: [FORMAT_IDS.O_QUE_E, FORMAT_IDS.COMPLETA, FORMAT_IDS.ESCOLHA_MULTIPLA],
      promptHint: 'Pede o significado ou definição de um conceito. Não peças uma data, um nome próprio isolado nem uma localização.',
    }),
    LOCALIZACAO: defineArchetype(ARCHETYPE_IDS.LOCALIZACAO, {
      label: 'Localização',
      cognitiveLevel: COGNITIVE_LEVELS.L1_RECORDAR,
      compatibleFormats: [FORMAT_IDS.ONDE_FICA, FORMAT_IDS.RESPOSTA_DIRETA, FORMAT_IDS.ESCOLHA_MULTIPLA],
      promptHint: 'Pede ONDE (país, cidade, continente, origem geográfica). A resposta tem de ser um sítio inequívoco — nunca "o Tejo fica em Espanha e Portugal" sem especificar nascer/desaguar.',
    }),
    TEMPORAL: defineArchetype(ARCHETYPE_IDS.TEMPORAL, {
      label: 'Temporal',
      cognitiveLevel: COGNITIVE_LEVELS.L1_RECORDAR,
      compatibleFormats: [FORMAT_IDS.QUANDO, FORMAT_IDS.ESCOLHA_MULTIPLA, FORMAT_IDS.VERDADEIRO_FALSO],
      promptHint: 'Pede QUANDO (ano, século, década ou período). A resposta é temporal — nunca um país, pessoa ou conceito.',
    }),
    CAUSA_EFEITO: defineArchetype(ARCHETYPE_IDS.CAUSA_EFEITO, {
      label: 'Causa e efeito',
      cognitiveLevel: COGNITIVE_LEVELS.L2_COMPREENDER,
      compatibleFormats: [
        FORMAT_IDS.CAUSA_CONSEQUENCIA, FORMAT_IDS.RESPOSTA_DIRETA, FORMAT_IDS.ESCOLHA_MULTIPLA,
      ],
      promptHint: 'Pede a CAUSA ou a CONSEQUÊNCIA de um fenómeno/acontecimento concreto. Nunca um facto isolado (data, capital, nome).',
    }),
    COMPARACAO: defineArchetype(ARCHETYPE_IDS.COMPARACAO, {
      label: 'Comparação',
      cognitiveLevel: COGNITIVE_LEVELS.L4_ANALISAR,
      compatibleFormats: [
        FORMAT_IDS.ESCOLHA_MULTIPLA, FORMAT_IDS.VERDADEIRO_FALSO, FORMAT_IDS.RESPOSTA_DIRETA,
      ],
      promptHint: 'Compara DOIS elementos concretos e conhecidos (diferença, semelhança ou qual é maior/menor num critério). Nunca um facto isolado.',
    }),
    SUPERLATIVO: defineArchetype(ARCHETYPE_IDS.SUPERLATIVO, {
      label: 'Superlativo / recorde',
      cognitiveLevel: COGNITIVE_LEVELS.L2_COMPREENDER,
      compatibleFormats: [FORMAT_IDS.RESPOSTA_DIRETA, FORMAT_IDS.ESCOLHA_MULTIPLA],
      promptHint: 'Pede o maior, menor, primeiro ou recorde, com critério explícito (área, comprimento, velocidade, data). Evita empates ambíguos.',
    }),
    SEQUENCIA: defineArchetype(ARCHETYPE_IDS.SEQUENCIA, {
      label: 'Sequência / ordem',
      cognitiveLevel: COGNITIVE_LEVELS.L4_ANALISAR,
      compatibleFormats: [FORMAT_IDS.COMPLETA, FORMAT_IDS.RESPOSTA_DIRETA, FORMAT_IDS.ESCOLHA_MULTIPLA],
      promptHint: 'Pede ordem cronológica, o próximo elemento de um padrão, ou o que acontece primeiro. A resposta é um passo da sequência, não um facto solto.',
    }),
    APLICACAO: defineArchetype(ARCHETYPE_IDS.APLICACAO, {
      label: 'Aplicação prática',
      cognitiveLevel: COGNITIVE_LEVELS.L3_APLICAR,
      compatibleFormats: [FORMAT_IDS.SITUACAO_PRATICA, FORMAT_IDS.ESCOLHA_MULTIPLA, FORMAT_IDS.RESPOSTA_DIRETA],
      promptHint: 'Cenário curto do quotidiano: o jogador aplica uma regra, princípio ou cálculo. Uma resposta objectiva. Não peças só a definição do conceito.',
    }),
    MITO_VS_FACTO: defineArchetype(ARCHETYPE_IDS.MITO_VS_FACTO, {
      label: 'Mito vs facto',
      cognitiveLevel: COGNITIVE_LEVELS.L4_ANALISAR,
      compatibleFormats: [FORMAT_IDS.VERDADEIRO_FALSO, FORMAT_IDS.CURIOSIDADE],
      promptHint: 'Afirmação para julgar verdadeira ou falsa. Privilegia mitos comuns ou factos surpreendentes mas verificáveis — não perguntas escolares banais.',
    }),
    ESTIMATIVA: defineArchetype(ARCHETYPE_IDS.ESTIMATIVA, {
      label: 'Estimativa / cálculo',
      cognitiveLevel: COGNITIVE_LEVELS.L3_APLICAR,
      compatibleFormats: [
        FORMAT_IDS.RESPOSTA_DIRETA, FORMAT_IDS.ESCOLHA_MULTIPLA, FORMAT_IDS.SITUACAO_PRATICA,
      ],
      promptHint: 'Cálculo, estimativa ou proporção. Calcula internamente a resposta numérica ANTES de devolver. Números adequados à idade.',
    }),
    PISTAS: defineArchetype(ARCHETYPE_IDS.PISTAS, {
      label: 'Identificação por pistas',
      cognitiveLevel: COGNITIVE_LEVELS.L4_ANALISAR,
      compatibleFormats: [FORMAT_IDS.ADIVINHA],
      promptHint: 'Adivinha com pistas que apontam a UMA resposta. Não transformes um facto escolar directo numa adivinha forçada.',
    }),
    RELACAO: defineArchetype(ARCHETYPE_IDS.RELACAO, {
      label: 'Relação entre entidades',
      cognitiveLevel: COGNITIVE_LEVELS.L2_COMPREENDER,
      compatibleFormats: [
        FORMAT_IDS.QUEM_E, FORMAT_IDS.O_QUE_E, FORMAT_IDS.ESCOLHA_MULTIPLA, FORMAT_IDS.RESPOSTA_DIRETA,
      ],
      promptHint: 'Liga DUAS entidades (autor↔obra, atleta↔feito, acontecimento↔personagem, prato↔região). A pergunta testa a relação, não um dos lados isolado.',
    }),
    FUNCAO: defineArchetype(ARCHETYPE_IDS.FUNCAO, {
      label: 'Função',
      cognitiveLevel: COGNITIVE_LEVELS.L2_COMPREENDER,
      compatibleFormats: [FORMAT_IDS.O_QUE_E, FORMAT_IDS.SITUACAO_PRATICA, FORMAT_IDS.ESCOLHA_MULTIPLA],
      promptHint: 'Pede para que serve / qual é a função principal. Resposta = papel ou utilidade, não o nome isolado sem contexto.',
    }),
    PREVISAO: defineArchetype(ARCHETYPE_IDS.PREVISAO, {
      label: 'Previsão',
      cognitiveLevel: COGNITIVE_LEVELS.L3_APLICAR,
      compatibleFormats: [
        FORMAT_IDS.CAUSA_CONSEQUENCIA, FORMAT_IDS.SITUACAO_PRATICA, FORMAT_IDS.ESCOLHA_MULTIPLA,
      ],
      promptHint: 'O que aconteceria SE… Resultado observável e ensinável, não opinião. Evita cenários perigosos ou assustadores.',
    }),
    CURIOSIDADE_FACTUAL: defineArchetype(ARCHETYPE_IDS.CURIOSIDADE_FACTUAL, {
      label: 'Curiosidade',
      cognitiveLevel: COGNITIVE_LEVELS.L2_COMPREENDER,
      compatibleFormats: [FORMAT_IDS.CURIOSIDADE, FORMAT_IDS.VERDADEIRO_FALSO, FORMAT_IDS.ESCOLHA_MULTIPLA],
      promptHint: 'Facto surpreendente que provoque "Não sabia disso!". Não faças uma pergunta escolar banal de capital, data óbvia ou definição de manual.',
    }),
    CONTEXTO: defineArchetype(ARCHETYPE_IDS.CONTEXTO, {
      label: 'Contexto',
      cognitiveLevel: COGNITIVE_LEVELS.L2_COMPREENDER,
      compatibleFormats: [FORMAT_IDS.RESPOSTA_DIRETA, FORMAT_IDS.ESCOLHA_MULTIPLA, FORMAT_IDS.O_QUE_E],
      promptHint: 'Em que contexto, movimento, época ou situação se insere X. Não peças só o nome de X.',
    }),
    REGRA: defineArchetype(ARCHETYPE_IDS.REGRA, {
      label: 'Regra / procedimento',
      cognitiveLevel: COGNITIVE_LEVELS.L2_COMPREENDER,
      compatibleFormats: [FORMAT_IDS.O_QUE_E, FORMAT_IDS.SITUACAO_PRATICA, FORMAT_IDS.ESCOLHA_MULTIPLA],
      promptHint: 'Pede uma regra, procedimento ou o que acontece quando se aplica uma norma (desporto, circulação, jogo, gramática).',
    }),
  });

  const ARCHETYPE_LABELS = Object.freeze(
    Object.fromEntries(Object.values(ARCHETYPES).map((a) => [a.id, a.label])),
  );

  /** Archetypes pouco adequados a 6–9 (raciocínio hipotético / abstracto). */
  const ARCHETYPE_AGE_EXCLUDED = Object.freeze({
    '6-9': Object.freeze([ARCHETYPE_IDS.PREVISAO]),
    '10-15': Object.freeze([]),
    '15+': Object.freeze([]),
  });

  function getArchetype(id) {
    return ARCHETYPES[id] || null;
  }

  function filterFormatsForArchetype(formats, archetypeId) {
    const arch = getArchetype(archetypeId);
    if (!arch) return (formats || []).slice();
    const allowed = new Set(arch.compatibleFormats);
    return (formats || []).filter((f) => allowed.has(f));
  }

  function getAllowedArchetypes(categoryNumber, ageBandKey, answerMode) {
    const def = getCategoryDef(categoryNumber);
    const ids = (def.archetypes && def.archetypes.length)
      ? def.archetypes.slice()
      : [ARCHETYPE_IDS.IDENTIFICACAO];
    const excluded = new Set(ARCHETYPE_AGE_EXCLUDED[ageBandKey] || []);
    const usable = ids.filter((id) => {
      if (excluded.has(id)) return false;
      const arch = getArchetype(id);
      if (!arch) return false;
      const compatible = (def.formats || []).filter((f) => arch.compatibleFormats.includes(f));
      return filterFormatsForContext(compatible, ageBandKey, answerMode).length > 0;
    });
    if (usable.length) return usable;
    const fallback = filterFormatsForArchetype(def.formats || [], ARCHETYPE_IDS.IDENTIFICACAO);
    if (filterFormatsForContext(fallback, ageBandKey, answerMode).length) {
      return [ARCHETYPE_IDS.IDENTIFICACAO];
    }
    return ids.length ? [ids[0]] : [ARCHETYPE_IDS.IDENTIFICACAO];
  }

  function buildArchetypeRules(archetypeId) {
    const arch = getArchetype(archetypeId);
    if (!arch) return '';
    const cog = COGNITIVE_LEVEL_LABELS[arch.cognitiveLevel] || arch.cognitiveLevel;
    return `ARCHETYPE OBRIGATÓRIO: ${arch.label} (${arch.id}) — nível cognitivo: ${cog}.
INTENÇÃO: ${arch.promptHint}
Não mudes de archetype: a pergunta tem de testar esta operação, não outra.`;
  }

  global.QuestionEngineArchetypes = Object.freeze({
    ARCHETYPE_IDS,
    ARCHETYPE_LABELS,
    ARCHETYPES,
    COGNITIVE_LEVELS,
    COGNITIVE_LEVEL_LABELS,
    ARCHETYPE_AGE_EXCLUDED,
    getArchetype,
    filterFormatsForArchetype,
    getAllowedArchetypes,
    buildArchetypeRules,
  });
})(typeof window !== 'undefined' ? window : globalThis);
