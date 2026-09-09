#!/usr/bin/env node
'use strict';

const {
  BATCH_DEFS,
  resolveBatchIds,
  listImportSources,
  buildRecords,
} = require('./lib/curiosidades-batch-import');
const { validateRecord } = require('./lib/knowledge-import-core');

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

console.log('Curiosidades batch import — testes\n');

assert('lote all = a+b+c', resolveBatchIds('all').join('') === 'abc');
assert('lote inválido falha', (() => {
  try {
    resolveBatchIds('x');
    return false;
  } catch (err) {
    return err.code === 'INVALID_BATCH';
  }
})());

const sources = listImportSources();
assert('catálogo tem 4 fontes', sources.length === 4);
assert('catálogo inclui all', sources.some((s) => s.id === 'all' && s.source === 'manual'));

const loteA = buildRecords('a');
assert('lote A tem 50', loteA.length === BATCH_DEFS.a.expected);
assert('lote A source manual', loteA.every((r) => r.source === 'manual'));
assert('lote A válido', loteA.every((r) => validateRecord(r).length === 0), validateRecord(loteA[0]).join(','));

const loteC = buildRecords('c');
assert('lote C tem 48', loteC.length === BATCH_DEFS.c.expected);

const all = buildRecords('all');
assert('lotes A+B+C = 148', all.length === 148);
assert('ids únicos', new Set(all.map((r) => r.knowledge_id)).size === 148);

console.log(`\nResultado: ${passed} passaram, ${failed} falharam`);
process.exit(failed > 0 ? 1 : 0);
