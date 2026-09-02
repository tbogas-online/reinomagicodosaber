-- Expira agora todas as salas sem actividade há mais de 24 horas.
-- Não precisa de pg_cron. Podes correr isto sempre que quiseres limpar salas antigas.
--
-- Pré-requisito: supabase/expire-rooms-24h.sql já executado.

SELECT public.expire_inactive_rooms() AS salas_expiradas;
