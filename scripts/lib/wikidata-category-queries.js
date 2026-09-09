'use strict';

/**
 * Catálogo SPARQL por categoria do jogo.
 * Cada query obtém um conjunto de Q-ids; o detalhe confirma-se depois via REST v1.
 */

const CATEGORY_QUERIES = {
  20: [
    {
      id: 'unescoPt',
      categoryN: 20,
      api: 'sparql',
      label: 'Património Mundial UNESCO em Portugal',
      rest: { fields: ['labels', 'descriptions', 'statements'], confirmProperties: ['P1435'] },
      sparql: `SELECT ?item ?itemLabel WHERE {
  ?item wdt:P1435 wd:Q9259.
  ?item wdt:P17 wd:Q45.
  SERVICE wikibase:label { bd:serviceParam wikibase:language "pt,en". }
}
LIMIT 40`,
    },
    {
      id: 'ichPt',
      categoryN: 20,
      api: 'sparql',
      label: 'Património cultural imaterial em Portugal',
      rest: { fields: ['labels', 'descriptions', 'statements'], confirmProperties: ['P3259'] },
      sparql: `SELECT ?item ?itemLabel WHERE {
  ?item wdt:P3259 ?status.
  ?item wdt:P17 wd:Q45.
  SERVICE wikibase:label { bd:serviceParam wikibase:language "pt,en". }
}
LIMIT 20`,
    },
    {
      id: 'hearts',
      categoryN: 20,
      api: 'sparql',
      label: 'Animais com 2 ou mais corações',
      rest: { fields: ['labels', 'descriptions', 'statements'], confirmProperties: ['P2109'] },
      sparql: `SELECT ?item ?itemLabel ?hearts WHERE {
  ?item wdt:P2109 ?hearts.
  FILTER(?hearts >= 2 && ?hearts <= 12)
  SERVICE wikibase:label { bd:serviceParam wikibase:language "pt,en". }
}
LIMIT 25`,
    },
  ],
  2: [
    {
      id: 'countryCapitals',
      categoryN: 2,
      api: 'sparql',
      label: 'Capitais de países (rótulo PT)',
      rest: { fields: ['labels', 'descriptions', 'statements'], confirmProperties: ['P36'] },
      sparql: `SELECT ?country ?countryLabel ?capital ?capitalLabel WHERE {
  ?country wdt:P31 wd:Q6256.
  ?country wdt:P36 ?capital.
  SERVICE wikibase:label { bd:serviceParam wikibase:language "pt,en". }
}
LIMIT 80`,
    },
  ],
};

function getCategoryQueries(categoryN) {
  const n = Number(categoryN);
  return Array.isArray(CATEGORY_QUERIES[n]) ? CATEGORY_QUERIES[n] : [];
}

function listWikidataQueryCatalog() {
  return Object.keys(CATEGORY_QUERIES)
    .map(Number)
    .sort((a, b) => a - b)
    .flatMap((categoryN) => getCategoryQueries(categoryN));
}

function getQueryById(queryId) {
  const id = String(queryId || '').trim();
  return listWikidataQueryCatalog().find((row) => row.id === id) || null;
}

module.exports = {
  CATEGORY_QUERIES,
  getCategoryQueries,
  listWikidataQueryCatalog,
  getQueryById,
};
