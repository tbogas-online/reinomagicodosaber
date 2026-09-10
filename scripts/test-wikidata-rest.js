#!/usr/bin/env node
'use strict';

const { REST_BASE, itemUrl, pickLabel, pickDescription, statementContents, buildVerifiedAiInput, attachRestMetadata } = require('./lib/wikidata-rest');
const { getCategoryQueries, listWikidataQueryCatalog, getQueryById } = require('./lib/wikidata-category-queries');
const { transformCountryCapitalBindings } = require('./lib/wikidata-geografia');
const { validateRecord } = require('./lib/knowledge-import-core');
const { SPARQL_ENDPOINT } = require('./lib/wikidata-sparql');

let passed = 0;
let failed = 0;

function assert(name, cond, detail) {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('Wikidata SPARQL + REST — testes\n');

assert('REST base v1', REST_BASE === 'https://www.wikidata.org/w/rest.php/wikibase/v1');
assert('SPARQL é WDQS', SPARQL_ENDPOINT === 'https://query.wikidata.org/sparql');
assert('item URL com _fields', itemUrl('q597').includes('/entities/items/Q597') && itemUrl('Q597').includes('_fields='));

const restItem = {
  id: 'Q45',
  labels: { pt: 'Portugal', en: 'Portugal' },
  descriptions: { pt: 'país da Europa Ocidental' },
  aliases: { pt: ['República Portuguesa'] },
  statements: {
    P36: [{ value: { type: 'value', content: 'Q597' } }],
    P2109: [{ value: { type: 'value', content: { amount: '+3', unit: '1' } } }],
  },
};
assert('REST pickLabel PT', pickLabel(restItem) === 'Portugal');
assert('REST pickDescription PT', pickDescription(restItem) === 'país da Europa Ocidental');
assert('REST statement P36', statementContents(restItem, 'P36').join() === 'Q597');
assert('REST statement quantidade', statementContents(restItem, 'P2109').join() === '3');

const input = buildVerifiedAiInput({
  knowledge_id: 'knw-cat2-geo-wd-q45-capital',
  fact: 'A capital de Portugal é Lisboa.',
  answer: 'Lisboa',
  source_id: 'Q45',
}, restItem);
assert('input IA tem facto e Q-id', input.fact.includes('Lisboa') && input.qid === 'Q45' && /NÃO inventes/.test(input.instruction));
assert('input IA não pede invenção', input.source === 'Wikidata' && input.label === 'Portugal');

const { extractQid } = require('./lib/wikidata-sparql');
assert('extractQid de source_id com sufixo', extractQid('Q193683:unesco-t') === 'Q193683');
assert(
  'REST hidrata Q-id com sufixo',
  buildVerifiedAiInput({ source_id: 'Q45:capital', fact: 'A capital de Portugal é Lisboa.', answer: 'Lisboa' }, restItem).qid === 'Q45',
);

const attached = attachRestMetadata({ knowledge_id: 'x', fact: 'y', metadata: { qid: 'Q45' } }, restItem);
assert('metadata REST no facto', attached.metadata.restLabel === 'Portugal' && attached.metadata.restDescription.includes('Europa'));

assert('cat. 20 tem 2 queries SPARQL', getCategoryQueries(20).length === 2 && getCategoryQueries(20).every((q) => q.api === 'sparql'));
assert('cat. 20 não usa P2109', getCategoryQueries(20).every((q) => !String(q.sparql || '').includes('P2109')));
assert('cat. 2 tem capitais', getQueryById('countryCapitals')?.categoryN === 2);
assert('catálogo inclui UNESCO e capitais', listWikidataQueryCatalog().some((q) => q.id === 'unescoPt') && listWikidataQueryCatalog().some((q) => q.id === 'countryCapitals'));
assert('cat. sem queries = vazio', getCategoryQueries(99).length === 0);

const capitals = transformCountryCapitalBindings([
  {
    country: { value: 'http://www.wikidata.org/entity/Q45' },
    countryLabel: { value: 'Portugal' },
    capital: { value: 'http://www.wikidata.org/entity/Q597' },
    capitalLabel: { value: 'Lisboa' },
  },
  {
    country: { value: 'http://www.wikidata.org/entity/Q29' },
    countryLabel: { value: 'Q29' },
    capital: { value: 'http://www.wikidata.org/entity/Q2807' },
    capitalLabel: { value: 'Madrid' },
  },
]);
assert('geografia aceita Portugal/Lisboa', capitals.length === 1 && capitals[0].answer === 'Lisboa');
assert('geografia source Q-id do país', capitals[0].source_id === 'Q45' && capitals[0].category_n === 2);
assert('geografia válido', validateRecord(capitals[0]).length === 0, validateRecord(capitals[0]).join(','));
assert('atalho capitais ignora data de fim', String(getQueryById('countryCapitals')?.sparql || '').includes('P582'));

const southCapitals = transformCountryCapitalBindings([
  {
    country: { value: 'http://www.wikidata.org/entity/Q258' },
    countryLabel: { value: 'África do Sul' },
    capital: { value: 'http://www.wikidata.org/entity/Q3926' },
    capitalLabel: { value: 'Pretória' },
    capitalTypeLabel: { value: 'capital administrativa' },
  },
  {
    country: { value: 'http://www.wikidata.org/entity/Q258' },
    countryLabel: { value: 'África do Sul' },
    capital: { value: 'http://www.wikidata.org/entity/Q5468' },
    capitalLabel: { value: 'Cidade do Cabo' },
    capitalTypeLabel: { value: 'capital legislativa' },
  },
  {
    country: { value: 'http://www.wikidata.org/entity/Q258' },
    countryLabel: { value: 'África do Sul' },
    capital: { value: 'http://www.wikidata.org/entity/Q37701' },
    capitalLabel: { value: 'Bloemfontein' },
    capitalEnd: { value: '1910-01-01T00:00:00Z' },
  },
]);
assert(
  'geografia distingue capitais e ignora históricas',
  southCapitals.length === 2
    && southCapitals.some((row) => row.fact.includes('administrativa') && row.answer === 'Pretória')
    && southCapitals.some((row) => row.fact.includes('legislativa') && row.answer === 'Cidade do Cabo'),
);

console.log(`\nResultado: ${passed} passaram, ${failed} falharam`);
process.exit(failed > 0 ? 1 : 0);
