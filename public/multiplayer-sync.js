/**
 * Cliente Supabase Realtime para salas multijogador.
 * Requer: @supabase/supabase-js (CDN), supabase-config.js, auth anónima activa.
 */
(function (global) {
  'use strict';

  let client = null;
  let playerId = null;
  let roomId = null;
  let roomCode = null;
  let isHost = false;
  let channel = null;
  let playersChannel = null;
  let heartbeatTimer = null;
  let onStateChange = null;
  let onPlayersChange = null;
  let onHostChange = null;
  let lastGameStateJson = '';

  function getConfig() {
    const cfg = global.SUPABASE_CONFIG || {};
    return {
      url: (cfg.url || '').trim(),
      anonKey: (cfg.anonKey || '').trim(),
    };
  }

  function isConfigured() {
    const { url, anonKey } = getConfig();
    return !!(url && anonKey && global.supabase?.createClient);
  }

  async function ensureClient() {
    if (!isConfigured()) {
      throw new Error('Supabase não configurado — edita public/supabase-config.js');
    }
    if (client) return client;
    const { url, anonKey } = getConfig();
    client = global.supabase.createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
      realtime: { params: { eventsPerSecond: 8 } },
    });
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    if (!data.session) {
      const signIn = await client.auth.signInAnonymously();
      if (signIn.error) throw signIn.error;
    }
    const session = (await client.auth.getSession()).data.session;
    playerId = session?.user?.id || null;
    if (!playerId) throw new Error('Falha na autenticação anónima');
    return client;
  }

  function getPlayerId() {
    return playerId;
  }

  function getRoomId() {
    return roomId;
  }

  function getRoomCode() {
    return roomCode;
  }

  function getIsHost() {
    return isHost;
  }

  function isActive() {
    return !!roomId && !!client;
  }

  async function fetchPlayers() {
    if (!client || !roomId) return [];
    const { data, error } = await client
      .from('room_players')
      .select('id, player_id, nickname, score, is_host, is_connected, last_seen_at')
      .eq('room_id', roomId)
      .order('joined_at', { ascending: true });
    if (error) throw error;
    return data || [];
  }

  async function createRoom(settings) {
    await ensureClient();
    const { data, error } = await client.rpc('create_room', { p_settings: settings || {} });
    if (error) throw error;
    roomId = data.room_id;
    roomCode = data.code;
    isHost = true;
    await subscribe();
    return { roomId, code: roomCode, isHost: true };
  }

  async function joinRoom(code, nickname) {
    await ensureClient();
    const { data, error } = await client.rpc('join_room', {
      p_code: code,
      p_nickname: nickname || null,
    });
    if (error) throw error;
    roomId = data.room_id;
    roomCode = data.code;
    isHost = !!data.is_host;
    await subscribe();
    return {
      roomId,
      code: roomCode,
      isHost,
      status: data.status,
      settings: data.settings,
      gameState: data.game_state,
    };
  }

  async function updateRoom(patch) {
    if (!client || !roomId || !isHost) return;
    const { error } = await client.from('rooms').update(patch).eq('id', roomId);
    if (error) throw error;
  }

  async function updateGameState(gameState) {
    if (!isHost) return;
    lastGameStateJson = JSON.stringify(gameState);
    await updateRoom({ game_state: gameState, status: gameState?.status || 'playing' });
  }

  async function updateSettings(settings) {
    if (!isHost) return;
    await updateRoom({ settings });
  }

  async function startGame(gameState, settings) {
    if (!isHost) return;
    await updateRoom({
      status: 'playing',
      settings: settings || {},
      game_state: gameState,
    });
  }

  async function insertHistoryRound(round, matchId) {
    if (!client || !roomId || !isHost) return;
    const { error } = await client.from('game_history').insert({
      room_id: roomId,
      match_id: matchId || null,
      round_number: round.round,
      category: round.category,
      format: round.format || null,
      difficulty: round.difficulty || null,
      age_band: round.ageBand || null,
      question: round.question,
      correct_answer: round.correctAnswer,
      options: round.options || null,
    });
    if (error) console.warn('[MP] history insert', error.message);
  }

  async function insertMatch(matchId, metadata) {
    if (!client || !roomId || !isHost) return;
    const { error } = await client.from('game_matches').insert({
      id: matchId,
      room_id: roomId,
      mode: 'multiplayer',
      host_player_id: playerId,
      finished_at: new Date().toISOString(),
      rounds_count: metadata?.roundsCount || 0,
      metadata: metadata || {},
    });
    if (error) console.warn('[MP] match insert', error.message);
  }

  async function setConnected(connected) {
    if (!client || !roomId || !playerId) return;
    await client
      .from('room_players')
      .update({ is_connected: connected, last_seen_at: new Date().toISOString() })
      .eq('room_id', roomId)
      .eq('player_id', playerId);
  }

  async function heartbeat() {
    if (!roomId) return;
    await setConnected(true);
    if (!isHost) {
      try {
        await client.rpc('claim_host_if_disconnected', { p_room_id: roomId });
        const { data: room } = await client.from('rooms').select('host_player_id').eq('id', roomId).single();
        if (room && room.host_player_id === playerId && !isHost) {
          isHost = true;
          onHostChange?.(true);
        }
      } catch { /* ignore */ }
    }
  }

  function startHeartbeat() {
    stopHeartbeat();
    heartbeatTimer = setInterval(() => { heartbeat().catch(() => {}); }, 12000);
    heartbeat().catch(() => {});
  }

  function stopHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  async function subscribe() {
    if (!client || !roomId) return;
    await unsubscribe();
    channel = client
      .channel('room:' + roomId)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'rooms',
        filter: 'id=eq.' + roomId,
      }, (payload) => {
        const row = payload.new;
        if (row.host_player_id && row.host_player_id !== playerId) {
          if (isHost) {
            isHost = false;
            onHostChange?.(false);
          }
        } else if (row.host_player_id === playerId && !isHost) {
          isHost = true;
          onHostChange?.(true);
        }
        const gs = row.game_state || {};
        const json = JSON.stringify(gs);
        if (json !== lastGameStateJson) {
          lastGameStateJson = json;
          onStateChange?.(gs, row.settings || {}, row.status);
        }
      })
      .subscribe();

    playersChannel = client
      .channel('players:' + roomId)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'room_players',
        filter: 'room_id=eq.' + roomId,
      }, async () => {
        try {
          const players = await fetchPlayers();
          onPlayersChange?.(players);
        } catch { /* ignore */ }
      })
      .subscribe();

    startHeartbeat();
    const players = await fetchPlayers();
    onPlayersChange?.(players);
  }

  async function unsubscribe() {
    stopHeartbeat();
    if (channel) {
      await client.removeChannel(channel);
      channel = null;
    }
    if (playersChannel) {
      await client.removeChannel(playersChannel);
      playersChannel = null;
    }
  }

  async function leaveRoom() {
    await setConnected(false);
    await unsubscribe();
    roomId = null;
    roomCode = null;
    isHost = false;
    lastGameStateJson = '';
  }

  async function fetchRoomHistory() {
    if (!client || !roomId) return [];
    const { data, error } = await client
      .from('game_history')
      .select('*')
      .eq('room_id', roomId)
      .order('round_number', { ascending: true });
    if (error) throw error;
    return data || [];
  }

  function setCallbacks(cbs) {
    onStateChange = cbs?.onStateChange || null;
    onPlayersChange = cbs?.onPlayersChange || null;
    onHostChange = cbs?.onHostChange || null;
  }

  global.MultiplayerSync = {
    isConfigured,
    ensureClient,
    getPlayerId,
    getRoomId,
    getRoomCode,
    getIsHost,
    isActive,
    createRoom,
    joinRoom,
    updateGameState,
    updateSettings,
    startGame,
    insertHistoryRound,
    insertMatch,
    fetchPlayers,
    fetchRoomHistory,
    leaveRoom,
    setConnected,
    setCallbacks,
  };
})(typeof window !== 'undefined' ? window : global);
