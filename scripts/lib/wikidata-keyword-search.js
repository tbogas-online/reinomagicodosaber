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

const SOURCE = 'Wikidata';
const LICENSE = 'CC0';
const MAX_WORDS = 4;
const SEARCH_LIMIT = 5;
const MAX_RECORDS = 24;

const SKIP_CLASS_QIDS = new Set([
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
]);

const SKIP_CLASS_LABEL = /t[aá]xon|wikimedia|desambigua|artigo|categoria|página|entidade|humano|ser humano/i;

const CLASS_PHRASE = {
  país: 'um país',
  cidade: 'uma cidade',
  vila: 'uma vila',
  rio: 'um rio',
  montanha: 'uma montanha',
  oceano: 'um oceano',
  ilha: 'uma ilha',
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
};

function sanitizeWord(raw) {
  const text = String(raw || '').trim().replace(/\s+/g, ' ');
  if (text.length < 2 || text.length > 40) return '';
  if (!/^[\p{L}\p{N} \-']+$/u.test(text)) return '';
  return text;
}

function sanitizeWords(words) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(words) ? words : []) {
    const word = sanitizeWord(raw);
    const key = word.toLowerCase();
    if (!word || seen.has(key)) continue;
    seen.add(key);
    out.push(word);
    if (out.length >= MAX_WORDS) break;
  }
  return out;
}

function escapeSparqlString(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
}

function buildKeywordSearchQuery(word) {
  const search = escapeSparqlString(sanitizeWord(word));
  if (!search) return '';
  return `SELECT ?item ?itemLabel ?class ?classLabel ?country ?countryLabel ?capital ?capitalLabel ?place ?placeLabel ?occupation ?occupationLabel WHERE {
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
  OPTIONAL { ?item wdt:P36 ?capital. }
  OPTIONAL { ?item wdt:P131 ?place. }
  OPTIONAL { ?item wdt:P106 ?occupation. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "pt,en". }
}
LIMIT 12`;
}

function pushUnique(list, qid, label) {
  if (!qid || !isUsableLabel(label)) return;
  if (list.some((row) => row.qid === qid)) return;
  list.push({ qid, label });
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
      };
      map.set(qid, row);
    }
    pushUnique(row.classes, qidFromUri(bindValue(binding, 'class')), bindValue(binding, 'classLabel'));
    pushUnique(row.countries, qidFromUri(bindValue(binding, 'country')), bindValue(binding, 'countryLabel'));
    pushUnique(row.capitals, qidFromUri(bindValue(binding, 'capital')), bindValue(binding, 'capitalLabel'));
    pushUnique(row.places, qidFromUri(bindValue(binding, 'place')), bindValue(binding, 'placeLabel'));
    pushUnique(row.occupations, qidFromUri(bindValue(binding, 'occupation')), bindValue(binding, 'occupationLabel'));
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

function pickFact(item) {
  const label = item.label;
  const capital = item.capitals[0];
  const country = item.countries[0];
  const place = item.places[0];
  const occupation = item.occupations[0];
  const cls = item.classes.find(usableClass);

  if (capital) {
    return {
      fact: `A capital de ${label} é ${capital.label}.`,
      answer: capital.label,
      suffix: 'p36',
      subtopic: 'capital',
    };
  }
  if (country) {
    return {
      fact: `${label} fica em ${country.label}.`,
      answer: country.label,
      suffix: 'p17',
      subtopic: 'localização',
    };
  }
  if (place) {
    return {
      fact: `${label} fica em ${place.label}.`,
      answer: place.label,
      suffix: 'p131',
      subtopic: 'localização',
    };
  }
  if (occupation) {
    return {
      fact: `${label} é ${occupation.label}.`,
      answer: occupation.label,
      suffix: 'p106',
      subtopic: 'personagem',
    };
  }
  if (cls && cls.label.toLowerCase() !== label.toLowerCase()) {
    return {
      fact: `${label} é ${classPhrase(cls.label)}.`,
      answer: cls.label,
      suffix: 'p31',
      subtopic: 'identificação',
    };
  }
  return null;
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
  const records = [];
  for (const item of items || []) {
    const picked = pickFact(item);
    if (!picked) continue;
    records.push(toKeywordRecord(categoryN, item, picked, word));
  }
  return records;
}

async function searchKeywordItems(word, { fetchFn, timeoutMs } = {}) {
  const query = buildKeywordSearchQuery(word);
  if (!query) return [];
  const bindings = await fetchSparql(query, { fetchFn, timeoutMs });
  return groupKeywordBindings(bindings);
}

async function collectKeywordRecords({ categoryN, words, fetchFn, timeoutMs } = {}) {
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
      if (records.length >= MAX_RECORDS) return records;
    }
  }
  return records;
}

module.exports = {
  SOURCE,
  MAX_WORDS,
  sanitizeWord,
  sanitizeWords,
  buildKeywordSearchQuery,
  groupKeywordBindings,
  pickFact,
  transformKeywordItems,
  collectKeywordRecords,
};
