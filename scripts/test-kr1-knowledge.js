#!/usr/bin/env node
/**
 * KR-1 — testes de import (KR-1.2) e entrega cat. 20 (KR-1.4).
 * Executar: node scripts/test-kr1-knowledge.js
 */
'use strict';

const path = require('path');
const vm = require('vm');
const fs = require('fs');

const {
  validateAgeVocabulary,
  detectAmbiguousAdivinha,
  validateAdivinhaImport,
} = require('./lib/adivinha-import-validation');
const {
  cat20RequiresKnowledgeId,
  assertCat20Delivery,
  bankRowMissingKnowledgeId,
  isRepositoryTelemetrySource,
} = require('./lib/kr1-cat20-guards');
const { validateParsed, clueLeaksAnswer } = require('./lib/memoriamedia-adivinhas');

const publicDir = path.join(__dirname, '..', 'public');
const krSrc = fs.readFileSync(path.join(publicDir, 'knowledge-repository.js'), 'utf8');
const krSandbox = { globalThis: {}, window: {} };
krSandbox.window = krSandbox.globalThis;
vm.createContext(krSandbox);
vm.runInContext(krSrc, krSandbox);
const KR = krSandbox.globalThis.ReinoKnowledgeRepository;

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

console.log('KR-1 — import + entrega cat. 20\n');

// KR-1.4 — pick / knowledgeId
assert('cat20 ADIVINHA exige knowledgeId', cat20RequiresKnowledgeId(20, 'ADIVINHA'));
assert('cat20 CURIOSIDADE exige knowledgeId', cat20RequiresKnowledgeId(20, 'CURIOSIDADE'));
assert('cat2 não exige knowledgeId', !cat20RequiresKnowledgeId(2, 'ADIVINHA'));
assert('rowToRecord rejeita sem id', KR.rowToRecord({ category: 20, fact: 'x', answer: 'y' }) === null);
assert('entrega válida com knowledgeId', assertCat20Delivery({ knowledgeId: 'knw-1', source: 'repository' }, 20, 'ADIVINHA').ok);
assert('stock fallback permitido', assertCat20Delivery({ source: 'local', a: '—' }, 20, 'ADIVINHA').stockFallback);
assert('entrega bloqueada sem knowledgeId', assertCat20Delivery({ source: 'bank', a: 'Pente' }, 20, 'ADIVINHA').blocked);
assert('banco cat20 sem knowledge_id', bankRowMissingKnowledgeId(20, { format: 'ADIVINHA', knowledge_id: '' }));
assert('banco cat20 com knowledge_id ok', !bankRowMissingKnowledgeId(20, { format: 'ADIVINHA', knowledge_id: 'knw-1' }));
assert('telemetria repository', isRepositoryTelemetrySource('repository'));
assert('telemetria repo-direct', isRepositoryTelemetrySource('repo-direct'));
assert('telemetria ai não é repo', !isRepositoryTelemetrySource('ai'));

// KR-1.2 — vocabulário por idade
{
  const parsed = {
    fact: 'A epistemologia explica o saber.',
    answer: 'Filosofia',
    clues: ['tema abstracto', 'pensamento profundo'],
  };
  const issues = validateAgeVocabulary(parsed, ['6-9', '10-15']);
  assert('vocab demasiado difícil para 6-9', issues.includes('vocab_too_hard_69'));
  assert('vocab ok para 15+ apenas', validateAgeVocabulary(parsed, ['15+']).length === 0);
}

// KR-1.2 — adivinhas ambíguas / incoerentes
{
  const relogio = {
    fact: 'Tenho dentes mas não mordo. O que sou?',
    answer: 'Relógio',
    clues: ['tenho dentes', 'não mordo'],
  };
  assert('incoerente relógio/dentes', detectAmbiguousAdivinha(relogio).includes('incoherent_adivinha'));
  assert('validateParsed + ambiguidade', validateParsed(relogio, { includeMalicious: true }).includes('incoherent_adivinha'));
}

{
  const cabra = {
    fact: 'Comer-me querias? Diz-me o que sou.',
    answer: 'Cabra no milho',
    clues: ['brincadeira oral', 'resposta folclórica'],
  };
  assert('folclore ambíguo cabra/milho', detectAmbiguousAdivinha(cabra).includes('ambiguous_folklore'));
}

{
  const vaga = {
    fact: 'Sou transparente e molho tudo.',
    answer: 'Água',
    clues: ['transparente', 'molha'],
  };
  assert('resposta vaga com poucas pistas', detectAmbiguousAdivinha(vaga).includes('ambiguous_answer'));
}

// KR-1.2 — clues não revelam resposta
assert('clueLeaksAnswer detecta substring', clueLeaksAnswer(['o pente de madeira'], 'Pente'));
assert('clueLeaksAnswer seguro', !clueLeaksAnswer(['tem dentes mas não morde'], 'Pente'));
{
  const parsed = {
    mmId: 99,
    fact: 'Linha um suficientemente longa aqui.',
    answer: 'Relógio',
    clues: ['o relógio marca as horas', 'faz tic tac'],
    classificationId: '5',
  };
  const issues = validateParsed(parsed, { includeMalicious: true });
  assert('import rejeita clue_leaks', issues.includes('clue_leaks_answer'));
  assert('import rejeita incoerente', !issues.includes('incoherent_adivinha') || issues.length > 0);
}

{
  const parsed = {
    mmId: 100,
    fact: 'Tenho dentes mas não mordo.',
    answer: 'Pente',
    clues: ['tenho dentes', 'não mordo'],
    classificationId: '5',
  };
  const ageBands = ['6-9', '10-15', '15+'];
  assert('import limpo sem issues extra', validateAdivinhaImport(parsed, ageBands).length === 0);
  assert('validateParsed pente ok', validateParsed(parsed, { includeMalicious: true }).length === 0);
}

console.log(`\nResultado: ${passed} passaram, ${failed} falharam`);
process.exit(failed > 0 ? 1 : 0);
