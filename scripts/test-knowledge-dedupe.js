#!/usr/bin/env node
'use strict';

const { buildDedupePlan, filterNewRecords, formatDisabledReason, jaccard } = require('./lib/knowledge-dedupe');

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

console.log('Knowledge dedupe — testes unitários\n');

assert('jaccard idêntico', jaccard('sol lua terra', 'sol lua terra') === 1);
assert('jaccard diferente', jaccard('sol lua', 'cão gato') < 0.5);

const curiosidades = [
  { knowledge_id: 'knw-cat20-cur-b50-001', topic: 'curiosidade surpreendente', fact: 'As girafas só dormem alguns minutos.', answer: 'Verdadeiro', source: 'manual', is_active: true, priority_pt: 70 },
  { knowledge_id: 'knw-cat20-cur-daily-001', topic: 'curiosidade surpreendente', fact: 'As girafas só dormem alguns minutos.', answer: 'Verdadeiro', source: 'manual', is_active: true, priority_pt: 60 },
];

const curPlan = buildDedupePlan(curiosidades, { curiosidades: true, adivinhas: false });
assert('curiosidade exact_fact desactiva daily', curPlan.toDisable.some((e) => e.knowledge_id === 'knw-cat20-cur-daily-001'));
assert('curiosidade mantém b50', !curPlan.toDisable.some((e) => e.knowledge_id === 'knw-cat20-cur-b50-001'));
{
  const daily = curPlan.toDisable.find((e) => e.knowledge_id === 'knw-cat20-cur-daily-001');
  assert(
    'justificação de duplicado inclui keeper',
    formatDisabledReason(daily) === 'Duplicado (mesmo texto) — mantido knw-cat20-cur-b50-001',
    formatDisabledReason(daily),
  );
}

const adivinhas = [
  { knowledge_id: 'knw-cat20-mm-001', topic: 'adivinha tradicional', fact: 'Tenho dentes mas não mordo.', answer: 'Pente', source: 'MemóriaMedia', is_active: true, priority_pt: 98 },
  { knowledge_id: 'knw-cat20-web-ditos-001', topic: 'adivinha tradicional', fact: 'Tenho dentes e não mordo.', answer: 'Pente', source: 'Ditos.pt', is_active: true, priority_pt: 70 },
];

const advPlan = buildDedupePlan(adivinhas, { curiosidades: false, adivinhas: true });
assert('adivinha desactiva web duplicado', advPlan.toDisable.some((e) => e.knowledge_id === 'knw-cat20-web-ditos-001'));

const filtered = filterNewRecords(
  [{ topic: 'curiosidade surpreendente', fact: 'Facto novo único.', answer: 'Verdadeiro' }],
  curiosidades,
);
assert('filterNewRecords aceita novo', filtered.accepted.length === 1);
assert('filterNewRecords rejeita duplicado', filterNewRecords(
  [{ topic: 'curiosidade surpreendente', fact: 'As girafas só dormem alguns minutos.', answer: 'Verdadeiro' }],
  curiosidades,
).skipped.length === 1);

const unescoSites = [
  {
    knowledge_id: 'knw-cat20-cur-wd-q174779-unesco-t',
    topic: 'curiosidade surpreendente',
    fact: 'Mosteiro da Batalha faz parte do Património Mundial da UNESCO.',
    answer: 'Verdadeiro',
    source: 'Wikidata',
    source_id: 'Q174779',
    is_active: true,
  },
  {
    knowledge_id: 'knw-cat20-cur-wd-q593147-unesco-t',
    topic: 'curiosidade surpreendente',
    fact: 'Mosteiro de Alcobaça faz parte do Património Mundial da UNESCO.',
    answer: 'Verdadeiro',
    source: 'Wikidata',
    source_id: 'Q593147',
    is_active: true,
  },
];
assert('UNESCO Q-ids diferentes não colapsam', filterNewRecords(unescoSites, []).accepted.length === 2);
assert('UNESCO Q-ids diferentes não desactiva no dedupe', buildDedupePlan(unescoSites, { curiosidades: true, adivinhas: false }).toDisable.length === 0);

const unescoVf = filterNewRecords([
  {
    knowledge_id: 'knw-cat20-cur-wd-q193683-unesco-t',
    topic: 'curiosidade surpreendente',
    fact: 'Mosteiro dos Jerónimos faz parte do Património Mundial da UNESCO.',
    answer: 'Verdadeiro',
    source: 'Wikidata',
    source_id: 'Q193683:unesco-t',
    source_url: 'https://www.wikidata.org/wiki/Q193683',
  },
  {
    knowledge_id: 'knw-cat20-cur-wd-q193683-unesco-f',
    topic: 'curiosidade surpreendente',
    fact: 'Mosteiro dos Jerónimos fica em Espanha.',
    answer: 'Falso',
    source: 'Wikidata',
    source_id: 'Q193683:unesco-f',
    source_url: 'https://www.wikidata.org/wiki/Q193683',
  },
], []);
assert('UNESCO V e F do mesmo Q-id são factos distintos', unescoVf.accepted.length === 2);

const geoDup = filterNewRecords(
  [{ knowledge_id: 'b', topic: 'geografia', fact: 'A capital de Portugal é Lisboa.', answer: 'Lisboa', source: 'Wikidata', is_active: true }],
  [{ knowledge_id: 'a', topic: 'geografia', fact: 'A capital de Portugal é Lisboa.', answer: 'Lisboa', source: 'Wikidata', is_active: true }],
);
assert('geografia exact_fact desduplica', geoDup.accepted.length === 0 && geoDup.skipped.length === 1);

console.log(`\nResultado: ${passed} passaram, ${failed} falharam`);
process.exit(failed > 0 ? 1 : 0);
