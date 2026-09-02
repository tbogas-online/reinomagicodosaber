/**
 * Game Stats Adapters — browser bundle.
 * Gerado por scripts/build-game-stats-browser.js — não editar à mão.
 */
(function (global) {
'use strict';
/**
 * Adaptadores — convertem formatos de armazenamento para o Stats Engine.
 * Mantém game-stats-engine.js livre de formatos legacy/Supabase.
 */

const { normalizeGames, DEFAULT_PLAYER_ID, normalizeText } = require('./game-stats-engine');

function fromGameHistory(games, options = {}) {
  const list = Array.isArray(games) ? games : [];
  const defaultPlayerId = options.defaultPlayerId || DEFAULT_PLAYER_ID;
  const defaultNickname = options.defaultNickname || 'Jogador';

  return normalizeGames(list.map((g) => {
    const rounds = (g.rounds || []).map((r) => ({
      round: r.round,
      category: r.category,
      categoryN: r.categoryN != null ? Number(r.categoryN) : null,
      format: r.format,
      difficulty: r.difficulty,
      ageBand: r.ageBand,
      question: r.question,
      correctAnswer: r.correctAnswer,
      options: r.options,
      questionHash: r.questionHash,
      knowledgeId: r.knowledgeId,
      answers: Array.isArray(r.answers) ? r.answers : (
        r.selectedAnswer != null
          ? [{
            playerId: r.playerId || defaultPlayerId,
            nickname: r.nickname || defaultNickname,
            selectedAnswer: r.selectedAnswer,
            correct: r.correct === true,
            responseMs: r.responseMs,
            answeredAt: r.answeredAt,
          }]
          : []
      ),
    }));

    const players = Array.isArray(g.players) && g.players.length
      ? g.players
      : [{ playerId: defaultPlayerId, nickname: defaultNickname }];

    return {
      gameId: g.id || g.gameId,
      mode: g.mode,
      startedAt: g.startedAt,
      finishedAt: g.finishedAt,
      roomCode: g.roomCode,
      roomId: g.roomId,
      players,
      rounds,
    };
  }));
}

function fromSupabaseRows({ matches = [], historyRows = [], players = [] } = {}) {
  const historyByMatch = new Map();
  for (const row of historyRows) {
    const matchId = row.match_id || row.matchId || 'unknown';
    if (!historyByMatch.has(matchId)) historyByMatch.set(matchId, []);
    historyByMatch.get(matchId).push({
      round: row.round_number ?? row.roundNumber,
      category: row.category,
      format: row.format,
      difficulty: row.difficulty,
      ageBand: row.age_band || row.ageBand,
      question: row.question,
      correctAnswer: row.correct_answer || row.correctAnswer,
      options: row.options,
      answers: row.answers || [],
    });
  }

  const playersByRoom = new Map();
  for (const p of players) {
    const roomId = p.room_id || p.roomId;
    if (!roomId) continue;
    if (!playersByRoom.has(roomId)) playersByRoom.set(roomId, []);
    playersByRoom.get(roomId).push({
      playerId: p.player_id || p.playerId,
      nickname: p.nickname,
    });
  }

  const games = matches.map((m) => ({
    gameId: m.id || m.match_id,
    mode: m.mode,
    startedAt: m.started_at || m.startedAt,
    finishedAt: m.finished_at || m.finishedAt,
    roomId: m.room_id || m.roomId,
    players: playersByRoom.get(m.room_id || m.roomId) || [],
    rounds: historyByMatch.get(m.id || m.match_id) || [],
  }));

  return normalizeGames(games);
}

function answerEventToRoundAnswer(ev, nicknamesByPlayer = new Map()) {
  const playerId = ev.player_id || ev.playerId || DEFAULT_PLAYER_ID;
  return {
    playerId,
    nickname: ev.nickname || nicknamesByPlayer.get(playerId) || '',
    selectedAnswer: ev.selected_answer ?? ev.selectedAnswer ?? '',
    correct: ev.correct === true,
    responseMs: ev.response_ms ?? ev.responseMs ?? null,
    answeredAt: ev.answered_at || ev.answeredAt || null,
  };
}

function mergeAnswerEventsIntoGames(games, answerEvents = [], players = []) {
  const nicknamesByPlayer = new Map();
  for (const p of players) {
    const id = p.player_id || p.playerId;
    if (id) nicknamesByPlayer.set(String(id), p.nickname || '');
  }

  const gamesById = new Map(games.map((g) => [g.gameId, g]));
  const roundIndex = new Map();
  for (const game of games) {
    for (const round of game.rounds || []) {
      roundIndex.set(`${game.gameId}:${round.round}`, round);
    }
  }

  for (const ev of answerEvents) {
    const matchId = ev.match_id || ev.matchId;
    if (!matchId) continue;
    const roundNo = Number(ev.round_number ?? ev.roundNumber);
    const key = `${matchId}:${roundNo}`;
    let round = roundIndex.get(key);

    if (!round) {
      let game = gamesById.get(matchId);
      if (!game) {
        game = {
          gameId: matchId,
          mode: ev.mode === 'multiplayer' ? 'multiplayer' : 'single',
          startedAt: ev.answered_at || ev.answeredAt || null,
          finishedAt: null,
          roomId: ev.room_id || ev.roomId || null,
          players: [],
          rounds: [],
        };
        games.push(game);
        gamesById.set(matchId, game);
      }
      round = {
        round: roundNo || (game.rounds.length + 1),
        category: ev.category_n != null ? `Categoria ${ev.category_n}` : '',
        categoryN: ev.category_n ?? ev.categoryN ?? null,
        format: ev.format || '',
        difficulty: null,
        ageBand: ev.age_band || ev.ageBand || '',
        question: ev.question || '',
        correctAnswer: ev.correct_answer || ev.correctAnswer || '',
        options: [],
        answers: [],
      };
      game.rounds.push(round);
      roundIndex.set(`${matchId}:${round.round}`, round);
    }

    if (!Array.isArray(round.answers)) round.answers = [];
    const ans = answerEventToRoundAnswer(ev, nicknamesByPlayer);
    const idx = round.answers.findIndex((a) => a.playerId === ans.playerId);
    if (idx >= 0) round.answers[idx] = ans;
    else round.answers.push(ans);
  }

  return games;
}

function fromSupabasePayload({ matches = [], historyRows = [], answerEvents = [], players = [] } = {}) {
  const games = fromSupabaseRows({ matches, historyRows, players });
  if (!answerEvents?.length) return games;
  return mergeAnswerEventsIntoGames([...games], answerEvents, players);
}

function enrichGamesWithAnswerEvents(games, events, options = {}) {
  const normalized = fromGameHistory(games, options);
  const evs = Array.isArray(events) ? events : [];
  if (!evs.length) return normalized;

  for (const ev of evs) {
    const qKey = normalizeText(ev?.question);
    if (!qKey) continue;
    let attached = false;
    for (const game of normalized) {
      for (const round of game.rounds || []) {
        if (Array.isArray(round.answers) && round.answers.length) continue;
        if (normalizeText(round.question) !== qKey) continue;
        round.answers = [{
          playerId: ev.playerId || options.defaultPlayerId || DEFAULT_PLAYER_ID,
          nickname: ev.nickname || options.defaultNickname || 'Jogador',
          selectedAnswer: ev.selectedAnswer,
          correct: ev.correct === true,
          responseMs: ev.responseMs ?? null,
          answeredAt: ev.ts ? new Date(ev.ts).toISOString() : (ev.answeredAt || undefined),
        }];
        attached = true;
        break;
      }
      if (attached) break;
    }
  }
  return normalized;
}


  global.GameStatsAdapters = {
    fromGameHistory,
    fromSupabaseRows,
    fromSupabasePayload,
    mergeAnswerEventsIntoGames,
    enrichGamesWithAnswerEvents,
  };
})(typeof window !== 'undefined' ? window : global);
