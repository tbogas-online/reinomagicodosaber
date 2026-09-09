#!/usr/bin/env node
'use strict';

const { validateRecord } = require('./lib/knowledge-import-core');
const { listCategoryTopics, getCategoryTopic } = require('./lib/wikidata-category-topics');
const {
  sanitizeWords,
  splitWordTokens,
  applyKnowledgeIdFilter,
  buildImportCandidates,
  PREVIEW_LIMIT,
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
assert('separa vírgulas e ponto-e-vírgula', sanitizeWords(['portugal, seleção, golo']).join() === 'portugal,seleção,golo');
assert('limite 4 palavras', sanitizeWords(['um', 'dois', 'três', 'quatro', 'cinco']).length === 4);
assert('tokens de campo livre', splitWordTokens('portugal, seleção; golo').length === 3);
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
assert('ignora táxon e usa classe útil', pickFact(taxon[0])?.fact === 'polvo é um cefalópode.');

const records = transformKeywordItems(portugal, { categoryN: 2, word: 'Portugal' });
assert('registo cat. 2', records[0]?.category_n === 2 && records[0].answer === 'Lisboa');
assert('source_id inclui categoria', records[0]?.source_id === 'Q45:cat2:p36');
assert('registo válido', validateRecord(records[0]).length === 0, validateRecord(records[0]).join(','));

const twelve = Array.from({ length: 12 }, (_, i) => ({ knowledge_id: `knw-${i}`, fact: `Facto ${i}.`, answer: 'X' }));
assert('lista de importação tem 10 entradas', buildImportCandidates(twelve, []).length === PREVIEW_LIMIT);
assert('filtra IDs seleccionados', applyKnowledgeIdFilter(twelve, ['knw-1', 'knw-9']).records.map((row) => row.knowledge_id).join() === 'knw-1,knw-9');
assert('duplicados preenchem a lista', buildImportCandidates(twelve.slice(0, 2), [{ record: twelve[2], reason: 'dup' }]).some((row) => row.status === 'duplicate'));

const curiosity = transformKeywordItems(taxon, { categoryN: 20, word: 'polvo' });
assert('cat. 20 responde Verdadeiro', curiosity[0]?.answer === 'Verdadeiro' && curiosity[0].topic === 'curiosidade surpreendente');

const filmRio = groupKeywordBindings([
  binding({
    item: 'http://www.wikidata.org/entity/Q208569',
    itemLabel: 'Rio',
    class: 'http://www.wikidata.org/entity/Q202866',
    classLabel: 'filme de animação',
    country: 'http://www.wikidata.org/entity/Q30',
    countryLabel: 'Estados Unidos',
  }),
]);
assert('filme Rio fora da geografia', transformKeywordItems(filmRio, { categoryN: 2, word: 'rio' }).length === 0);
assert('filme Rio na categoria cinema', transformKeywordItems(filmRio, { categoryN: 11, word: 'rio' })[0]?.answer === 'filme de animação');

const africa = groupKeywordBindings([
  binding({
    item: 'http://www.wikidata.org/entity/Q15',
    itemLabel: 'África',
    class: 'http://www.wikidata.org/entity/Q5107',
    classLabel: 'continente',
  }),
]);
assert('continente África na geografia', transformKeywordItems(africa, { categoryN: 2, word: 'africa' })[0]?.fact === 'África é um continente.');
assert('continente África fora do desporto', transformKeywordItems(africa, { categoryN: 15, word: 'africa' }).length === 0);

const givenName = groupKeywordBindings([
  binding({
    item: 'http://www.wikidata.org/entity/Q123',
    itemLabel: 'Africa',
    class: 'http://www.wikidata.org/entity/Q11879590',
    classLabel: 'nome próprio feminino',
  }),
]);
assert('nome próprio fora da geografia', transformKeywordItems(givenName, { categoryN: 2, word: 'africa' }).length === 0);

const watercourseType = groupKeywordBindings([
  binding({
    item: 'http://www.wikidata.org/entity/Q4022',
    itemLabel: 'rio',
    class: 'http://www.wikidata.org/entity/Q11626619',
    classLabel: 'type of watercourse',
  }),
]);
assert('conceito rio não entra na geografia', transformKeywordItems(watercourseType, { categoryN: 2, word: 'rio' }).length === 0);

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
