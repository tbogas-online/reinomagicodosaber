#!/usr/bin/env node
'use strict';

const { validateRecord } = require('./lib/knowledge-import-core');
const { listCategoryTopics, getCategoryTopic, findSubtopic, findFocus, suggestionsFor } = require('./lib/wikidata-category-topics');
const {
  sanitizeWords,
  splitWordTokens,
  applyKnowledgeIdFilter,
  buildImportCandidates,
  PREVIEW_LIMIT,
  buildKeywordSearchQuery,
  groupKeywordBindings,
  pickFact,
  listFacts,
  itemSearchScore,
  diversifyRecords,
  transformKeywordItems,
  collectKeywordRecords,
} = require('./lib/wikidata-keyword-search');
const { itemFitsCategory } = require('./lib/wikidata-category-match');

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
assert('cat. 2 tem subtema Portugal', findSubtopic(2, 'portugal')?.label === 'Portugal');
assert('Portugal tem tópico Rios', findFocus(2, 'portugal', 'rivers')?.label === 'Rios');
assert('Rios de Portugal sugere Tejo', suggestionsFor(2, 'portugal', 'rivers').includes('Tejo'));
assert('subtema pelo rótulo', findSubtopic(2, 'Portugal')?.id === 'portugal');
assert('tópico pelo rótulo', findFocus(2, 'europa', 'Capitais')?.label === 'Capitais');
assert('sem tópico junta palavras do subtema', suggestionsFor(2, 'portugal').includes('Tejo'));
assert('sem subtema usa sugestões da categoria', suggestionsFor(2, '').includes('Portugal'));
assert('piloto geografia tem 6 subtemas', getCategoryTopic(2).subtopics.length === 6);
assert('Europa tem 6 tópicos', findSubtopic(2, 'europa').topics.length === 6);
for (const topic of listCategoryTopics()) {
  const clean = sanitizeWords(topic.suggestions);
  assert(`cat. ${topic.categoryN} tem sugestões utilizáveis`, clean.length >= 3, `${topic.suggestions.join(', ')} → ${clean.join(', ')}`);
  assert(`cat. ${topic.categoryN} tem subtemas`, (topic.subtopics || []).length >= 2);
  for (const sub of topic.subtopics || []) {
    if (sub.topics?.length) {
      assert(`cat. ${topic.categoryN} / ${sub.id} tem tópicos`, sub.topics.length >= 3);
      for (const focus of sub.topics) {
        const focusClean = sanitizeWords(focus.suggestions);
        assert(`cat. ${topic.categoryN} / ${sub.id} / ${focus.id} tem palavras`, focusClean.length >= 3, `${(focus.suggestions || []).join(', ')} → ${focusClean.join(', ')}`);
      }
    } else {
      const subClean = sanitizeWords(sub.suggestions);
      assert(`cat. ${topic.categoryN} / ${sub.id} tem palavras`, subClean.length >= 3, `${(sub.suggestions || []).join(', ')} → ${subClean.join(', ')}`);
    }
  }
}
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

const lynx = groupKeywordBindings([
  binding({
    item: 'http://www.wikidata.org/entity/Q127960',
    itemLabel: 'lince-ibérico',
    class: 'http://www.wikidata.org/entity/Q16521',
    classLabel: 'táxon',
    country: 'http://www.wikidata.org/entity/Q45',
    countryLabel: 'Portugal',
  }),
]);
assert('táxon com país entra na natureza', itemFitsCategory(lynx[0], 5) && pickFact(lynx[0], { categoryN: 5 })?.answer === 'Portugal');

const giraffe = groupKeywordBindings([
  binding({
    item: 'http://www.wikidata.org/entity/Q15083',
    itemLabel: 'girafa',
    class: 'http://www.wikidata.org/entity/Q16521',
    classLabel: 'táxon',
  }),
]);
assert('táxon sem país gera espécie', pickFact(giraffe[0], { categoryN: 5 })?.fact === 'girafa é uma espécie.');

const portugalTypes = listFacts(portugal[0], { categoryN: 2 });
assert(
  'Portugal gera capital e identificação',
  portugalTypes.some((row) => row.suffix === 'p36') && portugalTypes.some((row) => row.suffix === 'p31'),
);

const tejoRich = groupKeywordBindings([
  binding({
    item: 'http://www.wikidata.org/entity/Q14294',
    itemLabel: 'Tejo',
    class: 'http://www.wikidata.org/entity/Q4022',
    classLabel: 'rio',
    country: 'http://www.wikidata.org/entity/Q45',
    countryLabel: 'Portugal',
    mouth: 'http://www.wikidata.org/entity/Q97',
    mouthLabel: 'Oceano Atlântico',
  }),
]);
const tejoFacts = listFacts(tejoRich[0], { categoryN: 2 });
assert(
  'Tejo gera hidrografia e classe, não só localização',
  tejoFacts.some((row) => row.suffix === 'p403') && tejoFacts.some((row) => row.suffix === 'p31'),
);

const rioJaneiro = groupKeywordBindings([
  binding({
    item: 'http://www.wikidata.org/entity/Q8678',
    itemLabel: 'Rio de Janeiro',
    class: 'http://www.wikidata.org/entity/Q515',
    classLabel: 'cidade',
    country: 'http://www.wikidata.org/entity/Q155',
    countryLabel: 'Brasil',
  }),
]);
assert(
  'palavra rio prefere o rio Tejo à cidade Rio de Janeiro',
  itemSearchScore(tejoRich[0], 'rio') > itemSearchScore(rioJaneiro[0], 'rio'),
);

const mixedTypes = [
  { knowledge_id: 'a', metadata: { factKey: 'p17' } },
  { knowledge_id: 'b', metadata: { factKey: 'p17' } },
  { knowledge_id: 'c', metadata: { factKey: 'p36' } },
  { knowledge_id: 'd', metadata: { factKey: 'p31' } },
];
assert(
  'lista mistura tipos de facto',
  diversifyRecords(mixedTypes, 3).map((row) => row.metadata.factKey).join() === 'p17,p36,p31',
);

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
  assert(
    'pesquisa Lisboa gera localização e identificação',
    rows.some((row) => row.fact === 'Lisboa fica em Portugal.') && rows.some((row) => row.fact === 'Lisboa é uma cidade.'),
  );
  assert('ids estáveis', rows.some((row) => row.knowledge_id === 'knw-cat2-wd-q597-p17'));
  return collectKeywordRecords({ categoryN: 2, words: ['Lisboa'], fetchFn: mockSparqlFetch, limit: 1 });
}).then((capped) => {
  assert('respeita limite do briefing', capped.length === 1);
  console.log(`\nResultado: ${passed} passaram, ${failed} falharam`);
  process.exit(failed > 0 ? 1 : 0);
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
