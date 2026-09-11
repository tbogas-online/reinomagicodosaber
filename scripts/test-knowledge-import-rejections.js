#!/usr/bin/env node
'use strict';

const {
  factKeyFromRecord,
  rejectionFingerprint,
  toRejectionRow,
  filterRejectedRecords,
  matchRejectionReason,
  buildRejectionIndex,
} = require('./lib/knowledge-import-rejections');

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

console.log('Rejeições de importação — testes\n');

const lisboa = {
  knowledge_id: 'knw-cat2-wd-q45-p36',
  source: 'Wikidata',
  source_id: 'Q45:cat2:p36',
  source_url: 'https://www.wikidata.org/wiki/Q45',
  fact: 'A capital de Portugal é Lisboa.',
  answer: 'Lisboa',
  category_n: 2,
  topic: 'geografia',
  metadata: { qid: 'Q45', factKey: 'p36' },
};

assert('factKey do metadata', factKeyFromRecord(lisboa) === 'p36');
assert('factKey capital no id', factKeyFromRecord({ knowledge_id: 'knw-cat2-geo-wd-q750-capital-q2900' }) === 'capital');
assert('fingerprint tem qid', rejectionFingerprint(lisboa).qid === 'Q45');
assert('toRejectionRow guarda knowledge_id', toRejectionRow(lisboa).knowledge_id === lisboa.knowledge_id);

const stored = [toRejectionRow(lisboa)];
const index = buildRejectionIndex(stored);

assert('mesmo id', matchRejectionReason(lisboa, index) === 'same_id');
assert(
  'mesmo source_id noutro knowledge_id',
  matchRejectionReason({ ...lisboa, knowledge_id: 'knw-cat2-wd-q45-p36-b' }, index) === 'same_source',
);
assert(
  'mesmo texto noutro id',
  matchRejectionReason({
    ...lisboa,
    knowledge_id: 'knw-other',
    source_id: 'other',
    metadata: { qid: 'Q999', factKey: 'p17' },
    source_url: 'https://www.wikidata.org/wiki/Q999',
  }, index) === 'same_fact',
);
assert(
  'mesma propriedade da entidade',
  matchRejectionReason({
    knowledge_id: 'knw-cat20-wd-q45-p36',
    source: 'Wikidata',
    source_id: 'Q45:cat20:p36',
    source_url: 'https://www.wikidata.org/wiki/Q45',
    fact: 'Lisboa é a capital de Portugal.',
    answer: 'Lisboa',
    metadata: { qid: 'Q45', factKey: 'p36' },
  }, index) === 'same_property',
);
assert(
  'texto parecido da mesma entidade',
  matchRejectionReason({
    knowledge_id: 'knw-cat2-wd-q45-capital',
    source: 'Wikidata',
    source_id: 'Q45:cat2:capital',
    source_url: 'https://www.wikidata.org/wiki/Q45',
    fact: 'A capital de Portugal é a cidade de Lisboa.',
    answer: 'Lisboa',
    metadata: { qid: 'Q45', factKey: 'capital' },
  }, index) === 'similar_fact',
);

const tejo = {
  knowledge_id: 'knw-cat2-wd-q14295-p17',
  source: 'Wikidata',
  source_id: 'Q14295:cat2:p17',
  source_url: 'https://www.wikidata.org/wiki/Q14295',
  fact: 'O Tejo fica em Portugal.',
  answer: 'Portugal',
  metadata: { qid: 'Q14295', factKey: 'p17' },
};
assert('facto diferente passa', matchRejectionReason(tejo, index) === '');

const filtered = filterRejectedRecords([lisboa, tejo], stored);
assert('filtra o rejeitado e mantém o outro', filtered.kept.length === 1 && filtered.kept[0].knowledge_id === tejo.knowledge_id);
assert('conta a rejeição', filtered.rejected.length === 1 && filtered.rejected[0].reason === 'same_id');

if (failed) {
  console.log(`\n${failed} falha(s), ${passed} ok.`);
  process.exit(1);
}
console.log(`\n${passed} testes ok.`);
