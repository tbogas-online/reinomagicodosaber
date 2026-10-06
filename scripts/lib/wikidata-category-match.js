'use strict';

/**
 * Filtra entidades Wikidata pela categoria do jogo (P31 / rótulo PT).
 * A pesquisa por palavras devolve homónimos (filme, apelido, revista); só entram
 * tipos que pertencem à categoria escolhida.
 */

function qset(...ids) {
  return new Set(ids);
}

const JUNK_QIDS = qset(
  'Q5',
  'Q16521',
  'Q13406463',
  'Q4167836',
  'Q4167410',
  'Q11266439',
  'Q17442446',
  'Q35120',
  'Q488383',
  'Q223557',
  'Q386724',
  'Q16889133',
  'Q23958852',
  'Q24017414',
  'Q19478619',
  'Q151885',
  'Q202444',
  'Q11879590',
  'Q12308941',
  'Q101352',
  'Q10856962',
  'Q13442814',
  'Q732577',
  'Q1002697',
  'Q11032',
  'Q5633421',
  'Q191067',
  'Q234460',
  'Q3744874',
);

const JUNK_LABEL = /t[aá]xon|wikimedia|desambigua|artigo|categoria|página|entidade|humano|ser humano|type of |tipo de |given name|family name|surname|nome pr[oó]prio|apelido|alcunha|publica[cç][aã]o peri[oó]dica|crit[eé]rio|conceito|metclasse|segunda ordem/i;

const NAME_OR_MEDIA_QIDS = qset(
  'Q11424',
  'Q202866',
  'Q5398426',
  'Q24856',
  'Q7777570',
  'Q2188189',
  'Q105543609',
  'Q134556',
  'Q482994',
  'Q7366',
  'Q7889',
  'Q3305213',
);

const GEO_QIDS = qset(
  'Q6256',
  'Q3624078',
  'Q7275',
  'Q515',
  'Q1549591',
  'Q1637706',
  'Q5119',
  'Q3957',
  'Q532',
  'Q15284',
  'Q13218391',
  'Q184451',
  'Q13217644',
  'Q4022',
  'Q355304',
  'Q15324',
  'Q8502',
  'Q46831',
  'Q54050',
  'Q8072',
  'Q23442',
  'Q33837',
  'Q5107',
  'Q9430',
  'Q165',
  'Q23397',
  'Q166620',
  'Q123480',
  'Q34763',
  'Q35657',
  'Q10864048',
  'Q1128397',
  'Q39816',
  'Q47521',
  'Q45762',
  'Q271669',
  'Q162112',
);

const GEO_LABEL = /^(pa[ií]s|estado soberano|cidade|grande cidade|capital|vila|aldeia|munic[ií]pio|rio|curso de [aá]gua|montanha|cordilheira|serra|vulc[aã]o|continente|oceano|mar|ilha|arquip[eé]lago|lago|deserto|pen[ií]nsula|regi[aã]o|plan[ií]cie|planalto|vale|golfo|estreito|cabo|delta|floresta|selva|ba[ií]a)$/i;

const GEO_DENY_QIDS = qset(
  'Q182547',
  'Q3024240',
  'Q19953632',
  'Q11424',
  'Q202866',
  'Q2188189',
  'Q105543609',
  'Q202444',
  'Q11879590',
  'Q12308941',
  'Q101352',
);

const NATURE_QIDS = qset(
  'Q729',
  'Q756',
  'Q10884',
  'Q7377',
  'Q5113',
  'Q152',
  'Q1390',
  'Q10908',
  'Q188805',
  'Q25324',
  'Q55983756',
  'Q7239',
  'Q4421',
  'Q16970',
  'Q4022',
  'Q8502',
  'Q8072',
  'Q9430',
  'Q23397',
  'Q166620',
  'Q10811',
  'Q425332',
  'Q33837',
  'Q23442',
);

const NATURE_LABEL = /^(animal|mam[ií]fero|ave|p[aá]ssaro|peixe|insecto|inseto|r[eé]ptil|anf[ií]bio|planta|árvore|arvore|fungo|molusco|cefal[oó]pode|rio|montanha|vulc[aã]o|floresta|selva|oceano|lago|recife|habitat|esp[eé]cie)$/i;

const SPACE_QIDS = qset(
  'Q634',
  'Q319',
  'Q523',
  'Q318',
  'Q405',
  'Q8928',
  'Q40210',
  'Q2513',
  'Q544',
  'Q3863',
  'Q2243',
  'Q83373',
  'Q277338',
);

const SPACE_LABEL = /^(planeta|planeta an[aã]o|estrela|gal[aá]xia|lua|sat[eé]lite natural|constela[cç][aã]o|cometa|aster[oó]ide|esta[cç][aã]o espacial|nebulosa|sistema solar)$/i;

const SPORT_QIDS = qset(
  'Q349',
  'Q31629',
  'Q13406554',
  'Q18608583',
  'Q500834',
  'Q476300',
  'Q12973014',
  'Q6979593',
  'Q476028',
  'Q185363',
  'Q5389',
  'Q483349',
  'Q1154710',
  'Q847017',
  'Q4438121',
  'Q11417',
  'Q5369',
);

const SPORT_LABEL = /^(desporto|esporte|modalidade|equipa|equipe|clube|sele[cç][aã]o|competi[cç][aã]o|campeonato|torneio|olimp[ií]ad|est[aá]dio|atleta|futebol|natação|t[eé]nis)$/i;

const FILM_QIDS = qset('Q11424', 'Q202866', 'Q5398426', 'Q24856', 'Q1259759', 'Q7777570', 'Q2431196');
const FILM_LABEL = /^(filme|filme de anima[cç][aã]o|s[eé]rie de televis[aã]o|s[eé]rie|document[aá]rio|anima[cç][aã]o)$/i;

const MUSIC_QIDS = qset(
  'Q2188189',
  'Q105543609',
  'Q134556',
  'Q482994',
  'Q7366',
  'Q34379',
  'Q188451',
  'Q215380',
  'Q8341',
  'Q207628',
  'Q11405',
);
const MUSIC_LABEL = /^(m[uú]sica|g[eé]nero musical|instrumento|can[cç][aã]o|álbum|album|composição musical|obra musical|orquestra|banda|fado|ópera|opera)$/i;

const LIT_QIDS = qset('Q7725634', 'Q1667921', 'Q8261', 'Q49084', 'Q8242', 'Q571', 'Q5185279', 'Q474613');
const LIT_LABEL = /^(obra liter[aá]ria|romance|poema|poesia|livro|conto|pe[cç]a de teatro|epopeia)$/i;

const ART_QIDS = qset('Q3305213', 'Q860861', 'Q207694', 'Q968159', 'Q838948', 'Q179700');
const ART_LABEL = /^(pintura|escultura|museu|movimento art[ií]stico|fresco|azulejo|obra de arte)$/i;

const FOOD_QIDS = qset('Q2095', 'Q746549', 'Q25403900', 'Q40050', 'Q40050', 'Q44', 'Q282', 'Q11002', 'Q3314483');
const FOOD_LABEL = /^(alimento|prato|ingrediente|bebida|vinho|queijo|doce|fruta|cereal)$/i;

const TECH_QIDS = qset('Q11019', 'Q68', 'Q3966', 'Q7397', 'Q35127', 'Q75', 'Q11016', 'Q1183543', 'Q265158', 'Q581105');
const TECH_LABEL = /^(m[aá]quina|computador|software|inven[cç][aã]o|tecnologia|internet|s[ií]tio web|telefone|rob[oô])$/i;

const TRANSPORT_QIDS = qset(
  'Q42889',
  'Q1420',
  'Q11436',
  'Q11446',
  'Q870',
  'Q22667',
  'Q34442',
  'Q1248784',
  'Q44782',
  'Q11442',
  'Q197',
);
const TRANSPORT_LABEL = /^(ve[ií]culo|autom[oó]vel|avi[aã]o|aeronave|navio|comboio|trem|bicicleta|metro|aeroporto|caminho de ferro|barco)$/i;

const GAME_QIDS = qset('Q7889', 'Q131436', 'Q11410', 'Q14233', 'Q1607014', 'Q11422', 'Q8076', 'Q224769');
const GAME_LABEL = /^(jogo|videojogo|jogo de tabuleiro|jogo de cartas|brinquedo|consola)$/i;

const CULTURE_QIDS = qset('Q82821', 'Q132241', 'Q1153376', 'Q34770', 'Q17376908', 'Q11042', 'Q2198855', 'Q201676');
const CULTURE_LABEL = /^(tradi[cç][aã]o|festa|festival|l[ií]ngua|idioma|cultura|patrim[oó]nio|ritual|traje)$/i;

const FASHION_QIDS = qset('Q11460', 'Q28803', 'Q317275', 'Q15707');
const FASHION_LABEL = /^(roupa|vestu[aá]rio|tecido|traje|cal[cç]ado|moda)$/i;

const SCIENCE_QIDS = qset('Q11344', 'Q11173', 'Q79529', 'Q47574', 'Q324254', 'Q395', 'Q28732711');
const SCIENCE_LABEL = /^(elemento qu[ií]mico|composto|lei f[ií]sica|unidade|grandeza|vacina|mol[eé]cula)$/i;

const MATH_QIDS = qset('Q11563', 'Q65943', 'Q189010', 'Q207961', 'Q474614', 'Q12503');
const MATH_LABEL = /^(n[uú]mero|teorema|forma geom[eé]trica|pol[ií]gono|constante matem[aá]tica)$/i;

const LANG_QIDS = qset('Q34770', 'Q17376908', 'Q5146', 'Q33742');
const LANG_LABEL = /^(l[ií]ngua|idioma|alfabeto|ortografia|gram[aá]tica|prov[eé]rbio)$/i;

function mergeQids(...sets) {
  const out = new Set();
  for (const set of sets) {
    for (const id of set) out.add(id);
  }
  return out;
}

function mergeLabel(...regexes) {
  const source = regexes.map((re) => re.source.replace(/^\^/, '').replace(/\$$/, '')).join('|');
  return new RegExp(`^(?:${source})$`, 'i');
}

const CATEGORY_FILTERS = {
  1: {
    denyQids: mergeQids(NAME_OR_MEDIA_QIDS, JUNK_QIDS),
    factOrder: ['capital', 'continent', 'class', 'country', 'place', 'occupation', 'language', 'currency'],
  },
  2: {
    allowQids: GEO_QIDS,
    allowLabel: GEO_LABEL,
    denyQids: GEO_DENY_QIDS,
    denyLabel: /filme|anima[cç][aã]o|m[uú]sica|composi[cç][aã]o|publica[cç][aã]o|peri[oó]dica|nome pr[oó]prio|apelido|álbum|revista|can[cç][aã]o|surname|given name|type of/i,
    factOrder: ['capital', 'capitalOf', 'continent', 'mouth', 'class', 'country', 'place', 'language', 'currency'],
  },
  3: {
    people: true,
    allowQids: mergeQids(GEO_QIDS, qset('Q198', 'Q178561', 'Q180684', 'Q124734', 'Q7269', 'Q11514315')),
    allowLabel: mergeLabel(GEO_LABEL, /^(guerra|batalha|revolu[cç][aã]o|imp[eé]rio|dinastia|civiliza[cç][aã]o|evento hist[oó]rico)$/i),
    factOrder: ['occupation', 'country', 'class'],
  },
  4: {
    people: true,
    allowQids: SCIENCE_QIDS,
    allowLabel: SCIENCE_LABEL,
    factOrder: ['class', 'occupation'],
  },
  5: {
    allowQids: NATURE_QIDS,
    allowLabel: NATURE_LABEL,
    denyQids: NAME_OR_MEDIA_QIDS,
    factOrder: ['class', 'parent', 'country', 'place'],
  },
  6: {
    allowQids: SPACE_QIDS,
    allowLabel: SPACE_LABEL,
    factOrder: ['class', 'place'],
  },
  7: {
    people: true,
    allowQids: MATH_QIDS,
    allowLabel: MATH_LABEL,
    factOrder: ['class', 'occupation'],
  },
  8: {
    people: true,
    allowQids: LIT_QIDS,
    allowLabel: LIT_LABEL,
    factOrder: ['class', 'occupation', 'country'],
  },
  9: {
    people: true,
    allowQids: mergeQids(LIT_QIDS, LANG_QIDS),
    allowLabel: mergeLabel(LIT_LABEL, LANG_LABEL),
    factOrder: ['class', 'occupation'],
  },
  10: {
    people: true,
    allowQids: ART_QIDS,
    allowLabel: ART_LABEL,
    factOrder: ['class', 'occupation', 'country'],
  },
  11: {
    people: true,
    allowQids: FILM_QIDS,
    allowLabel: FILM_LABEL,
    factOrder: ['class', 'occupation', 'country'],
  },
  12: {
    people: true,
    allowQids: MUSIC_QIDS,
    allowLabel: MUSIC_LABEL,
    factOrder: ['class', 'occupation'],
  },
  13: {
    allowQids: FASHION_QIDS,
    allowLabel: FASHION_LABEL,
    factOrder: ['class', 'country'],
  },
  14: {
    allowQids: FOOD_QIDS,
    allowLabel: FOOD_LABEL,
    factOrder: ['class', 'country', 'place'],
  },
  15: {
    people: true,
    allowQids: SPORT_QIDS,
    allowLabel: SPORT_LABEL,
    denyQids: mergeQids(NAME_OR_MEDIA_QIDS, GEO_QIDS, qset('Q101352', 'Q202444')),
    denyLabel: /apelido|nome pr[oó]prio|filme|continente|cidade|pa[ií]s|crit[eé]rio/i,
    factOrder: ['class', 'occupation', 'sport'],
  },
  16: {
    allowQids: GAME_QIDS,
    allowLabel: GAME_LABEL,
    factOrder: ['class'],
  },
  17: {
    allowQids: TECH_QIDS,
    allowLabel: TECH_LABEL,
    factOrder: ['class', 'occupation'],
  },
  18: {
    allowQids: CULTURE_QIDS,
    allowLabel: CULTURE_LABEL,
    factOrder: ['class', 'country', 'place'],
  },
  19: {
    allowQids: TRANSPORT_QIDS,
    allowLabel: TRANSPORT_LABEL,
    factOrder: ['class', 'country'],
  },
  20: {
    allowQids: mergeQids(NATURE_QIDS, GEO_QIDS, CULTURE_QIDS),
    allowLabel: mergeLabel(NATURE_LABEL, GEO_LABEL, CULTURE_LABEL),
    denyQids: NAME_OR_MEDIA_QIDS,
    denyLabel: /nome pr[oó]prio|apelido|publica[cç][aã]o|peri[oó]dica|filme|composi[cç][aã]o musical/i,
    factOrder: ['class', 'parent', 'continent', 'mouth', 'country', 'place', 'capital', 'capitalOf'],
  },
};

function getCategoryFilter(categoryN) {
  return CATEGORY_FILTERS[Number(categoryN)] || null;
}

function englishOnlyClass(label) {
  const text = String(label || '').trim();
  return /\b(type of|given name|family name|male given name|female given name|musical composition|scientific journal|academic journal|periodical|animated film|surname)\b/i.test(text);
}

function classAllowedForCategory(cls, categoryN) {
  if (!cls?.qid || !cls?.label) return false;
  if (JUNK_QIDS.has(cls.qid) || JUNK_LABEL.test(cls.label) || englishOnlyClass(cls.label)) return false;
  const filter = getCategoryFilter(categoryN);
  if (!filter) return true;
  if (filter.denyQids?.has(cls.qid)) return false;
  if (filter.denyLabel?.test(cls.label)) return false;
  if (filter.allowQids || filter.allowLabel) {
    if (filter.allowQids?.has(cls.qid)) return true;
    if (filter.allowLabel?.test(cls.label)) return true;
    return false;
  }
  return true;
}

function itemFitsCategory(item, categoryN) {
  const n = Number(categoryN);
  if (!n) return true;
  const filter = getCategoryFilter(n);
  if (!filter) return true;
  if (n === 15) {
    if ((item?.sports || []).some((row) => row?.qid)) return true;
    if ((item?.occupations || []).some((row) => /futebolista|atleta|treinador|nadador|tenista|ciclista|jogador|desportista|ol[ií]mpic/i.test(row?.label || ''))) {
      return true;
    }
  } else if (filter.people && (item?.occupations || []).length) {
    return true;
  }
  if ((n === 5 || n === 20)
    && (item?.classes || []).some((cls) => cls.qid === 'Q16521')) {
    return true;
  }
  return (item?.classes || []).some((cls) => classAllowedForCategory(cls, n));
}

module.exports = {
  JUNK_QIDS,
  getCategoryFilter,
  classAllowedForCategory,
  itemFitsCategory,
  englishOnlyClass,
};
