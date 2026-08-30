-- Corrige erro 500 em room_players (recursão infinita nas políticas RLS)
-- Executar no SQL Editor do Supabase APÓS schema.sql

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

GRANT EXECUTE ON FUNCTION public.is_room_member(uuid) TO anon, authenticated;

-- room_players: SELECT sem auto-referência
DROP POLICY IF EXISTS players_select_room ON public.room_players;
CREATE POLICY players_select_room ON public.room_players
  FOR SELECT TO authenticated, anon
  USING (public.is_room_member(room_id));

-- rooms: SELECT via função (evita cadeia recursiva)
DROP POLICY IF EXISTS rooms_select_member ON public.rooms;
CREATE POLICY rooms_select_member ON public.rooms
  FOR SELECT TO authenticated, anon
  USING (public.is_room_member(id));

-- game_history
DROP POLICY IF EXISTS history_select_member ON public.game_history;
CREATE POLICY history_select_member ON public.game_history
  FOR SELECT TO authenticated, anon
  USING (public.is_room_member(room_id));

-- game_matches
DROP POLICY IF EXISTS matches_select_member ON public.game_matches;
CREATE POLICY matches_select_member ON public.game_matches
  FOR SELECT TO authenticated, anon
  USING (
    room_id IS NULL
    OR public.is_room_member(room_id)
  );
