-- ---------------------------------------------------------------------------
-- Anti-reuso global (30 dias) — entre sessões e dispositivos
-- Executar no Supabase SQL Editor DEPOIS de question-bank.sql e knowledge-repository.sql
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.question_reuse_events (
  id BIGSERIAL PRIMARY KEY,
  question_hash TEXT NOT NULL,
  knowledge_id TEXT,
  category_n INT,
  age_band TEXT,
  played_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_question_reuse_events_hash_played
  ON public.question_reuse_events (question_hash, played_at DESC);

CREATE INDEX IF NOT EXISTS idx_question_reuse_events_knowledge_played
  ON public.question_reuse_events (knowledge_id, played_at DESC)
  WHERE knowledge_id IS NOT NULL AND knowledge_id <> '';

-- ---------------------------------------------------------------------------
-- RPC: registar pergunta mostrada ao jogador
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_question_reuse(
  p_question_hash TEXT,
  p_knowledge_id TEXT DEFAULT NULL,
  p_category_n INT DEFAULT NULL,
  p_age_band TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_question_hash IS NULL OR trim(p_question_hash) = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_hash');
  END IF;

  INSERT INTO public.question_reuse_events (question_hash, knowledge_id, category_n, age_band)
  VALUES (trim(p_question_hash), NULLIF(trim(p_knowledge_id), ''), p_category_n, NULLIF(trim(p_age_band), ''));

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ---------------------------------------------------------------------------
-- Helper: excluir factos/perguntas jogados nos últimos 30 dias
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reino_recently_played_question(p_question_hash TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.question_reuse_events e
    WHERE e.question_hash = p_question_hash
      AND e.played_at > now() - interval '30 days'
  );
$$;

CREATE OR REPLACE FUNCTION public.reino_recently_played_knowledge(p_knowledge_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT p_knowledge_id IS NOT NULL
    AND trim(p_knowledge_id) <> ''
    AND EXISTS (
      SELECT 1
      FROM public.question_reuse_events e
      WHERE e.knowledge_id = p_knowledge_id
        AND e.played_at > now() - interval '30 days'
    );
$$;

-- ---------------------------------------------------------------------------
-- pick_question_from_bank — exclui também jogos recentes (global)
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- pick_knowledge_record — exclui knowledge_id jogado nos últimos 30 dias
-- ---------------------------------------------------------------------------
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

-- Limpeza opcional (cron ou manual): eventos > 90 dias
-- DELETE FROM public.question_reuse_events WHERE played_at < now() - interval '90 days';

-- ---------------------------------------------------------------------------
-- RPC: estatísticas de quarentena (admin — service role)
-- Perguntas/factos jogados nos últimos N dias (indisponíveis para novo sorteio)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_question_reuse_quarantine_stats(
  p_days INT DEFAULT 30
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days INT := GREATEST(COALESCE(p_days, 30), 1);
  v_cutoff TIMESTAMPTZ := now() - (v_days || ' days')::interval;
  v_bank_total INT := 0;
  v_knowledge_total INT := 0;
  v_events_total INT := 0;
  v_bank_by_category_age JSONB := '[]'::jsonb;
  v_bank_by_category JSONB := '[]'::jsonb;
  v_knowledge_by_category JSONB := '[]'::jsonb;
  v_knowledge_by_category_topic JSONB := '[]'::jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'question_reuse_events'
  ) THEN
    RETURN jsonb_build_object(
      'days', v_days,
      'available', false,
      'bankTotal', 0,
      'knowledgeTotal', 0,
      'eventsTotal', 0,
      'bankByCategoryAge', '[]'::jsonb,
      'bankByCategory', '[]'::jsonb,
      'knowledgeByCategory', '[]'::jsonb,
      'knowledgeByCategoryTopic', '[]'::jsonb
    );
  END IF;

  SELECT COUNT(*)::INT INTO v_events_total
  FROM public.question_reuse_events e
  WHERE e.played_at >= v_cutoff;

  SELECT COUNT(DISTINCT qb.question_hash)::INT INTO v_bank_total
  FROM public.question_bank qb
  INNER JOIN public.question_reuse_events e ON e.question_hash = qb.question_hash
  WHERE e.played_at >= v_cutoff
    AND qb.is_reported = false
    AND public.reino_has_valid_mc_options(qb.options, qb.format, qb.correct_answer);

  SELECT COUNT(DISTINCT kr.knowledge_id)::INT INTO v_knowledge_total
  FROM public.knowledge_records kr
  INNER JOIN public.question_reuse_events e ON e.knowledge_id = kr.knowledge_id
  WHERE e.played_at >= v_cutoff
    AND kr.is_active = true
    AND kr.knowledge_id IS NOT NULL
    AND kr.knowledge_id <> '';

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'category_n', t.category_n,
      'age_band', t.age_band,
      'count', t.cnt
    ) ORDER BY t.category_n, t.age_band
  ), '[]'::jsonb)
  INTO v_bank_by_category_age
  FROM (
    SELECT qb.category_n, qb.age_band, COUNT(DISTINCT qb.question_hash)::INT AS cnt
    FROM public.question_bank qb
    INNER JOIN public.question_reuse_events e ON e.question_hash = qb.question_hash
    WHERE e.played_at >= v_cutoff
      AND qb.is_reported = false
      AND public.reino_has_valid_mc_options(qb.options, qb.format, qb.correct_answer)
    GROUP BY qb.category_n, qb.age_band
  ) t;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object('category_n', t.category_n, 'count', t.cnt)
    ORDER BY t.category_n
  ), '[]'::jsonb)
  INTO v_bank_by_category
  FROM (
    SELECT qb.category_n, COUNT(DISTINCT qb.question_hash)::INT AS cnt
    FROM public.question_bank qb
    INNER JOIN public.question_reuse_events e ON e.question_hash = qb.question_hash
    WHERE e.played_at >= v_cutoff
      AND qb.is_reported = false
      AND public.reino_has_valid_mc_options(qb.options, qb.format, qb.correct_answer)
    GROUP BY qb.category_n
  ) t;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object('category_n', t.category_n, 'count', t.cnt)
    ORDER BY t.category_n
  ), '[]'::jsonb)
  INTO v_knowledge_by_category
  FROM (
    SELECT kr.category_n, COUNT(DISTINCT kr.knowledge_id)::INT AS cnt
    FROM public.knowledge_records kr
    INNER JOIN public.question_reuse_events e ON e.knowledge_id = kr.knowledge_id
    WHERE e.played_at >= v_cutoff
      AND kr.is_active = true
      AND kr.knowledge_id IS NOT NULL
      AND kr.knowledge_id <> ''
    GROUP BY kr.category_n
  ) t;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'category_n', t.category_n,
      'topic', t.topic,
      'count', t.cnt
    ) ORDER BY t.category_n, t.topic
  ), '[]'::jsonb)
  INTO v_knowledge_by_category_topic
  FROM (
    SELECT kr.category_n, kr.topic, COUNT(DISTINCT kr.knowledge_id)::INT AS cnt
    FROM public.knowledge_records kr
    INNER JOIN public.question_reuse_events e ON e.knowledge_id = kr.knowledge_id
    WHERE e.played_at >= v_cutoff
      AND kr.is_active = true
      AND kr.knowledge_id IS NOT NULL
      AND kr.knowledge_id <> ''
    GROUP BY kr.category_n, kr.topic
  ) t;

  RETURN jsonb_build_object(
    'days', v_days,
    'available', true,
    'bankTotal', v_bank_total,
    'knowledgeTotal', v_knowledge_total,
    'eventsTotal', v_events_total,
    'bankByCategoryAge', v_bank_by_category_age,
    'bankByCategory', v_bank_by_category,
    'knowledgeByCategory', v_knowledge_by_category,
    'knowledgeByCategoryTopic', v_knowledge_by_category_topic
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_question_reuse_quarantine_stats(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_question_reuse_quarantine_stats(INT) TO service_role;

REVOKE ALL ON FUNCTION public.record_question_reuse(TEXT, TEXT, INT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_question_reuse(TEXT, TEXT, INT, TEXT) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.reino_recently_played_question(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reino_recently_played_question(TEXT) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.reino_recently_played_knowledge(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reino_recently_played_knowledge(TEXT) TO anon, authenticated;

GRANT EXECUTE ON FUNCTION public.pick_question_from_bank(INT, TEXT, TEXT[], TEXT[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pick_knowledge_record(INT, TEXT, TEXT, TEXT, TEXT, TEXT[], NUMERIC) TO anon, authenticated;
