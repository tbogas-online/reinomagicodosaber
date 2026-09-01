-- ---------------------------------------------------------------------------
-- Reportes — bloqueio permanente até correcção explícita
-- Executar no Supabase SQL Editor (após question-bank.sql e knowledge-repository.sql)
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.mark_question_reported(TEXT);

CREATE OR REPLACE FUNCTION public.mark_question_reported(
  p_question_hash TEXT,
  p_knowledge_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_question_hash IS NULL OR trim(p_question_hash) = '' THEN
    RETURN jsonb_build_object('ok', false);
  END IF;

  INSERT INTO public.question_bank_blocked (question_hash)
  VALUES (trim(p_question_hash))
  ON CONFLICT (question_hash) DO NOTHING;

  UPDATE public.question_bank
  SET is_reported = true, reported_at = now()
  WHERE question_hash = trim(p_question_hash) AND is_reported = false;

  IF p_knowledge_id IS NOT NULL AND trim(p_knowledge_id) <> '' THEN
    UPDATE public.knowledge_records
    SET is_active = false, updated_at = now()
    WHERE knowledge_id = trim(p_knowledge_id) AND is_active = true;
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- Lista de hashes bloqueados (cliente — anti-repetição entre dispositivos)
CREATE OR REPLACE FUNCTION public.get_reported_question_hashes()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'hashes', COALESCE(
      (SELECT jsonb_agg(b.question_hash ORDER BY b.reported_at DESC)
       FROM public.question_bank_blocked b),
      '[]'::jsonb
    )
  );
$$;

-- Correcção admin: remove bloqueio antigo e grava pergunta corrigida (novo hash)
CREATE OR REPLACE FUNCTION public.correct_reported_question(
  p_old_question_hash TEXT,
  p_category_n INT,
  p_age_band TEXT,
  p_question TEXT,
  p_correct_answer TEXT,
  p_question_hash TEXT,
  p_options JSONB DEFAULT NULL,
  p_format TEXT DEFAULT NULL,
  p_knowledge_key TEXT DEFAULT NULL,
  p_knowledge_id TEXT DEFAULT NULL,
  p_source TEXT DEFAULT 'corrected'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old public.question_bank%ROWTYPE;
BEGIN
  IF p_old_question_hash IS NULL OR trim(p_old_question_hash) = ''
    OR p_question_hash IS NULL OR trim(p_question_hash) = ''
    OR p_category_n IS NULL OR p_age_band IS NULL OR p_age_band = ''
    OR length(trim(COALESCE(p_question, ''))) = 0
    OR length(trim(COALESCE(p_correct_answer, ''))) = 0
  THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_fields');
  END IF;

  IF trim(p_old_question_hash) = trim(p_question_hash) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'hash_unchanged');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.question_bank_blocked
    WHERE question_hash = trim(p_old_question_hash)
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_blocked');
  END IF;

  IF NOT public.reino_has_valid_mc_options(p_options, p_format, p_correct_answer) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_options');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.question_bank_blocked
    WHERE question_hash = trim(p_question_hash)
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'new_hash_blocked');
  END IF;

  SELECT * INTO v_old
  FROM public.question_bank
  WHERE question_hash = trim(p_old_question_hash);

  DELETE FROM public.question_bank_blocked
  WHERE question_hash = trim(p_old_question_hash);

  DELETE FROM public.question_bank
  WHERE question_hash = trim(p_old_question_hash);

  INSERT INTO public.question_bank (
    category_n, age_band, question, correct_answer,
    options, format, knowledge_key, question_hash, source,
    knowledge_id, is_reported, reported_at
  ) VALUES (
    p_category_n, p_age_band, p_question, p_correct_answer,
    p_options, p_format, NULLIF(trim(p_knowledge_key), ''), trim(p_question_hash),
    COALESCE(NULLIF(trim(p_source), ''), 'corrected'),
    NULLIF(trim(p_knowledge_id), ''), false, NULL
  );

  IF p_knowledge_id IS NOT NULL AND trim(p_knowledge_id) <> '' THEN
    UPDATE public.knowledge_records
    SET is_active = true, updated_at = now()
    WHERE knowledge_id = trim(p_knowledge_id);
  END IF;

  RETURN jsonb_build_object('ok', true, 'reason', 'corrected', 'oldHash', trim(p_old_question_hash));
END;
$$;

REVOKE ALL ON FUNCTION public.mark_question_reported(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_question_reported(TEXT, TEXT) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.get_reported_question_hashes() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_reported_question_hashes() TO anon, authenticated;

REVOKE ALL ON FUNCTION public.correct_reported_question(TEXT, INT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.correct_reported_question(TEXT, INT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT) TO service_role;
