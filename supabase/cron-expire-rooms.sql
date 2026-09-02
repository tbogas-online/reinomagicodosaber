-- Expiração automática de salas inactivas (requer extensão pg_cron no Supabase).
-- Dashboard → Database → Extensions → activar "pg_cron".
-- Depois executar este ficheiro no SQL Editor.

SELECT cron.schedule(
  'expire-inactive-rooms-hourly',
  '15 * * * *',
  $$SELECT public.expire_inactive_rooms();$$
);
