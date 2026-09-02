-- Overrides manuais de regras de validação (desactivar código/mensagem por faixa/formato)
-- Executar no SQL Editor do Supabase após gen-telemetry.sql

CREATE TABLE IF NOT EXISTS public.gen_validation_rule_overrides (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  issue_code      TEXT NOT NULL,
  message         TEXT,
  age_band_key    TEXT,
  format_id       TEXT,
  note            TEXT,
  active          BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS gen_validation_rule_overrides_active_idx
  ON public.gen_validation_rule_overrides (active, issue_code);

ALTER TABLE public.gen_validation_rule_overrides ENABLE ROW LEVEL SECURITY;
