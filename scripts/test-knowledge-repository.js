#!/usr/bin/env node
/**
 * Testes unitários do cliente Knowledge Repository (sem Supabase).
 * Executar: node scripts/test-knowledge-repository.js
 */
'use strict';

const path = require('path');
const vm = require('vm');
const fs = require('fs');

const publicDir = path.join(__dirname, '..', 'public');
const src = fs.readFileSync(path.join(publicDir, 'knowledge-repository.js'), 'utf8');
const sandbox = { globalThis: {}, window: {} };
sandbox.window = sandbox.globalThis;
vm.createContext(sandbox);
vm.runInContext(src, sandbox);

const KR = sandbox.globalThis.ReinoKnowledgeRepository;
if (!KR) {
  console.error('Falha ao carregar ReinoKnowledgeRepository');
  process.exit(1);
}

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

console.log('Knowledge Repository — testes unitários\n');

const row = KR.rowToRecord({
  knowledgeId: 'knw-cat20-adv-001',
  category: 20,
  topic: 'adivinha tradicional',
  fact: 'Tem dentes mas não morde.',
  answer: 'Pente',
  clues: ['tem dentes'],
  source: 'MemóriaMedia',
  sourceId: 'mm:1',
  confidence: 0.95,
  ageBands: ['6-9'],
  allowedFormats: ['ADIVINHA'],
});

assert('rowToRecord válido', row && row.knowledgeId === 'knw-cat20-adv-001' && row.clues.length === 1);
assert('rowToRecord rejeita vazio', KR.rowToRecord(null) === null);
assert('isConfigured sem Supabase', KR.isConfigured() === false);

console.log(`\nResultado: ${passed} passaram, ${failed} falharam`);
process.exit(failed > 0 ? 1 : 0);
