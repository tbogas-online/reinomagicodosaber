#!/usr/bin/env node
/**
 * Testes do motor de perguntas (question-engine.js).
 * Executar: node scripts/test-question-engine.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const publicDir = path.join(__dirname, '..', 'public');
const manifestSrc = fs.readFileSync(path.join(publicDir, 'question-engine/manifest.js'), 'utf8');
const manifestSandbox = { globalThis: {} };
vm.createContext(manifestSandbox);
vm.runInContext(manifestSrc, manifestSandbox);
const engineScripts = manifestSandbox.globalThis.QuestionEngineManifest.ENGINE_SCRIPT_PATHS;
const memStore = {};
const sandbox = {
  globalThis: {},
  window: {},
  localStorage: {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(memStore, k) ? memStore[k] : null),
    setItem: (k, v) => { memStore[k] = String(v); },
  },
};
sandbox.window = sandbox.globalThis;
vm.createContext(sandbox);
for (const rel of engineScripts) {
  vm.runInContext(fs.readFileSync(path.join(publicDir, rel), 'utf8'), sandbox);
}
const QE = sandbox.globalThis.QuestionEngine;

if (!QE) {
  console.error('Falha ao carregar QuestionEngine');
  process.exit(1);
}

const stripTags = (s) => String(s || '').replace(/<[^>]*>/g, '').trim();
const normalizeQ = (s) => stripTags(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

function baseCtx(overrides = {}) {
  return {
    formatId: QE.FORMAT_IDS.RESPOSTA_DIRETA,
    ageBandKey: '10-15',
    categoryNumber: 2,
    difficulty: 2,
    usedQuestions: [],
    usedAnswers: [],
    usedKnowledgeKeys: [],
    persistentKnowledgeKeys: [],
    isMC: false,
    stripTags,
    normalizeFn: normalizeQ,
    helpers: { stripTags, validateTrueFalseQuestion: () => ({ ok: true, issues: [] }), ageBandKey: '10-15' },
    ...overrides,
  };
}

let passed = 0;
let failed = 0;

function assert(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('Question Engine — testes\n');

// 1. pergunta válida
{
  const parsed = { q: 'Qual é a capital de Espanha?', a: 'Madrid' };
  const r = QE.validateQuestion(parsed, baseCtx({ categoryNumber: 2 }));
  assert('1. pergunta válida', r.ok, r.issues?.join(', '));
}

// 2. pergunta repetida
{
  const parsed = { q: 'Qual é a capital de França?', a: 'Paris' };
  const ctx = baseCtx({ usedQuestions: ['Qual é a capital de França?'] });
  const r = QE.validateQuestion(parsed, ctx);
  assert('2. pergunta repetida', !r.ok);
}

// 3. pergunta semanticamente semelhante
{
  const parsed = { q: 'Em que cidade fica a capital francesa?', a: 'Paris' };
  const ctx = baseCtx({
    usedQuestions: ['Qual é a capital de França?'],
    usedKnowledgeKeys: [QE.computeKnowledgeKey('Qual é a capital de França?', 'Paris', QE.FORMAT_IDS.RESPOSTA_DIRETA, normalizeQ)],
  });
  const r = QE.validateQuestion(parsed, ctx);
  assert('3. semelhante / knowledgeKey', !r.ok);
}

// 4. categoria errada
{
  const parsed = { q: 'Quem foi o primeiro homem na Lua?', a: 'Neil Armstrong' };
  const r = QE.validateQuestion(parsed, baseCtx({ categoryNumber: 2 }));
  assert('4. categoria errada (geo)', !r.ok);
}

// 5. formato errado
{
  const parsed = { q: 'O Sol é uma estrela.', a: 'Verdadeiro' };
  const r = QE.validateByFormat(parsed, QE.FORMAT_IDS.VERDADEIRO_FALSO, {
    stripTags,
    validateTrueFalseQuestion: (p) => (/verdadeiro\s+ou\s+falso/i.test(p.q) ? { ok: true, issues: [] } : { ok: false, issues: ['sem V/F'] }),
    ageBandKey: '10-15',
  });
  assert('5. formato V/F errado', !r.ok);
}

// 6. idade errada
{
  const parsed = { q: 'Explica o teorema de Pitágoras com detalhe.', a: 'a²+b²=c²' };
  const r = QE.validateQuestion(parsed, baseCtx({ ageBandKey: '6-9', difficulty: 1 }));
  assert('6. idade errada (6-9)', !r.ok);
}

// 7. resposta ambígua
{
  const parsed = {
    q: 'Qual personagem de Toy Story usa chapéu de cowboy?',
    a: 'Woody',
    options: ['Woody', 'Jessie', 'Buzz', 'Rex'],
  };
  const r = QE.validateQuestion(parsed, baseCtx({ isMC: true, formatId: QE.FORMAT_IDS.ESCOLHA_MULTIPLA }));
  assert('7. resposta ambígua', !r.ok);
}

// 8. múltiplas respostas correctas
{
  const parsed = { q: 'Pode ser Lisboa ou Porto?', a: 'Lisboa' };
  const r = QE.validateSemanticQuality(parsed, baseCtx());
  assert('8. múltiplas respostas', !r.ok);
}

// 9. resposta revelada
{
  const parsed = { q: 'Qual é a capital de Portugal, Lisboa?', a: 'Lisboa' };
  const r = QE.validateSemanticQuality(parsed, baseCtx());
  assert('9. resposta revelada', !r.ok);
}

// 10. MC opções duplicadas
{
  const parsed = {
    q: 'Qual é o planeta mais próximo do Sol?',
    a: 'Mercúrio',
    options: ['Mercúrio', 'Mercúrio', 'Vénus', 'Marte'],
  };
  const r = QE.validateQuestion(parsed, baseCtx({ isMC: true, formatId: QE.FORMAT_IDS.ESCOLHA_MULTIPLA }));
  assert('10. MC duplicadas', !r.ok);
}

// 11. MC distractores absurdos
{
  const parsed = {
    q: 'Qual é o planeta mais próximo do Sol?',
    a: 'Mercúrio',
    options: ['Mercúrio', 'Azul', 'Futebol', 'Banana'],
  };
  const r = QE.validateQuestion(parsed, baseCtx({ isMC: true, formatId: QE.FORMAT_IDS.ESCOLHA_MULTIPLA }));
  assert('11. MC absurdos', !r.ok);
}

// 12. MC shuffle (não fica sempre em A)
{
  const positions = new Set();
  const mcHist = [];
  QE.resetMcPositions(mcHist);
  for (let i = 0; i < 20; i += 1) {
    const opts = QE.assembleMcOptions('Mercúrio', ['Vénus', 'Marte', 'Júpiter']);
    if (!opts) continue;
    QE.shuffleMcOptions(opts, 'Mercúrio', normalizeQ, mcHist);
    const pos = opts.findIndex((o) => normalizeQ(o) === normalizeQ('Mercúrio'));
    positions.add(pos);
  }
  assert('12. MC posição variada', positions.size >= 2, `posições: ${[...positions].join(',')}`);
}

// 13. V/F frequência configurada ~11%
assert('13. V/F chance ~11%', QE.TRUE_FALSE_CHANCE >= 0.1 && QE.TRUE_FALSE_CHANCE <= 0.12);

// 14. formatos consecutivos
{
  const recent = [QE.FORMAT_IDS.RESPOSTA_DIRETA, QE.FORMAT_IDS.RESPOSTA_DIRETA];
  let sameCount = 0;
  for (let i = 0; i < 30; i += 1) {
    const f = QE.chooseFormat(1, '10-15', 'open', recent);
    if (f === QE.FORMAT_IDS.RESPOSTA_DIRETA) sameCount += 1;
    recent.push(f);
    if (recent.length > 10) recent.shift();
  }
  assert('14. diversidade de formatos', sameCount < 28, `resposta_direta ${sameCount}/30`);
}

// 15. PT-PT incorrecto
{
  const parsed = { q: 'Qual é o ônibus mais rápido?', a: 'Metrô' };
  const r = QE.validateQuestion(parsed, baseCtx());
  assert('15. PT-PT incorrecto', !r.ok);
}

// 16. demasiado difícil 6-9
{
  const parsed = { q: 'Quando começou a Segunda Guerra Mundial?', a: '1939' };
  const r = QE.validateQuestion(parsed, baseCtx({ ageBandKey: '6-9', formatId: QE.FORMAT_IDS.QUANDO, difficulty: 1 }));
  assert('16. difícil para 6-9', !r.ok);
}

// 17. demasiado fácil 15+
{
  const parsed = { q: 'Qual é o planeta onde vivemos?', a: 'Terra' };
  const r = QE.validateQuestion(parsed, baseCtx({ ageBandKey: '15+', difficulty: 5 }));
  assert('17. fácil para 15+', !r.ok);
}

// 18. knowledgeKey repetido
{
  const key = QE.computeKnowledgeKey('Qual é a capital de Itália?', 'Roma', QE.FORMAT_IDS.RESPOSTA_DIRETA, normalizeQ);
  const parsed = { q: 'Em que cidade fica a capital italiana?', a: 'Roma' };
  const r = QE.validateQuestion(parsed, baseCtx({ usedKnowledgeKeys: [key] }));
  assert('18. knowledgeKey repetido', !r.ok);
}

// 19. retry após rejeição
{
  const hint = QE.buildRetryHint(['resposta ambígua', 'distratores incoerentes'], QE.FORMAT_IDS.ESCOLHA_MULTIPLA, '10-15');
  assert('19. retry hint', /ambígu|distractores/i.test(hint));
}

// 21–23. feedback: devia rejeitar (false-negative)
{
  const parsed = { q: 'A estrada para os carros é feita de ___.', a: 'asfalto' };
  const r = QE.validateQuestion(parsed, baseCtx({ formatId: QE.FORMAT_IDS.COMPLETA, categoryNumber: 19, ageBandKey: '6-9' }));
  assert('21. estrada para carros', !r.ok, r.issues?.join(', '));
}
{
  const parsed = { q: 'O que é a flor da planta?', a: 'parte que faz sementes' };
  const r = QE.validateQuestion(parsed, baseCtx({ formatId: QE.FORMAT_IDS.O_QUE_E, categoryNumber: 5, ageBandKey: '6-9' }));
  assert('22. flor da planta confusa', !r.ok, r.issues?.join(', '));
}
{
  const parsed = { q: 'O rato que queria ser rei, na obra de Roald Dahl, chama-se ___.', a: 'Ricky' };
  const r = QE.validateQuestion(parsed, baseCtx({ formatId: QE.FORMAT_IDS.COMPLETA, categoryNumber: 8, ageBandKey: '10-15' }));
  assert('23. rato Roald Dahl', !r.ok, r.issues?.join(', '));
}

// 24–26. V/F — knowledgeKey e repetição sem falso positivo
{
  const q = 'O sol nasce no leste. Verdadeiro ou Falso?';
  const vf = (p) => (/verdadeiro\s+ou\s+falso/i.test(p.q) ? { ok: true, issues: [] } : { ok: false, issues: ['sem V/F'] });
  const ctx = baseCtx({
    formatId: QE.FORMAT_IDS.VERDADEIRO_FALSO,
    ageBandKey: '6-9',
    categoryNumber: 5,
    isMC: true,
    helpers: { stripTags, validateTrueFalseQuestion: vf, ageBandKey: '6-9' },
  });
  const parsed = { q, a: 'Verdadeiro', options: ['Verdadeiro', 'Falso'] };
  const key = QE.computeKnowledgeKey(q, 'Verdadeiro', QE.FORMAT_IDS.VERDADEIRO_FALSO, normalizeQ);
  assert('24. V/F sol leste aceite', QE.validateQuestion(parsed, ctx).ok, key);
  assert('25. V/F key sem boilerplate', !key.includes('verdadeiro') && key.includes('sol'));
  const other = 'O sol põe-se no oeste. Verdadeiro ou Falso?';
  const otherKey = QE.computeKnowledgeKey(other, 'Verdadeiro', QE.FORMAT_IDS.VERDADEIRO_FALSO, normalizeQ);
  const rSimilar = QE.validateQuestion(parsed, {
    ...ctx,
    usedQuestions: [other],
    usedKnowledgeKeys: [otherKey],
  });
  assert('26. V/F sol leste vs poente distinto', rSimilar.ok, rSimilar.issues?.join(', '));
}

// 27–28. futebol PT-PT
{
  const bad = { q: 'No futebol, o jogador que protege a baliza é o ___.', a: 'goleiro' };
  const good = { q: 'No futebol, o jogador que protege a baliza é o ___.', a: 'guarda-redes' };
  const ctx = baseCtx({ formatId: QE.FORMAT_IDS.COMPLETA, categoryNumber: 15, ageBandKey: '6-9' });
  assert('27. goleiro rejeitado', !QE.validateQuestion(bad, ctx).ok);
  assert('28. guarda-redes aceite', QE.validateQuestion(good, ctx).ok);
}

// 29. camiseta → camisola
{
  const parsed = { q: 'Que peça de roupa usam os jogadores de futebol no peito?', a: 'camiseta' };
  const r = QE.validateQuestion(parsed, baseCtx({ categoryNumber: 15, ageBandKey: '6-9' }));
  assert('29. camiseta rejeitada', !r.ok, r.issues?.join(', '));
}

// 30–32. score e MC near-duplicate
{
  const parsed = { q: 'Qual é a capital de Espanha?', a: 'Madrid' };
  const r = QE.validateQuestion(parsed, baseCtx({ categoryNumber: 2 }));
  assert('30. score máximo 100', r.ok && r.score === 100, String(r.score));
  const weights = Object.values(QE.LAYER_WEIGHTS).reduce((s, w) => s + w, 0);
  assert('31. pesos somam 100', weights === 100, String(weights));
}
{
  const parsed = {
    q: 'Qual destes é um veículo?',
    a: 'Carro',
    options: ['Carro', 'Caro', 'Barco', 'Comboio'],
  };
  const r = QE.validateQuestion(parsed, baseCtx({ isMC: true, formatId: QE.FORMAT_IDS.ESCOLHA_MULTIPLA, categoryNumber: 19 }));
  assert('32. Carro vs Caro distintos', r.ok, r.issues?.join(', '));
}
{
  const dup = {
    q: 'Quem é?',
    a: 'Woody',
    options: ['Woody', 'Wooody', 'Buzz', 'Rex'],
  };
  const r = QE.validateQuestion(dup, baseCtx({ isMC: true, formatId: QE.FORMAT_IDS.ESCOLHA_MULTIPLA }));
  assert('33. Wooody typo duplicado', !r.ok);
}

// 34–39. review: categoria 17, MC isolado, jaccard, futebol extra
{
  const car = { q: 'Qual é a marca de carro mais vendida no mundo?', a: 'Toyota' };
  const r = QE.validateQuestion(car, baseCtx({ categoryNumber: 17 }));
  assert('34. carro em Tecnologia rejeitado', !r.ok, r.issues?.join(', '));
}
{
  const rocket = { q: 'Para que serve um foguetão?', a: 'ir ao espaço' };
  const r = QE.validateQuestion(rocket, baseCtx({ categoryNumber: 17 }));
  assert('35. foguetão em Tecnologia rejeitado', !r.ok, r.issues?.join(', '));
}
{
  const bulb = { q: 'Quem inventou a lâmpada elétrica?', a: 'Thomas Edison' };
  const r = QE.validateQuestion(bulb, baseCtx({ categoryNumber: 17 }));
  assert('36. lâmpada em Tecnologia aceite', r.ok, r.issues?.join(', '));
}
{
  const histA = [];
  const histB = [];
  for (let i = 0; i < 12; i += 1) {
    const optsA = QE.assembleMcOptions('A', ['B', 'C', 'D']);
    const optsB = QE.assembleMcOptions('X', ['Y', 'Z', 'W']);
    QE.shuffleMcOptions(optsA, 'A', normalizeQ, histA);
    QE.shuffleMcOptions(optsB, 'X', normalizeQ, histB);
  }
  assert('37. MC históricos isolados por sessão', histA.length === 12 && histB.length === 12 && histA !== histB);
}
{
  const r = QE.validateQuestion(
    { q: 'Qual é a capital de Portugal?', a: 'Lisboa' },
    baseCtx({ usedQuestions: ['', '   '] }),
  );
  assert('38. jaccard sem NaN', typeof r.score === 'number' && !Number.isNaN(r.score), String(r.score));
}
{
  const parsed = { q: 'O jogo foi no campo de grama.', a: 'relvado' };
  const r = QE.validateQuestion(parsed, baseCtx({ categoryNumber: 15, ageBandKey: '6-9' }));
  assert('39. campo de grama rejeitado', !r.ok, r.issues?.join(', '));
}

{
  const parsed = { q: 'Onde fica a cidade onde nasceu o pastel de nata?', a: 'Évora' };
  const r = QE.validateQuestion(parsed, baseCtx({ formatId: QE.FORMAT_IDS.ONDE_FICA, categoryNumber: 14, isMC: false }));
  assert('40. pastel de nata Évora rejeitado', !r.ok, r.issues?.join(', '));
}
{
  const parsed = { q: 'Em que cidade portuguesa se popularizou o pastel de nata?', a: 'Lisboa' };
  const r = QE.validateQuestion(parsed, baseCtx({ formatId: QE.FORMAT_IDS.ONDE_FICA, categoryNumber: 14 }));
  assert('41. pastel de nata Lisboa aceite', r.ok, r.issues?.join(', '));
}
{
  const parsed = { q: 'Onde fica o rio Tejo?', a: 'Portugal', options: ['Espanha', 'França', 'Portugal', 'Itália'] };
  const r = QE.validateQuestion(parsed, baseCtx({ formatId: QE.FORMAT_IDS.ONDE_FICA, categoryNumber: 2, ageBandKey: '6-9', isMC: true }));
  assert('42. Tejo ambíguo rejeitado', !r.ok, r.issues?.join(', '));
}

{
  const parsed = {
    q: 'Tenho cidades mas não casas, montanhas mas não árvores, água mas não peixes. O que sou?',
    a: 'Um mapa',
    clues: ['tem cidades sem casas', 'tem montanhas sem árvores', 'tem água sem peixes'],
    options: ['Um globo terráqueo', 'Uma fotografia aérea', 'Um mapa', 'Um quadro de paisagem'],
  };
  const r = QE.validateQuestion(parsed, baseCtx({
    formatId: QE.FORMAT_IDS.ADIVINHA,
    categoryNumber: 20,
    ageBandKey: '10-15',
    isMC: true,
  }));
  assert('43. adivinha mapa vs globo ambígua', !r.ok, r.issues?.join(', '));
}

// 44–52. reportes Aug 2026 — distractores MC incoerentes
{
  const versalhes = {
    q: 'Que tratado pôs fim à Primeira Guerra Mundial?',
    a: 'Tratado de Versalhes',
    options: ['Tratado de Versalhes', 'Mahatma Gandhi', '1789', '1986'],
  };
  const r1 = QE.validateQuestion(versalhes, baseCtx({ isMC: true, formatId: QE.FORMAT_IDS.RESPOSTA_DIRETA, categoryNumber: 3, ageBandKey: '15+' }));
  assert('44. Versalhes sem Gandhi/anos', !r1.ok, r1.issues?.join(', '));
}
{
  const coringa = {
    q: 'Quem interpretou o Coringa em O Cavaleiro das Trevas, de 2008?',
    a: 'Heath Ledger',
    options: ['Bong Joon-ho', 'Quentin Tarantino', 'Heath Ledger', 'A Origem'],
  };
  const r2 = QE.validateQuestion(coringa, baseCtx({ isMC: true, formatId: QE.FORMAT_IDS.RESPOSTA_DIRETA, categoryNumber: 8, ageBandKey: '15+' }));
  assert('45. Coringa sem filmes/realizadores misturados', !r2.ok, r2.issues?.join(', '));
}
{
  const gps = {
    q: 'Como se chama o sistema de posicionamento global usado para navegação?',
    a: 'GPS',
    options: ['Propolente criogénico', 'GPS', 'Alemanha', 'BRT'],
  };
  const r3 = QE.validateQuestion(gps, baseCtx({ isMC: true, formatId: QE.FORMAT_IDS.RESPOSTA_DIRETA, categoryNumber: 19, ageBandKey: '15+' }));
  assert('46. GPS sem país/marca', !r3.ok, r3.issues?.join(', '));
}
{
  const adn = {
    q: 'Como se chama a molécula que contém a informação genética?',
    a: 'ADN',
    options: ['ADN', 'Neutrão', 'Fusão nuclear', 'Edição genética CRISPR'],
  };
  const r4 = QE.validateQuestion(adn, baseCtx({ isMC: true, formatId: QE.FORMAT_IDS.RESPOSTA_DIRETA, categoryNumber: 5, ageBandKey: '15+' }));
  assert('47. ADN demasiado óbvio', !r4.ok, r4.issues?.join(', '));
}
{
  const picasso = {
    q: 'Quando nasceu o famoso pintor Pablo Picasso?',
    a: '1881',
    options: ['1881', '1890', '1901', '1875'],
  };
  const r5 = QE.validateQuestion(picasso, baseCtx({ formatId: QE.FORMAT_IDS.QUANDO, categoryNumber: 4, ageBandKey: '6-9', isMC: true }));
  assert('48. Picasso 6-9 demasiado difícil', !r5.ok, r5.issues?.join(', '));
}
{
  const engenheira = {
    q: 'Quem é a engenheira que desenvolveu a primeira mão robótica controlada pelo pensamento?',
    a: 'Dario Farina',
    options: ['Hiroshi Ishiguro', 'Dario Farina', 'Elon Musk', 'Ray Kurzweil'],
  };
  const r6 = QE.validateQuestion(engenheira, baseCtx({ formatId: QE.FORMAT_IDS.QUEM_E, categoryNumber: 17, ageBandKey: '15+', isMC: true }));
  assert('49. engenheira vs nome masculino', !r6.ok, r6.issues?.join(', '));
}
{
  const nylon = {
    q: 'Como se chama o material sintético desenvolvido como alternativa à seda, muito usado em meias?',
    a: 'Nylon',
    options: ['Nylon', 'Moda ética', 'Moda genderless', 'Vogue'],
  };
  const r7 = QE.validateQuestion(nylon, baseCtx({ isMC: true, formatId: QE.FORMAT_IDS.RESPOSTA_DIRETA, categoryNumber: 16, ageBandKey: '15+' }));
  assert('50. nylon só materiais', !r7.ok, r7.issues?.join(', '));
}
{
  const chita = {
    q: 'Quando foi apresentado o traje de chita de Viana em Lisboa?',
    a: '1909',
    options: ['1895', '1915', '1909', '1923'],
  };
  const r8 = QE.validateQuestion(chita, baseCtx({ formatId: QE.FORMAT_IDS.QUANDO, categoryNumber: 16, ageBandKey: '10-15', isMC: true }));
  assert('51. chita Viana factual', !r8.ok, r8.issues?.join(', '));
}
{
  const insight = {
    q: 'Devido à atmosfera muito ténue e à baixa gravidade, a sonda InSight, da NASA, não podia usar paraquedas para aterrar em Marte. Que sistema de frenagem acionou os retrofoguetes nos segundos finais da descida?',
    a: 'Sistema de pouso com retrofoguetes',
    options: ['Rampa de dissipação', 'Paraquedas supersônico', 'Sistema de pouso com retrofoguetes', 'Airbag gigante'],
  };
  const r9 = QE.validateQuestion(insight, baseCtx({ formatId: QE.FORMAT_IDS.CAUSA_CONSEQUENCIA, categoryNumber: 6, ageBandKey: '15+', isMC: true }));
  assert('52. InSight pergunta longa', !r9.ok, r9.issues?.join(', '));
}
{
  const narradorOk = {
    q: 'Como se chama o narrador que conhece os pensamentos de todas as personagens?',
    a: 'Narrador onisciente',
    options: ['Narrador onisciente', 'Narrador em terceira pessoa', 'Narrador testemunha', 'Narrador-protagonista'],
  };
  const r10 = QE.validateQuestion(narradorOk, baseCtx({ isMC: true, formatId: QE.FORMAT_IDS.RESPOSTA_DIRETA, categoryNumber: 9, ageBandKey: '15+' }));
  assert('53. narrador opções coerentes aceite', r10.ok, r10.issues?.join(', '));
}

// 54–66. reportes Aug 2026 — regras adicionais
{
  const bacalhau = {
    q: 'Qual é o prato típico de Portugal feito com bacalhau?',
    a: 'Bacalhau à Brás',
    options: ['Bacalhau à Brás', 'Bacalhau com natas', 'Bacalhau à Gomes de Sá', 'Bacalhau assado'],
  };
  const r = QE.validateQuestion(bacalhau, baseCtx({ isMC: true, categoryNumber: 14, ageBandKey: '6-9' }));
  assert('54. bacalhau ambíguo', !r.ok, r.issues?.join(', '));
}
{
  const pulsar = {
    q: 'O que é a estrela pulsar que, em 2003, revelou a primeira evidência de um planeta em órbita ao seu redor através de variações no tempo das suas pulsações?',
    a: 'Psr b1257+12',
  };
  const r = QE.validateQuestion(pulsar, baseCtx({ formatId: QE.FORMAT_IDS.O_QUE_E, categoryNumber: 6 }));
  assert('55. pulsar demasiado técnico', !r.ok, r.issues?.join(', '));
}
{
  const everest = {
    q: 'Quando foi a primeira vez que subiram ao Monte Everest?',
    a: '1953',
    options: ['1953', '1960', '1945', '1970'],
  };
  const r = QE.validateQuestion(everest, baseCtx({ formatId: QE.FORMAT_IDS.QUANDO, categoryNumber: 3, ageBandKey: '6-9', isMC: true }));
  assert('56. Everest 6-9 demasiado difícil', !r.ok, r.issues?.join(', '));
}
{
  const vira = { q: 'Quando a água evapora, ela vira vapor que fica no ar. Verdadeiro ou Falso?', a: 'Verdadeiro' };
  const r = QE.validateQuestion(vira, baseCtx({ formatId: QE.FORMAT_IDS.VERDADEIRO_FALSO, categoryNumber: 4 }));
  assert('57. vira vapor rejeitado', !r.ok, r.issues?.join(', '));
}
{
  const merckx = { q: 'O ciclista belga Eddy Merckx venceu o Tour de France em 1975 com 4 dias de vantagem sobre o segundo colocado. Verdadeiro ou Falso?', a: 'Verdadeiro' };
  const r = QE.validateQuestion(merckx, baseCtx({ formatId: QE.FORMAT_IDS.VERDADEIRO_FALSO, categoryNumber: 15 }));
  assert('58. Merckx 1975 falso', !r.ok, r.issues?.join(', '));
}
{
  const div = {
    q: 'Quanto é 144 dividido por 12?',
    a: '12',
    options: ['12', '144', '24', '36'],
  };
  const r = QE.validateQuestion(div, baseCtx({ isMC: true, categoryNumber: 7 }));
  assert('59. divisão trivial 144/12', !r.ok, r.issues?.join(', '));
}
{
  const apito = {
    q: 'Tenho cabeça sem cérebro, corpo sem coração e rabo sem osso. Quando corre, faz barulho, mas quando para, cala a boca. O que é?',
    a: 'Cavalo',
    clues: ['cabeça sem cérebro', 'faz barulho quando corre', 'cala quando para'],
  };
  const r = QE.validateQuestion(apito, baseCtx({ formatId: QE.FORMAT_IDS.ADIVINHA, categoryNumber: 20, ageBandKey: '15+' }));
  assert('60. adivinha apito vs cavalo', !r.ok, r.issues?.join(', '));
}
{
  const trem = { q: 'Que tipo de veículo usa um sistema de propulsão magnética para flutuar sobre os carris?', a: 'Trem-baleiro' };
  const r = QE.validateQuestion(trem, baseCtx({ categoryNumber: 19, ageBandKey: '10-15' }));
  assert('61. trem-baleiro rejeitado', !r.ok, r.issues?.join(', '));
}
{
  const frodo = { q: "Qual é o nome do protagonista de 'O Senhor dos Anéis' que recebe a Tarefa de destruir o Um Anel?", a: 'Frodo Bolseiro' };
  const r = QE.validateQuestion(frodo, baseCtx({ formatId: QE.FORMAT_IDS.QUEM_E, categoryNumber: 8, ageBandKey: '15+' }));
  assert('62. Frodo Bolseiro rejeitado', !r.ok, r.issues?.join(', '));
}
{
  const congelamento = { q: 'Completa: O processo de solidificação da água, passando do estado líquido ao sólido, é chamado de ___.', a: 'Congelamento' };
  const r = QE.validateQuestion(congelamento, baseCtx({ formatId: QE.FORMAT_IDS.COMPLETA, categoryNumber: 5, ageBandKey: '15+' }));
  assert('63. congelamento categoria errada', !r.ok, r.issues?.join(', '));
}
{
  const vies = {
    q: 'Como se chama o efeito que faz recordar informações negativas com mais intensidade do que as positivas?',
    a: 'Viés de negatividade',
    options: ['Viés de negatividade', 'Efeito placebo', 'Memória fotográfica', 'Déjà vu'],
  };
  const r = QE.validateQuestion(vies, baseCtx({ isMC: true, categoryNumber: 5, ageBandKey: '15+' }));
  assert('64. viés brasileiro', !r.ok, r.issues?.join(', '));
}
{
  const reu = {
    q: 'Qual é o feminino de réu?',
    a: 'Ré',
    options: ['Ré', 'Arcadismo', 'Barroco', 'Romantismo'],
  };
  const r = QE.validateQuestion(reu, baseCtx({ isMC: true, categoryNumber: 9, ageBandKey: '15+' }));
  assert('65. feminino de réu sem movimentos literários', !r.ok, r.issues?.join(', '));
}
{
  const neuronios = {
    q: 'Quantos neurónios tem, aproximadamente, o cérebro humano?',
    a: 'Cerca de 86 mil milhões',
    options: ['Cerca de 86 mil milhões', 'O Enigma da Esfinge', 'Déjà vu', '3 a 5'],
  };
  const r = QE.validateQuestion(neuronios, baseCtx({ isMC: true, categoryNumber: 5, ageBandKey: '15+' }));
  assert('66. neurónios distractores coerentes', !r.ok, r.issues?.join(', '));
}

// 67–73. reportes Aug 2026 — lote 2
{
  const ps1 = {
    q: 'Quando foi lançada a consola PlayStation 1?',
    a: '1994',
    options: ['1994', '1999', '1985', '2000'],
  };
  const r = QE.validateQuestion(ps1, baseCtx({ formatId: QE.FORMAT_IDS.QUANDO, categoryNumber: 16, ageBandKey: '6-9', isMC: true }));
  assert('67. PlayStation 6-9 demasiado difícil', !r.ok, r.issues?.join(', '));
}
{
  const mickey = {
    q: 'Qual é o nome do rato que faz queijo no filme da Disney?',
    a: 'Mickey',
    options: ['Donald', 'Goofy', 'Pato', 'Mickey'],
  };
  const r = QE.validateQuestion(mickey, baseCtx({ isMC: true, categoryNumber: 11, ageBandKey: '6-9' }));
  assert('68. rato+queijo Disney confuso', !r.ok, r.issues?.join(', '));
}
{
  const sapatilha = {
    q: 'Quem é o designer português famoso por criar o sapato de saltos em madeira, conhecido como sapatilha?',
    a: 'Manuel Branco',
    options: ['Pedro Marques', 'José António da Silva', 'Nuno Gama', 'Manuel Branco'],
  };
  const r = QE.validateQuestion(sapatilha, baseCtx({ formatId: QE.FORMAT_IDS.QUEM_E, categoryNumber: 13, ageBandKey: '10-15' }));
  assert('69. Manuel Branco sapatilha duvidoso', !r.ok, r.issues?.join(', '));
}
{
  const pato = {
    q: 'O que é que tem asas e não voa, tem penas e não canta?',
    a: 'Pato de borracha',
    clues: ['tem asas mas não voa', 'tem penas mas não canta'],
    options: ['Gato', 'Cão', 'Pato de borracha', 'Peixe'],
  };
  const r = QE.validateQuestion(pato, baseCtx({ formatId: QE.FORMAT_IDS.ADIVINHA, categoryNumber: 20, ageBandKey: '6-9' }));
  assert('70. adivinha pato de borracha', !r.ok, r.issues?.join(', '));
}
{
  const nilo = {
    q: 'O rio Nilo é o mais longo do mundo. Verdadeiro ou Falso?',
    a: 'Falso',
    options: ['Verdadeiro', 'Falso'],
  };
  const r = QE.validateQuestion(nilo, baseCtx({ formatId: QE.FORMAT_IDS.VERDADEIRO_FALSO, categoryNumber: 2, ageBandKey: '10-15', isTrueFalse: true }));
  assert('71. Nilo vs Amazónia disputado', !r.ok, r.issues?.join(', '));
}
{
  const wc2026 = {
    q: 'Quem é o jogador português que marcou o primeiro golo da seleção na fase de grupos da Copa do Mundo 2026?',
    a: 'Pedro Gonçalves',
    options: ['Nuno Santos', 'Rui Costa', 'Diogo Pereira', 'Pedro Gonçalves'],
  };
  const r = QE.validateQuestion(wc2026, baseCtx({ formatId: QE.FORMAT_IDS.QUEM_E, categoryNumber: 15, ageBandKey: '10-15' }));
  assert('72. Mundial 2026 golos específicos', !r.ok, r.issues?.join(', '));
}
{
  const remyOk = {
    q: 'Qual é o nome do rato que cozinha no filme Ratatouille?',
    a: 'Remy',
    options: ['Remy', 'Gusteau', 'Linguini', 'Colette'],
  };
  const r = QE.validateQuestion(remyOk, baseCtx({ isMC: true, categoryNumber: 11, ageBandKey: '6-9' }));
  assert('73. Remy Ratatouille aceite', r.ok, r.issues?.join(', '));
}
{
  const trilhos = { q: 'O comboio precisa de trilhos para andar. Verdadeiro ou Falso?', a: 'Verdadeiro' };
  const r = QE.validateQuestion(trilhos, baseCtx({ formatId: QE.FORMAT_IDS.VERDADEIRO_FALSO, categoryNumber: 19, ageBandKey: '6-9', isTrueFalse: true }));
  assert('74. trilhos vs carris', !r.ok, r.issues?.join(', '));
}
{
  const marley = {
    q: 'Quem canta no festival de verão com um chapéu de palha e óculos escuros?',
    a: 'Bob Marley',
    options: ['Bob Marley', 'Elton John', 'Elvis Presley', 'Michael Jackson'],
  };
  const r = QE.validateQuestion(marley, baseCtx({ formatId: QE.FORMAT_IDS.QUEM_E, categoryNumber: 12, ageBandKey: '6-9' }));
  assert('75. Bob Marley festival vago', !r.ok, r.issues?.join(', '));
}

// 20. persistência histórico (em memória via API)
{
  const testKey = 'reino_magico_q_history_v3_test_' + Date.now();
  const origKey = QE.PERSISTENT_HISTORY_KEY;
  // persist via API — memStore já ligado ao sandbox
  QE.persistQuestion('10-15', 'Pergunta teste?', 'Resposta', normalizeQ, {
    category: 1,
    format: QE.FORMAT_IDS.RESPOSTA_DIRETA,
    knowledgeKey: 'teste',
    difficulty: 2,
    subtopic: 'facto geral',
  });
  const slice = QE.getPersistentSlice('10-15');
  assert('20. persistência histórico', slice.questions.includes('Pergunta teste?') && slice.knowledgeKeys.includes('teste'));
}

// Extras: scoreQuestion e answerMode
{
  const openFormats = QE.getAllowedFormats(1, '10-15', 'open');
  assert('answerMode open sem MC', !openFormats.includes(QE.FORMAT_IDS.ESCOLHA_MULTIPLA));
  const mcFormats = QE.getAllowedFormats(1, '10-15', 'mc');
  assert('answerMode mc sem resposta directa', !mcFormats.includes(QE.FORMAT_IDS.RESPOSTA_DIRETA));
}

{
  const d69 = QE.chooseDifficulty('6-9', []);
  assert('dificuldade 6-9 no intervalo', d69 >= 1 && d69 <= 3, String(d69));
  const d15 = QE.chooseDifficulty('15+', [4, 4, 5]);
  assert('dificuldade 15+ no intervalo', d15 >= 1 && d15 <= 5, String(d15));
}

// 76–78. code review question-engine — formatos e categorias
{
  const fallback = QE.getAllowedFormats(999, '6-9', 'open');
  assert('76. fallback idade no getAllowedFormats', !fallback.includes(QE.FORMAT_IDS.CAUSA_CONSEQUENCIA));
}
{
  assert('77. defaultFormat open', QE.defaultFormatForAnswerMode('open') === QE.FORMAT_IDS.RESPOSTA_DIRETA);
  assert('77b. defaultFormat mc', QE.defaultFormatForAnswerMode('mc') === QE.FORMAT_IDS.ESCOLHA_MULTIPLA);
}
{
  const cat7 = QE.getCategoryDef(7);
  assert('78. CATEGORIES unificado', cat7.formats.includes('CAUSA_CONSEQUENCIA') && cat7.subtopics.length > 0 && cat7.rules.includes('Matemática'));
  assert('78b. CATEGORY_RULES derivado', QE.CATEGORY_RULES[7] === cat7.rules);
  assert('78c. CATEGORIES_RAW 20 entradas', Object.keys(QE.CATEGORIES).length === 20);
}

// 79–81. regex PT-PT / brasileirismo
{
  const equipa = { q: 'O time de actores do filme ganhou um prémio. Verdadeiro ou Falso?', a: 'Verdadeiro' };
  const r1 = QE.validateQuestion(equipa, baseCtx({ formatId: QE.FORMAT_IDS.VERDADEIRO_FALSO, categoryNumber: 11, ageBandKey: '15+' }));
  assert('79. time de (não BR) aceite', r1.ok, r1.issues?.join(', '));
}
{
  const brTime = { q: 'O time ganhou o campeonato brasileiro.', a: 'Verdadeiro', options: ['Verdadeiro', 'Falso'] };
  const r2 = QE.validateQuestion(brTime, baseCtx({ formatId: QE.FORMAT_IDS.VERDADEIRO_FALSO, isMC: true, categoryNumber: 15 }));
  assert('80. time como equipa BR rejeitado', !r2.ok, r2.issues?.join(', '));
}
{
  const en = { q: 'Qual é a estação do ano com mais sol?', a: 'Summer', options: ['Summer', 'Primavera', 'Outono', 'Inverno'] };
  const r3 = QE.validateQuestion(en, baseCtx({ isMC: true, categoryNumber: 1, ageBandKey: '10-15' }));
  assert('81. resposta só em inglês rejeitada', !r3.ok, r3.issues?.join(', '));
}

// 82. AGE_LIMITS
{
  const lim = QE.getAgeLimits('6-9');
  assert('82. AGE_LIMITS 6-9', lim.shortQ.includes('110') && lim.maxCausaConsequenciaChars === 120
    && lim.maxQuestionChars === 110 && lim.maxMcOptionWords === 4);
}
{
  const longQ = { q: 'A'.repeat(181), a: 'Lisboa' };
  const r = QE.validateQuestion(longQ, baseCtx({ categoryNumber: 2, ageBandKey: '10-15' }));
  assert('83. pergunta longa 10-15', !r.ok, r.issues?.join(', '));
}
{
  const lim15 = QE.getAgeLimits('15+');
  assert('84. AGE_LIMITS 15+', lim15.maxQuestionChars === 240 && lim15.promptDiffExtraHard?.includes('exigente'));
}
{
  const keys69 = Object.keys(QE.getAgeLimits('6-9')).sort();
  const keys1015 = Object.keys(QE.getAgeLimits('10-15')).sort();
  const keys15 = Object.keys(QE.getAgeLimits('15+')).sort();
  assert('85. AGE_LIMITS shape igual', JSON.stringify(keys69) === JSON.stringify(keys1015)
    && JSON.stringify(keys69) === JSON.stringify(keys15));
}

// 86–88. Fase 1 — issue codes estruturados
{
  const r = QE.validateQuestion({ q: '', a: '' }, baseCtx());
  assert('86. issueDetails em estrutura incompleta', Array.isArray(r.issueDetails) && r.issueDetails[0]?.code === 'STRUCTURE_INCOMPLETE');
  assert('86b. issues string backward compat', r.issues[0] === 'estrutura incompleta');
}
{
  const dup = { q: 'Quem é o xerife?', a: 'Woody', options: ['Woody', 'Wooody', 'Buzz', 'Rex'] };
  const r = QE.validateQuestion(dup, baseCtx({ isMC: true, categoryNumber: 11, ageBandKey: '6-9' }));
  assert('87. MC_NEAR_DUPLICATE code', !r.ok && r.issueDetails?.some((i) => i.code === 'MC_NEAR_DUPLICATE'), r.issues?.join(', '));
}
{
  const hint = QE.buildRetryHint(['conhecimento já testado recentemente (knowledgeKey)'], QE.FORMAT_IDS.RESPOSTA_DIRETA, '10-15');
  assert('88. buildRetryHint por code', hint.includes('Não repitas conhecimento já testado'));
}

// 89–94. Fase 2 — knowledgeKey estruturado (Groq + OpenAI)
{
  const meta = { entity: 'espanha', concept: 'capital', relation: 'é' };
  const k = QE.buildStructuredKnowledgeKey(meta, 2, normalizeQ);
  assert('89. structured key geografia', k === 'geografia|espanha|capital|e');
}
{
  const kCap = QE.computeKnowledgeKey('Qual é a capital de Espanha?', 'Madrid', QE.FORMAT_IDS.RESPOSTA_DIRETA, normalizeQ, {
    knowledgeMeta: { entity: 'espanha', concept: 'capital' },
    categoryNumber: 2,
  });
  const kClub = QE.computeKnowledgeKey('Que clube tem o estádio Santiago Bernabéu?', 'Madrid', QE.FORMAT_IDS.RESPOSTA_DIRETA, normalizeQ, {
    knowledgeMeta: { entity: 'real madrid', concept: 'estadio' },
    categoryNumber: 15,
  });
  assert('90. Madrid capital vs clube distintos', !QE.knowledgeKeysMatch(kCap, kClub, normalizeQ), `${kCap} vs ${kClub}`);
}
{
  const groqRaw = {
    q: 'Qual é a capital de Espanha?',
    a: 'Madrid',
    knowledge: { entity: 'espanha', concept: 'capital', relation: 'é' },
    distractors: ['Lisboa', 'Paris', 'Roma'],
  };
  const openaiRaw = JSON.parse('{"q":"Qual é a capital de Espanha?","a":"Madrid","knowledge":{"entity":"espanha","concept":"capital","relation":"é"},"distractors":["Lisboa","Paris","Roma"]}');
  const groqMeta = QE.parseKnowledgeMeta(groqRaw);
  const openaiMeta = QE.parseKnowledgeMeta(openaiRaw);
  assert('91. parse Groq knowledge', groqMeta?.entity === 'espanha' && groqMeta?.concept === 'capital');
  assert('92. parse OpenAI knowledge', openaiMeta?.entity === 'espanha' && openaiMeta?.concept === 'capital');
  const kGroq = QE.computeKnowledgeKey(groqRaw.q, groqRaw.a, QE.FORMAT_IDS.ESCOLHA_MULTIPLA, normalizeQ, {
    knowledgeMeta: groqMeta,
    categoryNumber: 2,
  });
  const kOpenai = QE.computeKnowledgeKey(openaiRaw.q, openaiRaw.a, QE.FORMAT_IDS.ESCOLHA_MULTIPLA, normalizeQ, {
    knowledgeMeta: openaiMeta,
    categoryNumber: 2,
  });
  assert('93. Groq/OpenAI mesma chave', kGroq === kOpenai && QE.isStructuredKnowledgeKey(kGroq));
}
{
  const parsed = {
    q: 'Qual é a capital de França?',
    a: 'Paris',
    knowledge: { entity: 'frança', concept: 'capital', relation: 'é' },
  };
  const ctx = baseCtx({
    usedKnowledgeKeys: [QE.buildStructuredKnowledgeKey({ entity: 'frança', concept: 'capital' }, 2, normalizeQ)],
    categoryNumber: 2,
  });
  const r = QE.validateQuestion(parsed, ctx);
  assert('94. repetição por knowledge estruturado', !r.ok, r.issues?.join(', '));
}

// 95–97. Fase 3 — retry adaptativo
{
  const details = [{ code: 'KNOWLEDGE_REPEATED', layer: 'repetition', message: 'conhecimento já testado' }];
  assert('95. rotate subtopic tentativa 2', QE.shouldRotateSubtopicForRetry(details, 2));
  assert('95b. não rotate tentativa 1', !QE.shouldRotateSubtopicForRetry(details, 1));
}
{
  const hint = QE.buildAdaptiveRetryHint(
    ['conhecimento já testado recentemente (knowledgeKey)'],
    QE.FORMAT_IDS.RESPOSTA_DIRETA,
    '10-15',
    3,
    { issueDetails: [{ code: 'KNOWLEDGE_REPEATED', layer: 'repetition', message: 'conhecimento já testado' }] },
  );
  assert('96. hint adaptativo repetição', hint.includes('SUBTÓPICO') && hint.includes('entity e concept'));
}
{
  const mcHint = QE.buildAdaptiveRetryHint(
    ['opções repetidas ou quase iguais'],
    QE.FORMAT_IDS.ESCOLHA_MULTIPLA,
    '6-9',
    2,
    { issueDetails: [{ code: 'MC_NEAR_DUPLICATE', layer: 'mcOptions', message: 'opções repetidas' }] },
  );
  assert('97. hint adaptativo MC', mcHint.includes('distractores'));
}

// 98–100. telemetria de geração
{
  QE.clearGenerationTelemetry();
  QE.recordGenerationTelemetry({
    outcome: 'rejected',
    category: 2,
    formatId: 'ESCOLHA_MULTIPLA',
    ageBandKey: '10-15',
    attempt: 2,
    issueCodes: ['MC_NEAR_DUPLICATE'],
  });
  QE.recordGenerationTelemetry({
    outcome: 'accepted',
    category: 2,
    formatId: 'ESCOLHA_MULTIPLA',
    ageBandKey: '10-15',
    attempt: 1,
    score: 100,
  });
  const summary = QE.getGenerationTelemetrySummary();
  assert('98. telemetria summary', summary.total === 2 && summary.accepted === 1 && summary.rejected === 1);
  assert('99. telemetria byIssueCode', summary.byIssueCode.MC_NEAR_DUPLICATE === 1);
  QE.recordGenerationTelemetry({
    outcome: 'rejected',
    category: 2,
    formatId: 'QUEM_E',
    issueCodes: ['FACT_29_PERGUNTA_CONFUSA_RATO_QUE_FA'],
    issueMessages: ['pergunta confusa — "rato que faz queijo" é o Remy (Ratatouille), não o Mickey'],
  });
  const summary2 = QE.getGenerationTelemetrySummary();
  assert('104. telemetria byIssueDetail', summary2.byIssueDetail.FACT_29_PERGUNTA_CONFUSA_RATO_QUE_FA?.count === 1
    && /Remy/i.test(summary2.byIssueDetail.FACT_29_PERGUNTA_CONFUSA_RATO_QUE_FA.sampleMessage));
}

// 105–110. Fase 4 — pushIssue em ADIVINHA, PT-PT e idade
{
  const apito = {
    q: 'Tenho cabeça sem cérebro, corpo sem coração e rabo sem osso. Quando corre, faz barulho, mas quando para, cala a boca. O que é?',
    a: 'Cavalo',
    clues: ['cabeça sem cérebro', 'faz barulho quando corre', 'cala quando para'],
  };
  const r = QE.validateQuestion(apito, baseCtx({ formatId: QE.FORMAT_IDS.ADIVINHA, categoryNumber: 20, ageBandKey: '15+' }));
  assert('105. ADIVINHA_WHISTLE code', !r.ok && r.issueDetails?.some((i) => i.code === 'ADIVINHA_WHISTLE_RIDDLE'), r.issues?.join(', '));
}
{
  const mapa = {
    q: 'Tenho cidades mas não casas, montanhas mas não árvores, água mas não peixes. O que sou?',
    a: 'Um mapa',
    clues: ['tem cidades sem casas', 'tem montanhas sem árvores', 'tem água sem peixes'],
    options: ['Um globo terráqueo', 'Uma fotografia aérea', 'Um mapa', 'Um quadro de paisagem'],
  };
  const r = QE.validateQuestion(mapa, baseCtx({ formatId: QE.FORMAT_IDS.ADIVINHA, categoryNumber: 20, ageBandKey: '10-15', isMC: true }));
  assert('106. ADIVINHA_MAP_GLOBE code', !r.ok && r.issueDetails?.some((i) => i.code === 'ADIVINHA_MAP_GLOBE_AMBIGUOUS'), r.issues?.join(', '));
}
{
  const camiseta = { q: 'Que peça de roupa usam os jogadores de futebol?', a: 'Camiseta' };
  const r = QE.validateQuestion(camiseta, baseCtx({ categoryNumber: 18, ageBandKey: '10-15' }));
  assert('107. PT_BRASILISM camiseta code', !r.ok && r.issueDetails?.some((i) => i.code === 'PT_BRASILISM'), r.issues?.join(', '));
}
{
  const vies = {
    q: 'Como se chama o efeito que faz recordar informações negativas com mais intensidade?',
    a: 'Viés de negatividade',
    options: ['Viés de negatividade', 'Efeito placebo', 'Memória fotográfica', 'Déjà vu'],
  };
  const r = QE.validateQuestion(vies, baseCtx({ isMC: true, categoryNumber: 5, ageBandKey: '15+' }));
  assert('108. PT_BRASILISM viés code', !r.ok && r.issueDetails?.some((i) => i.code === 'PT_BRASILISM'), r.issues?.join(', '));
}
{
  const picasso = {
    q: 'Quando nasceu o famoso pintor Pablo Picasso?',
    a: '1881',
    options: ['1881', '1890', '1901', '1875'],
  };
  const r = QE.validateQuestion(picasso, baseCtx({ formatId: QE.FORMAT_IDS.QUANDO, categoryNumber: 4, ageBandKey: '6-9', isMC: true }));
  assert('109. AGE_TOO_HARD code', !r.ok && r.issueDetails?.some((i) => i.code === 'AGE_TOO_HARD'), r.issues?.join(', '));
}
{
  const hint = QE.buildRetryHint([{ code: 'ADIVINHA_WHISTLE_RIDDLE', message: 'test' }], QE.FORMAT_IDS.ADIVINHA, '10-15');
  assert('110. retry hint ADIVINHA code', hint.includes('apito'));
}

// 111–115. Fase 4b — pushIssue em MC, categoria e dificuldade
{
  const versalhes = {
    q: 'Que tratado pôs fim à Primeira Guerra Mundial?',
    a: 'Tratado de Versalhes',
    options: ['Tratado de Versalhes', 'Mahatma Gandhi', '1789', '1986'],
  };
  const r = QE.validateQuestion(versalhes, baseCtx({ isMC: true, formatId: QE.FORMAT_IDS.RESPOSTA_DIRETA, categoryNumber: 3, ageBandKey: '15+' }));
  assert('111. MC_WRONG_CLASS Versalhes', !r.ok && r.issueDetails?.some((i) => i.code === 'MC_WRONG_CLASS'), r.issues?.join(', '));
}
{
  const congelamento = { q: 'Completa: O processo de solidificação da água é chamado de ___.', a: 'Congelamento' };
  const r = QE.validateQuestion(congelamento, baseCtx({ formatId: QE.FORMAT_IDS.COMPLETA, categoryNumber: 5, ageBandKey: '15+' }));
  assert('112. CATEGORY_MISMATCH congelamento', !r.ok && r.issueDetails?.some((i) => i.code === 'CATEGORY_MISMATCH'), r.issues?.join(', '));
}
{
  const div = {
    q: 'Quanto é 144 dividido por 12?',
    a: '12',
    options: ['12', '144', '24', '36'],
  };
  const r = QE.validateQuestion(div, baseCtx({ isMC: true, categoryNumber: 7 }));
  assert('113. MC_TRIVIAL_MATH divisão', !r.ok && r.issueDetails?.some((i) => i.code === 'MC_TRIVIAL_MATH'), r.issues?.join(', '));
}
{
  const picasso = {
    q: 'Quando nasceu o famoso pintor Pablo Picasso?',
    a: '1881',
    options: ['1881', '1890', '1901', '1875'],
  };
  const r = QE.validateQuestion(picasso, baseCtx({ formatId: QE.FORMAT_IDS.QUANDO, categoryNumber: 4, ageBandKey: '6-9', isMC: true, difficulty: 9 }));
  assert('114. DIFFICULTY_OUT_OF_RANGE', !r.ok && r.issueDetails?.some((i) => i.code === 'DIFFICULTY_OUT_OF_RANGE'), r.issues?.join(', '));
}
{
  const versalhes = {
    q: 'Que tratado pôs fim à Primeira Guerra Mundial?',
    a: 'Tratado de Versalhes',
    options: ['Tratado de Versalhes', 'Mahatma Gandhi', '1789', '1986'],
  };
  const hint = QE.buildRetryHint(versalhes.options.map(() => ({ code: 'MC_WRONG_CLASS', message: 'test' })), QE.FORMAT_IDS.ESCOLHA_MULTIPLA, '15+');
  assert('115. retry hint MC_WRONG_CLASS', hint.includes('mesma classe'));
}

// 116–120. Fase 4c — pushIssue em validadores de formato
{
  const engenheira = {
    q: 'Quem é a engenheira que desenvolveu a primeira mão robótica controlada pelo pensamento?',
    a: 'Dario Rossi',
  };
  const r = QE.validateQuestion(engenheira, baseCtx({ formatId: QE.FORMAT_IDS.QUEM_E, categoryNumber: 17, ageBandKey: '15+' }));
  assert('116. FORMAT_VIOLATION género QUEM_E', !r.ok && r.issueDetails?.some((i) => i.code === 'FORMAT_VIOLATION'), r.issues?.join(', '));
}
{
  const tejo = { q: 'Onde fica o rio Tejo?', a: 'Portugal', options: ['Espanha', 'França', 'Portugal', 'Itália'] };
  const r = QE.validateQuestion(tejo, baseCtx({ formatId: QE.FORMAT_IDS.ONDE_FICA, categoryNumber: 2, ageBandKey: '10-15', isMC: true }));
  assert('117. FORMAT_VIOLATION ONDE_FICA ambíguo', !r.ok && r.issueDetails?.some((i) => i.code === 'FORMAT_VIOLATION'), r.issues?.join(', '));
}
{
  const curiosidade = { q: 'Em que ano foi descoberto o Brasil?', a: '1500' };
  const r = QE.validateQuestion(curiosidade, baseCtx({ formatId: QE.FORMAT_IDS.CURIOSIDADE, categoryNumber: 3, ageBandKey: '15+' }));
  assert('118. FORMAT_VIOLATION CURIOSIDADE ano', !r.ok && r.issueDetails?.some((i) => i.code === 'FORMAT_VIOLATION'), r.issues?.join(', '));
}
{
  const completa = { q: 'Descreve o processo de evaporização da água.', a: 'evaporação' };
  const r = QE.validateQuestion(completa, baseCtx({ formatId: QE.FORMAT_IDS.COMPLETA, categoryNumber: 5, ageBandKey: '10-15' }));
  assert('119. FORMAT_VIOLATION COMPLETA sem lacuna', !r.ok && r.issueDetails?.some((i) => i.code === 'FORMAT_VIOLATION'), r.issues?.join(', '));
}
{
  const hint = QE.buildRetryHint([{ code: 'FORMAT_VIOLATION', message: 'test' }], QE.FORMAT_IDS.QUEM_E, '15+');
  assert('120. retry hint FORMAT_VIOLATION', hint.includes('formato pedido'));
}

// 121–125. Fase 5 — ADIVINHA com clues[] e verificador semântico
{
  const semClues = {
    q: 'Tenho dentes mas não mordo. O que sou?',
    a: 'Pente',
  };
  const r = QE.validateQuestion(semClues, baseCtx({ formatId: QE.FORMAT_IDS.ADIVINHA, categoryNumber: 20, ageBandKey: '10-15' }));
  assert('121. ADIVINHA_MISSING_CLUES', !r.ok && r.issueDetails?.some((i) => i.code === 'ADIVINHA_MISSING_CLUES'), r.issues?.join(', '));
}
{
  const leak = {
    q: 'O que é redondo e salta?',
    a: 'Bola',
    clues: ['é uma bola', 'salta muito'],
  };
  const r = QE.validateQuestion(leak, baseCtx({ formatId: QE.FORMAT_IDS.ADIVINHA, categoryNumber: 20, ageBandKey: '10-15' }));
  assert('122. ADIVINHA_CLUE_LEAKS_ANSWER', !r.ok && r.issueDetails?.some((i) => i.code === 'ADIVINHA_CLUE_LEAKS_ANSWER'), r.issues?.join(', '));
}
{
  assert('123. shouldRequestAdivinhaVerify', QE.shouldRequestAdivinhaVerify({ formatId: 'ADIVINHA', ageBandKey: '10-15' }));
  assert('123b. skip adivinha verify outros formatos', !QE.shouldRequestAdivinhaVerify({ formatId: 'QUEM_E', ageBandKey: '10-15' }));
}
{
  const ok = QE.parseAdivinhaVerifyResponse('{"ok":true}');
  const bad = QE.parseAdivinhaVerifyResponse('{"ok":false,"issues":["charada ambígua"]}');
  assert('124. parseAdivinhaVerifyResponse', ok.ok && !bad.ok && bad.issues[0].includes('ambígua'));
}
{
  const pente = {
    q: 'Tenho dentes mas não mordo. O que sou?',
    a: 'Pente',
    clues: ['tem dentes', 'não morde'],
  };
  const r = QE.validateQuestion(pente, baseCtx({ formatId: QE.FORMAT_IDS.ADIVINHA, categoryNumber: 20, ageBandKey: '10-15' }));
  assert('125. ADIVINHA válida com clues', r.ok, r.issues?.join(', '));
}

// 126–130. Fase 6 — dificuldade pedida vs estimada
{
  const est = QE.estimateDifficulty('Qual é o planeta onde vivemos?', 'Terra', { ageBandKey: '15+' });
  assert('126. estimateDifficulty trivial', est.estimatedDifficulty <= 2 && est.difficultyConfidence >= 0.7);
}
{
  const parsed = { q: 'Qual é o planeta onde vivemos?', a: 'Terra' };
  const r = QE.validateQuestion(parsed, baseCtx({ ageBandKey: '15+', difficulty: 5 }));
  assert('127. DIFFICULTY_EASIER_THAN_REQUESTED', !r.ok && r.issueDetails?.some((i) => i.code === 'DIFFICULTY_EASIER_THAN_REQUESTED'), r.issues?.join(', '));
}
{
  const parsed = { q: 'Quando começou a Segunda Guerra Mundial?', a: '1939' };
  const r = QE.validateQuestion(parsed, baseCtx({ ageBandKey: '6-9', formatId: QE.FORMAT_IDS.QUANDO, difficulty: 1 }));
  assert('128. DIFFICULTY_HARDER_THAN_REQUESTED', !r.ok && r.issueDetails?.some((i) => i.code === 'DIFFICULTY_HARDER_THAN_REQUESTED'), r.issues?.join(', '));
}
{
  const parsed = { q: 'Qual é a capital de Espanha?', a: 'Madrid' };
  const r = QE.validateQuestion(parsed, baseCtx({ ageBandKey: '10-15', difficulty: 2 }));
  assert('129. dificuldade pedida alinhada', r.ok, r.issues?.join(', '));
}
{
  const hint = QE.buildRetryHint([{ code: 'DIFFICULTY_EASIER_THAN_REQUESTED', message: 'test' }], QE.FORMAT_IDS.RESPOSTA_DIRETA, '15+');
  assert('130. retry hint DIFFICULTY_EASIER_THAN_REQUESTED', hint.includes('exigência'));
}

// 131. Fase 7 — engine-config modular
{
  assert('131. engine-config partilhado', QE.DIFFICULTY_RANGE['15+'].max === 5
    && QE.estimateDifficulty('Qual é o planeta onde vivemos?', 'Terra', { ageBandKey: '15+' }).estimatedDifficulty <= 2);
}

// 132. Fase 7b — pt-pt-validators modular
{
  const PtPt = sandbox.globalThis.QuestionEnginePtPt;
  const issues = PtPt.collectPtPtIssues('Qual cor tem a camiseta?', 'camiseta', [], '10-15');
  assert('132. pt-pt-validators collectPtPtIssues', issues.some((i) => i.code === 'PT_BRASILISM'),
    issues.map((i) => i.message).join(', '));
}

// 133. Fase 7c — format-validators modular
{
  const Fmt = sandbox.globalThis.QuestionEngineFormatValidators;
  const r = Fmt.validateByFormat(
    { q: 'O que é a fotossíntese?', a: 'Processo das plantas' },
    'O_QUE_E',
    { stripTags: (s) => String(s || ''), ageBandKey: '15+' },
  );
  assert('133. format-validators validateByFormat O_QUE_E', r.ok, r.issues?.map((i) => i.message || i).join(', '));
}

// 134. Fase 7d — mc-validators modular
{
  const Mc = sandbox.globalThis.QuestionEngineMcValidators;
  const issues = Mc.validateMcTrivialMath(
    'Quanto é 144 dividido por 12?',
    ['144', '12', '24', '36'],
    '24',
    (s) => String(s || ''),
  );
  assert('134. mc-validators validateMcTrivialMath', issues.some((i) => i.code === 'MC_TRIVIAL_MATH'),
    issues.map((i) => i.message).join(', '));
}

// 135. Fase 7e — age-validators modular
{
  const Age = sandbox.globalThis.QuestionEngineAgeValidators;
  const issues = Age.validateObscureCharacter('Quem é o rato da Cinderela?', 'Jaquim', '6-9');
  assert('135. age-validators obscure character', issues.some((i) => i.code === 'AGE_TOO_HARD'),
    issues.map((i) => i.message).join(', '));
}

// 136. Fase 7f — category-validators modular
{
  const Cat = sandbox.globalThis.QuestionEngineCategoryValidators;
  const issues = Cat.validateCategoryTopicFit('O que é o congelamento da água?', 5, '10-15');
  assert('136. category-validators congelamento', issues.some((i) => i.code === 'CATEGORY_MISMATCH'),
    issues.map((i) => i.message).join(', '));
}

// 137. Fase 7f — semantic-validators modular
{
  const Sem = sandbox.globalThis.QuestionEngineSemanticValidators;
  assert('137. semantic-validators stereotype', Sem.hasCulturalStereotype('Os japoneses são muito educados'));
}

// 138. Fase 7g — repetition-validators modular
{
  const Rep = sandbox.globalThis.QuestionEngineRepetitionValidators;
  const sim = Rep.jaccardSimilarity('qual a capital de portugal', 'capital de portugal');
  assert('138. repetition jaccard', sim >= 0.3 && !Number.isNaN(sim), String(sim));
}

// 139. Fase 8 — persistent-history modular
{
  const slice = QE.getPersistentSlice('6-9');
  assert('139. persistent-history slice shape', Array.isArray(slice.questions) && Array.isArray(slice.entries));
}

// 140–141. Fase 9 — prompt-builder modular
{
  const PB = sandbox.globalThis.QuestionEnginePromptBuilder;
  const globalRules = PB.buildGlobalRules();
  assert('140. prompt-builder global rules', globalRules.includes('REGRAS GLOBAIS') && globalRules.includes('PT-PT'));
  const fmtRules = PB.buildFormatRules('QUEM_E', { ageBandKey: '10-15', isMC: false, isTrueFalse: false });
  assert('140b. prompt-builder format rules', fmtRules.includes('QUEM_E'));
  const cat = QE.CATEGORIES[2];
  const prompt = QE.buildPrompt({
    category: cat,
    ageBandKey: '10-15',
    ageBandPromptText: '10 a 15 anos',
    formatId: 'RESPOSTA_DIRETA',
    ptPtRules: '',
    isMC: false,
    isTrueFalse: false,
    jsonFormat: '{"q":"","a":""}',
    normalizeFn: (s) => String(s || '').trim().toLowerCase(),
  });
  assert('141. buildPrompt estrutura', prompt.includes(cat.name) && prompt.includes('RESPOSTA_DIRETA') && prompt.includes('REGRAS GLOBAIS'));
}

// 142–143. Fase 10 — question-scoring modular
{
  const QS = sandbox.globalThis.QuestionEngineQuestionScoring;
  assert('142. question-scoring layerScore', QS.layerScore(10, []) === 10 && QS.layerScore(10, ['x']) === 0);
  const scored = QE.scoreQuestion({ q: 'Qual é a capital de Portugal?', a: 'Lisboa' }, {
    formatId: 'RESPOSTA_DIRETA',
    ageBandKey: '10-15',
    categoryNumber: 2,
    isMC: false,
    difficulty: 3,
    stripTags: (s) => String(s || '').replace(/<[^>]*>/g, '').trim(),
    normalizeFn: (s) => String(s || '').trim().toLowerCase(),
    usedQuestions: [],
    usedAnswers: [],
    usedKnowledgeKeys: [],
    persistentKnowledgeKeys: [],
  });
  assert('143. scoreQuestion válida', scored.score === 100 && scored.issues.length === 0);
}

// 144–147. Fases 11–14 — mc-assembly, knowledge-key-compute, fachada limpa
{
  const MC = sandbox.globalThis.QuestionEngineMcAssembly;
  const opts = MC.assembleMcOptions('Lisboa', ['Porto', 'Faro', 'Coimbra']);
  assert('144. mc-assembly assemble', Array.isArray(opts) && opts.length === 4 && opts.includes('Lisboa'));
  const KC = sandbox.globalThis.QuestionEngineKnowledgeKeyCompute;
  const key = KC.computeKnowledgeKey('Qual é a capital de Portugal?', 'Lisboa', QE.FORMAT_IDS.RESPOSTA_DIRETA, (s) => String(s).toLowerCase());
  assert('145. knowledge-key-compute', key.includes('lisboa') || key.includes('capital'));
  assert('146. fachada question-engine linhas', typeof QE.validateQuestion === 'function' && typeof QE.assembleMcOptions === 'function');
  assert('147. scoring sem configure', !sandbox.globalThis.QuestionEngineQuestionScoring.configure);
}

// 148–149. Fases 15–16 — known-facts factual + manifest
{
  const KF = sandbox.globalThis.QuestionEngineKnownFacts;
  const woody = KF.validateFactualConsistency(
    'No Toy Story, quem usa chapéu de cowboy?',
    'Woody',
  );
  assert('148. validateFactualConsistency', Array.isArray(woody));
  const manifest = manifestSandbox.globalThis.QuestionEngineManifest;
  assert('149. manifest ordem', manifest.ENGINE_SCRIPT_PATHS[0].endsWith('engine-config.js')
    && manifest.ENGINE_SCRIPT_PATHS.at(-1) === 'question-engine.js');
}
{
  QE.clearGenerationTelemetry();
  for (let i = 0; i < 210; i += 1) {
    QE.recordGenerationTelemetry({ outcome: 'rejected', category: 1, formatId: 'QUEM_E', issueCodes: ['UNSPECIFIED'] });
  }
  const events = sandbox.globalThis.QuestionEngineTelemetry.getTelemetryEvents();
  assert('100. telemetria ring buffer', events.length <= 200);
}

// 101–103. verificação factual IA
{
  assert('101. factual verify geografia', QE.shouldRequestFactualVerify({ categoryNumber: 2, formatId: 'QUEM_E', ageBandKey: '10-15' }));
  assert('102. factual skip adivinha', !QE.shouldRequestFactualVerify({ categoryNumber: 20, formatId: 'ADIVINHA', ageBandKey: '6-9' }));
  const ok = QE.parseFactualVerifyResponse('{"ok":true}');
  assert('103. factual parse ok', ok.ok && !ok.issues.length);
  const bad = QE.parseFactualVerifyResponse('{"ok":false,"issues":["capital errada"]}');
  assert('103b. factual parse reject', !bad.ok && bad.issues[0] === 'capital errada');
}

// 150–152. KR-1 — buildPromptFromFact + validação repositório
{
  const record = {
    knowledgeId: 'knw-test',
    answer: 'Pente',
    fact: 'Tem dentes mas não morde.',
    clues: ['tem dentes', 'não morde'],
    source: 'sample',
    sourceId: 'sample:001',
  };
  const cat = QE.CATEGORIES[20];
  const factPrompt = QE.buildPromptFromFact(record, {
    category: cat,
    ageBandKey: '10-15',
    ageBandPromptText: '10 a 15 anos',
    formatId: 'ADIVINHA',
    ptPtRules: '',
    isMC: true,
    isTrueFalse: false,
    mcInstruction: ' inclui clues',
    jsonFormat: '{"q":"","a":"Pente","clues":[],"distractors":[]}',
  });
  assert('150. buildPromptFromFact inclui resposta', factPrompt.includes('Pente') && factPrompt.includes('NÃO inventes'));
  const adivinha = {
    q: 'Tenho dentes mas não mordo. O que sou?',
    a: 'Pente',
    clues: ['tem dentes', 'não morde'],
    options: ['Pente', 'Garfo', 'Colher', 'Faca'],
  };
  const okRepo = QE.validateQuestion(adivinha, {
    ...baseCtx({ categoryNumber: 20, formatId: QE.FORMAT_IDS.ADIVINHA, isMC: true }),
    repositoryRecord: record,
  });
  assert('151. repository answer ok', okRepo.ok, okRepo.issues?.join(', '));
  const badRepo = QE.validateQuestion({ ...adivinha, a: 'Garfo' }, {
    ...baseCtx({ categoryNumber: 20, formatId: QE.FORMAT_IDS.ADIVINHA, isMC: true }),
    repositoryRecord: record,
  });
  assert('152. repository answer mismatch', !badRepo.ok && badRepo.issues.some((i) => /repositório/i.test(i)));
}

// 153–154. CURIOSIDADE — só Verdadeiro/Falso
{
  const ostra = {
    q: 'Sabias que as ostras produzem as pérolas? Verdadeiro ou Falso?',
    a: 'Verdadeiro',
    options: ['Não sei', 'Falso', 'Verdadeiro', 'Às vezes'],
  };
  const badCur = QE.validateQuestion(ostra, {
    ...baseCtx({ categoryNumber: 20, formatId: QE.FORMAT_IDS.CURIOSIDADE, isMC: true }),
    helpers: {
      stripTags,
      validateTrueFalseQuestion: (p) => (/verdadeiro\s+ou\s+falso/i.test(stripTags(p?.q || ''))
        ? { ok: true, issues: [] }
        : { ok: false, issues: ['sem V/F'] }),
      ageBandKey: '6-9',
    },
  });
  assert('153. curiosidade rejeita opções inválidas', !badCur.ok);
  const okCur = QE.validateQuestion({
    q: 'Sabias que um polvo tem três corações? Verdadeiro ou Falso?',
    a: 'Verdadeiro',
    options: ['Verdadeiro', 'Falso'],
  }, {
    ...baseCtx({ categoryNumber: 20, formatId: QE.FORMAT_IDS.CURIOSIDADE, isMC: true }),
    helpers: {
      stripTags,
      validateTrueFalseQuestion: () => ({ ok: true, issues: [] }),
      ageBandKey: '6-9',
    },
  });
  assert('154. curiosidade V/F válida', okCur.ok, okCur.issues?.join(', '));
}

// 155. cat. 20 — mix ~70% adivinha / 30% curiosidade
{
  const recent = [];
  let adivinhaCount = 0;
  const trials = 2000;
  for (let i = 0; i < trials; i += 1) {
    const f = QE.chooseFormat(20, '10-15', 'mc', recent);
    if (f === QE.FORMAT_IDS.ADIVINHA) adivinhaCount += 1;
    recent.push(f);
    if (recent.length > 40) recent.shift();
  }
  const ratio = adivinhaCount / trials;
  assert('155. cat.20 mix adivinha ~70%', ratio >= 0.62 && ratio <= 0.78, `adivinha ${(ratio * 100).toFixed(1)}%`);
}

// 156–158. KR-2 — curiosidades a partir do repositório
{
  assert('156. getRepositoryExpectedAnswer isTrue', QE.getRepositoryExpectedAnswer({ isTrue: true, answer: 'X' }) === 'Verdadeiro');
  assert('157. getRepositoryExpectedAnswer isFalse', QE.getRepositoryExpectedAnswer({ isTrue: false, answer: 'X' }) === 'Falso');
  const curRecord = {
    knowledgeId: 'knw-cur-test',
    fact: 'Um polvo tem três corações e sangue azul.',
    answer: 'Verdadeiro',
    statement: 'Um polvo tem três corações. Verdadeiro ou Falso?',
    isTrue: true,
    source: 'sample',
    sourceId: 'sample:cur:001',
  };
  const curPrompt = QE.buildPromptFromFact(curRecord, {
    category: QE.CATEGORIES[20],
    ageBandKey: '10-15',
    ageBandPromptText: '10 a 15 anos',
    formatId: QE.FORMAT_IDS.CURIOSIDADE,
    ptPtRules: '',
    isMC: true,
    isTrueFalse: true,
    mcInstruction: ' V/F',
    jsonFormat: '{"q":"","a":"Verdadeiro","options":["Verdadeiro","Falso"]}',
  });
  assert('158. buildPromptFromFact curiosidade', /Sabias que|curiosidade/i.test(curPrompt) && curPrompt.includes('Verdadeiro'));
  const vfPrompt = QE.buildPromptFromFact(curRecord, {
    category: QE.CATEGORIES[20],
    ageBandKey: '10-15',
    ageBandPromptText: '10 a 15 anos',
    formatId: QE.FORMAT_IDS.VERDADEIRO_FALSO,
    ptPtRules: '',
    isMC: true,
    isTrueFalse: true,
    mcInstruction: ' V/F',
    jsonFormat: '{"q":"","a":"Verdadeiro","options":["Verdadeiro","Falso"]}',
  });
  assert('158b. buildPromptFromFact V/F repo', vfPrompt.includes('Um polvo tem três corações'));
  const okCurRepo = QE.validateQuestion({
    q: 'Um polvo tem três corações. Verdadeiro ou Falso?',
    a: 'Verdadeiro',
    options: ['Verdadeiro', 'Falso'],
  }, {
    ...baseCtx({ categoryNumber: 20, formatId: QE.FORMAT_IDS.CURIOSIDADE, isMC: true }),
    repositoryRecord: { ...curRecord, answer: 'Verdadeiro' },
    helpers: {
      stripTags,
      validateTrueFalseQuestion: () => ({ ok: true, issues: [] }),
      ageBandKey: '10-15',
    },
  });
  assert('159. curiosidade repositório válida', okCurRepo.ok, okCurRepo.issues?.join(', '));
  const badCurRepo = QE.validateQuestion({
    q: 'Um polvo tem três corações. Verdadeiro ou Falso?',
    a: 'Falso',
    options: ['Verdadeiro', 'Falso'],
  }, {
    ...baseCtx({ categoryNumber: 20, formatId: QE.FORMAT_IDS.CURIOSIDADE, isMC: true }),
    repositoryRecord: { ...curRecord, answer: 'Verdadeiro' },
    helpers: {
      stripTags,
      validateTrueFalseQuestion: () => ({ ok: true, issues: [] }),
      ageBandKey: '10-15',
    },
  });
  assert('160. curiosidade repositório mismatch', !badCurRepo.ok);
}

// 161–162. KR-4 — reuse por knowledgeId
{
  const r = QE.validateQuestion({
    q: 'Um polvo tem três corações. Verdadeiro ou Falso?',
    a: 'Verdadeiro',
    options: ['Verdadeiro', 'Falso'],
  }, {
    ...baseCtx({ categoryNumber: 20, formatId: QE.FORMAT_IDS.CURIOSIDADE, isMC: true }),
    usedKnowledgeIds: ['knw-cat20-cur-sample-001'],
    repositoryRecord: { knowledgeId: 'knw-cat20-cur-sample-001', answer: 'Verdadeiro' },
    helpers: {
      stripTags,
      validateTrueFalseQuestion: () => ({ ok: true, issues: [] }),
      ageBandKey: '10-15',
    },
  });
  assert('161. knowledgeId repetido rejeitado', !r.ok && r.issues.some((i) => /knowledgeId|repositório/i.test(i)));
  const slice = QE.getPersistentSlice('10-15');
  assert('162. persistent slice knowledgeIds', Array.isArray(slice.knowledgeIds));
}

console.log(`\nResultado: ${passed} passaram, ${failed} falharam`);
process.exit(failed > 0 ? 1 : 0);
