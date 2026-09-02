/**
 * Game Stats Engine (V1) — browser bundle.
 * Gerado por scripts/build-game-stats-browser.js — não editar à mão.
 */
(function (global) {
'use strict';
/**
 * Game Stats Engine (V1) — puro: histórico → JSON.
 * Sem dependências de UI, Question Engine ou Supabase.
 *
 * Entrada: array de partidas normalizadas (ver normalizeGames).
 * Saída: playerStats, gameStats, categoryStats, questionStats, streaks, insights.
 */

const DEFAULT_PLAYER_ID = 'local';

function clip(value, max) {
  return String(value ?? '').trim().slice(0, max);
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function questionKey(round) {
  const hash = clip(round?.questionHash, 128);
  if (hash) return hash;
  const q = normalizeText(round?.question);
  const a = normalizeText(round?.correctAnswer);
  return q && a ? `${q}::${a}` : (q || a || 'unknown');
}

function parseCategoryN(round) {
  if (round?.categoryN != null && Number.isFinite(Number(round.categoryN))) {
    return Number(round.categoryN);
  }
  const raw = String(round?.category || '').trim();
  const m = raw.match(/(\d{1,2})/);
  return m ? Number(m[1]) : null;
}

function parseDifficulty(round) {
  const d = Number(round?.difficulty);
  return Number.isFinite(d) ? d : null;
}

function parseTimeMs(iso) {
  const t = Date.parse(iso || '');
  return Number.isFinite(t) ? t : null;
}

function durationMs(game) {
  const start = parseTimeMs(game?.startedAt);
  const end = parseTimeMs(game?.finishedAt);
  if (start == null || end == null || end < start) return null;
  return end - start;
}

function roundAnswers(round) {
  return Array.isArray(round?.answers) ? round.answers : [];
}

function gamePlayers(game) {
  const players = Array.isArray(game?.players) ? game.players : [];
  if (players.length) {
    return players.map((p) => ({
      playerId: clip(p.playerId, 64) || DEFAULT_PLAYER_ID,
      nickname: clip(p.nickname, 64) || '',
    }));
  }
  if (game?.mode === 'multiplayer') return [];
  return [{ playerId: DEFAULT_PLAYER_ID, nickname: 'Jogador' }];
}

function normalizeRound(raw, index) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    round: Number(r.round) || index + 1,
    category: clip(r.category, 120),
    categoryN: parseCategoryN(r),
    format: clip(r.format, 48),
    difficulty: parseDifficulty(r),
    ageBand: clip(r.ageBand || r.age_band, 16),
    question: String(r.question || ''),
    correctAnswer: String(r.correctAnswer || r.correct_answer || ''),
    questionHash: clip(r.questionHash || r.question_hash, 128) || null,
    knowledgeId: clip(r.knowledgeId || r.knowledge_id, 64) || null,
    options: Array.isArray(r.options) ? r.options.map(String) : [],
    answers: roundAnswers(r).map((a) => ({
      playerId: clip(a.playerId, 64) || DEFAULT_PLAYER_ID,
      nickname: clip(a.nickname, 64) || '',
      selectedAnswer: String(a.selectedAnswer || a.selected_answer || ''),
      correct: a.correct === true || a.correct === 'true',
      responseMs: Number.isFinite(Number(a.responseMs)) ? Number(a.responseMs)
        : (Number.isFinite(Number(a.response_ms)) ? Number(a.response_ms) : null),
      answeredAt: a.answeredAt || a.answered_at || null,
    })),
  };
}

function normalizeGame(raw) {
  const g = raw && typeof raw === 'object' ? raw : {};
  const rounds = Array.isArray(g.rounds) ? g.rounds.map(normalizeRound) : [];
  return {
    gameId: clip(g.gameId || g.id, 64) || 'unknown',
    mode: g.mode === 'multiplayer' ? 'multiplayer' : 'single',
    startedAt: g.startedAt || g.started_at || null,
    finishedAt: g.finishedAt || g.finished_at || null,
    roomCode: clip(g.roomCode || g.room_code, 8) || null,
    roomId: clip(g.roomId || g.room_id, 64) || null,
    players: gamePlayers(g),
    rounds,
  };
}

function normalizeGames(input) {
  if (!input) return [];
  const list = Array.isArray(input) ? input : [input];
  return list.map(normalizeGame).filter((g) => g.rounds.length > 0 || g.startedAt);
}

function pct(num, den) {
  if (!den) return null;
  return Math.round((num / den) * 1000) / 10;
}

function difficultyLabel(accuracyPct) {
  if (accuracyPct == null) return 'unknown';
  if (accuracyPct >= 80) return 'easy';
  if (accuracyPct >= 55) return 'medium';
  return 'hard';
}

function collectAnswerEvents(games) {
  const events = [];
  for (const game of games) {
    for (const round of game.rounds) {
      for (const ans of round.answers) {
        events.push({
          gameId: game.gameId,
          mode: game.mode,
          round: round.round,
          category: round.category,
          categoryN: round.categoryN,
          format: round.format,
          difficulty: round.difficulty,
          ageBand: round.ageBand,
          questionKey: questionKey(round),
          question: round.question,
          correctAnswer: round.correctAnswer,
          knowledgeId: round.knowledgeId,
          playerId: ans.playerId,
          nickname: ans.nickname,
          selectedAnswer: ans.selectedAnswer,
          correct: ans.correct,
          responseMs: ans.responseMs,
          answeredAt: ans.answeredAt || game.startedAt,
        });
      }
    }
  }
  return events;
}

function computeGameStats(game) {
  const g = normalizeGame(game);
  const events = collectAnswerEvents([g]);
  const answered = events.length;
  const correct = events.filter((e) => e.correct).length;
  const durations = events.map((e) => e.responseMs).filter((n) => n != null && n >= 0);
  const avgResponseMs = durations.length
    ? Math.round(durations.reduce((s, n) => s + n, 0) / durations.length)
    : null;

  return {
    gameId: g.gameId,
    mode: g.mode,
    startedAt: g.startedAt,
    finishedAt: g.finishedAt,
    durationMs: durationMs(g),
    roundsTotal: g.rounds.length,
    players: g.players,
    answersTotal: answered,
    correctTotal: correct,
    wrongTotal: answered - correct,
    accuracyPct: pct(correct, answered),
    avgResponseMs,
    hasAnswerData: answered > 0,
  };
}

function computeGamesSummary(games) {
  const normalized = normalizeGames(games);
  const perGame = normalized.map(computeGameStats);
  const events = collectAnswerEvents(normalized);
  const correct = events.filter((e) => e.correct).length;

  return {
    gamesTotal: normalized.length,
    roundsTotal: normalized.reduce((s, g) => s + g.rounds.length, 0),
    singleGames: normalized.filter((g) => g.mode === 'single').length,
    multiplayerGames: normalized.filter((g) => g.mode === 'multiplayer').length,
    answersTotal: events.length,
    correctTotal: correct,
    wrongTotal: events.length - correct,
    accuracyPct: pct(correct, events.length),
    avgRoundsPerGame: normalized.length
      ? Math.round((normalized.reduce((s, g) => s + g.rounds.length, 0) / normalized.length) * 10) / 10
      : 0,
    avgDurationMs: (() => {
      const ds = perGame.map((g) => g.durationMs).filter((n) => n != null);
      return ds.length ? Math.round(ds.reduce((s, n) => s + n, 0) / ds.length) : null;
    })(),
    hasAnswerData: events.length > 0,
    games: perGame,
  };
}

function computePlayerStats(games, options = {}) {
  const normalized = normalizeGames(games);
  const events = collectAnswerEvents(normalized);
  const filterId = options.playerId ? clip(options.playerId, 64) : null;

  const byPlayer = new Map();
  for (const ev of events) {
    if (filterId && ev.playerId !== filterId) continue;
    if (!byPlayer.has(ev.playerId)) {
      byPlayer.set(ev.playerId, {
        playerId: ev.playerId,
        nickname: ev.nickname || '',
        gamesPlayed: new Set(),
        answersTotal: 0,
        correctTotal: 0,
        responseMs: [],
        byCategory: new Map(),
      });
    }
    const p = byPlayer.get(ev.playerId);
    p.gamesPlayed.add(ev.gameId);
    p.answersTotal += 1;
    if (ev.correct) p.correctTotal += 1;
    if (ev.responseMs != null) p.responseMs.push(ev.responseMs);
    if (!p.nickname && ev.nickname) p.nickname = ev.nickname;

    const catKey = ev.categoryN != null ? String(ev.categoryN) : (ev.category || 'unknown');
    if (!p.byCategory.has(catKey)) {
      p.byCategory.set(catKey, { category: ev.category, categoryN: ev.categoryN, answers: 0, correct: 0 });
    }
    const cat = p.byCategory.get(catKey);
    cat.answers += 1;
    if (ev.correct) cat.correct += 1;
  }

  const players = [...byPlayer.values()].map((p) => {
    const categories = [...p.byCategory.values()].map((c) => ({
      category: c.category,
      categoryN: c.categoryN,
      answersTotal: c.answers,
      correctTotal: c.correct,
      accuracyPct: pct(c.correct, c.answers),
    })).sort((a, b) => b.answersTotal - a.answersTotal);

    const best = categories.reduce((bestSoFar, c) => {
      if (!c.answersTotal) return bestSoFar;
      if (!bestSoFar || (c.accuracyPct ?? 0) > (bestSoFar.accuracyPct ?? 0)) return c;
      return bestSoFar;
    }, null);

    const worst = categories.reduce((worstSoFar, c) => {
      if (!c.answersTotal || c.answersTotal < 2) return worstSoFar;
      if (!worstSoFar || (c.accuracyPct ?? 100) < (worstSoFar.accuracyPct ?? 100)) return c;
      return worstSoFar;
    }, null);

    const avgResponseMs = p.responseMs.length
      ? Math.round(p.responseMs.reduce((s, n) => s + n, 0) / p.responseMs.length)
      : null;

    return {
      playerId: p.playerId,
      nickname: p.nickname,
      gamesPlayed: p.gamesPlayed.size,
      answersTotal: p.answersTotal,
      correctTotal: p.correctTotal,
      wrongTotal: p.answersTotal - p.correctTotal,
      accuracyPct: pct(p.correctTotal, p.answersTotal),
      avgResponseMs,
      bestCategory: best,
      worstCategory: worst,
      byCategory: categories,
    };
  }).sort((a, b) => b.answersTotal - a.answersTotal);

  return {
    hasAnswerData: events.length > 0,
    players,
  };
}

function computeCategoryStats(games) {
  const normalized = normalizeGames(games);
  const events = collectAnswerEvents(normalized);
  const byCat = new Map();

  for (const game of normalized) {
    for (const round of game.rounds) {
      const key = round.categoryN != null ? `n:${round.categoryN}` : `t:${round.category || 'unknown'}`;
      if (!byCat.has(key)) {
        byCat.set(key, {
          category: round.category,
          categoryN: round.categoryN,
          roundsPresented: 0,
          answersTotal: 0,
          correctTotal: 0,
          formats: new Map(),
        });
      }
      const cat = byCat.get(key);
      cat.roundsPresented += 1;
      if (round.format) {
        cat.formats.set(round.format, (cat.formats.get(round.format) || 0) + 1);
      }
    }
  }

  for (const ev of events) {
    const key = ev.categoryN != null ? `n:${ev.categoryN}` : `t:${ev.category || 'unknown'}`;
    if (!byCat.has(key)) continue;
    const cat = byCat.get(key);
    cat.answersTotal += 1;
    if (ev.correct) cat.correctTotal += 1;
  }

  const categories = [...byCat.values()].map((c) => ({
    category: c.category,
    categoryN: c.categoryN,
    roundsPresented: c.roundsPresented,
    answersTotal: c.answersTotal,
    correctTotal: c.correctTotal,
    wrongTotal: c.answersTotal - c.correctTotal,
    accuracyPct: pct(c.correctTotal, c.answersTotal),
    topFormats: [...c.formats.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([format, count]) => ({ format, count })),
  })).sort((a, b) => b.roundsPresented - a.roundsPresented);

  const mostPlayed = categories[0] || null;
  const withAnswers = categories.filter((c) => c.answersTotal >= 3);
  const best = withAnswers.reduce((a, c) => (!a || (c.accuracyPct ?? 0) > (a.accuracyPct ?? 0) ? c : a), null);
  const worst = withAnswers.reduce((a, c) => (!a || (c.accuracyPct ?? 100) < (a.accuracyPct ?? 100) ? c : a), null);

  return {
    hasAnswerData: events.length > 0,
    categories,
    mostPlayed,
    bestAccuracy: best,
    worstAccuracy: worst,
  };
}

function computeQuestionStats(games) {
  const normalized = normalizeGames(games);
  const events = collectAnswerEvents(normalized);
  const presented = new Map();
  const answered = new Map();

  for (const game of normalized) {
    for (const round of game.rounds) {
      const key = questionKey(round);
      if (!presented.has(key)) {
        presented.set(key, {
          questionKey: key,
          question: round.question,
          correctAnswer: round.correctAnswer,
          category: round.category,
          categoryN: round.categoryN,
          format: round.format,
          knowledgeId: round.knowledgeId,
          timesPresented: 0,
        });
      }
      presented.get(key).timesPresented += 1;
    }
  }

  for (const ev of events) {
    if (!answered.has(ev.questionKey)) {
      answered.set(ev.questionKey, {
        answersTotal: 0,
        correctTotal: 0,
        wrongAnswers: new Map(),
        responseMs: [],
      });
    }
    const q = answered.get(ev.questionKey);
    q.answersTotal += 1;
    if (ev.correct) q.correctTotal += 1;
    else {
      const w = clip(ev.selectedAnswer, 120) || '(vazio)';
      q.wrongAnswers.set(w, (q.wrongAnswers.get(w) || 0) + 1);
    }
    if (ev.responseMs != null) q.responseMs.push(ev.responseMs);
  }

  const questions = [...presented.values()].map((p) => {
    const a = answered.get(p.questionKey);
    const wrongTop = a
      ? [...a.wrongAnswers.entries()].sort((x, y) => y[1] - x[1]).slice(0, 5)
        .map(([answer, count]) => ({ answer, count }))
      : [];
    const accuracyPct = a ? pct(a.correctTotal, a.answersTotal) : null;
    const avgResponseMs = a && a.responseMs.length
      ? Math.round(a.responseMs.reduce((s, n) => s + n, 0) / a.responseMs.length)
      : null;

    return {
      ...p,
      answersTotal: a?.answersTotal || 0,
      correctTotal: a?.correctTotal || 0,
      wrongTotal: a ? a.answersTotal - a.correctTotal : 0,
      accuracyPct,
      avgResponseMs,
      difficulty: difficultyLabel(accuracyPct),
      topWrongAnswers: wrongTop,
    };
  }).sort((a, b) => b.timesPresented - a.timesPresented || (b.answersTotal - a.answersTotal));

  return {
    hasAnswerData: events.length > 0,
    questions,
    hardest: questions.filter((q) => q.answersTotal >= 3)
      .sort((a, b) => (a.accuracyPct ?? 100) - (b.accuracyPct ?? 100))[0] || null,
    easiest: questions.filter((q) => q.answersTotal >= 3)
      .sort((a, b) => (b.accuracyPct ?? 0) - (a.accuracyPct ?? 0))[0] || null,
  };
}

function computeQuestionDifficulty(games) {
  const qs = computeQuestionStats(games);
  return {
    hasAnswerData: qs.hasAnswerData,
    questions: qs.questions.map((q) => ({
      questionKey: q.questionKey,
      question: q.question,
      correctAnswer: q.correctAnswer,
      categoryN: q.categoryN,
      timesPresented: q.timesPresented,
      answersTotal: q.answersTotal,
      accuracyPct: q.accuracyPct,
      difficulty: q.difficulty,
      avgResponseMs: q.avgResponseMs,
    })),
    hardest: qs.hardest,
    easiest: qs.easiest,
  };
}

function computeStreaksForEvents(events) {
  const sorted = [...events].sort((a, b) => {
    const ta = parseTimeMs(a.answeredAt) || 0;
    const tb = parseTimeMs(b.answeredAt) || 0;
    return ta - tb || String(a.gameId).localeCompare(String(b.gameId)) || a.round - b.round;
  });

  let current = 0;
  let best = 0;
  for (const ev of sorted) {
    if (ev.correct) {
      current += 1;
      if (current > best) best = current;
    } else {
      current = 0;
    }
  }
  return { currentStreak: current, bestStreak: best };
}

function computeStreaks(games, options = {}) {
  const normalized = normalizeGames(games);
  const events = collectAnswerEvents(normalized);
  const filterId = options.playerId ? clip(options.playerId, 64) : null;
  const byPlayer = new Map();

  for (const ev of events) {
    if (filterId && ev.playerId !== filterId) continue;
    if (!byPlayer.has(ev.playerId)) byPlayer.set(ev.playerId, []);
    byPlayer.get(ev.playerId).push(ev);
  }

  const players = [...byPlayer.entries()].map(([playerId, evs]) => ({
    playerId,
    nickname: evs.find((e) => e.nickname)?.nickname || '',
    ...computeStreaksForEvents(evs),
  })).sort((a, b) => b.bestStreak - a.bestStreak);

  return {
    hasAnswerData: events.length > 0,
    players,
    globalBest: players.reduce((m, p) => Math.max(m, p.bestStreak), 0),
  };
}

function buildInsight(type, message, detail = {}) {
  return { type, message, ...detail };
}

function computeMatchInsights(game) {
  const g = normalizeGame(game);
  const gameStat = computeGameStats(g);
  const events = collectAnswerEvents([g]);
  const insights = [];

  if (!events.length) {
    insights.push(buildInsight('info', 'Sem dados de respostas nesta partida — apenas rondas registadas.', {
      roundsTotal: g.rounds.length,
    }));
    return { gameId: g.gameId, hasAnswerData: false, insights, game: gameStat };
  }

  const players = computePlayerStats([g]).players;
  if (players.length) {
    const top = players[0];
    const name = top.nickname || top.playerId;
    if (top.accuracyPct != null) {
      insights.push(buildInsight('accuracy_leader', `${name} teve a melhor precisão (${top.accuracyPct}%).`, {
        playerId: top.playerId,
        accuracyPct: top.accuracyPct,
      }));
    }
    const fastest = [...players].filter((p) => p.avgResponseMs != null).sort((a, b) => a.avgResponseMs - b.avgResponseMs)[0];
    if (fastest) {
      const fastName = fastest.nickname || fastest.playerId;
      insights.push(buildInsight('fastest', `${fastName} foi o mais rápido (${(fastest.avgResponseMs / 1000).toFixed(1)} s de média).`, {
        playerId: fastest.playerId,
        avgResponseMs: fastest.avgResponseMs,
      }));
    }
    const bestCat = players
      .map((p) => ({ player: p, cat: p.bestCategory }))
      .filter((x) => x.cat && x.cat.answersTotal >= 2)
      .sort((a, b) => (b.cat.accuracyPct ?? 0) - (a.cat.accuracyPct ?? 0))[0];
    if (bestCat) {
      const catLabel = bestCat.cat.category || `Categoria ${bestCat.cat.categoryN}`;
      const pname = bestCat.player.nickname || bestCat.player.playerId;
      insights.push(buildInsight('category_dominance', `${pname} dominou ${catLabel} (${bestCat.cat.accuracyPct}% de acerto).`, {
        playerId: bestCat.player.playerId,
        category: bestCat.cat.category,
        categoryN: bestCat.cat.categoryN,
      }));
    }
  }

  const streaks = computeStreaks([g]).players;
  const bestStreakPlayer = streaks[0];
  if (bestStreakPlayer && bestStreakPlayer.bestStreak >= 2) {
    const sname = bestStreakPlayer.nickname || bestStreakPlayer.playerId;
    insights.push(buildInsight('streak', `${sname} teve a maior recuperação (${bestStreakPlayer.bestStreak} respostas certas seguidas).`, {
      playerId: bestStreakPlayer.playerId,
      bestStreak: bestStreakPlayer.bestStreak,
    }));
  }

  const byRound = new Map();
  for (const ev of events) {
    if (!byRound.has(ev.round)) byRound.set(ev.round, []);
    byRound.get(ev.round).push(ev);
  }

  let hardestRound = null;
  let splitRound = null;
  for (const [round, evs] of byRound.entries()) {
    const correct = evs.filter((e) => e.correct).length;
    const acc = pct(correct, evs.length);
    const sample = evs[0];
    if (!hardestRound || (acc ?? 100) < (hardestRound.accuracyPct ?? 100)) {
      hardestRound = { round, accuracyPct: acc, question: sample.question, answers: evs.length };
    }
    if (evs.length >= 2) {
      const half = Math.abs(correct - (evs.length - correct)) <= 1;
      if (half && (!splitRound || evs.length > splitRound.answers)) {
        splitRound = { round, correct, wrong: evs.length - correct, question: sample.question, answers: evs.length };
      }
    }
  }

  if (hardestRound && hardestRound.answers >= 2) {
    insights.push(buildInsight('hardest_question', `A pergunta ${hardestRound.round} foi a mais difícil (${hardestRound.accuracyPct}% acertaram).`, {
      round: hardestRound.round,
      accuracyPct: hardestRound.accuracyPct,
      question: hardestRound.question,
    }));
  }

  if (splitRound) {
    insights.push(buildInsight('split_question', `A pergunta ${splitRound.round} dividiu os jogadores (${splitRound.correct} acertaram, ${splitRound.wrong} erraram).`, {
      round: splitRound.round,
      question: splitRound.question,
    }));
  }

  return {
    gameId: g.gameId,
    hasAnswerData: true,
    insights,
    game: gameStat,
  };
}

function computeAllStats(games, options = {}) {
  const normalized = normalizeGames(games);
  const events = collectAnswerEvents(normalized);

  return {
    meta: {
      engineVersion: 1,
      gamesAnalyzed: normalized.length,
      hasAnswerData: events.length > 0,
      generatedAt: new Date().toISOString(),
    },
    summary: computeGamesSummary(normalized),
    players: computePlayerStats(normalized, options),
    categories: computeCategoryStats(normalized),
    questions: computeQuestionStats(normalized),
    difficulty: computeQuestionDifficulty(normalized),
    streaks: computeStreaks(normalized, options),
    matchInsights: options.gameId
      ? computeMatchInsights(normalized.find((g) => g.gameId === options.gameId) || normalized[0])
      : normalized.map((g) => computeMatchInsights(g)),
  };
}


  global.GameStatsEngine = {
    DEFAULT_PLAYER_ID,
    normalizeText,
    questionKey,
    normalizeRound,
    normalizeGame,
    normalizeGames,
    computeGameStats,
    computeGamesSummary,
    computePlayerStats,
    computeCategoryStats,
    computeQuestionStats,
    computeQuestionDifficulty,
    computeStreaks,
    computeMatchInsights,
    computeAllStats
  };
})(typeof window !== 'undefined' ? window : global);
