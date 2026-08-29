#!/usr/bin/env node
/**
 * Testes do motor de perguntas (question-engine.js).
 * Executar: node scripts/test-question-engine.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const enginePath = path.join(__dirname, '..', 'public', 'question-engine.js');
const code = fs.readFileSync(enginePath, 'utf8');
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
vm.runInContext(code, sandbox);
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

console.log(`\nResultado: ${passed} passaram, ${failed} falharam`);
process.exit(failed > 0 ? 1 : 0);
