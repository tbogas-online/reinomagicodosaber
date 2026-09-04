-- Marca rejeições da telemetria descartadas manualmente no painel admin.
-- Executar no SQL Editor do Supabase após gen-telemetry-bank-validated.sql.
-- Se o PostgREST ainda não vir a coluna: Settings → API → Reload schema.

ALTER TABLE public.gen_telemetry_events
  ADD COLUMN IF NOT EXISTS dismissed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS gen_telemetry_dismissed_idx
  ON public.gen_telemetry_events (dismissed_at DESC)
  WHERE dismissed_at IS NOT NULL;
