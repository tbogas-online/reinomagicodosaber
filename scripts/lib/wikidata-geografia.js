'use strict';

/**
 * Geografia (cat. 2) a partir de SPARQL + Q-id para hidratar via REST.
 */

const { getCategoryQueries } = require('./wikidata-category-queries');
const { fetchSparql, bindValue, qidFromUri, isUsableLabel } = require('./wikidata-sparql');
const { resolveCapitalKind, formatCountryHasCapital, isCurrentCountryName } = require('./wikidata-keyword-search');

const SOURCE = 'Wikidata';
const LICENSE = 'CC0';
const TOPIC = 'capital';

function toCapitalRecord(countryQid, countryLabel, capitalQid, capitalLabel, { kind, multi } = {}) {
  const capitalBit = String(capitalQid || '').toLowerCase();
  const kindBit = kind?.suffix ? `-${kind.suffix}` : '';
  return {
    knowledge_id: `knw-cat2-geo-wd-${countryQid.toLowerCase()}-capital-${capitalBit}${kindBit}`,
    category_n: 2,
    topic: TOPIC,
    subtopic: 'capital',
    fact: formatCountryHasCapital(countryLabel, capitalLabel, { kind, multi }),
    answer: capitalLabel,
    statement: `${formatCountryHasCapital(countryLabel, capitalLabel, { kind, multi })} Verdadeiro ou Falso?`,
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
    metadata: {
      pipeline: 'wikidata-sparql',
      qid: countryQid,
      relatedQid: capitalQid,
      capitalKind: kind?.id || (multi ? 'one-of-many' : 'sole'),
    },
  };
}

function transformCountryCapitalBindings(bindings) {
  const staged = [];
  for (const binding of bindings || []) {
    const countryQid = qidFromUri(bindValue(binding, 'country'));
    const capitalQid = qidFromUri(bindValue(binding, 'capital'));
    const countryLabel = bindValue(binding, 'countryLabel');
    const capitalLabel = bindValue(binding, 'capitalLabel');
    if (!countryQid || !capitalQid) continue;
    if (!isUsableLabel(countryLabel) || !isUsableLabel(capitalLabel)) continue;
    if (!isCurrentCountryName(countryLabel)) continue;
    if (bindValue(binding, 'capitalEnd') || bindValue(binding, 'dissolved')) continue;
    const kind = resolveCapitalKind(
      qidFromUri(bindValue(binding, 'capitalType')) || qidFromUri(bindValue(binding, 'capitalRole')) || qidFromUri(bindValue(binding, 'capitalMethod')),
      bindValue(binding, 'capitalTypeLabel'),
      bindValue(binding, 'capitalRoleLabel'),
      bindValue(binding, 'capitalMethodLabel'),
    );
    if (kind.skip) continue;
    staged.push({ countryQid, capitalQid, countryLabel, capitalLabel, kind: kind.id ? kind : null });
  }
  const counts = new Map();
  for (const row of staged) counts.set(row.countryQid, (counts.get(row.countryQid) || 0) + 1);
  return staged.map((row) => toCapitalRecord(
    row.countryQid,
    row.countryLabel,
    row.capitalQid,
    row.capitalLabel,
    { kind: row.kind, multi: (counts.get(row.countryQid) || 0) > 1 },
  ));
}

async function collectGeografiaRecords({ fetchFn, timeoutMs = 20000 } = {}) {
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
