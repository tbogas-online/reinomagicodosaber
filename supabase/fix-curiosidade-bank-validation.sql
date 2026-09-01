-- ---------------------------------------------------------------------------
-- Corrigir validação CURIOSIDADE no banco (2 opções V/F, resposta Verdadeiro/Falso)
-- Executar no Supabase SQL Editor APÓS question-bank.sql
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.reino_has_valid_mc_options(
  p_options JSONB,
  p_format TEXT,
  p_correct_answer TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_len INT;
  v_expected INT;
  v_norm TEXT;
BEGIN
  IF p_options IS NULL OR jsonb_typeof(p_options) <> 'array' THEN
    RETURN FALSE;
  END IF;

  v_len := jsonb_array_length(p_options);
  IF v_len < 2 THEN
    RETURN FALSE;
  END IF;

  v_norm := lower(trim(regexp_replace(COALESCE(p_correct_answer, ''), '<[^>]*>', '', 'gi')));
  IF COALESCE(p_format, '') IN ('VERDADEIRO_FALSO', 'CURIOSIDADE') THEN
    v_expected := 2;
    IF v_norm NOT IN ('verdadeiro', 'falso') THEN
      RETURN FALSE;
    END IF;
  ELSIF v_norm IN ('verdadeiro', 'falso') THEN
    v_expected := 2;
  ELSE
    v_expected := 4;
  END IF;

  IF v_len <> v_expected THEN
    RETURN FALSE;
  END IF;

  IF v_expected = 2 THEN
    RETURN EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(p_options) AS opt(val)
      WHERE lower(trim(regexp_replace(val, '<[^>]*>', '', 'gi'))) = 'verdadeiro'
    ) AND EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(p_options) AS opt(val)
      WHERE lower(trim(regexp_replace(val, '<[^>]*>', '', 'gi'))) = 'falso'
    );
  END IF;

  RETURN TRUE;
END;
$$;

-- Remover perguntas CURIOSIDADE inválidas já guardadas (ex.: resposta «Sim», 4 opções)
DELETE FROM public.question_bank qb
WHERE qb.is_reported = false
  AND COALESCE(qb.format, '') = 'CURIOSIDADE'
  AND NOT public.reino_has_valid_mc_options(qb.options, qb.format, qb.correct_answer);

-- Opcional: outras inválidas (qualquer formato)
-- DELETE FROM public.question_bank qb
-- WHERE qb.is_reported = false
--   AND NOT public.reino_has_valid_mc_options(qb.options, qb.format, qb.correct_answer);
