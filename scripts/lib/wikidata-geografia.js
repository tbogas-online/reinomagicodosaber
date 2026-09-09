'use strict';

/**
 * Geografia (cat. 2) a partir de SPARQL + Q-id para hidratar via REST.
 */

const { getCategoryQueries } = require('./wikidata-category-queries');
const { fetchSparql, bindValue, qidFromUri, isUsableLabel } = require('./wikidata-sparql');

const SOURCE = 'Wikidata';
const LICENSE = 'CC0';
const TOPIC = 'capital';

function toCapitalRecord(countryQid, countryLabel, capitalQid, capitalLabel) {
  return {
    knowledge_id: `knw-cat2-geo-wd-${countryQid.toLowerCase()}-capital`,
    category_n: 2,
    topic: TOPIC,
    subtopic: 'capital',
    fact: `A capital de ${countryLabel} é ${capitalLabel}.`,
    answer: capitalLabel,
    statement: `A capital de ${countryLabel} é ${capitalLabel}. Verdadeiro ou Falso?`,
    is_true: true,
    source: SOURCE,
    source_id: countryQid,
    source_url: `https://www.wikidata.org/wiki/${countryQid}`,
    license: LICENSE,
    confidence: 0.94,
    priority_pt: countryLabel.toLowerCase().includes('portugal') ? 90 : 55,
    age_bands: ['6-9', '10-15', '15+'],
    allowed_formats: ['RESPOSTA_DIRETA', 'ESCOLHA_MULTIPLA', 'ONDE_FICA', 'VERDADEIRO_FALSO'],
    tags: ['wikidata', 'geografia', 'capital'],
    verified_by: 'wikidata-sparql-v1',
    metadata: { pipeline: 'wikidata-sparql', qid: countryQid, relatedQid: capitalQid },
  };
}

function transformCountryCapitalBindings(bindings) {
  const records = [];
  for (const binding of bindings || []) {
    const countryQid = qidFromUri(bindValue(binding, 'country'));
    const capitalQid = qidFromUri(bindValue(binding, 'capital'));
    const countryLabel = bindValue(binding, 'countryLabel');
    const capitalLabel = bindValue(binding, 'capitalLabel');
    if (!countryQid || !capitalQid) continue;
    if (!isUsableLabel(countryLabel) || !isUsableLabel(capitalLabel)) continue;
    records.push(toCapitalRecord(countryQid, countryLabel, capitalQid, capitalLabel));
  }
  return records;
}

async function collectGeografiaRecords({ fetchFn, timeoutMs } = {}) {
  const query = getCategoryQueries(2).find((row) => row.id === 'countryCapitals');
  if (!query) return [];
  const bindings = await fetchSparql(query.sparql, { fetchFn, timeoutMs });
  return transformCountryCapitalBindings(bindings);
}

module.exports = {
  SOURCE,
  TOPIC,
  toCapitalRecord,
  transformCountryCapitalBindings,
  collectGeografiaRecords,
};
