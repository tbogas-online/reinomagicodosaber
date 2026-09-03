-- Múltiplas categorias e faixas etárias por pergunta no question_bank
-- Executar no SQL Editor do Supabase após question-bank.sql e question-reuse-global.sql

ALTER TABLE public.question_bank
  ADD COLUMN IF NOT EXISTS category_ns INT[],
  ADD COLUMN IF NOT EXISTS age_bands TEXT[];

UPDATE public.question_bank
SET
  category_ns = ARRAY[category_n],
  age_bands = ARRAY[age_band]
WHERE category_ns IS NULL
   OR age_bands IS NULL
   OR cardinality(category_ns) = 0
   OR cardinality(age_bands) = 0;

CREATE OR REPLACE FUNCTION public.reino_bank_category_matches(
  p_category_ns INT[],
  p_category_n INT,
  p_legacy_category_n INT
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_category_n IS NULL THEN FALSE
    WHEN p_category_ns IS NOT NULL AND cardinality(p_category_ns) > 0 THEN p_category_n = ANY(p_category_ns)
    ELSE p_legacy_category_n = p_category_n
  END;
$$;

CREATE OR REPLACE FUNCTION public.reino_bank_age_matches(
  p_age_bands TEXT[],
  p_age_band TEXT,
  p_legacy_age_band TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_age_band IS NULL OR p_age_band = '' THEN FALSE
    WHEN p_age_bands IS NOT NULL AND cardinality(p_age_bands) > 0 THEN p_age_band = ANY(p_age_bands)
    ELSE p_legacy_age_band = p_age_band
  END;
$$;

CREATE OR REPLACE FUNCTION public.reino_sync_bank_taxonomy_legacy()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.category_ns IS NOT NULL AND cardinality(NEW.category_ns) > 0 THEN
    NEW.category_n := NEW.category_ns[1];
  ELSIF NEW.category_n IS NOT NULL THEN
    NEW.category_ns := ARRAY[NEW.category_n];
  END IF;

  IF NEW.age_bands IS NOT NULL AND cardinality(NEW.age_bands) > 0 THEN
    NEW.age_band := NEW.age_bands[1];
  ELSIF NEW.age_band IS NOT NULL THEN
    NEW.age_bands := ARRAY[NEW.age_band];
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_bank_taxonomy ON public.question_bank;
CREATE TRIGGER trg_sync_bank_taxonomy
  BEFORE INSERT OR UPDATE ON public.question_bank
  FOR EACH ROW
  EXECUTE FUNCTION public.reino_sync_bank_taxonomy_legacy();

-- pick_question_from_bank — suporta arrays (mantém quarentena global se existir)
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

CREATE OR REPLACE FUNCTION public.get_question_bank_stats()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total INT;
  v_active INT;
  v_valid_active INT;
  v_invalid_active INT;
  v_reported INT;
  v_blocked INT;
  v_by_category_age JSONB;
  v_by_source JSONB;
BEGIN
  SELECT COUNT(*) INTO v_total FROM public.question_bank;
  SELECT COUNT(*) INTO v_active FROM public.question_bank WHERE is_reported = false;
  SELECT COUNT(*) INTO v_reported FROM public.question_bank WHERE is_reported = true;
  SELECT COUNT(*) INTO v_blocked FROM public.question_bank_blocked;
  SELECT COUNT(*) INTO v_valid_active
  FROM public.question_bank qb
  WHERE qb.is_reported = false
    AND public.reino_has_valid_mc_options(qb.options, qb.format, qb.correct_answer);
  v_invalid_active := GREATEST(v_active - v_valid_active, 0);

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'category_n', t.category_n,
      'age_band', t.age_band,
      'count', t.cnt
    ) ORDER BY t.category_n, t.age_band
  ), '[]'::jsonb)
  INTO v_by_category_age
  FROM (
    SELECT cat_n AS category_n, age_b AS age_band, COUNT(*)::INT AS cnt
    FROM public.question_bank qb,
      LATERAL unnest(
        CASE
          WHEN qb.category_ns IS NOT NULL AND cardinality(qb.category_ns) > 0 THEN qb.category_ns
          ELSE ARRAY[qb.category_n]
        END
      ) AS cat_n,
      LATERAL unnest(
        CASE
          WHEN qb.age_bands IS NOT NULL AND cardinality(qb.age_bands) > 0 THEN qb.age_bands
          ELSE ARRAY[qb.age_band]
        END
      ) AS age_b
    WHERE qb.is_reported = false
      AND public.reino_has_valid_mc_options(qb.options, qb.format, qb.correct_answer)
    GROUP BY cat_n, age_b
  ) t;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object('source', t.source, 'count', t.cnt) ORDER BY t.cnt DESC, t.source
  ), '[]'::jsonb)
  INTO v_by_source
  FROM (
    SELECT source, COUNT(*)::INT AS cnt
    FROM public.question_bank qb
    WHERE qb.is_reported = false
      AND public.reino_has_valid_mc_options(qb.options, qb.format, qb.correct_answer)
    GROUP BY source
  ) t;

  RETURN jsonb_build_object(
    'total', v_total,
    'active', v_active,
    'validActive', v_valid_active,
    'invalidActive', v_invalid_active,
    'reported', v_reported,
    'blocked', v_blocked,
    'byCategoryAge', v_by_category_age,
    'bySource', v_by_source
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_question_bank_coverage()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'category_n', t.category_n,
        'age_band', t.age_band,
        'count', t.cnt
      ) ORDER BY t.cnt ASC, t.category_n, t.age_band
    )
    FROM (
      SELECT cat_n AS category_n, age_b AS age_band, COUNT(*)::INT AS cnt
      FROM public.question_bank qb,
        LATERAL unnest(
          CASE
            WHEN qb.category_ns IS NOT NULL AND cardinality(qb.category_ns) > 0 THEN qb.category_ns
            ELSE ARRAY[qb.category_n]
          END
        ) AS cat_n,
        LATERAL unnest(
          CASE
            WHEN qb.age_bands IS NOT NULL AND cardinality(qb.age_bands) > 0 THEN qb.age_bands
            ELSE ARRAY[qb.age_band]
          END
        ) AS age_b
      WHERE qb.is_reported = false
        AND public.reino_has_valid_mc_options(qb.options, qb.format, qb.correct_answer)
      GROUP BY cat_n, age_b
    ) t
  ), '[]'::jsonb);
END;
$$;

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
  WHERE public.reino_bank_category_matches(qb.category_ns, p_category_n, qb.category_n)
    AND (
      p_age_band IS NULL
      OR public.reino_bank_age_matches(qb.age_bands, p_age_band, qb.age_band)
    )
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
