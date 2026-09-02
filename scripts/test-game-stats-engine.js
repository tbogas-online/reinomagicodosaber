#!/usr/bin/env node
/**
 * Testes do Game Stats Engine (V1).
 * Executar: node scripts/test-game-stats-engine.js
 */
'use strict';

const {
  computeAllStats,
  computeMatchInsights,
  computeGlobalInsights,
  computePlayerStats,
  computeCategoryStats,
  computeAgeBandStats,
  computeQuestionDifficulty,
  computeStreaks,
  normalizeGames,
  questionKey,
} = require('./lib/game-stats-engine');
const { fromGameHistory, enrichGamesWithAnswerEvents, fromSupabasePayload } = require('./lib/game-stats-adapters');

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

const mpGame = {
  id: 'game-mp-1',
  mode: 'multiplayer',
  startedAt: '2026-09-02T16:00:00.000Z',
  finishedAt: '2026-09-02T16:18:32.000Z',
  roomCode: 'ABCD',
  players: [
    { playerId: 'p-joao', nickname: 'João', isHost: true },
    { playerId: 'p-maria', nickname: 'Maria' },
    { playerId: 'p-tiago', nickname: 'Tiago' },
  ],
  rounds: [
    {
      round: 1,
      category: '2. Geografia',
      categoryN: 2,
      format: 'ONDE_FICA',
      difficulty: 2,
      ageBand: '10-15',
      question: 'Qual é a capital de Portugal?',
      correctAnswer: 'Lisboa',
      answers: [
        { playerId: 'p-joao', nickname: 'João', selectedAnswer: 'Lisboa', correct: true, responseMs: 3200, answeredAt: '2026-09-02T16:01:00.000Z' },
        { playerId: 'p-maria', nickname: 'Maria', selectedAnswer: 'Lisboa', correct: true, responseMs: 4100, answeredAt: '2026-09-02T16:01:01.000Z' },
        { playerId: 'p-tiago', nickname: 'Tiago', selectedAnswer: 'Porto', correct: false, responseMs: 5000, answeredAt: '2026-09-02T16:01:02.000Z' },
      ],
    },
    {
      round: 2,
      category: '3. História',
      categoryN: 3,
      format: 'QUANDO',
      difficulty: 3,
      ageBand: '10-15',
      question: 'Em que ano foi assinado o Tratado de Tordesilhas?',
      correctAnswer: '1494',
      answers: [
        { playerId: 'p-joao', nickname: 'João', selectedAnswer: '1494', correct: true, responseMs: 6000, answeredAt: '2026-09-02T16:05:00.000Z' },
        { playerId: 'p-maria', nickname: 'Maria', selectedAnswer: '1492', correct: false, responseMs: 7000, answeredAt: '2026-09-02T16:05:01.000Z' },
        { playerId: 'p-tiago', nickname: 'Tiago', selectedAnswer: '1494', correct: true, responseMs: 8000, answeredAt: '2026-09-02T16:05:02.000Z' },
      ],
    },
    {
      round: 12,
      category: '14. Gastronomia',
      categoryN: 14,
      format: 'COMPLETA',
      difficulty: 3,
      ageBand: '15+',
      question: 'Qual é o rio mais longo de Portugal?',
      correctAnswer: 'Tejo',
      answers: [
        { playerId: 'p-joao', nickname: 'João', selectedAnswer: 'Douro', correct: false, responseMs: 7400, answeredAt: '2026-09-02T16:15:00.000Z' },
        { playerId: 'p-maria', nickname: 'Maria', selectedAnswer: 'Tejo', correct: true, responseMs: 5200, answeredAt: '2026-09-02T16:15:01.000Z' },
        { playerId: 'p-tiago', nickname: 'Tiago', selectedAnswer: 'Douro', correct: false, responseMs: 9000, answeredAt: '2026-09-02T16:15:02.000Z' },
      ],
    },
  ],
};

const legacyGame = {
  id: 'game-local-1',
  mode: 'single',
  startedAt: '2026-09-01T10:00:00.000Z',
  finishedAt: '2026-09-01T10:12:00.000Z',
  rounds: [
    {
      round: 1,
      category: '20. Adivinhas',
      format: 'ADIVINHA',
      question: 'Tenho dentes mas não mordo. O que sou?',
      correctAnswer: 'Pente',
    },
  ],
};

console.log('Game Stats Engine — testes V1\n');

assert('questionKey estável', questionKey({ question: 'Olá', correctAnswer: 'Mundo' }) === questionKey({ question: 'Olá', correctAnswer: 'Mundo' }));
assert('oculta jogos sem rondas', normalizeGames([{
  gameId: 'empty-1',
  mode: 'multiplayer',
  startedAt: '2026-09-02T16:00:00.000Z',
  rounds: [],
}]).length === 0);

const games = fromGameHistory([mpGame, legacyGame]);
const all = computeAllStats(games);

assert('meta V1', all.meta.engineVersion === 1 && all.meta.gamesAnalyzed === 2);
assert('summary partidas', all.summary.gamesTotal === 2 && all.summary.roundsTotal === 4);
assert('legacy sem respostas', all.summary.hasAnswerData === true);
assert('global insights no all stats', all.globalInsights?.insights?.length >= 3);
assert('global corpus overview', all.globalInsights.insights.some((i) => i.type === 'corpus_overview'));
assert('global hardest question', all.globalInsights.insights.some((i) => i.type === 'global_hardest_question'));

const joao = computePlayerStats(games, { playerId: 'p-joao' }).players[0];
assert('player João acertos', joao && joao.correctTotal === 2 && joao.answersTotal === 3);
assert('player João precisão', joao.accuracyPct === 66.7);

const cats = computeCategoryStats(games);
assert('category stats', cats.categories.length >= 3);
assert('categoria mais jogada', cats.mostPlayed && cats.mostPlayed.roundsPresented >= 1);

const bands = computeAgeBandStats(games);
assert('age band stats', bands.ageBands.length >= 2);
const band1015 = bands.ageBands.find((b) => b.ageBand === '10-15');
assert('faixa 10-15 respostas', band1015 && band1015.answersTotal === 6);

const diff = computeQuestionDifficulty(games);
const tejo = diff.questions.find((q) => /tejo/i.test(q.question) || /tejo/i.test(q.correctAnswer));
assert('dificuldade Tejo hard', tejo && tejo.difficulty === 'hard' && tejo.accuracyPct === 33.3);
assert('dificuldade inclui resposta', tejo && tejo.correctAnswer === 'Tejo');
assert('dificuldade por faixa', Array.isArray(diff.byAgeBand) && diff.byAgeBand.length >= 2);
const band15Diff = diff.byAgeBand.find((b) => b.ageBand === '15+');
assert('faixa 15+ Tejo', band15Diff && band15Diff.questions.some((q) => q.correctAnswer === 'Tejo'));
const band1015Diff = diff.byAgeBand.find((b) => b.ageBand === '10-15');
assert('faixa 10-15 sem Tejo', band1015Diff && !band1015Diff.questions.some((q) => q.correctAnswer === 'Tejo'));

const streaks = computeStreaks(games, { playerId: 'p-joao' });
assert('streak João', streaks.players[0] && streaks.players[0].bestStreak >= 1);

const insights = computeMatchInsights(games[0]);
assert('insights MP', insights.hasAnswerData && insights.insights.length >= 3);
assert('insight MP label', insights.matchLabel?.mode === 'multiplayer'
  && insights.matchLabel?.name === 'João'
  && insights.matchLabel?.roomCode === 'ABCD'
  && insights.matchLabel?.date);
assert('MP sem ranking por jogador', !insights.insights.some((i) => i.type === 'accuracy_leader' || i.type === 'fastest' || i.type === 'streak'));
assert('MP destaques de sala', insights.insights.some((i) => i.type === 'match_accuracy'));
assert('insight pergunta difícil ou divisão', insights.insights.some((i) => i.type === 'hardest_question' || i.type === 'split_question'));

const legacyOnly = computeMatchInsights(games[1]);
assert('insights legacy informativo', !legacyOnly.hasAnswerData && legacyOnly.insights.length === 1);

const enriched = enrichGamesWithAnswerEvents([legacyGame], [{
  question: legacyGame.rounds[0].question,
  selectedAnswer: 'Pente',
  correct: true,
  responseMs: 2100,
  playerId: 'local',
  ts: Date.parse('2026-09-01T10:02:00.000Z'),
}]);
const enrichedStats = computeAllStats(enriched);
assert('enrich answer events', enrichedStats.summary.answersTotal === 1);

const supabasePayload = fromSupabasePayload({
  matches: [{
    id: 'match-1',
    mode: 'single',
    started_at: '2026-09-01T10:00:00.000Z',
    finished_at: '2026-09-01T10:12:00.000Z',
    room_id: null,
  }],
  historyRows: [],
  answerEvents: [{
    match_id: 'match-1',
    round_number: 1,
    player_id: 'player-1',
    nickname: 'Ana',
    correct: true,
    selected_answer: 'Pente',
    response_ms: 2100,
    question: legacyGame.rounds[0].question,
    correct_answer: 'Pente',
    mode: 'single',
    answered_at: '2026-09-01T10:02:00.000Z',
  }],
  players: [],
});
const supabaseStats = computeAllStats(supabasePayload);
assert('fromSupabasePayload', supabaseStats.summary.answersTotal === 1 && supabaseStats.summary.gamesTotal === 1);

console.log(`\nResultado: ${passed} passaram, ${failed} falharam`);
process.exit(failed > 0 ? 1 : 0);
