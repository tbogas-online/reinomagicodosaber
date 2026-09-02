#!/usr/bin/env node
/**
 * Testes unitários do cliente Knowledge Repository (sem Supabase).
 * Executar: node scripts/test-knowledge-repository.js
 */
'use strict';

const path = require('path');
const vm = require('vm');
const fs = require('fs');
const policy = require('./lib/knowledge-policy');

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
assert('rowToRecord blocked quando superseded', KR.rowToRecord({
  knowledgeId: 'knw-x',
  category: 20,
  fact: 'f',
  answer: 'a',
  supersededBy: 'knw-y',
}).blocked === true);
assert('isConfigured sem Supabase', KR.isConfigured() === false);

// KR-0.3 — política
assert('min confidence ADIVINHA cat20', KR.getMinConfidence(20, 'ADIVINHA') === 0.9);
assert('min confidence default cat20', KR.getMinConfidence(20, 'CURIOSIDADE') === 0.85);
assert('fonte MemóriaMedia permitida', KR.isSourceAllowed({ source: 'MemóriaMedia', confidence: 0.8 }, { categoryN: 20 }));
assert('fonte desconhecida bloqueada', !KR.isSourceAllowed({ source: 'RandomBlog', confidence: 0.8 }, { categoryN: 20 }));
assert('alta confiança compensa fonte', KR.isSourceAllowed({ source: 'RandomBlog', confidence: 0.95 }, { categoryN: 20 }));
assert('registo bloqueado rejeitado', !KR.evaluateRecordPolicy({ source: 'manual', confidence: 0.99, blocked: true }, { categoryN: 20 }).ok);
assert('confiança baixa rejeitada', KR.evaluateRecordPolicy({
  source: 'manual',
  confidence: 0.7,
  category: 20,
}, { categoryN: 20, formatId: 'ADIVINHA' }).reason === 'confidence_below_minimum');
assert('alta confiança MemóriaMedia ok', KR.evaluateRecordPolicy({
  source: 'MemóriaMedia',
  confidence: 0.95,
  category: 20,
}, { categoryN: 20, formatId: 'ADIVINHA' }).ok);
assert('isRecordHighTrust manual', KR.isRecordHighTrust({ source: 'manual', confidence: 0.5 }));

// Espelho scripts/lib/knowledge-policy.js
assert('policy module alinhado', policy.getMinConfidence(20, 'ADIVINHA') === KR.getMinConfidence(20, 'ADIVINHA'));

console.log(`\nResultado: ${passed} passaram, ${failed} falharam`);
process.exit(failed > 0 ? 1 : 0);
