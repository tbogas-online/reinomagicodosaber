/** Regras de factos/ambiguidades reportados — dados + runner (Fase 1 modularização). */
(function (global) {
  'use strict';

  const Issues = global.QuestionEngineIssues;
  if (!Issues) {
    throw new Error('known-facts: carrega issue-codes.js antes deste módulo');
  }
  const { mkIssue, issueMessage, issueCode } = Issues;

  const LAYER = Object.freeze({ semantic: 'semantic', factual: 'factual', language: 'language' });

  const CONFUSING_FACT_PREFIXES = ['pergunta confusa', 'formulação', 'resposta ambígua — asfalto', 'pergunta circular'];

  const REPORTED_FACT_RULES = [
    {
      code: "FACT_01_PERGUNTA_AMBIGUA_WOODY_E_JES",
      layer: LAYER.semantic,
      message: "pergunta ambígua — Woody e Jessie usam chapéu de cowboy; especifica \"xerife\", \"vaqueira\" ou outro detalhe único",
      when: (q, a, opts) => /\btoy\s*story\b/i.test(q) && /\b(chapéu|chapeu)\b/i.test(q) && /\b(cowboy|vaqueir|xerife)\b/i.test(q),
    },
    {
      code: "FACT_02_PERGUNTA_AMBIGUA_EM_PT_PT_US",
      layer: LAYER.semantic,
      message: "pergunta ambígua — em PT-PT usa \"Ursinho Puff\" de forma única (não Pooh/Winnie em separado)",
      when: (q, a, opts) => /\b(ursinho|urso)\b.*\bmel\b|\bmel\b.*\b(ursinho|urso)\b/i.test(q) && /\b(disney|desenho)\b/i.test(q) && (/\b(pooh|winnie|puff)\b/i.test(a) || opts.some((o) => /\b(pooh|winnie|puff)\b/i.test(o))),
    },
    {
      code: "FACT_03_PERGUNTA_AMBIGUA_MAIS_DO_QUE",
      layer: LAYER.semantic,
      message: "pergunta ambígua — mais do que um personagem encaixa na descrição",
      when: (q, a, opts) => /\bqual\s+(personagem|herói|heroi)\b/i.test(q) && /\b(chapéu|chapeu|óculos|oculos|veste|usa)\b/i.test(q) && !/\b(único|unico|só\s+ele|so\s+ele|principal|xerife|vaqueira)\b/i.test(q) && /\bwoody\b/i.test(a) && opts.some((o) => /\bjessie\b/i.test(o)),
    },
    {
      code: "FACT_04_PERGUNTA_AMBIGUA_VARIOS_ANIM",
      layer: LAYER.semantic,
      message: "pergunta ambígua — vários animais marinhos/aves dormem com um olho aberto; especifica espécie ou contexto",
      when: (q, a) => /\b(olho aberto|metade do cérebro|metade do cerebro|unihemisfério|unihemisferio)\b/i.test(q) && /\b(golfinho|baleia|pato|foca)\b/i.test(a),
    },
    {
      code: "FACT_05_RESPOSTA_MASCULINA_INCOMPATI",
      layer: LAYER.semantic,
      message: "resposta masculina incompatível com \"primeira mulher\"",
      when: (q, a) => /\b(primeira\s+mulher|primeira\s+realizadora)\b/i.test(q) && /\b(steven|spielberg|scorsese|nolan|cameron|tarantino|hitchcock|kubrick)\b/i.test(a),
    },
    {
      code: "FACT_06_PERGUNTA_CONTRADITORIA_PRIME",
      layer: LAYER.semantic,
      message: "pergunta contraditória — \"primeira mulher\" com \"realizador\"",
      when: (q) => /\b(primeira\s+mulher|primeira\s+realizadora)\b/i.test(q) && /\brealizador\b/i.test(q) && !/\brealizadora\b/i.test(q),
    },
    {
      code: "FACT_07_FACTO_INCORRETO_A_LISTA_DE_S",
      layer: LAYER.factual,
      message: "facto incorreto — A Lista de Schindler não se liga ao primeiro Óscar de melhor realizadora",
      when: (q) => /\blista de schindler\b/i.test(q) && /\bprimeira\s+mulher\b/i.test(q),
    },
    {
      code: "FACT_08_RESPOSTA_NAO_CORRESPONDE_A_D",
      layer: LAYER.semantic,
      message: "resposta não corresponde à descrição de tamanho",
      when: (q, a) => /\b(4[,.]5\s*metros?|metros?\s+de\s+altura|mais\s+alto|altura.*ombros)\b/i.test(q) && /\b(maior|animal\s+terrestre)\b/i.test(q) && /\bzebra\b/i.test(a) && /\b(giraf|elefant|altura|ombros|4)\b/i.test(q),
    },
    {
      code: "FACT_09_ZEBRA_NAO_E_O_MAIOR_ANIMAL_T",
      layer: LAYER.semantic,
      message: "zebra não é o maior animal terrestre",
      when: (q, a) => /\bmaior animal terrestre\b/i.test(q) && /\bzebra\b/i.test(a),
    },
    {
      code: "FACT_10_NA_CHUVA_O_ACESSORIO_USUAL_E",
      layer: LAYER.semantic,
      message: "na chuva, o acessório usual é guarda-chuva ou impermeável, não luvas",
      when: (q, a) => /\b(chove|chuva)\b/i.test(q) && /\b(mãos|maos)\b/i.test(q) && /\bacessório\b/i.test(q) && /\b(luvas|gorro|cachecol)\b/i.test(a),
    },
    {
      code: "FACT_11_PERGUNTA_VAGA_TRACO_FISICO_G",
      layer: LAYER.semantic,
      message: "pergunta vaga — traço físico genérico não identifica uma pessoa de forma única",
      when: (q) => /\b(cabelo|olhos)\s+(castanh|azul|verde|loiro|ruivo)\b/i.test(q) && /\b(artista|cantor|pianista|músico|música)\b/i.test(q),
    },
    {
      code: "FACT_12_DEFINICAO_CIRCULAR_OU_DEMASI",
      layer: LAYER.semantic,
      message: "definição circular ou demasiado vaga no \"O que é\"",
      when: (q, a) => /^o\s+que\s+é\s+(um|uma)\s+/i.test(q) && /^(imagem\s+de|tipo\s+de|forma\s+de)\b/i.test(a),
    },
    {
      code: "FACT_13_RESPOSTA_FACTUALMENTE_ERRADA",
      layer: LAYER.factual,
      message: "resposta factualmente errada — arco-íris é um fenómeno da luz e da água no céu",
      when: (q, a) => /\barco[-\s]?íris|arco[-\s]?iris\b/i.test(q) && /\b(desenho|pintura|nuvem|animal|fruta|planta)\b/i.test(a),
    },
    {
      code: "FACT_14_DEFINICAO_ERRADA_NAO_CONFUND",
      layer: LAYER.factual,
      message: "definição errada — não confundir fenómeno natural com \"desenho\" ou \"pintura\"",
      when: (q, a) => /^o\s+que\s+é\s+(um|uma)\s+/i.test(q) && /\b(desenho|pintura)\s+de\s+(cores|luz)\b/i.test(a),
    },
    {
      code: "FACT_15_BICA_E_GALAO_DIFEREM_SOBRETU",
      layer: LAYER.semantic,
      message: "bica e galão diferem sobretudo na proporção de leite — pergunta ambígua",
      when: (q, a) => /\b(bica|galão)\b/i.test(q) && /\balém\b.*\bproporção\b/i.test(q) && /\bcafé\b/i.test(a),
    },
    {
      code: "FACT_16_PERGUNTA_AMBIGUA_MAPA_E_GLOB",
      layer: LAYER.semantic,
      message: "pergunta ambígua — mapa e globo terráqueo respondem às mesmas pistas",
      when: (q, a, opts) => {
      const mapGlobeRiddle = /\bcidades\b/i.test(q) && /\bn[aã]o\s+casas\b/i.test(q)
        && /\bmontanhas\b/i.test(q) && /\bn[aã]o\s+(árvores|arvores)\b/i.test(q)
        && /\b(água|agua)\b/i.test(q) && /\bn[aã]o\s+peixes\b/i.test(q);
      if (!mapGlobeRiddle) return false;
      const hasMapa = opts.some((o) => /\bmapa\b/i.test(o)) || /\bmapa\b/i.test(a);
      const hasGlobo = opts.some((o) => /\bglobo\b/i.test(o));
      return hasMapa && hasGlobo;
    },
    },
    {
      code: "FACT_17_FACTO_INCORRETO_O_PASTEL_DE_",
      layer: LAYER.factual,
      message: "facto incorreto — o pastel de nata associa-se a Belém/Lisboa",
      when: (q, a) => /\bpastel\s+de\s+nata\b/i.test(q) && /\b(cidade|onde|fica|nasceu|origem|populariz|criado|inventado)\b/i.test(q) && !/\b(lisboa|bel[eé]m)\b/i.test(String(a || '')),
    },
    {
      code: "FACT_18_FACTO_INCORRETO_A_FRANCESINH",
      layer: LAYER.factual,
      message: "facto incorreto — a francesinha é típica do Porto",
      when: (q, a) => /\bfrancesinha\b/i.test(q) && /\b(cidade|onde|fica|origem|nasceu|típic[ao])\b/i.test(q) && !/\bporto\b/i.test(String(a || '')),
    },
    {
      code: "FACT_19_FACTO_CULTURAL_A_CHITA_ASSOC",
      layer: LAYER.factual,
      message: "facto cultural — a chita associa-se sobretudo a Alcobaça; não confundir com o traje de Viana sem contexto histórico claro",
      when: (q) => /\bchita\b/i.test(q) && /\btraje\b/i.test(q) && /\bviana\b/i.test(q),
    },
    {
      code: "FACT_20_PERGUNTA_AMBIGUA_VARIOS_PRAT",
      layer: LAYER.semantic,
      message: "pergunta ambígua — vários pratos de bacalhau são igualmente defensáveis; indica um prato específico",
      when: (q, a, opts) => {
      if (!/\bbacalhau\b/i.test(q) || !/\b(prato|pratos|típic[oa]s?)\b/i.test(q)) return false;
      const all = [a, ...(opts || [])].map((x) => String(x || ''));
      return all.filter((x) => /\bbacalhau\b/i.test(x)).length >= 2;
    },
    },
    {
      code: "FACT_21_TEMA_ASTRONOMICO_DEMASIADO_T",
      layer: LAYER.semantic,
      message: "tema astronómico demasiado técnico ou obscuro para o jogo",
      when: (q) => /\bpulsar\b/i.test(q) && (/\bpsr\b/i.test(q) || /\bplaneta\b.*\b[óo]rbita\b/i.test(q) || /\bpulsa[çc][õo]es\b/i.test(q)),
    },
    {
      code: "FACT_22_FACTO_INCORRETO_EDDY_MERCKX_",
      layer: LAYER.factual,
      message: "facto incorreto — Eddy Merckx não venceu o Tour de 1975 (vencedor: Bernard Thévenet)",
      when: (q) => /\bmerckx\b/i.test(q) && /\b1975\b/.test(q) && /\btour\s+de\s+france\b/i.test(q) && /\bvenceu\b/i.test(q),
    },
    {
      code: "FACT_23_FACTO_DUVIDOSO_VANTAGENS_NO_",
      layer: LAYER.factual,
      message: "facto duvidoso — vantagens no ciclismo medem-se em minutos ou horas, não em dias",
      when: (q) => /\b(vantagem|diferen[çc]a)\b/i.test(q) && /\b\d+\s+dias\b/i.test(q) && /\b(tour|ciclismo|ciclista|volta)\b/i.test(q),
    },
    {
      code: "FACT_24_INCONSISTENCIA_DE_GENERO_A_P",
      layer: LAYER.semantic,
      message: "inconsistência de género — a pergunta pede uma mulher mas a resposta é um nome masculino",
      when: (q, a) => /\b(a|uma)\s+(engenheira|actriz|atriz|inventora|escritora|diretora|realizadora)\b/i.test(q) && /\b(dario|martin|james|john|robert|leonardo|quentin|stanley|heath|elon|ray|hiroshi)\b/i.test(String(a || '').toLowerCase()),
    },
    {
      code: "FACT_25_FACTO_INCORRETO_ROALD_DAHL_N",
      layer: LAYER.factual,
      message: "facto incorreto — Roald Dahl não escreveu \"O rato que queria ser rei\"",
      when: (q) => /\broald\s+dahl\b/i.test(q) && /\brato\b/i.test(q) && /\b(queria\s+ser|ser)\s+rei\b/i.test(q),
    },
    {
      code: "FACT_26_ERRO_ORTOGRAFICO_ESCREVE_ASF",
      layer: LAYER.semantic,
      message: "erro ortográfico — escreve \"asfalto\" (não \"asfato\")",
      when: (q, a) => /\basfato\b/i.test(a) && !/\basfalto\b/i.test(a),
    },
    {
      code: "FACT_27_FORMULACAO_ESTRANHA_DIZ_ESTR",
      layer: LAYER.semantic,
      message: "formulação estranha — diz \"estrada\" ou \"piso da estrada\", não \"estrada para os carros\"",
      when: (q) => /\bestrada\s+para\s+os\s+carros\b/i.test(q),
    },
    {
      code: "FACT_28_RESPOSTA_AMBIGUA_ASFALTO_E_A",
      layer: LAYER.semantic,
      message: "resposta ambígua — asfalto e alcatrão são ambos aceitáveis em PT-PT; reformula ou escolhe outro tema",
      when: (q, a) => /\b(estrad|autoestrada)\b/i.test(q) && /\bfeit[ao]\s+de\b/i.test(q) && /\b(asfalto|alcatrão|alcatrao|betume)\b/i.test(a),
    },
    {
      code: "FACT_29_PERGUNTA_CONFUSA_RATO_QUE_FA",
      layer: LAYER.semantic,
      message: "pergunta confusa — \"rato que faz queijo\" é o Remy (Ratatouille), não o Mickey nem outros personagens clássicos",
      when: (q, a, opts) => {
      if (!(/\b(rato|ratos)\b/i.test(q) && /\bqueijo\b/i.test(q) && /\b(disney|pixar|filme)\b/i.test(q))) return false;
      const all = [a, ...(opts || [])].map((x) => String(x || '').toLowerCase());
      if (all.some((x) => /\b(remy|rémy|ratatouille)\b/i.test(x))) return false;
      return true;
    },
    },
    {
      code: "FACT_30_FACTO_INCORRETO_O_RATO_QUE_C",
      layer: LAYER.factual,
      message: "facto incorreto — o rato que cozinha/faz queijo é o Remy (Ratatouille), não o Mickey",
      when: (q, a) => /\b(rato|ratos)\b/i.test(q) && /\bqueijo\b/i.test(q) && /\b(disney|pixar|filme)\b/i.test(q) && /\bmickey\b/i.test(a),
    },
    {
      code: "FACT_31_FACTO_DUVIDOSO_DESIGNER_OBRA",
      layer: LAYER.factual,
      message: "facto duvidoso — designer/obras de moda portuguesa obscuras; prefere temas verificáveis (ex.: Nuno Gama)",
      when: (q, a) => /\b(sapatilha|sapato)\b/i.test(q) && /\b(salto|madeira)\b/i.test(q) && /\b(designer|criou|criador|famoso)\b/i.test(q) && /\bmanuel\s+branco\b/i.test(a),
    },
    {
      code: "FACT_32_PERGUNTA_CONFUSA_PATO_DE_BOR",
      layer: LAYER.semantic,
      message: "pergunta confusa — pato de borracha não tem penas reais; reformula a adivinha",
      when: (q, a) => /\b(asas|asa)\b/i.test(q) && /\b(penas|pena)\b/i.test(q) && /\bn[aã]o\s+voa\b/i.test(q) && /\bpato\s+de\s+borracha\b/i.test(a),
    },
    {
      code: "FACT_33_FACTO_DISPUTADO_COMPRIMENTO_",
      layer: LAYER.factual,
      message: "facto disputado — comprimento do Nilo vs Amazónia varia conforme a medição; evita V/F absoluto",
      when: (q) => /\bnilo\b/i.test(q) && /\b(mais\s+longo|maior\s+rio)\b/i.test(q) && /verdadeiro\s+ou\s+falso/i.test(q),
    },
    {
      code: "FACT_34_FACTO_DESPORTIVO_ESPECIFICO_",
      layer: LAYER.factual,
      message: "facto desportivo específico do Mundial 2026 não verificável — evita golos/jogadores desse torneio",
      when: (q) => /\b(copa\s+do\s+mundo|mundial)\b/i.test(q) && /\b2026\b/.test(q) && /\b(golo|golos|marcou|jogador|sele[cç][ãa]o)\b/i.test(q),
    },
    {
      code: "FACT_35_TERMO_BRASILEIRO_EM_PT_PT_US",
      layer: LAYER.factual,
      message: "termo brasileiro — em PT-PT usa \"Mundial\" ou \"Campeonato do Mundo\"",
      when: (q) => /\bcopa\s+do\s+mundo\b/i.test(q),
    },
    {
      code: "FACT_36_PERGUNTA_VAGA_CHAPEU_E_OCULO",
      layer: LAYER.semantic,
      message: "pergunta vaga — chapéu e óculos não identificam um cantor de forma única",
      when: (q) => /\b(chapéu|chapeu)\b/i.test(q) && /\b(óculos|oculos)\b/i.test(q) && /\b(canta|cantor|cantora|festival)\b/i.test(q),
    },
    {
      code: "FACT_37_PERGUNTA_CONFUSA_EVITA_O_QUE",
      layer: LAYER.semantic,
      message: "pergunta confusa — evita \"O que é a [parte] da planta/árvore?\"; reformula (ex.: \"Para que serve a flor?\")",
      when: (q, _a, _o, _ql, _al, formatId) => formatId === 'O_QUE_E' && /^o\s+que\s+é\s+(?:a|o|um|uma)\s+(flor|folha|raiz|tronco|casca|semente|fruto|galho)\s+(?:d[aeo]s?\s+)(?:planta|árvore|arvore|flor)\b/i.test(q),
    },
    {
      code: "FACT_38_PERGUNTA_CIRCULAR_A_RESPOSTA",
      layer: LAYER.semantic,
      message: "pergunta circular — a resposta repete a palavra que se pede para definir",
      when: (q, a, _o, _ql, _al, formatId) => {
      if (formatId !== 'O_QUE_E') return false;
      const circular = q.match(/^o\s+que\s+é\s+(?:a|o|um|uma)\s+(\w+)\s+(?:d[aeo]s?\s+)(\w+)/i);
      if (!circular) return false;
      const term = circular[1].toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const answerFirst = String(a || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/\s+/)[0];
      return term && answerFirst && term === answerFirst;
    },
    },
    {
      code: "FACT_39_ADIVINHA_SEM_RESPOSTA",
      layer: LAYER.format,
      message: "adivinha sem solução registada — não publicar",
      when: (_q, a) => /^sem\s+resposta$/i.test(String(a || '').trim()),
    },
    {
      code: "FACT_40_AVIÃO_COM_PENAS",
      layer: LAYER.semantic,
      message: "adivinha incoerente — avião não tem penas; reformula ou muda a resposta",
      when: (q, a) => /\bpenas\b/i.test(q) && /\bn[aã]o\s+[eé]\s+um\s+p[aá]ssaro\b/i.test(q) && /\bavi[aã]o\b/i.test(a),
    },
    {
      code: "FACT_41_RELOGIO_DENTES",
      layer: LAYER.semantic,
      message: "adivinha clássica dos dentes — resposta correcta é pente, não relógio",
      when: (q, a) => /\bdentes\b/i.test(q) && /\bn[aã]o\s+morde?\b/i.test(q) && /\brel[oó]gio\b/i.test(a) && !/\bpente\b/i.test(a),
    },
    {
      code: "FACT_42_CAO_NAO_E_BURRO",
      layer: LAYER.semantic,
      message: "pergunta errada — Burro/Donkey não é um cão; reformula",
      when: (q, a) => /\bc[aã]o\b/i.test(q) && /\b(shrek|donkey|burro)\b/i.test(a),
    },
    {
      code: "FACT_43_CRAVOS_LIDER_AMBIGUO",
      layer: LAYER.semantic,
      message: "pergunta ambígua — vários intervenientes no 25 de Abril; especifica o papel (ex.: comandante operacional)",
      when: (q, a) => /\brevolu[cç][aã]o\s+dos\s+cravos\b/i.test(q) && /\bl[ií]der\b/i.test(q) && /\botelo\b/i.test(a),
    },
    {
      code: "FACT_44_COSTAS_ALFINETE",
      layer: LAYER.semantic,
      message: "resposta errada — cadeira tem costas; alfinete não encaixa nas pistas",
      when: (q, a) => /\bcostas\b/i.test(q) && /\bn[aã]o\s+tenho\s+corpo\b/i.test(q) && /\balfinete\b/i.test(a),
    },
    {
      code: "FACT_45_FUTRE_FINAL_1998",
      layer: LAYER.factual,
      message: "facto incorrecto — na final da Champions 1998 marcou Predrag Mijatović, não Paulo Futre",
      when: (q, a) => /\b1998\b/.test(q) && /\bliga\s+dos\s+campe[oõ]es\b/i.test(q) && /\bfinal\b/i.test(q) && /\bpaulo\s+futre\b/i.test(a),
    },
    {
      code: "FACT_46_PADRAO_VAGO",
      layer: LAYER.semantic,
      message: "pergunta vaga — especifica o objecto (ex.: pilha, barber pole, pastilha elástica)",
      when: (q) => /\bpadr[aã]o\s+vermelho,\s*branco,\s*vermelho\b/i.test(q),
    },
    {
      code: "FACT_47_MOZART_HAYDN_OBSCURO",
      layer: LAYER.semantic,
      message: "pergunta demasiado obscura — simplifica ou escolhe outro tema musical",
      when: (q) => /\bromper\s+com\s+haydn\b/i.test(q) && /\b1781\b/.test(q),
    },
    {
      code: "FACT_48_CABRA_MILHO_ADIVINHA",
      layer: LAYER.semantic,
      message: "resposta folclórica ambígua (brincadeira oral) — não adequada ao jogo",
      when: (q, a) => /\bcomer\s+me\s+qu.*rias\b/i.test(q) && /\bcabra\b.*\b(milho|centeio|trigo)\b/i.test(a),
    },
  ];

  const CONFUSING_FACT_CODES = new Set(
    REPORTED_FACT_RULES
      .filter((r) => /pergunta confusa|formulação|resposta ambígua — asfalto|pergunta circular/i.test(r.message))
      .map((r) => r.code),
  );

  function telemetryLabelFromMessage(message) {
    const m = String(message || '').trim();
    if (!m) return '';
    const dash = m.indexOf(' — ');
    const short = dash >= 0 ? m.slice(dash + 3) : m;
    return short.length > 72 ? `${short.slice(0, 69)}…` : short;
  }

  const TELEMETRY_ISSUE_LABELS = Object.freeze(
    Object.fromEntries(REPORTED_FACT_RULES.map((r) => [r.code, telemetryLabelFromMessage(r.message)])),
  );

  function runReportedFactRules(q, a, options, formatId, mkIssueFn) {
    const issueFn = mkIssueFn || mkIssue;
    const opts = (options || []).map((o) => String(o).toLowerCase());
    const issues = [];
    for (const rule of REPORTED_FACT_RULES) {
      if (rule.when(q, a, opts, q.toLowerCase(), a.toLowerCase(), formatId)) {
        issues.push(issueFn(rule.code, rule.layer, rule.message));
      }
    }
    return issues;
  }

  function isConfusingFactIssue(issue) {
    const code = issueCode(issue);
    if (code && CONFUSING_FACT_CODES.has(code)) return true;
    return CONFUSING_FACT_PREFIXES.some((prefix) => issueMessage(issue).startsWith(prefix));
  }

  function validateFactualConsistency(q, a) {
    return runReportedFactRules(q, a, [], null)
      .filter((i) => !isConfusingFactIssue(i) && !issueMessage(i).startsWith('pergunta ambígua'));
  }

  global.QuestionEngineKnownFacts = Object.freeze({
    LAYER,
    REPORTED_FACT_RULES,
    CONFUSING_FACT_CODES,
    CONFUSING_FACT_PREFIXES,
    TELEMETRY_ISSUE_LABELS,
    telemetryLabelFromMessage,
    runReportedFactRules,
    isConfusingFactIssue,
    validateFactualConsistency,
  });
})(typeof window !== 'undefined' ? window : globalThis);
