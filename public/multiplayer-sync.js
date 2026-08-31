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
  let roomHostPlayerId = null;
  let channel = null;
  let playersChannel = null;
  let heartbeatTimer = null;
  let playersPollTimer = null;
  let playersRefreshTimer = null;
  let playersRefreshInFlight = false;
  let onStateChange = null;
  let onPlayersChange = null;
  let onHostChange = null;
  let onRoomExpired = null;
  let lastGameStateJson = '';

  function isConfigured() {
    return !!global.ReinoSupabase?.isConfigured?.();
  }

  async function ensureClient() {
    if (!isConfigured()) {
      throw new Error('Supabase não configurado — edita public/supabase-config.js');
    }
    const shared = await global.ReinoSupabase.ensureClient();
    if (!shared) throw new Error('Supabase não configurado — edita public/supabase-config.js');
    client = shared;
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
    if (!roomHostPlayerId || !playerId) return false;
    return String(roomHostPlayerId) === String(playerId);
  }

  function isActive() {
    return !!roomId && !!client;
  }

  function refreshHostFlag(notify = true) {
    const next = getIsHost();
    if (isHost === next) return next;
    isHost = next;
    if (notify) onHostChange?.(next);
    return next;
  }

  function applyHostPlayerId(hostId) {
    if (!hostId) return;
    roomHostPlayerId = hostId;
    refreshHostFlag(true);
  }

  function getHostPlayerId() {
    return roomHostPlayerId;
  }

  function syncHostFromPlayers() {
    refreshHostFlag(false);
    return getIsHost();
  }

  function normalizePlayerHostFlags(players) {
    if (!roomHostPlayerId) return players || [];
    return (players || []).map((p) => ({
      ...p,
      is_host: String(p.player_id) === String(roomHostPlayerId),
    }));
  }

  function notifyPlayersChange(players) {
    onPlayersChange?.(players);
  }

  async function refreshPlayers() {
    if (!roomId || playersRefreshInFlight) return [];
    playersRefreshInFlight = true;
    try {
      await syncHostFromServer();
      const players = await fetchPlayers();
      notifyPlayersChange(players);
      return players;
    } catch {
      return [];
    } finally {
      playersRefreshInFlight = false;
    }
  }

  function schedulePlayersRefresh(delayMs = 250) {
    if (!roomId) return;
    if (playersRefreshTimer) clearTimeout(playersRefreshTimer);
    playersRefreshTimer = setTimeout(() => {
      playersRefreshTimer = null;
      refreshPlayers().catch(() => {});
    }, delayMs);
  }

  async function fetchPlayers() {
    if (!client || !roomId) return [];
    try { await syncHostFromServer(); } catch { /* ignore */ }
    const { data: rpcData, error: rpcError } = await client.rpc('get_room_players', {
      p_room_id: roomId,
    });
    if (!rpcError && Array.isArray(rpcData)) {
      const players = normalizePlayerHostFlags(rpcData);
      syncHostFromPlayers();
      return players;
    }
    const { data, error } = await client
      .from('room_players')
      .select('id, player_id, nickname, score, is_host, is_connected, last_seen_at')
      .eq('room_id', roomId)
      .order('joined_at', { ascending: true });
    if (error) throw error;
    const players = normalizePlayerHostFlags(data || []);
    syncHostFromPlayers();
    return players;
  }

  async function syncHostFromServer() {
    if (!client || !roomId) return false;
    try {
      const { data: room, error } = await client
        .from('rooms')
        .select('host_player_id')
        .eq('id', roomId)
        .single();
      if (!error && room?.host_player_id) {
        applyHostPlayerId(room.host_player_id);
        return true;
      }
    } catch { /* ignore */ }
    return false;
  }

  async function createRoom(settings, nickname) {
    await ensureClient();
    const name = String(nickname || '').trim().slice(0, 24) || null;
    const { data, error } = await client.rpc('create_room', {
      p_settings: settings || {},
      p_nickname: name,
    });
    if (error) throw error;
    roomId = data.room_id;
    roomCode = data.code;
    applyHostPlayerId(data.host_player_id || playerId);
    await subscribe();
    await syncHostFromServer();
    return { roomId, code: roomCode, isHost: getIsHost() };
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
    if (data.host_player_id) applyHostPlayerId(data.host_player_id);
    await subscribe();
    await syncHostFromServer();
    return {
      roomId,
      code: roomCode,
      isHost: getIsHost(),
      status: data.status,
      settings: data.settings,
      gameState: data.game_state,
    };
  }

  async function updateRoom(patch) {
    if (!client || !roomId) return;
    const { error } = await client.from('rooms').update(patch).eq('id', roomId);
    if (error) throw error;
  }

  async function updateGameState(gameState) {
    if (!roomId) return;
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
    if (!client || !roomId) return;
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
    if (!client || !roomId || !isHost || !matchId) return;
    const meta = metadata || {};
    const { error } = await client.from('game_matches').insert({
      id: matchId,
      room_id: roomId,
      mode: 'multiplayer',
      host_player_id: playerId,
      started_at: meta.startedAt || new Date().toISOString(),
      finished_at: meta.finishedAt || new Date().toISOString(),
      rounds_count: Number(meta.roundsCount) || 0,
      metadata: {
        source: 'multiplayer',
        roomCode: meta.roomCode || null,
        gameId: meta.gameId || null,
      },
    });
    if (error && !/duplicate|unique/i.test(error.message || '')) {
      console.warn('[MP] match insert', error.message);
    }
  }

  async function touchRoomActivity() {
    if (!client || !roomId) return { expired: false };
    const { data, error } = await client.rpc('touch_room_activity', { p_room_id: roomId });
    if (error) throw error;
    return { expired: !!data?.expired };
  }

  async function notifyRoomEnded(message) {
    const msg = message || 'A sala terminou.';
    await leaveRoom();
    onRoomExpired?.(msg);
  }

  async function notifyRoomExpired() {
    await notifyRoomEnded('A sala expirou por inatividade (24 horas).');
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
    try {
      const touch = await touchRoomActivity();
      if (touch.expired) {
        await notifyRoomExpired();
        return;
      }
      await syncHostFromServer();
      schedulePlayersRefresh(0);
    } catch { /* ignore */ }
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

  function startPlayersPoll() {
    stopPlayersPoll();
    playersPollTimer = setInterval(() => {
      if (!roomId) return;
      refreshPlayers().catch(() => {});
    }, 5000);
  }

  function stopPlayersPoll() {
    if (playersPollTimer) {
      clearInterval(playersPollTimer);
      playersPollTimer = null;
    }
    if (playersRefreshTimer) {
      clearTimeout(playersRefreshTimer);
      playersRefreshTimer = null;
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
        if (row.status === 'finished') {
          notifyRoomEnded('O anfitrião terminou a sala.').catch(() => {});
          return;
        }
        if (row.host_player_id) applyHostPlayerId(row.host_player_id);
        const gs = row.game_state || {};
        const json = JSON.stringify(gs);
        if (json !== lastGameStateJson) {
          lastGameStateJson = json;
          onStateChange?.(gs, row.settings || {}, row.status);
        }
        schedulePlayersRefresh();
      })
      .subscribe();

    playersChannel = client
      .channel('players:' + roomId)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'room_players',
        filter: 'room_id=eq.' + roomId,
      }, () => {
        schedulePlayersRefresh(120);
      })
      .subscribe();

    startHeartbeat();
    startPlayersPoll();
    await refreshPlayers();
  }

  async function unsubscribe() {
    stopHeartbeat();
    stopPlayersPoll();
    if (channel) {
      await client.removeChannel(channel);
      channel = null;
    }
    if (playersChannel) {
      await client.removeChannel(playersChannel);
      playersChannel = null;
    }
  }

  async function fetchRoom() {
    if (!client || !roomId) return null;
    const { data: expired, error: expErr } = await client.rpc('expire_room_if_inactive', {
      p_room_id: roomId,
    });
    if (expErr) throw expErr;
    if (expired) {
      await notifyRoomExpired();
      return { status: 'finished', expired: true };
    }
    const { data, error } = await client
      .from('rooms')
      .select('status, settings, game_state')
      .eq('id', roomId)
      .single();
    if (error) throw error;
    if (data?.status === 'finished') {
      await notifyRoomExpired();
      return { ...data, expired: true };
    }
    return data;
  }

  async function leaveRoom() {
    await setConnected(false);
    await unsubscribe();
    roomId = null;
    roomCode = null;
    roomHostPlayerId = null;
    isHost = false;
    lastGameStateJson = '';
  }

  async function hostLeaveRoom(action) {
    if (!client || !roomId) return null;
    const { data, error } = await client.rpc('host_leave_room', {
      p_room_id: roomId,
      p_action: action,
    });
    if (error) throw error;
    await unsubscribe();
    roomId = null;
    roomCode = null;
    roomHostPlayerId = null;
    isHost = false;
    lastGameStateJson = '';
    return data;
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

  async function updateNickname(nickname) {
    if (!client || !roomId || !playerId) return;
    const name = String(nickname || '').trim().slice(0, 24);
    if (!name) throw new Error('Nome inválido');
    const { error } = await client
      .from('room_players')
      .update({ nickname: name, last_seen_at: new Date().toISOString() })
      .eq('room_id', roomId)
      .eq('player_id', playerId);
    if (error) throw error;
  }

  async function getMyNickname() {
    const players = await fetchPlayers();
    const me = players.find((p) => p.player_id === playerId);
    return me?.nickname || '';
  }

  function setLastGameStateJson(json) {
    lastGameStateJson = json;
  }

  function setCallbacks(cbs) {
    onStateChange = cbs?.onStateChange || null;
    onPlayersChange = cbs?.onPlayersChange || null;
    onHostChange = cbs?.onHostChange || null;
    onRoomExpired = cbs?.onRoomExpired || null;
  }

  global.MultiplayerSync = {
    isConfigured,
    ensureClient,
    getPlayerId,
    getRoomId,
    getRoomCode,
    getIsHost,
    getHostPlayerId,
    isActive,
    createRoom,
    joinRoom,
    updateGameState,
    updateSettings,
    startGame,
    insertHistoryRound,
    insertMatch,
    fetchPlayers,
    refreshPlayers,
    schedulePlayersRefresh,
    fetchRoom,
    fetchRoomHistory,
    touchRoomActivity,
    leaveRoom,
    hostLeaveRoom,
    setConnected,
    setCallbacks,
    updateNickname,
    getMyNickname,
    setLastGameStateJson,
    syncHostFromPlayers,
    syncHostFromServer,
  };
})(typeof window !== 'undefined' ? window : global);
