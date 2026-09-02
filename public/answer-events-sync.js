/**
 * Sincronização de respostas com Supabase (primário).
 * localStorage deixa de ser a fonte de verdade para estatísticas.
 */
(function (global) {
  'use strict';

  let cachedPlayerId = null;

  async function resolvePlayerId() {
    if (cachedPlayerId) return cachedPlayerId;
    try {
      const mpId = global.MultiplayerSync?.getPlayerId?.();
      if (mpId) {
        cachedPlayerId = String(mpId);
        return cachedPlayerId;
      }
    } catch { /* ignore */ }
    if (!global.ReinoSupabase?.isConfigured?.()) return null;
    try {
      const client = await global.ReinoSupabase.ensureClient();
      const session = (await client.auth.getSession()).data.session;
      cachedPlayerId = session?.user?.id ? String(session.user.id) : null;
      return cachedPlayerId;
    } catch {
      return null;
    }
  }

  function getMatchContext() {
    const mp = global.MultiplayerController;
    if (mp?.isMultiplayer?.()) {
      return {
        mode: 'multiplayer',
        matchId: mp.getMatchId?.() || null,
        roomId: global.MultiplayerSync?.getRoomId?.() || null,
        roundNumber: global.GameHistory?.getCurrentGame?.()?.rounds?.length || null,
      };
    }
    const game = global.GameHistory?.getCurrentGame?.();
    const matchId = game?.id && /^[0-9a-f-]{36}$/i.test(game.id) ? game.id : null;
    return {
      mode: 'single',
      matchId,
      roomId: null,
      roundNumber: game?.rounds?.length || null,
    };
  }

  function buildRow(event, playerId) {
    const ctx = getMatchContext();
    const nick = global.MultiplayerSync?.getMyNickname?.() || 'Jogador';
    return {
      match_id: ctx.matchId,
      room_id: ctx.roomId,
      round_number: ctx.roundNumber,
      player_id: playerId,
      nickname: nick,
      correct: !!event.correct,
      selected_answer: event.selectedAnswer != null ? String(event.selectedAnswer) : null,
      response_ms: Number.isFinite(Number(event.responseMs)) ? Number(event.responseMs) : null,
      timed_out: !!event.timedOut,
      question: event.question || null,
      correct_answer: event.correctAnswer || null,
      format: event.format || null,
      category_n: event.categoryN != null ? Number(event.categoryN) : null,
      knowledge_id: event.knowledgeId || null,
      age_band: event.ageBand || null,
      mode: ctx.mode,
      answered_at: new Date().toISOString(),
    };
  }

  async function syncHistoryRoundAnswers() {
    const ctx = getMatchContext();
    if (ctx.mode !== 'multiplayer' || !ctx.roomId || !ctx.matchId || !ctx.roundNumber) return;
    const game = global.GameHistory?.getCurrentGame?.();
    const round = game?.rounds?.[ctx.roundNumber - 1];
    if (!round?.answers?.length) return;
    let client;
    try {
      client = await global.ReinoSupabase.ensureClient();
    } catch {
      return;
    }
    const answers = round.answers.map((a) => ({
      playerId: a.playerId,
      nickname: a.nickname || '',
      selectedAnswer: a.selectedAnswer,
      correct: !!a.correct,
      responseMs: a.responseMs ?? null,
      answeredAt: a.answeredAt || null,
    }));
    const { error } = await client
      .from('game_history')
      .update({ answers })
      .eq('room_id', ctx.roomId)
      .eq('match_id', ctx.matchId)
      .eq('round_number', ctx.roundNumber);
    if (error) console.warn('[AnswerEvents] history update', error.message);
  }

  async function persist(event) {
    if (!global.ReinoSupabase?.isConfigured?.()) return;
    const playerId = await resolvePlayerId();
    if (!playerId) return;
    let client;
    try {
      client = await global.ReinoSupabase.ensureClient();
    } catch {
      return;
    }
    const row = buildRow(event, playerId);
    const { error } = await client.from('game_answer_events').insert(row);
    if (error) console.warn('[AnswerEvents] insert', error.message);
    syncHistoryRoundAnswers().catch(() => {});
  }

  async function ensureSingleMatch(game) {
    if (!game?.id || !/^[0-9a-f-]{36}$/i.test(game.id)) return;
    if (!global.ReinoSupabase?.isConfigured?.()) return;
    let client;
    try {
      client = await global.ReinoSupabase.ensureClient();
    } catch {
      return;
    }
    const { error } = await client.from('game_matches').upsert({
      id: game.id,
      mode: 'single',
      started_at: game.startedAt || new Date().toISOString(),
      rounds_count: 0,
      metadata: { source: 'local', gameId: game.id },
    }, { onConflict: 'id', ignoreDuplicates: false });
    if (error && !/duplicate|unique/i.test(error.message || '')) {
      console.warn('[AnswerEvents] match upsert', error.message);
    }
  }

  global.AnswerEventsSync = {
    persist,
    resolvePlayerId,
    ensureSingleMatch,
    syncHistoryRoundAnswers,
    getCachedPlayerId: () => cachedPlayerId,
  };
})(typeof window !== 'undefined' ? window : global);
