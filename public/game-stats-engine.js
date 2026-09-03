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
      playerId: clip(p.playerId || p.player_id, 64) || DEFAULT_PLAYER_ID,
      nickname: clip(p.nickname, 64) || '',
      isHost: p.isHost === true || p.is_host === true,
    }));
  }
  if (game?.mode === 'multiplayer') return [];
  return [{ playerId: DEFAULT_PLAYER_ID, nickname: 'Jogador', isHost: true }];
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
    sessionName: clip(g.sessionName || g.session_name, 64) || null,
    players: gamePlayers(g),
    rounds,
  };
}

function normalizeGames(input) {
  if (!input) return [];
  const list = Array.isArray(input) ? input : [input];
  return list.map(normalizeGame).filter((g) => g.rounds.length > 0);
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

function filterEventsForScope(events, options = {}) {
  if (!options.singlePlayerOnly) return events;
  return events.filter((ev) => ev.mode !== 'multiplayer');
}

function computePlayerStats(games, options = {}) {
  const normalized = normalizeGames(games);
  const events = filterEventsForScope(collectAnswerEvents(normalized), options);
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

const AGE_BAND_ORDER = ['6-9', '10-15', '15+'];

function normalizeAgeBandKey(ageBand) {
  const raw = clip(ageBand, 16);
  if (!raw) return '—';
  if (AGE_BAND_ORDER.includes(raw)) return raw;
  return raw;
}

function ageBandSortIndex(ageBand) {
  const key = normalizeAgeBandKey(ageBand);
  const idx = AGE_BAND_ORDER.indexOf(key);
  return idx >= 0 ? idx : AGE_BAND_ORDER.length;
}

function computeAgeBandStats(games) {
  const normalized = normalizeGames(games);
  const events = collectAnswerEvents(normalized);
  const byBand = new Map();

  for (const game of normalized) {
    for (const round of game.rounds) {
      const key = normalizeAgeBandKey(round.ageBand);
      if (!byBand.has(key)) {
        byBand.set(key, {
          ageBand: key,
          roundsPresented: 0,
          answersTotal: 0,
          correctTotal: 0,
          responseMs: [],
        });
      }
      byBand.get(key).roundsPresented += 1;
    }
  }

  for (const ev of events) {
    const key = normalizeAgeBandKey(ev.ageBand);
    if (!byBand.has(key)) {
      byBand.set(key, {
        ageBand: key,
        roundsPresented: 0,
        answersTotal: 0,
        correctTotal: 0,
        responseMs: [],
      });
    }
    const band = byBand.get(key);
    band.answersTotal += 1;
    if (ev.correct) band.correctTotal += 1;
    if (ev.responseMs != null && ev.responseMs >= 0) band.responseMs.push(ev.responseMs);
  }

  const ageBands = [...byBand.values()].map((b) => {
    const avgResponseMs = b.responseMs.length
      ? Math.round(b.responseMs.reduce((s, n) => s + n, 0) / b.responseMs.length)
      : null;
    return {
      ageBand: b.ageBand,
      roundsPresented: b.roundsPresented,
      answersTotal: b.answersTotal,
      correctTotal: b.correctTotal,
      wrongTotal: b.answersTotal - b.correctTotal,
      accuracyPct: pct(b.correctTotal, b.answersTotal),
      avgResponseMs,
    };
  }).sort((a, b) => ageBandSortIndex(a.ageBand) - ageBandSortIndex(b.ageBand));

  const withAnswers = ageBands.filter((b) => b.answersTotal >= 3);
  const best = withAnswers.reduce((a, b) => (!a || (b.accuracyPct ?? 0) > (a.accuracyPct ?? 0) ? b : a), null);
  const worst = withAnswers.reduce((a, b) => (!a || (b.accuracyPct ?? 100) < (a.accuracyPct ?? 100) ? b : a), null);

  return {
    hasAnswerData: events.length > 0,
    ageBands,
    mostPlayed: ageBands.reduce((a, b) => (!a || b.roundsPresented > a.roundsPresented ? b : a), null),
    bestAccuracy: best,
    worstAccuracy: worst,
  };
}

function computeQuestionStats(games, options = {}) {
  const filterAgeBand = options.ageBand ? normalizeAgeBandKey(options.ageBand) : null;
  const normalized = normalizeGames(games);
  const events = collectAnswerEvents(normalized).filter((ev) => (
    !filterAgeBand || normalizeAgeBandKey(ev.ageBand) === filterAgeBand
  ));
  const presented = new Map();
  const answered = new Map();

  for (const game of normalized) {
    for (const round of game.rounds) {
      if (filterAgeBand && normalizeAgeBandKey(round.ageBand) !== filterAgeBand) continue;
      const key = questionKey(round);
      if (!presented.has(key)) {
        presented.set(key, {
          questionKey: key,
          question: round.question,
          correctAnswer: round.correctAnswer,
          category: round.category,
          categoryN: round.categoryN,
          format: round.format,
          ageBand: normalizeAgeBandKey(round.ageBand),
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
    ageBand: filterAgeBand,
    hasAnswerData: events.length > 0,
    questions,
    hardest: questions.filter((q) => q.answersTotal >= 3)
      .sort((a, b) => (a.accuracyPct ?? 100) - (b.accuracyPct ?? 100))[0] || null,
    easiest: questions.filter((q) => q.answersTotal >= 3)
      .sort((a, b) => (b.accuracyPct ?? 0) - (a.accuracyPct ?? 0))[0] || null,
  };
}

function mapQuestionDifficultyRow(q) {
  return {
    questionKey: q.questionKey,
    question: q.question,
    correctAnswer: q.correctAnswer,
    category: q.category,
    categoryN: q.categoryN,
    ageBand: q.ageBand,
    timesPresented: q.timesPresented,
    answersTotal: q.answersTotal,
    accuracyPct: q.accuracyPct,
    difficulty: q.difficulty,
    avgResponseMs: q.avgResponseMs,
    topWrongAnswers: q.topWrongAnswers,
  };
}

function collectAgeBandKeys(games) {
  const keys = new Set();
  for (const game of normalizeGames(games)) {
    for (const round of game.rounds) {
      keys.add(normalizeAgeBandKey(round.ageBand));
    }
    for (const ev of collectAnswerEvents([game])) {
      keys.add(normalizeAgeBandKey(ev.ageBand));
    }
  }
  return [...keys].sort((a, b) => ageBandSortIndex(a) - ageBandSortIndex(b));
}

function computeQuestionDifficulty(games) {
  const qs = computeQuestionStats(games);
  const byAgeBand = collectAgeBandKeys(games).map((ageBand) => {
    const bandQs = computeQuestionStats(games, { ageBand });
    const questions = bandQs.questions
      .filter((q) => (q.answersTotal || 0) >= 1)
      .sort((a, b) => (a.accuracyPct ?? 100) - (b.accuracyPct ?? 100));
    return {
      ageBand,
      questions: questions.map(mapQuestionDifficultyRow),
      hardest: bandQs.hardest ? mapQuestionDifficultyRow(bandQs.hardest) : null,
    };
  }).filter((b) => b.questions.length > 0);
  return {
    hasAnswerData: qs.hasAnswerData,
    questions: qs.questions.map(mapQuestionDifficultyRow),
    hardest: qs.hardest ? mapQuestionDifficultyRow(qs.hardest) : null,
    easiest: qs.easiest ? mapQuestionDifficultyRow(qs.easiest) : null,
    byAgeBand,
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
  const events = filterEventsForScope(collectAnswerEvents(normalized), options);
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

function buildPlayerNicknameMap(game) {
  const g = normalizeGame(game);
  const map = new Map();
  for (const p of g.players) {
    const id = String(p.playerId || '').trim();
    const nick = String(p.nickname || '').trim();
    if (id && nick) map.set(id, nick);
  }
  for (const ev of collectAnswerEvents([g])) {
    const id = String(ev.playerId || '').trim();
    const nick = String(ev.nickname || '').trim();
    if (id && nick && !map.get(id)) map.set(id, nick);
  }
  return map;
}

function resolvePlayerDisplayName(playerId, nickname, nickMap) {
  const rawNick = String(nickname || nickMap?.get(String(playerId || '')) || '').trim();
  const nick = (rawNick && rawNick !== '{}' && rawNick !== '[object Object]') ? rawNick : '';
  if (nick) return nick;
  const id = String(playerId || '').trim();
  if (id.length >= 4) return `Jogador ${id.slice(-4).toUpperCase()}`;
  return 'Jogador';
}

function formatGameDateLabel(iso) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString('pt-PT', {
    timeZone: 'Europe/Lisbon',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatMatchLabel(game) {
  const g = normalizeGame(game);
  const date = formatGameDateLabel(g.startedAt);
  if (g.mode === 'multiplayer') {
    const host = g.players.find((p) => p.isHost) || g.players[0];
    const name = host?.nickname || host?.playerId || 'Multijogador';
    const roomCode = g.roomCode ? String(g.roomCode).trim().toUpperCase() : null;
    const titleParts = [name];
    if (roomCode) titleParts.push(`Sala ${roomCode}`);
    if (date) titleParts.push(date);
    return {
      mode: 'multiplayer',
      name,
      date,
      roomCode,
      title: titleParts.join(' · '),
    };
  }
  const name = g.sessionName || 'Individual';
  const titleParts = [name];
  if (date) titleParts.push(date);
  return {
    mode: 'single',
    name,
    date,
    roomCode: null,
    title: titleParts.join(' · '),
  };
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
    return { gameId: g.gameId, mode: g.mode, matchLabel: formatMatchLabel(g), hasAnswerData: false, insights, game: gameStat };
  }

  const players = computePlayerStats([g]).players;
  const nickMap = buildPlayerNicknameMap(g);
  const isMultiplayer = g.mode === 'multiplayer';

  if (isMultiplayer) {
    if (gameStat.accuracyPct != null && gameStat.answersTotal > 0) {
      insights.push(buildInsight('match_accuracy', `A sala teve ${gameStat.accuracyPct}% de precisão (${gameStat.correctTotal} de ${gameStat.answersTotal} acertos).`, {
        accuracyPct: gameStat.accuracyPct,
        answersTotal: gameStat.answersTotal,
        correctTotal: gameStat.correctTotal,
      }));
    }
    if (gameStat.avgResponseMs != null) {
      insights.push(buildInsight('match_pace', `Tempo médio de resposta na sala: ${(gameStat.avgResponseMs / 1000).toFixed(1)} s.`, {
        avgResponseMs: gameStat.avgResponseMs,
      }));
    }
    const deviceCount = new Set(events.map((ev) => ev.playerId).filter(Boolean)).size;
    if (deviceCount > 0) {
      const label = deviceCount === 1 ? '1 dispositivo registou respostas' : `${deviceCount} dispositivos registaram respostas`;
      insights.push(buildInsight('match_devices', `${label} nesta partida (vários jogadores reais podem partilhar o mesmo dispositivo).`, {
        deviceCount,
      }));
    }
  } else if (players.length) {
    const top = players[0];
    const name = resolvePlayerDisplayName(top.playerId, top.nickname, nickMap);
    if (top.accuracyPct != null) {
      insights.push(buildInsight('accuracy_leader', `${name} teve a melhor precisão (${top.accuracyPct}%).`, {
        playerId: top.playerId,
        playerName: name,
        accuracyPct: top.accuracyPct,
      }));
    }
    const fastest = [...players].filter((p) => p.avgResponseMs != null).sort((a, b) => a.avgResponseMs - b.avgResponseMs)[0];
    if (fastest) {
      const fastName = resolvePlayerDisplayName(fastest.playerId, fastest.nickname, nickMap);
      insights.push(buildInsight('fastest', `${fastName} foi o mais rápido (${(fastest.avgResponseMs / 1000).toFixed(1)} s de média).`, {
        playerId: fastest.playerId,
        playerName: fastName,
        avgResponseMs: fastest.avgResponseMs,
      }));
    }
    const bestCat = players
      .map((p) => ({ player: p, cat: p.bestCategory }))
      .filter((x) => x.cat && x.cat.answersTotal >= 2)
      .sort((a, b) => (b.cat.accuracyPct ?? 0) - (a.cat.accuracyPct ?? 0))[0];
    if (bestCat) {
      const catLabel = bestCat.cat.category || `Categoria ${bestCat.cat.categoryN}`;
      const pname = resolvePlayerDisplayName(bestCat.player.playerId, bestCat.player.nickname, nickMap);
      insights.push(buildInsight('category_dominance', `${pname} dominou ${catLabel} (${bestCat.cat.accuracyPct}% de acerto).`, {
        playerId: bestCat.player.playerId,
        playerName: pname,
        category: bestCat.cat.category,
        categoryN: bestCat.cat.categoryN,
      }));
    }
  }

  if (!isMultiplayer) {
  const streaks = computeStreaks([g]).players;
  const bestStreakPlayer = streaks[0];
  if (bestStreakPlayer && bestStreakPlayer.bestStreak >= 2) {
    const sname = resolvePlayerDisplayName(bestStreakPlayer.playerId, bestStreakPlayer.nickname, nickMap);
    insights.push(buildInsight('streak', `${sname} teve a maior recuperação (${bestStreakPlayer.bestStreak} respostas certas seguidas).`, {
      playerId: bestStreakPlayer.playerId,
      playerName: sname,
      bestStreak: bestStreakPlayer.bestStreak,
    }));
  }
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
    mode: g.mode,
    matchLabel: formatMatchLabel(g),
    hasAnswerData: true,
    insights,
    game: gameStat,
  };
}

function categoryLabel(cat) {
  if (!cat) return 'Categoria';
  return cat.category || (cat.categoryN != null ? `Categoria ${cat.categoryN}` : 'Categoria');
}

function computeGlobalInsights(games) {
  const normalized = normalizeGames(games);
  const summary = computeGamesSummary(normalized);
  const insights = [];

  if (!summary.gamesTotal) {
    insights.push(buildInsight('info', 'Sem partidas no histórico analisado.', {}));
    return { hasAnswerData: false, insights, summary };
  }

  if (!summary.hasAnswerData) {
    insights.push(buildInsight('info', `${summary.gamesTotal} partida(s) no histórico — ainda sem respostas registadas.`, {
      gamesTotal: summary.gamesTotal,
      roundsTotal: summary.roundsTotal,
    }));
    return { hasAnswerData: false, insights, summary };
  }

  insights.push(buildInsight('corpus_overview', `${summary.gamesTotal} partida(s), ${summary.answersTotal} respostas e ${summary.accuracyPct}% de precisão global.`, {
    gamesTotal: summary.gamesTotal,
    answersTotal: summary.answersTotal,
    accuracyPct: summary.accuracyPct,
    correctTotal: summary.correctTotal,
  }));

  const modeParts = [];
  if (summary.singleGames) modeParts.push(`${summary.singleGames} individual`);
  if (summary.multiplayerGames) modeParts.push(`${summary.multiplayerGames} multijogador`);
  if (modeParts.length) {
    insights.push(buildInsight('games_split', `Distribuição: ${modeParts.join(' · ')}.`, {
      singleGames: summary.singleGames,
      multiplayerGames: summary.multiplayerGames,
    }));
  }

  const events = collectAnswerEvents(normalized);
  const durations = events.map((e) => e.responseMs).filter((n) => n != null && n >= 0);
  if (durations.length) {
    const avgResponseMs = Math.round(durations.reduce((s, n) => s + n, 0) / durations.length);
    insights.push(buildInsight('global_pace', `Tempo médio de resposta em todo o histórico: ${(avgResponseMs / 1000).toFixed(1)} s.`, {
      avgResponseMs,
    }));
  }

  const diff = computeQuestionDifficulty(normalized);
  const rankedQuestions = (diff.questions || [])
    .filter((q) => (q.answersTotal || 0) >= 3)
    .sort((a, b) => (a.accuracyPct ?? 100) - (b.accuracyPct ?? 100));
  const hardest = rankedQuestions[0];
  if (hardest) {
    insights.push(buildInsight('global_hardest_question', `Pergunta mais difícil (${hardest.accuracyPct}% de acerto em ${hardest.answersTotal} respostas).`, {
      question: hardest.question,
      correctAnswer: hardest.correctAnswer,
      accuracyPct: hardest.accuracyPct,
      answersTotal: hardest.answersTotal,
    }));
  }
  const easiest = rankedQuestions[rankedQuestions.length - 1];
  if (easiest && easiest.questionKey !== hardest?.questionKey) {
    insights.push(buildInsight('global_easiest_question', `Pergunta mais fácil (${easiest.accuracyPct}% de acerto em ${easiest.answersTotal} respostas).`, {
      question: easiest.question,
      correctAnswer: easiest.correctAnswer,
      accuracyPct: easiest.accuracyPct,
      answersTotal: easiest.answersTotal,
    }));
  }

  const cats = computeCategoryStats(normalized);
  if (cats.mostPlayed) {
    const c = cats.mostPlayed;
    insights.push(buildInsight('top_category', `${categoryLabel(c)} foi a categoria mais jogada (${c.answersTotal} respostas, ${c.accuracyPct}% de precisão).`, {
      category: c.category,
      categoryN: c.categoryN,
      answersTotal: c.answersTotal,
      accuracyPct: c.accuracyPct,
    }));
  }
  if (cats.worstAccuracy && (cats.worstAccuracy.answersTotal || 0) >= 5
    && cats.worstAccuracy.categoryN !== cats.mostPlayed?.categoryN) {
    const c = cats.worstAccuracy;
    insights.push(buildInsight('weakest_category', `${categoryLabel(c)} teve a menor precisão (${c.accuracyPct}% em ${c.answersTotal} respostas).`, {
      category: c.category,
      categoryN: c.categoryN,
      answersTotal: c.answersTotal,
      accuracyPct: c.accuracyPct,
    }));
  }

  const bands = computeAgeBandStats(normalized);
  if (bands.bestAccuracy && (bands.bestAccuracy.answersTotal || 0) >= 3) {
    const b = bands.bestAccuracy;
    insights.push(buildInsight('best_age_band', `Faixa ${b.ageBand} com melhor precisão (${b.accuracyPct}% em ${b.answersTotal} respostas).`, {
      ageBand: b.ageBand,
      accuracyPct: b.accuracyPct,
      answersTotal: b.answersTotal,
    }));
  }
  if (bands.worstAccuracy && (bands.worstAccuracy.answersTotal || 0) >= 5
    && bands.worstAccuracy.ageBand !== bands.bestAccuracy?.ageBand) {
    const b = bands.worstAccuracy;
    insights.push(buildInsight('weakest_age_band', `Faixa ${b.ageBand} com menor precisão (${b.accuracyPct}% em ${b.answersTotal} respostas).`, {
      ageBand: b.ageBand,
      accuracyPct: b.accuracyPct,
      answersTotal: b.answersTotal,
    }));
  }

  const nickMap = new Map();
  for (const game of normalized) {
    const gameMap = buildPlayerNicknameMap(game);
    for (const [id, nick] of gameMap.entries()) {
      if (!nickMap.has(id) || !nickMap.get(id)) nickMap.set(id, nick);
    }
  }

  const players = computePlayerStats(normalized, { singlePlayerOnly: true });
  const topPlayer = players.players.find((p) => (p.answersTotal || 0) >= 3);
  if (topPlayer) {
    const name = resolvePlayerDisplayName(topPlayer.playerId, topPlayer.nickname, nickMap);
    insights.push(buildInsight('global_top_player', `${name} lidera o modo individual (${topPlayer.accuracyPct}% em ${topPlayer.answersTotal} respostas).`, {
      playerId: topPlayer.playerId,
      playerName: name,
      accuracyPct: topPlayer.accuracyPct,
      answersTotal: topPlayer.answersTotal,
    }));
  }

  const streaks = computeStreaks(normalized, { singlePlayerOnly: true });
  const bestStreak = streaks.players.find((p) => (p.bestStreak || 0) >= 2);
  if (bestStreak) {
    const name = resolvePlayerDisplayName(bestStreak.playerId, bestStreak.nickname, nickMap);
    insights.push(buildInsight('global_best_streak', `${name} tem a melhor série no modo individual (${bestStreak.bestStreak} acertos seguidos).`, {
      playerId: bestStreak.playerId,
      playerName: name,
      bestStreak: bestStreak.bestStreak,
    }));
  }

  return { hasAnswerData: true, insights, summary };
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
    players: computePlayerStats(normalized, { ...options, singlePlayerOnly: options.singlePlayerOnly !== false }),
    categories: computeCategoryStats(normalized),
    ageBands: computeAgeBandStats(normalized),
    questions: computeQuestionStats(normalized),
    difficulty: computeQuestionDifficulty(normalized),
    streaks: computeStreaks(normalized, { ...options, singlePlayerOnly: options.singlePlayerOnly !== false }),
    globalInsights: computeGlobalInsights(normalized),
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
    computeAgeBandStats,
    computeQuestionStats,
    computeQuestionDifficulty,
    computeStreaks,
    computeMatchInsights,
    computeGlobalInsights,
    computeAllStats,
    formatMatchLabel,
    formatGameDateLabel,
    resolvePlayerDisplayName,
    buildPlayerNicknameMap
  };
})(typeof window !== 'undefined' ? window : global);
