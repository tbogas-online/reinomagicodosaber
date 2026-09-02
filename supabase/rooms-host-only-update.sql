-- Restringe UPDATE em rooms ao anfitrião (host_player_id).
-- Sem isto, qualquer membro da sala pode alterar settings/game_state via cliente Supabase.
-- Executar no SQL Editor do Supabase após schema.sql / update-multiplayer-players.sql.

DROP POLICY IF EXISTS rooms_update_member ON public.rooms;
DROP POLICY IF EXISTS rooms_update_host ON public.rooms;

CREATE POLICY rooms_update_host ON public.rooms
  FOR UPDATE TO authenticated, anon
  USING (host_player_id = auth.uid())
  WITH CHECK (host_player_id = auth.uid());
