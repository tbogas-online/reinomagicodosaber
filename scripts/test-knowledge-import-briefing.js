#!/usr/bin/env node
'use strict';

const {
  listCollectors,
  getCollector,
  requireCollector,
  defaultAgeBands,
  defaultFormats,
  parseBriefing,
  applyBriefingToRecords,
  briefingSummary,
} = require('./lib/knowledge-import-briefing');

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

console.log('Briefing de importação — testes\n');

const collectors = listCollectors();
assert('lista colectores', collectors.length >= 2);
assert('Wikidata activo', getCollector('wikidata')?.status === 'active' && getCollector('wikidata').usesBriefing);
assert('lotes sem briefing', getCollector('curiosidades-batch')?.usesBriefing === false);
assert('RTP ainda indisponível', getCollector('rtp')?.status === 'unavailable');
assert('require Wikidata ok', requireCollector('wikidata').id === 'wikidata');
try {
  requireCollector('rtp');
  assert('require RTP falha', false);
} catch (err) {
  assert('require RTP falha', err.code === 'COLLECTOR_UNAVAILABLE');
}
try {
  requireCollector('nasa');
  assert('fonte desconhecida falha', false);
} catch (err) {
  assert('fonte desconhecida falha', err.code === 'INVALID_SOURCE');
}

assert('idades cat. 2', defaultAgeBands(2).join() === '6-9,10-15,15+');
assert('idades cat. 20', defaultAgeBands(20).join() === '10-15,15+');
assert('formatos geografia incluem ONDE_FICA', defaultFormats(2).includes('ONDE_FICA'));
assert('formatos cat. 20 são V/F e curiosidade', defaultFormats(20).join() === 'CURIOSIDADE,VERDADEIRO_FALSO');

const parsed = parseBriefing({
  source: 'wikidata',
  goal: 'fill-gaps',
  categoryN: 2,
  contentType: 'place',
  scope: 'portugal',
  limit: 5,
  ageBands: ['6-9'],
  allowedFormats: ['ONDE_FICA', 'RESPOSTA_DIRETA', 'bogus'],
  words: ['Tejo', 'Portugal'],
});
assert('sem erros no briefing válido', parsed.errors.length === 0);
assert('normaliza objectivo', parsed.briefing.goal === 'fill-gaps');
assert('normaliza âmbito', parsed.briefing.scope === 'portugal');
assert('limite 5', parsed.briefing.limit === 5);
assert('idades escolhidas', parsed.briefing.ageBands.join() === '6-9');
assert('ignora formato inválido', parsed.briefing.allowedFormats.join() === 'ONDE_FICA,RESPOSTA_DIRETA');
assert('tópico geografia', parsed.briefing.topic === 'geografia');

const fallback = parseBriefing({ source: 'wikidata', categoryN: 5, goal: 'nope', scope: 'marte', limit: 99 });
assert('objectivo inválido cai em tema', fallback.briefing.goal === 'theme');
assert('âmbito inválido cai em mundial', fallback.briefing.scope === 'world');
assert('limite 99 capado a 20', fallback.briefing.limit === 20);
assert('tipo natureza default animal', fallback.briefing.contentType === 'animal');
assert('idades natureza completas', fallback.briefing.ageBands.join() === '6-9,10-15,15+');

const stamped = applyBriefingToRecords(
  [{ knowledge_id: 'knw-1', age_bands: ['15+'], allowed_formats: ['CURIOSIDADE'], metadata: { qid: 'Q1' } }],
  parsed.briefing,
);
assert('aplica idades do briefing', stamped[0].age_bands.join() === '6-9');
assert('aplica formatos do briefing', stamped[0].allowed_formats.includes('ONDE_FICA'));
assert('preserva metadata existente', stamped[0].metadata.qid === 'Q1');
assert('grava resumo do briefing', stamped[0].metadata.briefing.scope === 'portugal');
assert('subtema opcional', applyBriefingToRecords([{ knowledge_id: 'x' }], { ...parsed.briefing, subtopic: 'rios' })[0].subtopic === 'rios');
assert('grava tópico específico', applyBriefingToRecords([{ knowledge_id: 'x' }], { ...parsed.briefing, subtopic: 'Portugal', focus: 'Rios' })[0].subtopic === 'Portugal · Rios');
assert('focus no metadata', applyBriefingToRecords([{ knowledge_id: 'x' }], { ...parsed.briefing, subtopic: 'Portugal', focus: 'Rios' })[0].metadata.briefing.focus === 'Rios');
assert('parse inclui focus', parseBriefing({ categoryN: 2, subtopic: 'Portugal', focus: 'Rios' }).briefing.focus === 'Rios');
assert('sumário com caminho', /Portugal · Rios/.test(briefingSummary({ ...parsed.briefing, subtopic: 'Portugal', focus: 'Rios' })));
assert('sumário legível', /cat\. 2/.test(briefingSummary(parsed.briefing)) && /Portugal/.test(briefingSummary(parsed.briefing)));

console.log(`\nResultado: ${passed} passaram, ${failed} falharam`);
process.exit(failed > 0 ? 1 : 0);
