-- Reino Mágico do Saber — Multiplayer + Histórico de partidas
-- Executar no SQL Editor do Supabase (https://supabase.com/dashboard)
--
-- Pré-requisitos:
--   1. Authentication → Providers → Enable "Anonymous sign-ins"
--   2. Database → Replication → supabase_realtime: activar tabelas rooms e room_players

-- ---------------------------------------------------------------------------
-- Extensões
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.rooms (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code          VARCHAR(6) NOT NULL UNIQUE,
  host_player_id UUID NOT NULL,
  status        TEXT NOT NULL DEFAULT 'lobby'
                CHECK (status IN ('lobby', 'playing', 'finished')),
  settings      JSONB NOT NULL DEFAULT '{}'::jsonb,
  game_state    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rooms_code_idx ON public.rooms (code);
CREATE INDEX IF NOT EXISTS rooms_status_idx ON public.rooms (status);

CREATE TABLE IF NOT EXISTS public.room_players (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id       UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  player_id     UUID NOT NULL,
  nickname      TEXT NOT NULL,
  score         INT NOT NULL DEFAULT 0,
  is_host       BOOLEAN NOT NULL DEFAULT false,
  is_connected  BOOLEAN NOT NULL DEFAULT true,
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  joined_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (room_id, player_id)
);

CREATE INDEX IF NOT EXISTS room_players_room_idx ON public.room_players (room_id);
CREATE INDEX IF NOT EXISTS room_players_player_idx ON public.room_players (player_id);

CREATE TABLE IF NOT EXISTS public.game_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id         UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  match_id        UUID,
  round_number    INT NOT NULL,
  category        TEXT NOT NULL,
  format          TEXT,
  difficulty      TEXT,
  age_band        TEXT,
  question        TEXT NOT NULL,
  correct_answer  TEXT NOT NULL,
  options         JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS game_history_room_idx ON public.game_history (room_id);
CREATE INDEX IF NOT EXISTS game_history_match_idx ON public.game_history (match_id);

CREATE TABLE IF NOT EXISTS public.game_matches (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id       UUID REFERENCES public.rooms(id) ON DELETE SET NULL,
  mode          TEXT NOT NULL CHECK (mode IN ('single', 'multiplayer')),
  host_player_id UUID,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ,
  rounds_count  INT NOT NULL DEFAULT 0,
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS game_matches_room_idx ON public.game_matches (room_id);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS rooms_updated_at ON public.rooms;
CREATE TRIGGER rooms_updated_at
  BEFORE UPDATE ON public.rooms
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Funções RPC (SECURITY DEFINER — validação centralizada)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_room(
  p_settings JSONB DEFAULT '{}'::jsonb,
  p_nickname TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_code TEXT;
  v_room public.rooms%ROWTYPE;
  v_tries INT := 0;
  v_chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_name TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Autenticação necessária (anonymous sign-in)';
  END IF;

  v_name := COALESCE(NULLIF(trim(p_nickname), ''), 'Jogador 1');

  LOOP
    v_tries := v_tries + 1;
    IF v_tries > 30 THEN
      RAISE EXCEPTION 'Não foi possível gerar código único';
    END IF;
    v_code := '';
    FOR i IN 1..4 LOOP
      v_code := v_code || substr(v_chars, 1 + floor(random() * length(v_chars))::int, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM rooms WHERE code = v_code AND status != 'finished');
  END LOOP;

  INSERT INTO rooms (code, host_player_id, settings, game_state, status)
  VALUES (v_code, v_uid, COALESCE(p_settings, '{}'::jsonb), '{}'::jsonb, 'lobby')
  RETURNING * INTO v_room;

  INSERT INTO room_players (room_id, player_id, nickname, is_host, is_connected)
  VALUES (v_room.id, v_uid, v_name, true, true);

  RETURN jsonb_build_object(
    'room_id', v_room.id,
    'code', v_room.code,
    'is_host', true
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.join_room(p_code TEXT, p_nickname TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_room public.rooms%ROWTYPE;
  v_name TEXT;
  v_count INT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Autenticação necessária (anonymous sign-in)';
  END IF;

  SELECT * INTO v_room
  FROM rooms
  WHERE code = upper(trim(p_code)) AND status != 'finished'
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sala não encontrada';
  END IF;

  SELECT count(*) INTO v_count FROM room_players WHERE room_id = v_room.id;

  v_name := COALESCE(
    NULLIF(trim(p_nickname), ''),
    'Jogador ' || (v_count + 1)::text
  );

  INSERT INTO room_players (room_id, player_id, nickname, is_host, is_connected)
  VALUES (v_room.id, v_uid, v_name, v_room.host_player_id = v_uid, true)
  ON CONFLICT (room_id, player_id) DO UPDATE
    SET nickname = EXCLUDED.nickname,
        is_connected = true,
        last_seen_at = now();

  RETURN jsonb_build_object(
    'room_id', v_room.id,
    'code', v_room.code,
    'is_host', v_room.host_player_id = v_uid,
    'status', v_room.status,
    'settings', v_room.settings,
    'game_state', v_room.game_state
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.transfer_host(p_room_id UUID, p_new_host_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN false; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM rooms WHERE id = p_room_id AND host_player_id = v_uid
  ) THEN
    RETURN false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM room_players WHERE room_id = p_room_id AND player_id = p_new_host_id
  ) THEN
    RETURN false;
  END IF;

  UPDATE rooms SET host_player_id = p_new_host_id WHERE id = p_room_id;
  UPDATE room_players SET is_host = (player_id = p_new_host_id) WHERE room_id = p_room_id;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_host_if_disconnected(p_room_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_host UUID;
  v_host_online BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN RETURN false; END IF;

  SELECT host_player_id INTO v_host FROM rooms WHERE id = p_room_id;
  IF NOT FOUND THEN RETURN false; END IF;

  SELECT is_connected INTO v_host_online
  FROM room_players
  WHERE room_id = p_room_id AND player_id = v_host;

  IF COALESCE(v_host_online, false) THEN
    RETURN false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM room_players WHERE room_id = p_room_id AND player_id = v_uid
  ) THEN
    RETURN false;
  END IF;

  UPDATE rooms SET host_player_id = v_uid WHERE id = p_room_id;
  UPDATE room_players SET is_host = (player_id = v_uid) WHERE room_id = p_room_id;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_room_players(p_room_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Autenticação necessária';
  END IF;

  IF NOT public.is_room_member(p_room_id) THEN
    RAISE EXCEPTION 'Não és membro desta sala';
  END IF;

  RETURN (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', rp.id,
          'player_id', rp.player_id,
          'nickname', rp.nickname,
          'score', rp.score,
          'is_host', rp.is_host,
          'is_connected', rp.is_connected,
          'last_seen_at', rp.last_seen_at,
          'joined_at', rp.joined_at
        )
        ORDER BY rp.joined_at
      ),
      '[]'::jsonb
    )
    FROM public.room_players rp
    WHERE rp.room_id = p_room_id
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

-- Função auxiliar SECURITY DEFINER evita recursão infinita nas políticas
-- (SELECT em room_players que referencia room_players → erro 500)
CREATE OR REPLACE FUNCTION public.is_room_member(p_room_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.room_players
    WHERE room_id = p_room_id AND player_id = auth.uid()
  );
$$;

ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_matches ENABLE ROW LEVEL SECURITY;

-- rooms
DROP POLICY IF EXISTS rooms_select_member ON public.rooms;
CREATE POLICY rooms_select_member ON public.rooms
  FOR SELECT TO authenticated, anon
  USING (public.is_room_member(id));

DROP POLICY IF EXISTS rooms_update_host ON public.rooms;
DROP POLICY IF EXISTS rooms_update_member ON public.rooms;
CREATE POLICY rooms_update_member ON public.rooms
  FOR UPDATE TO authenticated, anon
  USING (public.is_room_member(id))
  WITH CHECK (public.is_room_member(id));

-- room_players
DROP POLICY IF EXISTS players_select_room ON public.room_players;
CREATE POLICY players_select_room ON public.room_players
  FOR SELECT TO authenticated, anon
  USING (public.is_room_member(room_id));

DROP POLICY IF EXISTS players_update_self ON public.room_players;
CREATE POLICY players_update_self ON public.room_players
  FOR UPDATE TO authenticated, anon
  USING (player_id = auth.uid())
  WITH CHECK (player_id = auth.uid());

-- game_history
DROP POLICY IF EXISTS history_select_member ON public.game_history;
CREATE POLICY history_select_member ON public.game_history
  FOR SELECT TO authenticated, anon
  USING (public.is_room_member(room_id));

DROP POLICY IF EXISTS history_insert_host ON public.game_history;
DROP POLICY IF EXISTS history_insert_member ON public.game_history;
CREATE POLICY history_insert_member ON public.game_history
  FOR INSERT TO authenticated, anon
  WITH CHECK (public.is_room_member(room_id));

-- game_matches (multiplayer summaries on server)
DROP POLICY IF EXISTS matches_select_member ON public.game_matches;
CREATE POLICY matches_select_member ON public.game_matches
  FOR SELECT TO authenticated, anon
  USING (
    room_id IS NULL
    OR public.is_room_member(room_id)
  );

DROP POLICY IF EXISTS matches_insert_host ON public.game_matches;
CREATE POLICY matches_insert_host ON public.game_matches
  FOR INSERT TO authenticated, anon
  WITH CHECK (
    room_id IS NULL
    OR EXISTS (
      SELECT 1 FROM rooms r
      WHERE r.id = game_matches.room_id AND r.host_player_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
ALTER PUBLICATION supabase_realtime ADD TABLE public.rooms;
ALTER PUBLICATION supabase_realtime ADD TABLE public.room_players;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT, UPDATE ON public.rooms TO anon, authenticated;
GRANT SELECT, UPDATE ON public.room_players TO anon, authenticated;
GRANT SELECT, INSERT ON public.game_history TO anon, authenticated;
GRANT SELECT, INSERT ON public.game_matches TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_room_member(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_room(JSONB, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.join_room(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transfer_host(UUID, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_host_if_disconnected(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_room_players(UUID) TO anon, authenticated;
