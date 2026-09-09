'use strict';

/**
 * Curiosidades (cat. 20) via SPARQL/WDQS.
 * Conjuntos: SPARQL. Detalhe do Q-id: REST v1 (wikidata-rest.js).
 */

const { getCategoryQueries } = require('./wikidata-category-queries');
const {
  SPARQL_ENDPOINT,
  bindValue,
  qidFromUri,
  isUsableLabel,
  parseSparqlBindings,
  fetchSparql,
} = require('./wikidata-sparql');

const SOURCE = 'Wikidata';
const LICENSE = 'CC0';
const TOPIC = 'curiosidade surpreendente';

const QUERIES = Object.fromEntries(
  getCategoryQueries(20).map((row) => [row.id, row.sparql]),
);

function buildStatement(fact) {
  const core = String(fact || '').trim().replace(/\.$/, '');
  return `${core}. Verdadeiro ou Falso?`;
}

function toRecord({
  qid, fact, isTrue, subtopic, tags, priorityPt, confidence, suffix,
}) {
  const answer = isTrue ? 'Verdadeiro' : 'Falso';
  return {
    knowledge_id: `knw-cat20-cur-wd-${qid.toLowerCase()}-${suffix}`,
    category_n: 20,
    topic: TOPIC,
    subtopic,
    fact,
    answer,
    statement: buildStatement(fact),
    is_true: isTrue,
    source: SOURCE,
    source_id: `${qid}:${suffix}`,
    source_url: `https://www.wikidata.org/wiki/${qid}`,
    license: LICENSE,
    confidence,
    priority_pt: priorityPt,
    age_bands: isTrue && subtopic === 'animais'
      ? ['6-9', '10-15', '15+']
      : ['10-15', '15+'],
    allowed_formats: ['CURIOSIDADE', 'VERDADEIRO_FALSO'],
    tags,
    verified_by: 'wikidata-sparql-v1',
    metadata: { pipeline: 'wikidata-sparql', qid, factKey: suffix },
  };
}

function transformHeritageBindings(bindings, { falseLimit = 15 } = {}) {
  const records = [];
  let falseCount = 0;
  for (const binding of bindings || []) {
    const qid = qidFromUri(bindValue(binding, 'item'));
    const label = bindValue(binding, 'itemLabel');
    if (!qid || !isUsableLabel(label)) continue;
    records.push(toRecord({
      qid,
      fact: `${label} faz parte do Património Mundial da UNESCO.`,
      isTrue: true,
      subtopic: 'portugal',
      tags: ['wikidata', 'unesco', 'portugal'],
      priorityPt: 72,
      confidence: 0.94,
      suffix: 'unesco-t',
    }));
    if (falseCount < falseLimit) {
      records.push(toRecord({
        qid,
        fact: `${label} fica em Espanha.`,
        isTrue: false,
        subtopic: 'portugal',
        tags: ['wikidata', 'unesco', 'portugal'],
        priorityPt: 68,
        confidence: 0.93,
        suffix: 'unesco-f',
      }));
      falseCount += 1;
    }
  }
  return records;
}

function transformIchBindings(bindings) {
  const records = [];
  for (const binding of bindings || []) {
    const qid = qidFromUri(bindValue(binding, 'item'));
    const label = bindValue(binding, 'itemLabel');
    if (!qid || !isUsableLabel(label)) continue;
    records.push(toRecord({
      qid,
      fact: `${label} faz parte do Património Cultural Imaterial da Humanidade da UNESCO.`,
      isTrue: true,
      subtopic: 'cultura',
      tags: ['wikidata', 'unesco', 'portugal', 'cultura'],
      priorityPt: 74,
      confidence: 0.94,
      suffix: 'ich-t',
    }));
  }
  return records;
}

function transformHeartsBindings(bindings) {
  const records = [];
  for (const binding of bindings || []) {
    const qid = qidFromUri(bindValue(binding, 'item'));
    const label = bindValue(binding, 'itemLabel');
    const hearts = Number(bindValue(binding, 'hearts'));
    if (!qid || !isUsableLabel(label) || !Number.isFinite(hearts) || hearts < 2) continue;
    const noun = hearts === 1 ? 'coração' : 'corações';
    records.push(toRecord({
      qid,
      fact: `${label} tem ${hearts} ${noun}.`,
      isTrue: true,
      subtopic: 'animais',
      tags: ['wikidata', 'animais', 'ciência'],
      priorityPt: 66,
      confidence: 0.92,
      suffix: 'hearts-t',
    }));
  }
  return records;
}

function dedupeByKnowledgeId(records) {
  const seen = new Set();
  const out = [];
  for (const record of records) {
    if (!record?.knowledge_id || seen.has(record.knowledge_id)) continue;
    seen.add(record.knowledge_id);
    out.push(record);
  }
  return out;
}

async function collectWikidataRecords({ fetchFn, timeoutMs } = {}) {
  const [unesco, ich, hearts] = await Promise.all([
    fetchSparql(QUERIES.unescoPt, { fetchFn, timeoutMs }),
    fetchSparql(QUERIES.ichPt, { fetchFn, timeoutMs }),
    fetchSparql(QUERIES.hearts, { fetchFn, timeoutMs }),
  ]);
  return dedupeByKnowledgeId([
    ...transformHeritageBindings(unesco),
    ...transformIchBindings(ich),
    ...transformHeartsBindings(hearts),
  ]);
}

function listWikidataImportSources() {
  return [
    {
      id: 'wikidata',
      kind: 'wikidata',
      batch: 'pt',
      label: 'Wikidata — património UNESCO PT e factos estruturados',
      source: SOURCE,
    },
  ];
}

module.exports = {
  SPARQL_ENDPOINT,
  SOURCE,
  QUERIES,
  qidFromUri,
  isUsableLabel,
  toRecord,
  transformHeritageBindings,
  transformIchBindings,
  transformHeartsBindings,
  parseSparqlBindings,
  fetchSparql,
  collectWikidataRecords,
  listWikidataImportSources,
};
