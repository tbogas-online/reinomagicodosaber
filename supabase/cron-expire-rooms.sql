-- =============================================================================
-- OPÇÃO A — Expiração automática (pg_cron) — só depois de activar a extensão
-- =============================================================================
--
-- 1) Supabase Dashboard → Database → Extensions
-- 2) Procurar "pg_cron" → Enable (se não aparecer, o teu plano pode não incluir cron)
-- 3) SQL Editor → correr SÓ a query de diagnóstico abaixo:
--
--    SELECT extname, extversion FROM pg_extension WHERE extname = 'pg_cron';
--
--    Deve devolver uma linha. Se devolver 0 linhas, a extensão NÃO está activa.
--
-- 4) Só então descomenta e corre o bloco "AGENDAR JOB" no fim deste ficheiro.
--
-- =============================================================================
-- OPÇÃO B — Sem pg_cron (recomendado se a extensão não estiver disponível)
-- =============================================================================
--
--   • Correr: supabase/expire-rooms-run-once.sql  (limpa salas antigas agora)
--   • Ou: Admin → Salas → Actualizar (após deploy, chama expire_inactive_rooms)
--
-- =============================================================================

-- Diagnóstico (corre isto primeiro)
SELECT
  EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') AS cron_schema_existe,
  EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') AS pg_cron_instalado;

-- ---------------------------------------------------------------------------
-- AGENDAR JOB (descomenta após pg_cron activo e diagnóstico OK)
-- ---------------------------------------------------------------------------
/*
SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname = 'expire-inactive-rooms-hourly';

SELECT cron.schedule(
  'expire-inactive-rooms-hourly',
  '15 * * * *',
  $$SELECT public.expire_inactive_rooms();$$
);

SELECT jobid, jobname, schedule, command
FROM cron.job
WHERE jobname = 'expire-inactive-rooms-hourly';
*/
