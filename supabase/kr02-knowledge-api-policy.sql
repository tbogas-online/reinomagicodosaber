-- KR-0.2 / KR-0.3 — API cliente (get/list) + política (superseded, confiança)
-- Executar no Supabase APÓS knowledge-repository.sql e question-reuse-global.sql

-- ---------------------------------------------------------------------------
-- Helper: JSON estável de um registo activo
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.knowledge_record_to_json(p_row public.knowledge_records)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_build_object(
    'knowledgeId', p_row.knowledge_id,
    'category', p_row.category_n,
    'topic', p_row.topic,
    'subtopic', p_row.subtopic,
    'fact', p_row.fact,
    'answer', p_row.answer,
    'clues', p_row.clues,
    'statement', p_row.statement,
    'isTrue', p_row.is_true,
    'source', p_row.source,
    'sourceId', p_row.source_id,
    'sourceUrl', p_row.source_url,
    'license', p_row.license,
    'confidence', p_row.confidence,
    'priorityPt', p_row.priority_pt,
    'ageBands', to_jsonb(p_row.age_bands),
    'allowedFormats', to_jsonb(p_row.allowed_formats),
    'tags', to_jsonb(p_row.tags),
    'verifiedAt', p_row.verified_at,
    'verifiedBy', p_row.verified_by,
    'isActive', p_row.is_active,
    'blocked', NOT p_row.is_active,
    'supersededBy', p_row.superseded_by,
    'usageCount', p_row.usage_count,
    'dbCreatedAt', p_row.created_at
  );
$$;

-- ---------------------------------------------------------------------------
-- RPC: obter registo por knowledge_id (só activos, não substituídos)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_knowledge_record(p_knowledge_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.knowledge_records%ROWTYPE;
BEGIN
  IF p_knowledge_id IS NULL OR trim(p_knowledge_id) = '' THEN
    RETURN NULL;
  END IF;

  SELECT *
    INTO v_row
  FROM public.knowledge_records kr
  WHERE kr.knowledge_id = trim(p_knowledge_id)
    AND kr.is_active = true
    AND kr.superseded_by IS NULL
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN public.knowledge_record_to_json(v_row);
END;
$$;

-- ---------------------------------------------------------------------------
-- RPC: listar registos (paginado; cliente browser)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_knowledge_records(
  p_category_n INT,
  p_topic TEXT DEFAULT NULL,
  p_subtopic TEXT DEFAULT NULL,
  p_format TEXT DEFAULT NULL,
  p_age_band TEXT DEFAULT NULL,
  p_min_confidence NUMERIC DEFAULT 0.850,
  p_limit INT DEFAULT 50,
  p_offset INT DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit INT := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_offset INT := GREATEST(COALESCE(p_offset, 0), 0);
  v_rows JSONB;
BEGIN
  IF p_category_n IS NULL OR p_category_n NOT BETWEEN 1 AND 20 THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT COALESCE(jsonb_agg(public.knowledge_record_to_json(kr) ORDER BY kr.updated_at DESC), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT *
    FROM public.knowledge_records kr
    WHERE kr.category_n = p_category_n
      AND kr.is_active = true
      AND kr.superseded_by IS NULL
      AND kr.confidence >= COALESCE(p_min_confidence, 0.850)
      AND (p_topic IS NULL OR p_topic = '' OR kr.topic = p_topic)
      AND (p_subtopic IS NULL OR p_subtopic = '' OR kr.subtopic = p_subtopic)
      AND (
        p_age_band IS NULL OR p_age_band = ''
        OR public.knowledge_record_matches_context(kr, p_age_band, p_format)
      )
      AND (
        p_format IS NULL OR p_format = ''
        OR public.knowledge_record_matches_context(kr, COALESCE(NULLIF(p_age_band, ''), '6-9'), p_format)
      )
    ORDER BY kr.updated_at DESC
    LIMIT v_limit
    OFFSET v_offset
  ) kr;

  RETURN COALESCE(v_rows, '[]'::jsonb);
END;
$$;

-- ---------------------------------------------------------------------------
-- RPC: marcar facto como usado (anti-reuso global 30 dias)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_knowledge_used(
  p_knowledge_id TEXT,
  p_age_band TEXT DEFAULT NULL,
  p_category_n INT DEFAULT NULL,
  p_session_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_kid TEXT := NULLIF(trim(p_knowledge_id), '');
  v_hash TEXT;
BEGIN
  IF v_kid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_knowledge_id');
  END IF;

  v_hash := 'kid:' || v_kid;
  IF p_session_id IS NOT NULL AND trim(p_session_id) <> '' THEN
    v_hash := v_hash || ':' || left(trim(p_session_id), 64);
  END IF;

  INSERT INTO public.question_reuse_events (question_hash, knowledge_id, category_n, age_band)
  VALUES (v_hash, v_kid, p_category_n, NULLIF(trim(p_age_band), ''));

  RETURN jsonb_build_object('ok', true);
EXCEPTION
  WHEN undefined_table THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'reuse_table_missing');
END;
$$;

-- ---------------------------------------------------------------------------
-- RPC: substituir registo (correcção — desactiva o antigo)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.supersede_knowledge_record(
  p_knowledge_id TEXT,
  p_superseded_by TEXT,
  p_deactivate BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_knowledge_id IS NULL OR trim(p_knowledge_id) = ''
     OR p_superseded_by IS NULL OR trim(p_superseded_by) = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_ids');
  END IF;

  UPDATE public.knowledge_records
  SET superseded_by = trim(p_superseded_by),
      is_active = CASE WHEN COALESCE(p_deactivate, true) THEN false ELSE is_active END,
      updated_at = now()
  WHERE knowledge_id = trim(p_knowledge_id);

  RETURN jsonb_build_object('ok', FOUND);
END;
$$;

-- ---------------------------------------------------------------------------
-- pick_knowledge_record — excluir substituídos + anti-reuso global
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
    AND kr.superseded_by IS NULL
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

  RETURN public.knowledge_record_to_json(v_row);
END;
$$;

-- ---------------------------------------------------------------------------
-- Permissões
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.get_knowledge_record(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_knowledge_record(TEXT) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.list_knowledge_records(INT, TEXT, TEXT, TEXT, TEXT, NUMERIC, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_knowledge_records(INT, TEXT, TEXT, TEXT, TEXT, NUMERIC, INT, INT) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.mark_knowledge_used(TEXT, TEXT, INT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_knowledge_used(TEXT, TEXT, INT, TEXT) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.supersede_knowledge_record(TEXT, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.supersede_knowledge_record(TEXT, TEXT, BOOLEAN) TO service_role;

REVOKE ALL ON FUNCTION public.pick_knowledge_record(INT, TEXT, TEXT, TEXT, TEXT, TEXT[], NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pick_knowledge_record(INT, TEXT, TEXT, TEXT, TEXT, TEXT[], NUMERIC) TO anon, authenticated;
