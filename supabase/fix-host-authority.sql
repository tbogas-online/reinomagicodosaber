-- Corrige anfitrião: fonte única = rooms.host_player_id
-- Executar no SQL Editor do Supabase

-- 1) Alinhar flags existentes
UPDATE public.room_players rp
SET is_host = (rp.player_id = r.host_player_id)
FROM public.rooms r
WHERE rp.room_id = r.id;

-- 2) join_room: ao voltar à sala, sincronizar is_host
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
        is_host = (v_room.host_player_id = v_uid),
        last_seen_at = now();

  RETURN jsonb_build_object(
    'room_id', v_room.id,
    'code', v_room.code,
    'is_host', v_room.host_player_id = v_uid,
    'host_player_id', v_room.host_player_id,
    'status', v_room.status,
    'settings', v_room.settings,
    'game_state', v_room.game_state
  );
END;
$$;

-- 3) Lista de jogadores: coroa derivada de rooms.host_player_id
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
          'is_host', (rp.player_id = r.host_player_id),
          'is_connected', rp.is_connected,
          'last_seen_at', rp.last_seen_at,
          'joined_at', rp.joined_at
        )
        ORDER BY rp.joined_at
      ),
      '[]'::jsonb
    )
    FROM public.room_players rp
    JOIN public.rooms r ON r.id = rp.room_id
    WHERE rp.room_id = p_room_id
  );
END;
$$;

-- 4) Desactivar transferência automática de anfitrião
CREATE OR REPLACE FUNCTION public.claim_host_if_disconnected(p_room_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN false;
END;
$$;

GRANT EXECUTE ON FUNCTION public.join_room(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_room_players(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_host_if_disconnected(UUID) TO anon, authenticated;
