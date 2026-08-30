const LISBON_TZ = 'Europe/Lisbon';

const TIMELINE_DAYS = {
  '24h': 1,
  '3d': 3,
  '7d': 7,
  '14d': 14,
};

function getSupabaseAdmin() {
  const url = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key) return null;
  return { url, key };
}

async function supabaseCount(table, query = '') {
  const cfg = getSupabaseAdmin();
  if (!cfg) return 0;
  const response = await fetch(`${cfg.url}/rest/v1/${table}?select=id${query}`, {
    method: 'HEAD',
    headers: {
      apikey: cfg.key,
      Authorization: `Bearer ${cfg.key}`,
      Prefer: 'count=exact',
      Range: '0-0',
    },
  });
  if (!response.ok) return 0;
  const range = response.headers.get('content-range') || '';
  const total = range.split('/')[1];
  return Number(total) || 0;
}

async function supabaseRequest(path, options = {}) {
  const cfg = getSupabaseAdmin();
  if (!cfg) {
    const err = new Error('Supabase admin não configurado (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).');
    err.code = 'NOT_CONFIGURED';
    throw err;
  }

  const headers = {
    apikey: cfg.key,
    Authorization: `Bearer ${cfg.key}`,
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  if (!options.headers?.Prefer && options.method !== 'GET') {
    headers.Prefer = 'return=minimal';
  }

  const response = await fetch(`${cfg.url}/rest/v1${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const err = new Error(text || `Supabase HTTP ${response.status}`);
    err.status = response.status;
    throw err;
  }

  if (response.status === 204) return null;
  const text = await response.text();
  if (!text) return null;
  return JSON.parse(text);
}

function toLisbonDayKey(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('sv-SE', { timeZone: LISBON_TZ });
}

function toLisbonHourKey(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: LISBON_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}T${map.hour}`;
}

function buildDaySeries(items, dateField, days) {
  const counts = new Map();
  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - (days - 1));
  start.setHours(0, 0, 0, 0);

  for (let i = 0; i < days; i += 1) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const key = d.toLocaleDateString('sv-SE', { timeZone: LISBON_TZ });
    counts.set(key, 0);
  }

  (items || []).forEach((row) => {
    const key = toLisbonDayKey(row[dateField]);
    if (key && counts.has(key)) counts.set(key, (counts.get(key) || 0) + 1);
  });

  return [...counts.entries()].map(([t, v]) => ({ t, v }));
}

function buildHourSeries(items, dateField, hours) {
  const counts = new Map();
  const now = new Date();
  const start = new Date(now.getTime() - (hours - 1) * 60 * 60 * 1000);
  start.setMinutes(0, 0, 0);

  for (let i = 0; i < hours; i += 1) {
    const d = new Date(start.getTime() + i * 60 * 60 * 1000);
    const key = toLisbonHourKey(d.toISOString());
    if (key) counts.set(key, 0);
  }

  (items || []).forEach((row) => {
    const key = toLisbonHourKey(row[dateField]);
    if (key && counts.has(key)) counts.set(key, (counts.get(key) || 0) + 1);
  });

  return [...counts.entries()].map(([t, v]) => ({ t, v }));
}

function mapRoomRow(room) {
  const players = Array.isArray(room.room_players) ? room.room_players : [];
  const host = players.find((p) => p.player_id === room.host_player_id)
    || players.find((p) => p.is_host);
  return {
    id: room.id,
    code: room.code,
    status: room.status,
    createdAt: room.created_at,
    lastActivityAt: room.last_activity_at,
    updatedAt: room.updated_at,
    playerCount: players.length,
    connectedCount: players.filter((p) => p.is_connected).length,
    hostNickname: host?.nickname || '—',
    players: players.map((p) => ({
      nickname: p.nickname,
      isConnected: !!p.is_connected,
      isHost: !!p.is_host || p.player_id === room.host_player_id,
    })),
  };
}

async function listOpenRooms() {
  const rooms = await supabaseRequest(
    '/rooms?status=in.(lobby,playing)'
    + '&select=id,code,status,created_at,last_activity_at,updated_at,host_player_id,'
    + 'room_players(nickname,is_connected,is_host,player_id,joined_at)'
    + '&order=last_activity_at.desc'
  );
  return (rooms || []).map(mapRoomRow);
}

async function getRoomStats() {
  const since = new Date();
  since.setDate(since.getDate() - 14);
  const sinceIso = since.toISOString();

  const [openRooms, allRoomsRecent, allMatchesRecent, totalRooms, totalGames] = await Promise.all([
    supabaseRequest(
      '/rooms?status=in.(lobby,playing)&select=id,status'
    ),
    supabaseRequest(`/rooms?created_at=gte.${encodeURIComponent(sinceIso)}&select=created_at`),
    supabaseRequest(`/game_matches?started_at=gte.${encodeURIComponent(sinceIso)}&select=started_at,mode`),
    supabaseCount('rooms'),
    supabaseCount('game_matches'),
  ]);

  const open = openRooms || [];
  const playing = open.filter((r) => r.status === 'playing').length;
  const lobby = open.filter((r) => r.status === 'lobby').length;

  const timeline = {};
  Object.entries(TIMELINE_DAYS).forEach(([key, days]) => {
    const useHours = key === '24h' || key === '3d';
    const hourPoints = key === '24h' ? 24 : 72;
    timeline[key] = {
      rooms: useHours
        ? buildHourSeries(allRoomsRecent, 'created_at', hourPoints)
        : buildDaySeries(allRoomsRecent, 'created_at', days),
      games: useHours
        ? buildHourSeries(allMatchesRecent, 'started_at', hourPoints)
        : buildDaySeries(allMatchesRecent, 'started_at', days),
    };
  });

  return {
    openRooms: open.length,
    playingRooms: playing,
    lobbyRooms: lobby,
    totalRooms,
    totalGames,
    timeline,
  };
}

async function closeRoom(roomId) {
  if (!roomId) throw new Error('ID da sala em falta.');
  await supabaseRequest(`/rooms?id=eq.${encodeURIComponent(roomId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'finished' }),
  });
  await supabaseRequest(`/room_players?room_id=eq.${encodeURIComponent(roomId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ is_connected: false }),
  });
  return { ok: true, roomId };
}

module.exports = {
  getSupabaseAdmin,
  listOpenRooms,
  getRoomStats,
  closeRoom,
};
