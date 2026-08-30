-- Lista todos os jogadores de uma sala (SECURITY DEFINER)
-- Executar no SQL Editor do Supabase

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

GRANT EXECUTE ON FUNCTION public.get_room_players(UUID) TO anon, authenticated;
