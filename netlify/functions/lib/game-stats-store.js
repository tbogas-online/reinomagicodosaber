'use strict';

const { getSupabaseAdmin } = require('./rooms-store');

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

function inFilter(ids) {
  const list = [...new Set((ids || []).filter(Boolean))];
  if (!list.length) return null;
  return `in.(${list.join(',')})`;
}

async function fetchGameStatsPayload({ limit = 200 } = {}) {
  const matches = await supabaseRequest(
    `/game_matches?select=*&order=started_at.desc&limit=${Math.min(Math.max(limit, 1), 500)}`,
  ) || [];

  const matchIds = matches.map((m) => m.id).filter(Boolean);
  const matchFilter = inFilter(matchIds);

  const historyRows = matchFilter
    ? await supabaseRequest(
      `/game_history?select=*&match_id=${matchFilter}&order=round_number.asc`,
    ) || []
    : [];

  const answerEvents = matchFilter
    ? await supabaseRequest(
      `/game_answer_events?select=*&match_id=${matchFilter}&order=answered_at.asc`,
    ) || []
    : [];

  const roomIds = [...new Set(matches.map((m) => m.room_id).filter(Boolean))];
  const roomFilter = inFilter(roomIds);
  const players = roomFilter
    ? await supabaseRequest(`/room_players?select=*&room_id=${roomFilter}`) || []
    : [];

  return {
    matches,
    historyRows,
    answerEvents,
    players,
    fetchedAt: new Date().toISOString(),
  };
}

module.exports = {
  fetchGameStatsPayload,
};
