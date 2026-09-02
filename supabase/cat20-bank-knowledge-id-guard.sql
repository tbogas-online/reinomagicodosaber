-- KR-1.4 — bloquear question_bank cat. 20 (ADIVINHA/CURIOSIDADE/VF) sem knowledge_id
-- Executar no SQL Editor do Supabase (após question-bank.sql e knowledge-repository.sql).

-- ---------------------------------------------------------------------------
-- Helper: formatos cat. 20 que exigem knowledge_id no banco
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reino_cat20_bank_requires_knowledge_id(
  p_category_n INT,
  p_format TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_category_n = 20
    AND NULLIF(trim(COALESCE(p_format, '')), '') IN (
      'ADIVINHA',
      'CURIOSIDADE',
      'VERDADEIRO_FALSO'
    );
$$;

-- ---------------------------------------------------------------------------
-- save_question_to_bank — rejeita cat. 20 sem knowledge_id
-- ---------------------------------------------------------------------------
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
  p_confidence NUMERIC DEFAULT NULL
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
    RETURN jsonb_build_object('ok', true, 'reason', 'exists');
  END IF;

  IF NOT public.reino_has_valid_mc_options(p_options, p_format, p_correct_answer) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_options');
  END IF;

  INSERT INTO public.question_bank (
    category_n, age_band, question, correct_answer,
    options, format, knowledge_key, question_hash, source,
    knowledge_id, source_id, confidence
  ) VALUES (
    p_category_n, p_age_band, p_question, p_correct_answer,
    p_options, p_format, p_knowledge_key, p_question_hash, COALESCE(p_source, 'ai'),
    NULLIF(trim(p_knowledge_id), ''), NULLIF(trim(p_source_id), ''), p_confidence
  );

  RETURN jsonb_build_object('ok', true, 'reason', 'inserted');
END;
$$;

-- ---------------------------------------------------------------------------
-- import_questions_batch — persiste knowledge_id + guarda cat. 20
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.import_questions_batch(p_items JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  item JSONB;
  v_hash TEXT;
  v_category INT;
  v_format TEXT;
  v_knowledge_id TEXT;
  v_inserted INT := 0;
  v_exists INT := 0;
  v_skipped INT := 0;
  v_missing_knowledge_id INT := 0;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'inserted', 0,
      'exists', 0,
      'skipped', 0,
      'missing_knowledge_id', 0
    );
  END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_hash := item->>'question_hash';
    IF v_hash IS NULL OR v_hash = '' THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    v_category := (item->>'category_n')::INT;
    v_format := NULLIF(trim(COALESCE(item->>'format', '')), '');
    v_knowledge_id := NULLIF(trim(COALESCE(item->>'knowledge_id', '')), '');

    IF public.reino_cat20_bank_requires_knowledge_id(v_category, v_format)
       AND v_knowledge_id IS NULL THEN
      v_missing_knowledge_id := v_missing_knowledge_id + 1;
      CONTINUE;
    END IF;

    IF EXISTS (SELECT 1 FROM public.question_bank_blocked WHERE question_hash = v_hash) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    IF EXISTS (SELECT 1 FROM public.question_bank WHERE question_hash = v_hash) THEN
      v_exists := v_exists + 1;
      CONTINUE;
    END IF;

    IF v_category IS NULL
      OR v_category NOT BETWEEN 1 AND 20
      OR item->>'age_band' IS NULL
      OR item->>'age_band' NOT IN ('6-9', '10-15', '15+')
      OR length(trim(COALESCE(item->>'question', ''))) = 0
      OR length(trim(COALESCE(item->>'correct_answer', ''))) = 0
      OR NOT public.reino_has_valid_mc_options(
        item->'options',
        v_format,
        item->>'correct_answer'
      )
    THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    INSERT INTO public.question_bank (
      category_n, age_band, question, correct_answer,
      options, format, knowledge_key, question_hash, source,
      knowledge_id, source_id, confidence
    ) VALUES (
      v_category,
      item->>'age_band',
      item->>'question',
      item->>'correct_answer',
      item->'options',
      v_format,
      NULLIF(trim(COALESCE(item->>'knowledge_key', '')), ''),
      v_hash,
      COALESCE(NULLIF(trim(COALESCE(item->>'source', '')), ''), 'local'),
      v_knowledge_id,
      NULLIF(trim(COALESCE(item->>'source_id', '')), ''),
      NULLIF(item->>'confidence', '')::NUMERIC
    );
    v_inserted := v_inserted + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'inserted', v_inserted,
    'exists', v_exists,
    'skipped', v_skipped,
    'missing_knowledge_id', v_missing_knowledge_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reino_cat20_bank_requires_knowledge_id(INT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reino_cat20_bank_requires_knowledge_id(INT, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.save_question_to_bank(INT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_question_to_bank(INT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.import_questions_batch(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.import_questions_batch(JSONB) TO anon, authenticated;
