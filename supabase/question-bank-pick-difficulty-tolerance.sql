-- Tolerância de dificuldade (±1) ao escolher pergunta do banco.
-- Executar no SQL Editor do Supabase após question-bank-difficulty.sql
-- e question-bank-difficulty-by-age.sql.
-- Depois: NOTIFY pgrst, 'reload schema';

-- Remove overload de 4 argumentos (ambíguo com a versão de 5 abaixo).
DROP FUNCTION IF EXISTS public.pick_question_from_bank(INT, TEXT, TEXT[], TEXT[]);

CREATE OR REPLACE FUNCTION public.reino_bank_effective_difficulty(
  p_row public.question_bank,
  p_age_band TEXT
)
RETURNS INT
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    NULLIF(TRIM(p_row.difficulty_by_age_band ->> p_age_band), '')::INT,
    p_row.difficulty
  );
$$;

CREATE OR REPLACE FUNCTION public.pick_question_from_bank(
  p_category_n INT,
  p_age_band TEXT,
  p_exclude_hashes TEXT[] DEFAULT '{}'::TEXT[],
  p_exclude_knowledge_ids TEXT[] DEFAULT '{}'::TEXT[],
  p_requested_difficulty INT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.question_bank%ROWTYPE;
  v_fact_source TEXT;
  v_source_url TEXT;
  v_req INT;
BEGIN
  IF p_category_n IS NULL OR p_age_band IS NULL OR p_age_band = '' THEN
    RETURN NULL;
  END IF;

  v_req := CASE
    WHEN p_requested_difficulty IS NULL THEN NULL
    WHEN p_requested_difficulty < 1 THEN 1
    WHEN p_requested_difficulty > 5 THEN 5
    ELSE p_requested_difficulty
  END;

  v_row := NULL;

  IF v_req IS NOT NULL THEN
    SELECT *
      INTO v_row
    FROM public.question_bank qb
    WHERE public.reino_bank_category_matches(qb.category_ns, p_category_n, qb.category_n)
      AND public.reino_bank_age_matches(qb.age_bands, p_age_band, qb.age_band)
      AND qb.is_reported = false
      AND NOT EXISTS (
        SELECT 1 FROM public.question_bank_blocked b WHERE b.question_hash = qb.question_hash
      )
      AND (p_exclude_hashes IS NULL OR cardinality(p_exclude_hashes) = 0 OR qb.question_hash <> ALL(p_exclude_hashes))
      AND (
        p_exclude_knowledge_ids IS NULL
        OR cardinality(p_exclude_knowledge_ids) = 0
        OR qb.knowledge_id IS NULL
        OR qb.knowledge_id = ''
        OR qb.knowledge_id <> ALL(p_exclude_knowledge_ids)
      )
      AND NOT public.reino_recently_played_question(qb.question_hash)
      AND (
        qb.knowledge_id IS NULL
        OR qb.knowledge_id = ''
        OR NOT public.reino_recently_played_knowledge(qb.knowledge_id)
      )
      AND public.reino_has_valid_mc_options(qb.options, qb.format, qb.correct_answer)
      AND public.reino_bank_effective_difficulty(qb, p_age_band) = v_req
    ORDER BY random()
    LIMIT 1;

    IF NOT FOUND THEN
      SELECT *
        INTO v_row
      FROM public.question_bank qb
      WHERE public.reino_bank_category_matches(qb.category_ns, p_category_n, qb.category_n)
        AND public.reino_bank_age_matches(qb.age_bands, p_age_band, qb.age_band)
        AND qb.is_reported = false
        AND NOT EXISTS (
          SELECT 1 FROM public.question_bank_blocked b WHERE b.question_hash = qb.question_hash
        )
        AND (p_exclude_hashes IS NULL OR cardinality(p_exclude_hashes) = 0 OR qb.question_hash <> ALL(p_exclude_hashes))
        AND (
          p_exclude_knowledge_ids IS NULL
          OR cardinality(p_exclude_knowledge_ids) = 0
          OR qb.knowledge_id IS NULL
          OR qb.knowledge_id = ''
          OR qb.knowledge_id <> ALL(p_exclude_knowledge_ids)
        )
        AND NOT public.reino_recently_played_question(qb.question_hash)
        AND (
          qb.knowledge_id IS NULL
          OR qb.knowledge_id = ''
          OR NOT public.reino_recently_played_knowledge(qb.knowledge_id)
        )
        AND public.reino_has_valid_mc_options(qb.options, qb.format, qb.correct_answer)
        AND public.reino_bank_effective_difficulty(qb, p_age_band) BETWEEN GREATEST(1, v_req - 1) AND LEAST(5, v_req + 1)
      ORDER BY ABS(public.reino_bank_effective_difficulty(qb, p_age_band) - v_req), random()
      LIMIT 1;
    END IF;
  END IF;

  IF v_row IS NULL OR v_row.question_hash IS NULL THEN
    SELECT *
      INTO v_row
    FROM public.question_bank qb
    WHERE public.reino_bank_category_matches(qb.category_ns, p_category_n, qb.category_n)
      AND public.reino_bank_age_matches(qb.age_bands, p_age_band, qb.age_band)
      AND qb.is_reported = false
      AND NOT EXISTS (
        SELECT 1 FROM public.question_bank_blocked b WHERE b.question_hash = qb.question_hash
      )
      AND (p_exclude_hashes IS NULL OR cardinality(p_exclude_hashes) = 0 OR qb.question_hash <> ALL(p_exclude_hashes))
      AND (
        p_exclude_knowledge_ids IS NULL
        OR cardinality(p_exclude_knowledge_ids) = 0
        OR qb.knowledge_id IS NULL
        OR qb.knowledge_id = ''
        OR qb.knowledge_id <> ALL(p_exclude_knowledge_ids)
      )
      AND NOT public.reino_recently_played_question(qb.question_hash)
      AND (
        qb.knowledge_id IS NULL
        OR qb.knowledge_id = ''
        OR NOT public.reino_recently_played_knowledge(qb.knowledge_id)
      )
      AND public.reino_has_valid_mc_options(qb.options, qb.format, qb.correct_answer)
    ORDER BY random()
    LIMIT 1;
  END IF;

  IF v_row IS NULL OR v_row.question_hash IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT kr.source, kr.source_url
    INTO v_fact_source, v_source_url
  FROM public.knowledge_records kr
  WHERE v_row.knowledge_id IS NOT NULL
    AND v_row.knowledge_id <> ''
    AND kr.knowledge_id = v_row.knowledge_id
  LIMIT 1;

  RETURN jsonb_build_object(
    'q', v_row.question,
    'a', v_row.correct_answer,
    'options', v_row.options,
    'format', v_row.format,
    'knowledge_key', v_row.knowledge_key,
    'knowledge_id', v_row.knowledge_id,
    'question_hash', v_row.question_hash,
    'source', 'bank',
    'bank_origin', v_row.source,
    'source_id', v_row.source_id,
    'fact_source', v_fact_source,
    'source_url', v_source_url,
    'dbCreatedAt', v_row.created_at,
    'difficulty', public.reino_bank_effective_difficulty(v_row, p_age_band)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.pick_question_from_bank(INT, TEXT, TEXT[], TEXT[], INT) TO anon, authenticated;
