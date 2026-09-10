'use strict';

/**
 * Pesquisa Wikidata por palavras (EntitySearch) → factos estruturados (P31/P17/P36/P131/P106).
 * Nunca inventa o facto: só propriedades SPARQL com rótulo PT.
 */

const { getCategoryTopic } = require('./wikidata-category-topics');
const {
  bindValue,
  qidFromUri,
  isUsableLabel,
  fetchSparql,
} = require('./wikidata-sparql');
const {
  JUNK_QIDS,
  getCategoryFilter,
  classAllowedForCategory,
  itemFitsCategory,
} = require('./wikidata-category-match');

const SOURCE = 'Wikidata';
const LICENSE = 'CC0';
const MAX_WORDS = 4;
const SEARCH_LIMIT = 10;
const MAX_RECORDS = 10;
const PREVIEW_LIMIT = 10;

const SKIP_CLASS_QIDS = JUNK_QIDS;
const SKIP_CLASS_LABEL = /t[aá]xon|wikimedia|desambigua|artigo|categoria|página|entidade|humano|ser humano|type of |given name|family name|surname|nome pr[oó]prio|apelido|publica[cç][aã]o peri[oó]dica|crit[eé]rio/i;

const CLASS_PHRASE = {
  país: 'um país',
  cidade: 'uma cidade',
  vila: 'uma vila',
  rio: 'um rio',
  montanha: 'uma montanha',
  oceano: 'um oceano',
  ilha: 'uma ilha',
  continente: 'um continente',
  lago: 'um lago',
  deserto: 'um deserto',
  planeta: 'um planeta',
  estrela: 'uma estrela',
  mamífero: 'um mamífero',
  ave: 'uma ave',
  peixe: 'um peixe',
  insecto: 'um insecto',
  planta: 'uma planta',
  árvore: 'uma árvore',
  instrumento: 'um instrumento',
  desporto: 'um desporto',
  jogo: 'um jogo',
  cefalópode: 'um cefalópode',
};

const FORMER_CAPITAL_KIND = /antiga capital|former capital|ex-capital|capital hist[oó]ric|historical capital/i;
const CAPITAL_KIND_RULES = [
  { id: 'admin', phrase: 'administrativa', suffix: 'admin', qids: new Set(['Q1306755', 'Q15991390']), re: /administrativ|sede do governo|seat of government|executive capital|administrative (capital|centre|center)/i },
  { id: 'leg', phrase: 'legislativa', suffix: 'leg', qids: new Set(['Q1861831']), re: /legislativ|parlamentar|legislative/i },
  { id: 'jud', phrase: 'judicial', suffix: 'jud', qids: new Set(['Q1478433']), re: /judicial|judici[aá]ri/i },
  { id: 'off', phrase: 'oficial', suffix: 'off', qids: new Set(), re: /constitucional|oficial|statutory|constitutional/i },
  { id: 'defacto', phrase: 'de facto', suffix: 'defacto', qids: new Set(), re: /de facto|efectiva/i },
];

function sanitizeWord(raw) {
  const text = String(raw || '').trim().replace(/\s+/g, ' ');
  if (text.length < 2 || text.length > 40) return '';
  if (!/^[\p{L}\p{N} \-']+$/u.test(text)) return '';
  return text;
}

function splitWordTokens(raw) {
  return String(raw || '')
    .split(/[,;]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function sanitizeWords(words) {
  const seen = new Set();
  const out = [];
  const list = Array.isArray(words) ? words : [words];
  for (const raw of list) {
    for (const token of splitWordTokens(raw)) {
      const word = sanitizeWord(token);
      const key = word.toLowerCase();
      if (!word || seen.has(key)) continue;
      seen.add(key);
      out.push(word);
      if (out.length >= MAX_WORDS) return out;
    }
  }
  return out;
}

function normalizeKnowledgeIds(ids) {
  return [...new Set((ids || []).map((id) => String(id || '').trim()).filter(Boolean))];
}

function applyKnowledgeIdFilter(records, knowledgeIds) {
  const wanted = normalizeKnowledgeIds(knowledgeIds);
  if (!wanted.length) {
    return { records: records || [], rejected: 0 };
  }
  const set = new Set(wanted);
  const kept = (records || []).filter((row) => set.has(row.knowledge_id));
  return {
    records: kept,
    rejected: (records || []).length - kept.length,
  };
}

function candidateFromRecord(row, status, extra = {}) {
  return {
    knowledgeId: row?.knowledge_id,
    fact: row?.fact,
    answer: row?.answer,
    sourceUrl: row?.source_url,
    sourceId: row?.source_id,
    status,
    selectable: status === 'new',
    record: status === 'new' ? row : undefined,
    ...extra,
  };
}

function buildImportCandidates(accepted, skipped, limit = PREVIEW_LIMIT) {
  const cap = Math.min(20, Math.max(1, Number(limit) || PREVIEW_LIMIT));
  const rows = [];
  for (const row of accepted || []) {
    if (rows.length >= cap) break;
    rows.push(candidateFromRecord(row, 'new'));
  }
  void skipped;
  return rows;
}

function escapeSparqlString(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
}

function buildKeywordSearchQuery(word) {
  const search = escapeSparqlString(sanitizeWord(word));
  if (!search) return '';
  return `SELECT ?item ?itemLabel ?class ?classLabel ?country ?countryLabel ?capital ?capitalLabel ?capitalType ?capitalTypeLabel ?capitalRole ?capitalRoleLabel ?capitalMethod ?capitalMethodLabel ?place ?placeLabel ?occupation ?occupationLabel ?sport ?sportLabel ?continent ?continentLabel ?language ?languageLabel ?currency ?currencyLabel ?mouth ?mouthLabel ?capitalOf ?capitalOfLabel ?capitalOfType ?capitalOfTypeLabel ?capitalOfRole ?capitalOfRoleLabel ?capitalOfMethod ?capitalOfMethodLabel ?parent ?parentLabel WHERE {
  SERVICE wikibase:mwapi {
    bd:serviceParam wikibase:api "EntitySearch" .
    bd:serviceParam wikibase:endpoint "www.wikidata.org" .
    bd:serviceParam mwapi:search "${search}" .
    bd:serviceParam mwapi:language "pt" .
    bd:serviceParam mwapi:limit "${SEARCH_LIMIT}" .
    ?item wikibase:apiOutputItem mwapi:item .
  }
  OPTIONAL { ?item wdt:P31 ?class. }
  OPTIONAL { ?item wdt:P17 ?country. }
  OPTIONAL {
    ?item p:P36 ?capitalStmt.
    ?capitalStmt ps:P36 ?capital.
    ?capitalStmt wikibase:rank ?capitalRank.
    FILTER(?capitalRank != wikibase:DeprecatedRank)
    FILTER NOT EXISTS { ?capitalStmt pq:P582 ?capitalEnded. }
    FILTER NOT EXISTS { ?capitalStmt pq:P31 wd:Q1933965. }
    OPTIONAL { ?capitalStmt pq:P31 ?capitalType. }
    OPTIONAL { ?capitalStmt pq:P3831 ?capitalRole. }
    OPTIONAL { ?capitalStmt pq:P459 ?capitalMethod. }
  }
  OPTIONAL { ?item wdt:P131 ?place. }
  OPTIONAL { ?item wdt:P106 ?occupation. }
  OPTIONAL { ?item wdt:P641 ?sport. }
  OPTIONAL { ?item wdt:P30 ?continent. }
  OPTIONAL { ?item wdt:P37 ?language. }
  OPTIONAL { ?item wdt:P38 ?currency. }
  OPTIONAL { ?item wdt:P403 ?mouth. }
  OPTIONAL {
    ?item p:P1376 ?capitalOfStmt.
    ?capitalOfStmt ps:P1376 ?capitalOf.
    ?capitalOfStmt wikibase:rank ?capitalOfRank.
    FILTER(?capitalOfRank != wikibase:DeprecatedRank)
    FILTER NOT EXISTS { ?capitalOfStmt pq:P582 ?capitalOfEnded. }
    FILTER NOT EXISTS { ?capitalOfStmt pq:P31 wd:Q1933965. }
    OPTIONAL { ?capitalOfStmt pq:P31 ?capitalOfType. }
    OPTIONAL { ?capitalOfStmt pq:P3831 ?capitalOfRole. }
    OPTIONAL { ?capitalOfStmt pq:P459 ?capitalOfMethod. }
  }
  OPTIONAL { ?item wdt:P171 ?parent. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "pt,en". }
}
LIMIT 250`;
}

function pushUnique(list, qid, label) {
  if (!qid || !isUsableLabel(label)) return;
  if (list.some((row) => row.qid === qid)) return;
  list.push({ qid, label });
}

function resolveCapitalKind(...parts) {
  const qid = parts.map((part) => String(part || '')).map((part) => (part.match(/\bQ\d+\b/i) || [''])[0].toUpperCase()).find(Boolean) || '';
  const blob = parts.map((part) => String(part || '').trim()).filter(Boolean).join(' ');
  if (FORMER_CAPITAL_KIND.test(blob) || qid === 'Q1933965') return { skip: true };
  for (const rule of CAPITAL_KIND_RULES) {
    if ((qid && rule.qids.has(qid)) || (blob && rule.re.test(blob))) {
      return { id: rule.id, phrase: rule.phrase, suffix: rule.suffix };
    }
  }
  return { id: '', phrase: '', suffix: '' };
}

function formatCountryHasCapital(country, capital, { kind, multi } = {}) {
  if (kind?.phrase) return `A capital ${kind.phrase} de ${country} é ${capital}.`;
  if (multi) return `Uma das capitais de ${country} é ${capital}.`;
  return `A capital de ${country} é ${capital}.`;
}

function formatCityIsCapital(city, country, { kind, multi } = {}) {
  if (kind?.phrase) return `${city} é a capital ${kind.phrase} de ${country}.`;
  if (multi) return `${city} é uma das capitais de ${country}.`;
  return `${city} é a capital de ${country}.`;
}

const LIVING_PRINCIPALITY = /\b(m[oó]naco|liechtenstein|andorra)\b/i;
const HISTORICAL_POLITY = /^(principado|ducado|eleitorado|condado|landgraviat[oa]?|margraviato|marquesado|sacro imp[eé]rio|imp[eé]rio romano|uni[aã]o sovi[eé]tica|rep[uú]blica de weimar)\b/i;

function isCurrentCountryName(label) {
  const text = String(label || '').trim();
  if (!text) return false;
  if (LIVING_PRINCIPALITY.test(text)) return true;
  if (HISTORICAL_POLITY.test(text)) return false;
  return true;
}

function pushCapital(list, qid, label, extra = {}) {
  if (!qid || !isUsableLabel(label)) return;
  if (extra.ended) return;
  const kind = extra.kind && extra.kind.skip ? extra.kind : resolveCapitalKind(
    extra.kindQid,
    extra.kindLabel,
    extra.roleLabel,
    extra.methodLabel,
  );
  if (kind.skip) return;
  const existing = list.find((row) => row.qid === qid);
  if (!existing) {
    list.push({
      qid,
      label,
      kind: kind.id || '',
      kindPhrase: kind.phrase || '',
      kindSuffix: kind.suffix || '',
    });
    return;
  }
  if (!existing.kind && kind.id) {
    existing.kind = kind.id;
    existing.kindPhrase = kind.phrase;
    existing.kindSuffix = kind.suffix;
  }
}

function currentCapitals(list) {
  return (list || []).filter((row) => row?.qid && row?.label && !row.ended && !row.kindSkip);
}

function buildCapitalFacts(subjectLabel, entries, { direction } = {}) {
  if (direction !== 'of' && !isCurrentCountryName(subjectLabel)) return [];
  const current = currentCapitals(entries).filter((row) => {
    if (sameLabel(row.label, subjectLabel)) return false;
    if (direction === 'of' && !isCurrentCountryName(row.label)) return false;
    return true;
  });
  const multi = current.length > 1;
  return current.map((row, index) => {
    const kind = row.kindPhrase ? { phrase: row.kindPhrase, suffix: row.kindSuffix || row.kind } : null;
    const suffixBase = direction === 'of' ? 'p1376' : 'p36';
    const suffix = kind?.suffix
      ? `${suffixBase}-${kind.suffix}`
      : (multi ? `${suffixBase}-${String(row.qid || index).toLowerCase()}` : suffixBase);
    return {
      fact: direction === 'of'
        ? formatCityIsCapital(subjectLabel, row.label, { kind, multi })
        : formatCountryHasCapital(subjectLabel, row.label, { kind, multi }),
      answer: row.label,
      suffix,
      subtopic: 'capital',
    };
  });
}

function groupKeywordBindings(bindings) {
  const map = new Map();
  for (const binding of bindings || []) {
    const qid = qidFromUri(bindValue(binding, 'item'));
    const label = bindValue(binding, 'itemLabel');
    if (!qid || !isUsableLabel(label)) continue;
    let row = map.get(qid);
    if (!row) {
      row = {
        qid,
        label,
        classes: [],
        countries: [],
        capitals: [],
        places: [],
        occupations: [],
        sports: [],
        continents: [],
        languages: [],
        currencies: [],
        mouths: [],
        capitalOf: [],
        parents: [],
      };
      map.set(qid, row);
    }
    pushUnique(row.classes, qidFromUri(bindValue(binding, 'class')), bindValue(binding, 'classLabel'));
    pushUnique(row.countries, qidFromUri(bindValue(binding, 'country')), bindValue(binding, 'countryLabel'));
    pushCapital(row.capitals, qidFromUri(bindValue(binding, 'capital')), bindValue(binding, 'capitalLabel'), {
      ended: Boolean(bindValue(binding, 'capitalEnd')),
      kindQid: qidFromUri(bindValue(binding, 'capitalType')) || qidFromUri(bindValue(binding, 'capitalRole')) || qidFromUri(bindValue(binding, 'capitalMethod')),
      kindLabel: bindValue(binding, 'capitalTypeLabel'),
      roleLabel: bindValue(binding, 'capitalRoleLabel'),
      methodLabel: bindValue(binding, 'capitalMethodLabel'),
    });
    pushUnique(row.places, qidFromUri(bindValue(binding, 'place')), bindValue(binding, 'placeLabel'));
    pushUnique(row.occupations, qidFromUri(bindValue(binding, 'occupation')), bindValue(binding, 'occupationLabel'));
    pushUnique(row.sports, qidFromUri(bindValue(binding, 'sport')), bindValue(binding, 'sportLabel'));
    pushUnique(row.continents, qidFromUri(bindValue(binding, 'continent')), bindValue(binding, 'continentLabel'));
    pushUnique(row.languages, qidFromUri(bindValue(binding, 'language')), bindValue(binding, 'languageLabel'));
    pushUnique(row.currencies, qidFromUri(bindValue(binding, 'currency')), bindValue(binding, 'currencyLabel'));
    pushUnique(row.mouths, qidFromUri(bindValue(binding, 'mouth')), bindValue(binding, 'mouthLabel'));
    pushCapital(row.capitalOf, qidFromUri(bindValue(binding, 'capitalOf')), bindValue(binding, 'capitalOfLabel'), {
      ended: Boolean(bindValue(binding, 'capitalOfEnd')),
      kindQid: qidFromUri(bindValue(binding, 'capitalOfType')) || qidFromUri(bindValue(binding, 'capitalOfRole')) || qidFromUri(bindValue(binding, 'capitalOfMethod')),
      kindLabel: bindValue(binding, 'capitalOfTypeLabel'),
      roleLabel: bindValue(binding, 'capitalOfRoleLabel'),
      methodLabel: bindValue(binding, 'capitalOfMethodLabel'),
    });
    pushUnique(row.parents, qidFromUri(bindValue(binding, 'parent')), bindValue(binding, 'parentLabel'));
  }
  return [...map.values()];
}

function usableClass(entry) {
  if (!entry?.qid || !entry?.label) return false;
  if (SKIP_CLASS_QIDS.has(entry.qid)) return false;
  if (SKIP_CLASS_LABEL.test(entry.label)) return false;
  return isUsableLabel(entry.label);
}

function classPhrase(label) {
  const key = String(label || '').trim().toLowerCase();
  return CLASS_PHRASE[key] || label;
}

function sameLabel(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

function continentPrep(name) {
  const label = String(name || '').trim();
  if (/^(europa|áfrica|africa|ásia|asia|américa|america|oceânia|oceania|antárctida|antártida|antarctica)$/i.test(label)) {
    return `na ${label}`;
  }
  return `em ${label}`;
}

function itemSearchScore(item, word) {
  const w = String(word || '').trim().toLowerCase();
  const label = String(item?.label || '').trim().toLowerCase();
  if (!w || !label) return 0;
  const classHit = (item.classes || []).some((cls) => String(cls.label || '').trim().toLowerCase() === w);
  if (classHit && label !== w) return 90;
  if (label === w) return 80;
  if (label.startsWith(`${w} `) || label.startsWith(`${w}-`)) return 40;
  if (label.includes(w)) return 15;
  return 5;
}

function listFacts(item, { categoryN } = {}) {
  const n = Number(categoryN) || 0;
  if (n && !itemFitsCategory(item, n)) return [];

  const label = item.label;
  const country = item.countries?.[0];
  const place = item.places?.[0];
  const occupation = item.occupations?.[0];
  const sport = item.sports?.[0];
  const continent = item.continents?.[0];
  const language = item.languages?.[0];
  const currency = item.currencies?.[0];
  const mouth = item.mouths?.[0];
  const parent = item.parents?.[0];
  const cls = n
    ? (item.classes || []).find((entry) => classAllowedForCategory(entry, n))
    : (item.classes || []).find(usableClass);
  const filter = getCategoryFilter(n);
  const order = filter?.factOrder || ['capital', 'capitalOf', 'continent', 'mouth', 'country', 'place', 'occupation', 'class'];
  const allowPeople = !!filter?.people;

  const builders = {
    capital: () => buildCapitalFacts(label, item.capitals, { direction: 'has' }),
    capitalOf: () => buildCapitalFacts(label, item.capitalOf, { direction: 'of' }),
    continent: () => (continent && !sameLabel(continent.label, label) ? {
      fact: `${label} fica ${continentPrep(continent.label)}.`,
      answer: continent.label,
      suffix: 'p30',
      subtopic: 'continente',
    } : null),
    mouth: () => (mouth && !sameLabel(mouth.label, label) ? {
      fact: `${label} desagua em ${mouth.label}.`,
      answer: mouth.label,
      suffix: 'p403',
      subtopic: 'hidrografia',
    } : null),
    country: () => (country && !sameLabel(country.label, label) ? {
      fact: `${label} fica em ${country.label}.`,
      answer: country.label,
      suffix: 'p17',
      subtopic: 'localização',
    } : null),
    place: () => (place && !sameLabel(place.label, label) && !sameLabel(place.label, country?.label) ? {
      fact: `${label} fica em ${place.label}.`,
      answer: place.label,
      suffix: 'p131',
      subtopic: 'localização',
    } : null),
    language: () => (language && !sameLabel(language.label, label) ? {
      fact: `A língua oficial de ${label} é ${language.label}.`,
      answer: language.label,
      suffix: 'p37',
      subtopic: 'língua',
    } : null),
    currency: () => (currency && !sameLabel(currency.label, label) ? {
      fact: `A moeda de ${label} é ${currency.label}.`,
      answer: currency.label,
      suffix: 'p38',
      subtopic: 'moeda',
    } : null),
    parent: () => (parent && usableClass(parent) && !sameLabel(parent.label, label) ? {
      fact: `${label} pertence a ${parent.label}.`,
      answer: parent.label,
      suffix: 'p171',
      subtopic: 'classificação',
    } : null),
    occupation: () => (allowPeople && occupation ? {
      fact: `${label} é ${occupation.label}.`,
      answer: occupation.label,
      suffix: 'p106',
      subtopic: 'personagem',
    } : null),
    sport: () => (n === 15 && sport ? {
      fact: `${label} é de ${sport.label}.`,
      answer: sport.label,
      suffix: 'p641',
      subtopic: 'desporto',
    } : null),
    class: () => (cls && !sameLabel(cls.label, label) ? {
      fact: `${label} é ${classPhrase(cls.label)}.`,
      answer: cls.label,
      suffix: 'p31',
      subtopic: 'identificação',
    } : null),
  };

  const facts = [];
  const seen = new Set();
  const push = (picked) => {
    if (!picked) return;
    if (Array.isArray(picked)) {
      picked.forEach(push);
      return;
    }
    const key = `${picked.suffix}:${picked.answer}`;
    if (seen.has(key)) return;
    seen.add(key);
    facts.push(picked);
  };

  for (const key of order) push(builders[key]?.());
  if (!filter && occupation) {
    push({
      fact: `${label} é ${occupation.label}.`,
      answer: occupation.label,
      suffix: 'p106',
      subtopic: 'personagem',
    });
  }
  push(builders.class());
  if ((n === 5 || n === 20)
    && (item.classes || []).some((entry) => entry.qid === 'Q16521')
    && !sameLabel(label, 'táxon')) {
    push({
      fact: `${label} é uma espécie.`,
      answer: 'espécie',
      suffix: 'p31',
      subtopic: 'identificação',
    });
  }
  return facts;
}

function pickFact(item, options = {}) {
  return listFacts(item, options)[0] || null;
}

function diversifyRecords(records, limit = MAX_RECORDS) {
  const cap = Math.max(1, Number(limit) || MAX_RECORDS);
  const buckets = new Map();
  for (const record of records || []) {
    const key = record?.metadata?.factKey || 'other';
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(record);
  }
  const out = [];
  const seen = new Set();
  let round = 0;
  while (out.length < cap) {
    let added = false;
    for (const list of buckets.values()) {
      const record = list[round];
      if (!record?.knowledge_id || seen.has(record.knowledge_id)) continue;
      seen.add(record.knowledge_id);
      out.push(record);
      added = true;
      if (out.length >= cap) break;
    }
    if (!added) break;
    round += 1;
  }
  return out;
}

function topicForCategory(categoryN) {
  if (Number(categoryN) === 20) return 'curiosidade surpreendente';
  return getCategoryTopic(categoryN)?.topic || 'wikidata';
}

function formatsForCategory(categoryN) {
  const n = Number(categoryN);
  if (n === 20) return ['CURIOSIDADE', 'VERDADEIRO_FALSO'];
  if (n === 2) return ['RESPOSTA_DIRETA', 'ESCOLHA_MULTIPLA', 'VERDADEIRO_FALSO', 'ONDE_FICA'];
  return ['RESPOSTA_DIRETA', 'ESCOLHA_MULTIPLA', 'VERDADEIRO_FALSO'];
}

function toKeywordRecord(categoryN, item, picked, word) {
  const n = Number(categoryN);
  const isCuriosity = n === 20;
  const fact = picked.fact;
  return {
    knowledge_id: `knw-cat${n}-wd-${item.qid.toLowerCase()}-${picked.suffix}`,
    category_n: n,
    topic: topicForCategory(n),
    subtopic: picked.subtopic,
    fact,
    answer: isCuriosity ? 'Verdadeiro' : picked.answer,
    statement: `${String(fact).replace(/\.$/, '')}. Verdadeiro ou Falso?`,
    is_true: true,
    source: SOURCE,
    source_id: `${item.qid}:cat${n}:${picked.suffix}`,
    source_url: `https://www.wikidata.org/wiki/${item.qid}`,
    license: LICENSE,
    confidence: 0.93,
    priority_pt: 58,
    age_bands: n === 20 ? ['10-15', '15+'] : ['6-9', '10-15', '15+'],
    allowed_formats: formatsForCategory(n),
    tags: ['wikidata', 'keyword', String(word || '').toLowerCase()].filter(Boolean),
    verified_by: 'wikidata-keyword-sparql-v1',
    metadata: {
      pipeline: 'wikidata-keyword',
      qid: item.qid,
      factKey: picked.suffix,
      searchWord: word || null,
    },
  };
}

function transformKeywordItems(items, { categoryN, word } = {}) {
  const ranked = [...(items || [])].sort((a, b) => itemSearchScore(b, word) - itemSearchScore(a, word));
  const records = [];
  for (const item of ranked) {
    for (const picked of listFacts(item, { categoryN })) {
      records.push(toKeywordRecord(categoryN, item, picked, word));
    }
  }
  return records;
}

async function searchKeywordItems(word, { fetchFn, timeoutMs } = {}) {
  const query = buildKeywordSearchQuery(word);
  if (!query) return [];
  const bindings = await fetchSparql(query, { fetchFn, timeoutMs });
  return groupKeywordBindings(bindings);
}

async function collectKeywordRecords({ categoryN, words, fetchFn, timeoutMs, limit } = {}) {
  const n = Number(categoryN);
  if (!n || n < 1 || n > 20) {
    const err = new Error('Escolhe uma categoria (1 a 20).');
    err.code = 'INVALID_CATEGORY';
    throw err;
  }
  const clean = sanitizeWords(words);
  if (!clean.length) {
    const err = new Error('Escolhe pelo menos uma palavra para pesquisar na Wikidata.');
    err.code = 'INVALID_WORDS';
    throw err;
  }

  const batches = await Promise.all(
    clean.map(async (word) => {
      const items = await searchKeywordItems(word, { fetchFn, timeoutMs });
      return transformKeywordItems(items, { categoryN: n, word });
    }),
  );

  const seen = new Set();
  const records = [];
  for (const batch of batches) {
    for (const record of batch) {
      if (!record?.knowledge_id || seen.has(record.knowledge_id)) continue;
      seen.add(record.knowledge_id);
      records.push(record);
    }
  }
  const cap = Math.min(20, Math.max(1, Number(limit) || MAX_RECORDS));
  return diversifyRecords(records, cap);
}

module.exports = {
  SOURCE,
  MAX_WORDS,
  MAX_RECORDS,
  PREVIEW_LIMIT,
  sanitizeWord,
  sanitizeWords,
  splitWordTokens,
  normalizeKnowledgeIds,
  applyKnowledgeIdFilter,
  buildImportCandidates,
  buildKeywordSearchQuery,
  groupKeywordBindings,
  pickFact,
  listFacts,
  resolveCapitalKind,
  formatCountryHasCapital,
  formatCityIsCapital,
  isCurrentCountryName,
  buildCapitalFacts,
  itemSearchScore,
  diversifyRecords,
  transformKeywordItems,
  collectKeywordRecords,
};
