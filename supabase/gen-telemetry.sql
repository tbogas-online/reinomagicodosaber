-- Telemetria de geração IA — eventos de validação (local, multijogador, teste)
-- Executar no SQL Editor do Supabase após schema.sql
--
-- Escrita/leitura apenas via Netlify Functions (service_role). Sem políticas RLS públicas.

CREATE TABLE IF NOT EXISTS public.gen_telemetry_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  event_ts        BIGINT NOT NULL,
  outcome         TEXT NOT NULL
                  CHECK (outcome IN ('accepted', 'rejected', 'parse_error', 'api_error', 'unknown')),
  category        SMALLINT,
  format_id       TEXT,
  age_band_key    TEXT,
  difficulty      SMALLINT,
  attempt         SMALLINT,
  issue_codes     TEXT[] NOT NULL DEFAULT '{}',
  issue_messages  TEXT[] NOT NULL DEFAULT '{}',
  provider        TEXT,
  model           TEXT,
  score           SMALLINT,
  source          TEXT NOT NULL DEFAULT 'ai',
  game_mode       TEXT NOT NULL DEFAULT 'local'
                  CHECK (game_mode IN ('local', 'multiplayer', 'test'))
);

CREATE INDEX IF NOT EXISTS gen_telemetry_created_idx
  ON public.gen_telemetry_events (created_at DESC);

CREATE INDEX IF NOT EXISTS gen_telemetry_mode_idx
  ON public.gen_telemetry_events (game_mode, created_at DESC);

CREATE INDEX IF NOT EXISTS gen_telemetry_outcome_idx
  ON public.gen_telemetry_events (outcome, created_at DESC);

ALTER TABLE public.gen_telemetry_events ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Manutenção: manter no máximo N eventos (os mais recentes)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trim_gen_telemetry_events(p_max INT DEFAULT 10000)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted INT := 0;
BEGIN
  IF p_max IS NULL OR p_max < 1 THEN
    RETURN 0;
  END IF;

  WITH ranked AS (
    SELECT id
    FROM public.gen_telemetry_events
    ORDER BY created_at DESC
    OFFSET p_max
  )
  DELETE FROM public.gen_telemetry_events e
  USING ranked r
  WHERE e.id = r.id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

CREATE OR REPLACE FUNCTION public.clear_gen_telemetry_events()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted INT := 0;
BEGIN
  DELETE FROM public.gen_telemetry_events;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;
