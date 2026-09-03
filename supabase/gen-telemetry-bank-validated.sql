-- Marca rejeições da telemetria que foram validadas manualmente e guardadas no banco.
-- Executar no SQL Editor do Supabase após gen-telemetry.sql.

ALTER TABLE public.gen_telemetry_events
  ADD COLUMN IF NOT EXISTS bank_validated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS bank_question_hash TEXT;

CREATE INDEX IF NOT EXISTS gen_telemetry_bank_validated_idx
  ON public.gen_telemetry_events (bank_validated_at DESC)
  WHERE bank_validated_at IS NOT NULL;
