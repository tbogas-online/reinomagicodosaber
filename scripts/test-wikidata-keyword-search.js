#!/usr/bin/env node
'use strict';

const { validateRecord } = require('./lib/knowledge-import-core');
const { listCategoryTopics, getCategoryTopic } = require('./lib/wikidata-category-topics');
const {
  sanitizeWords,
  buildKeywordSearchQuery,
  groupKeywordBindings,
  pickFact,
  transformKeywordItems,
  collectKeywordRecords,
} = require('./lib/wikidata-keyword-search');

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

function binding(fields) {
  const row = {};
  for (const [key, value] of Object.entries(fields)) {
    row[key] = { value };
  }
  return row;
}

console.log('Wikidata pesquisa por palavras — testes\n');

assert('catálogo tem 20 categorias', listCategoryTopics().length === 20);
assert('cat. 5 sugere polvo', getCategoryTopic(5).suggestions.includes('polvo'));
assert('cat. 20 tem atalho UNESCO', getCategoryTopic(20).presets.some((p) => p.id === 'unescoPt'));
assert('sanitiza palavras', sanitizeWords(['  Tejo ', 'Tejo', '???', 'a']).join() === 'Tejo');
assert('limite 4 palavras', sanitizeWords(['um', 'dois', 'três', 'quatro', 'cinco']).length === 4);
assert('query SPARQL usa EntitySearch', buildKeywordSearchQuery('Lisboa').includes('EntitySearch') && buildKeywordSearchQuery('Lisboa').includes('Lisboa'));

const portugal = groupKeywordBindings([
  binding({
    item: 'http://www.wikidata.org/entity/Q45',
    itemLabel: 'Portugal',
    class: 'http://www.wikidata.org/entity/Q6256',
    classLabel: 'país',
    capital: 'http://www.wikidata.org/entity/Q597',
    capitalLabel: 'Lisboa',
  }),
]);
assert('agrupa Portugal', portugal.length === 1 && portugal[0].capitals[0].label === 'Lisboa');
const capitalFact = pickFact(portugal[0]);
assert('capital de Portugal', capitalFact?.fact === 'A capital de Portugal é Lisboa.' && capitalFact.suffix === 'p36');

const rio = groupKeywordBindings([
  binding({
    item: 'http://www.wikidata.org/entity/Q14294',
    itemLabel: 'Tejo',
    class: 'http://www.wikidata.org/entity/Q4022',
    classLabel: 'rio',
    country: 'http://www.wikidata.org/entity/Q45',
    countryLabel: 'Portugal',
  }),
]);
assert('Tejo fica em Portugal', pickFact(rio[0])?.fact === 'Tejo fica em Portugal.');

const taxon = groupKeywordBindings([
  binding({
    item: 'http://www.wikidata.org/entity/Q152',
    itemLabel: 'polvo',
    class: 'http://www.wikidata.org/entity/Q16521',
    classLabel: 'táxon',
  }),
  binding({
    item: 'http://www.wikidata.org/entity/Q152',
    itemLabel: 'polvo',
    class: 'http://www.wikidata.org/entity/Q188805',
    classLabel: 'cefalópode',
  }),
]);
assert('ignora táxon e usa classe útil', pickFact(taxon[0])?.fact === 'polvo é cefalópode.');

const records = transformKeywordItems(portugal, { categoryN: 2, word: 'Portugal' });
assert('registo cat. 2', records[0]?.category_n === 2 && records[0].answer === 'Lisboa');
assert('source_id inclui categoria', records[0]?.source_id === 'Q45:cat2:p36');
assert('registo válido', validateRecord(records[0]).length === 0, validateRecord(records[0]).join(','));

const curiosity = transformKeywordItems(taxon, { categoryN: 20, word: 'polvo' });
assert('cat. 20 responde Verdadeiro', curiosity[0]?.answer === 'Verdadeiro' && curiosity[0].topic === 'curiosidade surpreendente');

function mockSparqlFetch(url) {
  const query = decodeURIComponent(String(url));
  let bindings = [];
  if (query.includes('Lisboa')) {
    bindings = [
      binding({
        item: 'http://www.wikidata.org/entity/Q597',
        itemLabel: 'Lisboa',
        class: 'http://www.wikidata.org/entity/Q515',
        classLabel: 'cidade',
        country: 'http://www.wikidata.org/entity/Q45',
        countryLabel: 'Portugal',
      }),
    ];
  }
  return Promise.resolve({
    ok: true,
    status: 200,
    json: async () => ({ results: { bindings } }),
  });
}

collectKeywordRecords({ categoryN: 2, words: ['Lisboa'], fetchFn: mockSparqlFetch }).then((rows) => {
  assert('pesquisa Lisboa gera facto', rows[0]?.fact === 'Lisboa fica em Portugal.');
  assert('ids estáveis', rows[0]?.knowledge_id === 'knw-cat2-wd-q597-p17');
  console.log(`\nResultado: ${passed} passaram, ${failed} falharam`);
  process.exit(failed > 0 ? 1 : 0);
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
