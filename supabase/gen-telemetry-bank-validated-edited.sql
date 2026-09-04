-- Indica se a pergunta foi editada antes de guardar no banco (false = aceite como estava).
-- Executar no SQL Editor do Supabase após gen-telemetry-bank-validated.sql.
-- Se o PostgREST ainda não vir a coluna: Settings → API → Reload schema.

ALTER TABLE public.gen_telemetry_events
  ADD COLUMN IF NOT EXISTS bank_validated_edited BOOLEAN;
