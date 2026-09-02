#!/usr/bin/env node
'use strict';

const { buildDedupePlan, filterNewRecords, jaccard } = require('./lib/knowledge-dedupe');

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

console.log(`\nResultado: ${passed} passaram, ${failed} falharam`);
process.exit(failed > 0 ? 1 : 0);
