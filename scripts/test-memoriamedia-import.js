#!/usr/bin/env node
'use strict';

const {
  mapRawRow,
  validateParsed,
  stripHtml,
  normalizeText,
  transformRows,
  clueLeaksAnswer,
} = require('./lib/memoriamedia-adivinhas');

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

console.log('MemóriaMedia import — testes\n');

{
  const raw = {
    __pk_val: 160,
    adivinhario___nome_ficheiro_raw: 'A carne da menina é dura',
    adivinhario___adivinha_raw: '<p>A carne da menina é dura,</p><p>Mais dura é quem na fura,</p><p>R: Quando se está a furar as orelhas.</p>',
    adivinhario___resposta_raw: 'Furar as orelhas',
    adivinhario___classificacao_fundo_raw: '6',
    adivinhario___concelho_raw: 'Alcobaça',
    adivinhario___distrito_raw: 'Leiria',
    fabrik_view_url: '/index.php/adivinhario-base-de-dados/details/5/160',
  };
  const parsed = mapRawRow(raw);
  assert('mapRawRow id', parsed.mmId === 160);
  assert('mapRawRow answer', parsed.answer === 'Furar as orelhas');
  assert('mapRawRow clues >= 2', parsed.clues.length >= 2, String(parsed.clues.length));
  assert('malicious rejected by default', validateParsed(parsed).includes('malicious_classification'));
  assert('malicious allowed with flag', !validateParsed(parsed, { includeMalicious: true }).includes('malicious_classification'));
}

{
  const raw = {
    __pk_val: 167,
    adivinhario___nome_ficheiro_raw: 'Além está a minha amiga',
    adivinhario___adivinha_raw: '<p>Além está a minha amiga.</p><p>Vou daqui ponho-me nela.</p><p>Os gostos ficam comigo</p><p>E o leite fica c\'o ela.</p><p>R: A figueira.</p>',
    adivinhario___resposta_raw: 'Figueira',
    adivinhario___classificacao_fundo_raw: '6',
    fabrik_view_url: '/index.php/adivinhario-base-de-dados/details/5/167',
  };
  const parsed = mapRawRow(raw);
  const issues = validateParsed(parsed, { includeMalicious: true });
  assert('figueira válida', issues.length === 0, issues.join(', '));
}

{
  const rows = [
    {
      __pk_val: 1,
      adivinhario___nome_ficheiro_raw: 'Dup A',
      adivinhario___adivinha_raw: '<p>Linha um longa o bastante.</p><p>Linha dois também longa.</p>',
      adivinhario___resposta_raw: 'Figueira',
      adivinhario___classificacao_fundo_raw: '5',
    },
    {
      __pk_val: 2,
      adivinhario___nome_ficheiro_raw: 'Dup B',
      adivinhario___adivinha_raw: '<p>Linha um longa o bastante.</p><p>Linha dois também longa.</p>',
      adivinhario___resposta_raw: 'Figueira',
      adivinhario___classificacao_fundo_raw: '5',
    },
  ];
  const out = transformRows(rows, { includeMalicious: true });
  assert('dedupe similar', out.stats.queued === 1, `queued=${out.stats.queued}`);
}

assert('stripHtml', stripHtml('<p>Olá &eacute; bom</p>').includes('Olá'));
assert('normalizeText', normalizeText('Figueira!') === 'figueira');
assert('clueLeaksAnswer detecta', clueLeaksAnswer(['é um pente de madeira'], 'Pente'));
assert('clueLeaksAnswer ignora seguro', !clueLeaksAnswer(['tem dentes mas não morde'], 'Pente'));

{
  const parsed = {
    answer: 'Relógio',
    clues: ['o relógio dá as horas', 'tic tac'],
    fact: 'test',
  };
  assert('validateParsed clue_leaks', validateParsed(parsed, { includeMalicious: true }).includes('clue_leaks_answer'));
}

console.log(`\nResultado: ${passed} passaram, ${failed} falharam`);
process.exit(failed > 0 ? 1 : 0);
