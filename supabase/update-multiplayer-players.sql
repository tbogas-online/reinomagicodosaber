-- Permite qualquer jogador da sala actualizar o estado e inserir histórico
-- + nickname personalizado ao criar sala
-- Executar no SQL Editor do Supabase

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

DROP POLICY IF EXISTS rooms_update_host ON public.rooms;
CREATE POLICY rooms_update_member ON public.rooms
  FOR UPDATE TO authenticated, anon
  USING (public.is_room_member(id))
  WITH CHECK (public.is_room_member(id));

DROP POLICY IF EXISTS history_insert_host ON public.game_history;
CREATE POLICY history_insert_member ON public.game_history
  FOR INSERT TO authenticated, anon
  WITH CHECK (public.is_room_member(room_id));

GRANT EXECUTE ON FUNCTION public.create_room(JSONB, TEXT) TO anon, authenticated;
