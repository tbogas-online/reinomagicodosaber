-- Expira salas sem actividade há 24 horas
-- Executar no SQL Editor do Supabase

ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now();

UPDATE public.rooms
SET last_activity_at = GREATEST(updated_at, created_at)
WHERE last_activity_at < created_at;

CREATE INDEX IF NOT EXISTS rooms_last_activity_idx
  ON public.rooms (last_activity_at)
  WHERE status != 'finished';

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  NEW.last_activity_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.expire_room_if_inactive(p_room_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inactive BOOLEAN;
  v_status TEXT;
BEGIN
  SELECT status, (last_activity_at < now() - interval '24 hours')
    INTO v_status, v_inactive
  FROM public.rooms
  WHERE id = p_room_id;

  IF NOT FOUND OR v_status = 'finished' THEN
    RETURN true;
  END IF;

  IF v_inactive THEN
    UPDATE public.rooms SET status = 'finished' WHERE id = p_room_id;
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.expire_inactive_rooms()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT;
BEGIN
  WITH expired AS (
    UPDATE public.rooms
    SET status = 'finished'
    WHERE status != 'finished'
      AND last_activity_at < now() - interval '24 hours'
    RETURNING id
  )
  SELECT count(*)::int INTO v_count FROM expired;
  RETURN COALESCE(v_count, 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.touch_room_activity(p_room_id UUID)
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
    RETURN jsonb_build_object('ok', false, 'expired', false);
  END IF;

  IF public.expire_room_if_inactive(p_room_id) THEN
    RETURN jsonb_build_object('ok', false, 'expired', true);
  END IF;

  UPDATE public.rooms
  SET last_activity_at = now()
  WHERE id = p_room_id;

  RETURN jsonb_build_object('ok', true, 'expired', false);
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

  PERFORM public.expire_inactive_rooms();

  SELECT * INTO v_room
  FROM public.rooms
  WHERE code = upper(trim(p_code)) AND status != 'finished'
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sala não encontrada';
  END IF;

  IF public.expire_room_if_inactive(v_room.id) THEN
    RAISE EXCEPTION 'Sala expirada por inatividade (24 horas)';
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

  UPDATE public.rooms
  SET last_activity_at = now()
  WHERE id = v_room.id;

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

GRANT EXECUTE ON FUNCTION public.expire_room_if_inactive(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_inactive_rooms() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.touch_room_activity(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.join_room(TEXT, TEXT) TO anon, authenticated;
