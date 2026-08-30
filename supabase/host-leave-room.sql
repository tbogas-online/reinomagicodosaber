-- Saída do anfitrião: terminar sala ou transferir anfitrião
-- Executar no SQL Editor do Supabase após schema.sql e fix-host-authority.sql

CREATE OR REPLACE FUNCTION public.host_leave_room(p_room_id UUID, p_action TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_new_host UUID;
  v_new_host_nick TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Autenticação necessária';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.rooms
    WHERE id = p_room_id AND host_player_id = v_uid AND status != 'finished'
  ) THEN
    RAISE EXCEPTION 'Apenas o anfitrião pode fazer isto';
  END IF;

  IF p_action = 'finish' THEN
    UPDATE public.rooms SET status = 'finished' WHERE id = p_room_id;
    UPDATE public.room_players
    SET is_connected = false, last_seen_at = now()
    WHERE room_id = p_room_id AND player_id = v_uid;

    RETURN jsonb_build_object('action', 'finish', 'ok', true);
  END IF;

  IF p_action = 'transfer' THEN
    SELECT rp.player_id, rp.nickname
      INTO v_new_host, v_new_host_nick
    FROM public.room_players rp
    WHERE rp.room_id = p_room_id AND rp.player_id != v_uid
    ORDER BY rp.is_connected DESC, rp.joined_at ASC
    LIMIT 1;

    IF v_new_host IS NULL THEN
      UPDATE public.rooms SET status = 'finished' WHERE id = p_room_id;
      UPDATE public.room_players
      SET is_connected = false, last_seen_at = now()
      WHERE room_id = p_room_id AND player_id = v_uid;

      RETURN jsonb_build_object('action', 'finish', 'ok', true, 'reason', 'no_other_players');
    END IF;

    UPDATE public.rooms SET host_player_id = v_new_host WHERE id = p_room_id;
    UPDATE public.room_players
    SET is_host = (player_id = v_new_host)
    WHERE room_id = p_room_id;

    UPDATE public.room_players
    SET is_connected = false, last_seen_at = now()
    WHERE room_id = p_room_id AND player_id = v_uid;

    RETURN jsonb_build_object(
      'action', 'transfer',
      'ok', true,
      'new_host_id', v_new_host,
      'new_host_nickname', v_new_host_nick
    );
  END IF;

  RAISE EXCEPTION 'Acção inválida';
END;
$$;

GRANT EXECUTE ON FUNCTION public.host_leave_room(UUID, TEXT) TO anon, authenticated;
