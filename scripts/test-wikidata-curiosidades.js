#!/usr/bin/env node
'use strict';

const { validateRecord } = require('./lib/knowledge-import-core');
const {
  SPARQL_ENDPOINT,
  qidFromUri,
  isUsableLabel,
  transformHeritageBindings,
  transformIchBindings,
  transformHeartsBindings,
  collectWikidataRecords,
} = require('./lib/wikidata-curiosidades');
const { importWikidataCuriosidades } = require('./lib/wikidata-curiosidades-import');
const {
  buildCuriosityQuestion,
  validateCuriosityQuestion,
  buildCuriosityBankItems,
} = require('./lib/curiosidade-question-from-fact');

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

function binding(qid, label, extra = {}) {
  return {
    item: { value: `http://www.wikidata.org/entity/${qid}` },
    itemLabel: { value: label },
    ...extra,
  };
}

function mockSparqlFetch(url) {
  const query = decodeURIComponent(String(url));
  let bindings = [];
  if (query.includes('P1435')) {
    bindings = [
      binding('Q193683', 'Mosteiro dos Jerónimos'),
      binding('Q1', 'Q1'),
      binding('Q2', 'Torre (Lisboa)'),
    ];
  } else if (query.includes('P3259')) {
    bindings = [binding('Q184266', 'Fado')];
  } else if (query.includes('P2109')) {
    bindings = [
      { ...binding('Q37140', 'polvo'), hearts: { value: '3' } },
      { ...binding('Q3', 'x'), hearts: { value: '1' } },
    ];
  }
  return Promise.resolve({
    ok: true,
    status: 200,
    json: async () => ({ results: { bindings } }),
  });
}

console.log('Wikidata curiosidades — testes\n');

assert('qid a partir de URI', qidFromUri('http://www.wikidata.org/entity/Q193683') === 'Q193683');
assert('rótulo PT útil', isUsableLabel('Mosteiro dos Jerónimos'));
assert('rejeita Q-id como rótulo', !isUsableLabel('Q193683'));
assert('rejeita parênteses', !isUsableLabel('Torre (Lisboa)'));

const unesco = transformHeritageBindings([binding('Q193683', 'Mosteiro dos Jerónimos')]);
assert('UNESCO gera V e F', unesco.length === 2);
assert('UNESCO verdadeiro', unesco[0].is_true === true && /UNESCO/.test(unesco[0].fact));
assert('UNESCO falso Espanha', unesco[1].is_true === false && /Espanha/.test(unesco[1].fact));
assert('UNESCO source Wikidata', unesco[0].source === 'Wikidata' && unesco[0].source_id === 'Q193683:unesco-t');
assert('UNESCO V e F com source_id distintos', unesco[0].source_id !== unesco[1].source_id && unesco[1].source_id === 'Q193683:unesco-f');
assert('UNESCO URL Q-id', unesco[0].source_url === 'https://www.wikidata.org/wiki/Q193683');
assert('UNESCO válido', validateRecord(unesco[0]).length === 0, validateRecord(unesco[0]).join(','));
assert('UNESCO falso válido', validateRecord(unesco[1]).length === 0, validateRecord(unesco[1]).join(','));

const ich = transformIchBindings([binding('Q184266', 'Fado')]);
assert('ICH um facto verdadeiro', ich.length === 1 && ich[0].is_true === true && /Imaterial/.test(ich[0].fact));
assert('ICH válido', validateRecord(ich[0]).length === 0, validateRecord(ich[0]).join(','));

const hearts = transformHeartsBindings([{ ...binding('Q37140', 'polvo'), hearts: { value: '3' } }]);
assert('corações 3', hearts[0]?.fact === 'polvo tem 3 corações.');
assert('corações válido', validateRecord(hearts[0]).length === 0, validateRecord(hearts[0]).join(','));
assert('corações inclui 6-9', Array.isArray(hearts[0].age_bands) && hearts[0].age_bands.includes('6-9'));

{
  const vf = buildCuriosityQuestion(unesco[0], 'VERDADEIRO_FALSO');
  const issues = validateCuriosityQuestion(unesco[0], vf);
  assert('template V/F usa statement', /Verdadeiro ou Falso/.test(vf.question));
  assert('template resposta Verdadeiro', vf.correctAnswer === 'Verdadeiro');
  assert('validação da resposta ok', issues.length === 0, issues.join(','));
}

{
  const vfFalse = buildCuriosityQuestion(unesco[1], 'VERDADEIRO_FALSO');
  assert('falso → Falso', vfFalse.correctAnswer === 'Falso');
  assert('falso no enunciado', /Espanha/.test(vfFalse.question));
  assert('validação falso ok', validateCuriosityQuestion(unesco[1], vfFalse).length === 0);
}

{
  const bad = { ...unesco[0] };
  const built = buildCuriosityQuestion(bad, 'VERDADEIRO_FALSO');
  built.correctAnswer = 'Sim';
  assert('rejeita resposta fora de V/F', validateCuriosityQuestion(bad, built).includes('answer_mismatch'));
}

collectWikidataRecords({ fetchFn: mockSparqlFetch }).then(async (records) => {
  assert('SPARQL mock obtém 4 factos', records.length === 4, `len=${records.length}`);
  assert('ids únicos', new Set(records.map((r) => r.knowledge_id)).size === 4);
  assert(
    'source+source_id únicos no lote',
    new Set(records.map((r) => `${r.source}|${r.source_id}`)).size === records.length,
  );
  assert('todos válidos', records.every((r) => validateRecord(r).length === 0));

  const bank = buildCuriosityBankItems(records);
  assert('perguntas por faixa etária', bank.items.length === 9, `len=${bank.items.length}`);
  assert('nenhuma pergunta inválida', bank.skipped.length === 0, JSON.stringify(bank.skipped));
  assert('todas com knowledge_id', bank.items.every((row) => row.knowledge_id && row.format === 'VERDADEIRO_FALSO'));

  const dry = await importWikidataCuriosidades(
    { url: 'https://example.supabase.co', key: 'test-key' },
    { dryRun: true, fetchFn: mockSparqlFetch, existingRecords: [] },
  );
  assert('dry-run ok', dry.ok === true && dry.dryRun === true);
  assert('dry-run 4 novos', dry.newCount === 4 && dry.imported === 0);
  assert('dry-run prepara perguntas', dry.questionsPrepared === 9);
  assert('endpoint SPARQL', SPARQL_ENDPOINT === 'https://query.wikidata.org/sparql');

  const dup = await importWikidataCuriosidades(
    { url: 'https://example.supabase.co', key: 'test-key' },
    {
      dryRun: true,
      fetchFn: mockSparqlFetch,
      existingRecords: [{
        knowledge_id: 'knw-cat20-cur-b50-999',
        topic: 'curiosidade surpreendente',
        fact: 'polvo tem 3 corações.',
        answer: 'Verdadeiro',
        is_active: true,
      }],
    },
  );
  assert('dedupe polvo já no lote manual', dup.skipped >= 1 && dup.newCount === 3, `new=${dup.newCount} skipped=${dup.skipped}`);

  console.log(`\nResultado: ${passed} passaram, ${failed} falharam`);
  process.exit(failed > 0 ? 1 : 0);
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
