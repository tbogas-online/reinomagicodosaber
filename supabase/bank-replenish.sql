-- Reabastecimento do question_bank + contagens de stock jogável
-- Executar no SQL Editor do Supabase APÓS question-bank.sql e question-reuse-global.sql

-- Perguntas com opções válidas e fora de quarentena (jogáveis agora)
CREATE OR REPLACE FUNCTION public.count_playable_bank_questions(
  p_category_n INT,
  p_age_band TEXT
)
RETURNS INT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::INT
  FROM public.question_bank qb
  WHERE qb.category_n = p_category_n
    AND qb.age_band = p_age_band
    AND qb.is_reported = false
    AND NOT EXISTS (
      SELECT 1 FROM public.question_bank_blocked b WHERE b.question_hash = qb.question_hash
    )
    AND NOT public.reino_recently_played_question(qb.question_hash)
    AND NOT public.reino_recently_played_knowledge(qb.knowledge_id)
    AND public.reino_has_valid_mc_options(qb.options, qb.format, qb.correct_answer);
$$;

-- Factos do repositório ainda não materializados no banco para uma faixa etária
CREATE OR REPLACE FUNCTION public.list_unmaterialized_knowledge(
  p_category_n INT,
  p_age_band TEXT,
  p_topic TEXT DEFAULT 'adivinha tradicional',
  p_limit INT DEFAULT 50,
  p_min_confidence NUMERIC DEFAULT 0.850
)
RETURNS SETOF public.knowledge_records
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT kr.*
  FROM public.knowledge_records kr
  WHERE kr.category_n = p_category_n
    AND kr.is_active = true
    AND kr.confidence >= COALESCE(p_min_confidence, 0.850)
    AND (p_topic IS NULL OR p_topic = '' OR kr.topic = p_topic)
    AND public.knowledge_record_matches_context(kr, p_age_band, 'ADIVINHA')
    AND NOT EXISTS (
      SELECT 1
      FROM public.question_bank qb
      WHERE qb.knowledge_id = kr.knowledge_id
        AND qb.age_band = p_age_band
        AND qb.is_reported = false
        AND public.reino_has_valid_mc_options(qb.options, qb.format, qb.correct_answer)
    )
  ORDER BY COALESCE(kr.priority_pt, 50) DESC, random()
  LIMIT GREATEST(COALESCE(p_limit, 50), 1);
$$;

REVOKE ALL ON FUNCTION public.count_playable_bank_questions(INT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.count_playable_bank_questions(INT, TEXT) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.list_unmaterialized_knowledge(INT, TEXT, TEXT, INT, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_unmaterialized_knowledge(INT, TEXT, TEXT, INT, NUMERIC) TO anon, authenticated;

-- pick_question_from_bank — fallback quando quarentena esgota stock
CREATE OR REPLACE FUNCTION public.pick_question_from_bank(
  p_category_n INT,
  p_age_band TEXT,
  p_exclude_hashes TEXT[] DEFAULT '{}'::TEXT[],
  p_exclude_knowledge_ids TEXT[] DEFAULT '{}'::TEXT[]
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
BEGIN
  IF p_category_n IS NULL OR p_age_band IS NULL OR p_age_band = '' THEN
    RETURN NULL;
  END IF;

  SELECT *
    INTO v_row
  FROM public.question_bank qb
  WHERE qb.category_n = p_category_n
    AND qb.age_band = p_age_band
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
    AND NOT public.reino_recently_played_knowledge(qb.knowledge_id)
    AND public.reino_has_valid_mc_options(qb.options, qb.format, qb.correct_answer)
  ORDER BY random()
  LIMIT 1;

  IF NOT FOUND THEN
    SELECT *
      INTO v_row
    FROM public.question_bank qb
    WHERE qb.category_n = p_category_n
      AND qb.age_band = p_age_band
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
      AND public.reino_has_valid_mc_options(qb.options, qb.format, qb.correct_answer)
    ORDER BY (
      SELECT MAX(e.played_at)
      FROM public.question_reuse_events e
      WHERE e.question_hash = qb.question_hash
    ) ASC NULLS FIRST,
    random()
    LIMIT 1;
  END IF;

  IF NOT FOUND THEN
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
    'dbCreatedAt', v_row.created_at
  );
END;
$$;

-- pick_knowledge_record — fallback quando quarentena esgota stock
CREATE OR REPLACE FUNCTION public.pick_knowledge_record(
  p_category_n INT,
  p_age_band TEXT,
  p_topic TEXT DEFAULT NULL,
  p_subtopic TEXT DEFAULT NULL,
  p_format TEXT DEFAULT NULL,
  p_exclude_knowledge_ids TEXT[] DEFAULT '{}'::TEXT[],
  p_min_confidence NUMERIC DEFAULT 0.850
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.knowledge_records%ROWTYPE;
BEGIN
  IF p_category_n IS NULL OR p_age_band IS NULL OR p_age_band = '' THEN
    RETURN NULL;
  END IF;

  SELECT *
    INTO v_row
  FROM public.knowledge_records kr
  WHERE kr.category_n = p_category_n
    AND kr.is_active = true
    AND kr.confidence >= COALESCE(p_min_confidence, 0.850)
    AND public.knowledge_record_matches_context(kr, p_age_band, p_format)
    AND (p_topic IS NULL OR p_topic = '' OR kr.topic = p_topic)
    AND (p_subtopic IS NULL OR p_subtopic = '' OR kr.subtopic = p_subtopic)
    AND (
      p_exclude_knowledge_ids IS NULL
      OR cardinality(p_exclude_knowledge_ids) = 0
      OR kr.knowledge_id <> ALL(p_exclude_knowledge_ids)
    )
    AND NOT public.reino_recently_played_knowledge(kr.knowledge_id)
  ORDER BY COALESCE(kr.priority_pt, 50) DESC, random()
  LIMIT 1;

  IF NOT FOUND THEN
    SELECT *
      INTO v_row
    FROM public.knowledge_records kr
    WHERE kr.category_n = p_category_n
      AND kr.is_active = true
      AND kr.confidence >= COALESCE(p_min_confidence, 0.850)
      AND public.knowledge_record_matches_context(kr, p_age_band, p_format)
      AND (p_topic IS NULL OR p_topic = '' OR kr.topic = p_topic)
      AND (p_subtopic IS NULL OR p_subtopic = '' OR kr.subtopic = p_subtopic)
      AND (
        p_exclude_knowledge_ids IS NULL
        OR cardinality(p_exclude_knowledge_ids) = 0
        OR kr.knowledge_id <> ALL(p_exclude_knowledge_ids)
      )
    ORDER BY (
      SELECT MAX(e.played_at)
      FROM public.question_reuse_events e
      WHERE e.knowledge_id = kr.knowledge_id
    ) ASC NULLS FIRST,
    COALESCE(kr.priority_pt, 50) DESC,
    random()
    LIMIT 1;
  END IF;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  UPDATE public.knowledge_records
  SET usage_count = usage_count + 1,
      updated_at = now()
  WHERE id = v_row.id;

  RETURN jsonb_build_object(
    'knowledgeId', v_row.knowledge_id,
    'category', v_row.category_n,
    'topic', v_row.topic,
    'subtopic', v_row.subtopic,
    'fact', v_row.fact,
    'answer', v_row.answer,
    'clues', v_row.clues,
    'statement', v_row.statement,
    'isTrue', v_row.is_true,
    'source', v_row.source,
    'sourceId', v_row.source_id,
    'sourceUrl', v_row.source_url,
    'license', v_row.license,
    'confidence', v_row.confidence,
    'priorityPt', v_row.priority_pt,
    'ageBands', to_jsonb(v_row.age_bands),
    'allowedFormats', to_jsonb(v_row.allowed_formats),
    'tags', to_jsonb(v_row.tags),
    'verifiedAt', v_row.verified_at,
    'verifiedBy', v_row.verified_by,
    'dbCreatedAt', v_row.created_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.pick_question_from_bank(INT, TEXT, TEXT[], TEXT[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pick_knowledge_record(INT, TEXT, TEXT, TEXT, TEXT, TEXT[], NUMERIC) TO anon, authenticated;
