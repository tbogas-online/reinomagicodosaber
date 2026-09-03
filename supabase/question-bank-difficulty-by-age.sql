-- Dificuldade por faixa etária (validação manual com várias idades).
-- Executar no SQL Editor do Supabase após question-bank-difficulty.sql.
--
-- Nota: CHECK não aceita subquery em PostgreSQL — validação via função + trigger.

ALTER TABLE public.question_bank
  ADD COLUMN IF NOT EXISTS difficulty_by_age_band JSONB;

ALTER TABLE public.question_bank
  DROP CONSTRAINT IF EXISTS question_bank_difficulty_by_age_band_check;

CREATE OR REPLACE FUNCTION public.reino_validate_difficulty_by_age_band(p JSONB)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p IS NULL
    OR (
      jsonb_typeof(p) = 'object'
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_each_text(p) AS e(key, val)
        WHERE e.key NOT IN ('6-9', '10-15', '15+')
          OR val !~ '^[1-5]$'
      )
    );
$$;

CREATE OR REPLACE FUNCTION public.reino_check_difficulty_by_age_band()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT public.reino_validate_difficulty_by_age_band(NEW.difficulty_by_age_band) THEN
    RAISE EXCEPTION
      'difficulty_by_age_band inválido: chaves 6-9, 10-15 ou 15+; valores inteiros de 1 a 5';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_difficulty_by_age_band ON public.question_bank;
CREATE TRIGGER trg_validate_difficulty_by_age_band
  BEFORE INSERT OR UPDATE OF difficulty_by_age_band ON public.question_bank
  FOR EACH ROW
  EXECUTE FUNCTION public.reino_check_difficulty_by_age_band();
