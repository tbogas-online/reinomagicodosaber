-- Apagar perguntas do banco (admin) — executar no SQL Editor do Supabase
-- Requer question-bank.sql; question_reuse_events é opcional (question-reuse-global.sql).

CREATE OR REPLACE FUNCTION public.delete_questions_from_bank(
  p_hashes TEXT[],
  p_block BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted INT := 0;
  v_blocked INT := 0;
  v_reuse INT := 0;
  v_hashes TEXT[];
BEGIN
  IF p_hashes IS NULL OR array_length(p_hashes, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'deleted', 0, 'blocked', 0, 'reuseEventsRemoved', 0);
  END IF;

  SELECT COALESCE(array_agg(DISTINCT h), ARRAY[]::TEXT[])
  INTO v_hashes
  FROM unnest(p_hashes) AS h
  WHERE h IS NOT NULL AND trim(h) <> '';

  IF array_length(v_hashes, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'deleted', 0, 'blocked', 0, 'reuseEventsRemoved', 0);
  END IF;

  IF to_regclass('public.question_reuse_events') IS NOT NULL THEN
    DELETE FROM public.question_reuse_events
    WHERE question_hash = ANY(v_hashes);
    GET DIAGNOSTICS v_reuse = ROW_COUNT;
  END IF;

  DELETE FROM public.question_bank
  WHERE question_hash = ANY(v_hashes);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  IF COALESCE(p_block, true) THEN
    INSERT INTO public.question_bank_blocked (question_hash)
    SELECT unnest(v_hashes)
    ON CONFLICT (question_hash) DO NOTHING;
    GET DIAGNOSTICS v_blocked = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'deleted', v_deleted,
    'blocked', v_blocked,
    'reuseEventsRemoved', v_reuse
  );
END;
$$;

REVOKE ALL ON FUNCTION public.delete_questions_from_bank(TEXT[], BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_questions_from_bank(TEXT[], BOOLEAN) TO service_role;

-- ---------------------------------------------------------------------------
-- RPC: apagar todas as perguntas de uma categoria (admin)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_questions_from_bank_by_category(
  p_category_n INT,
  p_age_band TEXT DEFAULT NULL,
  p_include_reported BOOLEAN DEFAULT true,
  p_block BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted INT := 0;
  v_blocked INT := 0;
  v_reuse INT := 0;
  v_matched INT := 0;
  v_hashes TEXT[];
BEGIN
  IF p_category_n IS NULL OR p_category_n NOT BETWEEN 1 AND 20 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_category');
  END IF;

  IF p_age_band IS NOT NULL AND p_age_band NOT IN ('6-9', '10-15', '15+') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_age_band');
  END IF;

  SELECT COALESCE(array_agg(qb.question_hash), ARRAY[]::TEXT[])
  INTO v_hashes
  FROM public.question_bank qb
  WHERE qb.category_n = p_category_n
    AND (p_age_band IS NULL OR qb.age_band = p_age_band)
    AND (COALESCE(p_include_reported, true) OR qb.is_reported = false);

  v_matched := COALESCE(array_length(v_hashes, 1), 0);
  IF v_matched = 0 THEN
    RETURN jsonb_build_object(
      'ok', true,
      'matched', 0,
      'deleted', 0,
      'blocked', 0,
      'reuseEventsRemoved', 0,
      'hashes', '[]'::jsonb
    );
  END IF;

  IF to_regclass('public.question_reuse_events') IS NOT NULL THEN
    DELETE FROM public.question_reuse_events
    WHERE question_hash = ANY(v_hashes);
    GET DIAGNOSTICS v_reuse = ROW_COUNT;
  END IF;

  DELETE FROM public.question_bank
  WHERE question_hash = ANY(v_hashes);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  IF COALESCE(p_block, true) THEN
    INSERT INTO public.question_bank_blocked (question_hash)
    SELECT unnest(v_hashes)
    ON CONFLICT (question_hash) DO NOTHING;
    GET DIAGNOSTICS v_blocked = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'matched', v_matched,
    'deleted', v_deleted,
    'blocked', v_blocked,
    'reuseEventsRemoved', v_reuse,
    'hashes', to_jsonb(v_hashes)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.delete_questions_from_bank_by_category(INT, TEXT, BOOLEAN, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_questions_from_bank_by_category(INT, TEXT, BOOLEAN, BOOLEAN) TO service_role;
