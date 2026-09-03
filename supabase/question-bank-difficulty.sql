-- Dificuldade alvo (1–5) por pergunta no banco — usada ao aceitar da telemetria IA
-- e ao guardar perguntas com dificuldade estimada diferente da pedida.
-- Executar no SQL Editor do Supabase após question-bank.sql e cat20-bank-knowledge-id-guard.sql.

ALTER TABLE public.question_bank
  ADD COLUMN IF NOT EXISTS difficulty SMALLINT;

ALTER TABLE public.question_bank
  DROP CONSTRAINT IF EXISTS question_bank_difficulty_check;

ALTER TABLE public.question_bank
  ADD CONSTRAINT question_bank_difficulty_check
  CHECK (difficulty IS NULL OR (difficulty >= 1 AND difficulty <= 5));

-- save_question_to_bank — acrescenta p_difficulty (opcional)
DROP FUNCTION IF EXISTS public.save_question_to_bank(INT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC);

CREATE OR REPLACE FUNCTION public.save_question_to_bank(
  p_category_n INT,
  p_age_band TEXT,
  p_question TEXT,
  p_correct_answer TEXT,
  p_question_hash TEXT,
  p_options JSONB DEFAULT NULL,
  p_format TEXT DEFAULT NULL,
  p_knowledge_key TEXT DEFAULT NULL,
  p_source TEXT DEFAULT 'ai',
  p_knowledge_id TEXT DEFAULT NULL,
  p_source_id TEXT DEFAULT NULL,
  p_confidence NUMERIC DEFAULT NULL,
  p_difficulty SMALLINT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing public.question_bank%ROWTYPE;
BEGIN
  IF p_question_hash IS NULL OR p_question_hash = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_hash');
  END IF;

  IF public.reino_cat20_bank_requires_knowledge_id(p_category_n, p_format)
     AND (p_knowledge_id IS NULL OR trim(p_knowledge_id) = '') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_knowledge_id');
  END IF;

  IF EXISTS (SELECT 1 FROM public.question_bank_blocked WHERE question_hash = p_question_hash) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'reported');
  END IF;

  SELECT * INTO v_existing
  FROM public.question_bank
  WHERE question_hash = p_question_hash;

  IF FOUND THEN
    IF v_existing.is_reported THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'reported');
    END IF;
    IF p_difficulty IS NOT NULL AND v_existing.difficulty IS NULL THEN
      UPDATE public.question_bank
      SET difficulty = p_difficulty
      WHERE question_hash = p_question_hash;
    END IF;
    RETURN jsonb_build_object('ok', true, 'reason', 'exists');
  END IF;

  IF NOT public.reino_has_valid_mc_options(p_options, p_format, p_correct_answer) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_options');
  END IF;

  INSERT INTO public.question_bank (
    category_n, age_band, question, correct_answer,
    options, format, knowledge_key, question_hash, source,
    knowledge_id, source_id, confidence, difficulty
  ) VALUES (
    p_category_n, p_age_band, p_question, p_correct_answer,
    p_options, p_format, p_knowledge_key, p_question_hash, COALESCE(p_source, 'ai'),
    NULLIF(trim(p_knowledge_id), ''), NULLIF(trim(p_source_id), ''), p_confidence,
    p_difficulty
  );

  RETURN jsonb_build_object('ok', true, 'reason', 'inserted');
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_question_to_bank(INT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, SMALLINT) TO anon, authenticated;
