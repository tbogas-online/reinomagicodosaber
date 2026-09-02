-- Knowledge Repository (Supabase) — factos verificados antes da IA
-- Executar no SQL Editor do Supabase APÓS question-bank.sql
--
-- Armazena conhecimento de fontes confiáveis. A IA só formula perguntas a partir destes registos.

-- ---------------------------------------------------------------------------
-- Tabela principal: factos verificados
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.knowledge_records (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  knowledge_id      TEXT NOT NULL UNIQUE,
  category_n        INT NOT NULL CHECK (category_n BETWEEN 1 AND 20),
  topic             TEXT NOT NULL,
  subtopic          TEXT,
  fact              TEXT NOT NULL,
  answer            TEXT NOT NULL,
  clues             JSONB NOT NULL DEFAULT '[]'::jsonb,
  statement         TEXT,
  is_true           BOOLEAN,
  source            TEXT NOT NULL,
  source_id         TEXT NOT NULL,
  source_url        TEXT,
  license           TEXT,
  confidence        NUMERIC(4, 3) NOT NULL DEFAULT 0.900
                    CHECK (confidence >= 0 AND confidence <= 1),
  priority_pt       INT CHECK (priority_pt IS NULL OR (priority_pt >= 0 AND priority_pt <= 100)),
  age_bands         TEXT[] NOT NULL DEFAULT ARRAY['6-9', '10-15', '15+']::TEXT[],
  allowed_formats   TEXT[] NOT NULL DEFAULT ARRAY['RESPOSTA_DIRETA']::TEXT[],
  tags              TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  verified_at       DATE,
  verified_by       TEXT,
  is_active         BOOLEAN NOT NULL DEFAULT true,
  superseded_by     TEXT,
  usage_count       INT NOT NULL DEFAULT 0,
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source, source_id)
);

CREATE INDEX IF NOT EXISTS knowledge_records_pick_idx
  ON public.knowledge_records (category_n, topic)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS knowledge_records_subtopic_idx
  ON public.knowledge_records (category_n, subtopic)
  WHERE is_active = true;

-- ---------------------------------------------------------------------------
-- Ligação ao question_bank (perguntas geradas a partir do repositório)
-- ---------------------------------------------------------------------------
ALTER TABLE public.question_bank
  ADD COLUMN IF NOT EXISTS knowledge_id TEXT,
  ADD COLUMN IF NOT EXISTS source_id TEXT,
  ADD COLUMN IF NOT EXISTS confidence NUMERIC(4, 3);

CREATE INDEX IF NOT EXISTS question_bank_knowledge_id_idx
  ON public.question_bank (knowledge_id)
  WHERE knowledge_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Helper: registo activo e adequado à faixa etária / formato
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.knowledge_record_matches_context(
  p_row public.knowledge_records,
  p_age_band TEXT,
  p_format TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF NOT p_row.is_active THEN
    RETURN FALSE;
  END IF;

  IF p_age_band IS NULL OR p_age_band = '' THEN
    RETURN FALSE;
  END IF;

  IF NOT (p_row.age_bands @> ARRAY[p_age_band]) THEN
    RETURN FALSE;
  END IF;

  IF p_format IS NOT NULL AND p_format <> ''
     AND NOT (p_row.allowed_formats @> ARRAY[p_format]) THEN
    RETURN FALSE;
  END IF;

  RETURN TRUE;
END;
$$;

-- ---------------------------------------------------------------------------
-- RPC: escolher um facto verificado (aleatório ponderado por priority_pt)
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

-- ---------------------------------------------------------------------------
-- RPC: importar lote de factos (scripts de curadoria / admin)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.import_knowledge_batch(p_items JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  item JSONB;
  v_upserted INT := 0;
  v_skipped INT := 0;
  v_rows INT;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RETURN jsonb_build_object('ok', false, 'upserted', 0, 'skipped', 0);
  END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    IF item->>'knowledge_id' IS NULL OR item->>'knowledge_id' = ''
       OR item->>'source' IS NULL OR item->>'source_id' IS NULL
       OR (item->>'category_n')::INT IS NULL
       OR (item->>'category_n')::INT NOT BETWEEN 1 AND 20
       OR length(trim(COALESCE(item->>'fact', ''))) = 0
       OR length(trim(COALESCE(item->>'answer', ''))) = 0
       OR length(trim(COALESCE(item->>'topic', ''))) = 0
    THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    INSERT INTO public.knowledge_records (
      knowledge_id, category_n, topic, subtopic, fact, answer, clues,
      statement, is_true, source, source_id, source_url, license,
      confidence, priority_pt, age_bands, allowed_formats, tags,
      verified_at, verified_by, metadata
    ) VALUES (
      item->>'knowledge_id',
      (item->>'category_n')::INT,
      item->>'topic',
      NULLIF(item->>'subtopic', ''),
      item->>'fact',
      item->>'answer',
      COALESCE(item->'clues', '[]'::jsonb),
      NULLIF(item->>'statement', ''),
      CASE WHEN item ? 'is_true' THEN (item->>'is_true')::BOOLEAN ELSE NULL END,
      item->>'source',
      item->>'source_id',
      NULLIF(item->>'source_url', ''),
      NULLIF(item->>'license', ''),
      COALESCE((item->>'confidence')::NUMERIC, 0.900),
      CASE WHEN item ? 'priority_pt' THEN (item->>'priority_pt')::INT ELSE NULL END,
      COALESCE(
        ARRAY(SELECT jsonb_array_elements_text(COALESCE(item->'age_bands', '["6-9","10-15","15+"]'::jsonb))),
        ARRAY['6-9', '10-15', '15+']::TEXT[]
      ),
      COALESCE(
        ARRAY(SELECT jsonb_array_elements_text(COALESCE(item->'allowed_formats', '["RESPOSTA_DIRETA"]'::jsonb))),
        ARRAY['RESPOSTA_DIRETA']::TEXT[]
      ),
      COALESCE(
        ARRAY(SELECT jsonb_array_elements_text(COALESCE(item->'tags', '[]'::jsonb))),
        '{}'::TEXT[]
      ),
      CASE WHEN item->>'verified_at' IS NOT NULL THEN (item->>'verified_at')::DATE ELSE NULL END,
      NULLIF(item->>'verified_by', ''),
      COALESCE(item->'metadata', '{}'::jsonb)
    )
    ON CONFLICT (knowledge_id) DO UPDATE SET
      category_n = EXCLUDED.category_n,
      topic = EXCLUDED.topic,
      subtopic = EXCLUDED.subtopic,
      fact = EXCLUDED.fact,
      answer = EXCLUDED.answer,
      clues = EXCLUDED.clues,
      statement = EXCLUDED.statement,
      is_true = EXCLUDED.is_true,
      source = EXCLUDED.source,
      source_id = EXCLUDED.source_id,
      source_url = EXCLUDED.source_url,
      license = EXCLUDED.license,
      confidence = EXCLUDED.confidence,
      priority_pt = EXCLUDED.priority_pt,
      age_bands = EXCLUDED.age_bands,
      allowed_formats = EXCLUDED.allowed_formats,
      tags = EXCLUDED.tags,
      verified_at = EXCLUDED.verified_at,
      verified_by = EXCLUDED.verified_by,
      metadata = EXCLUDED.metadata,
      updated_at = now();

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows > 0 THEN
      v_upserted := v_upserted + 1;
    ELSE
      v_skipped := v_skipped + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'upserted', v_upserted, 'skipped', v_skipped);
END;
$$;

-- ---------------------------------------------------------------------------
-- RPC: desactivar registo (ex.: após reporte)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.disable_knowledge_record(p_knowledge_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_knowledge_id IS NULL OR p_knowledge_id = '' THEN
    RETURN jsonb_build_object('ok', false);
  END IF;

  UPDATE public.knowledge_records
  SET is_active = false, updated_at = now()
  WHERE knowledge_id = p_knowledge_id AND is_active = true;

  RETURN jsonb_build_object('ok', FOUND);
END;
$$;

-- ---------------------------------------------------------------------------
-- RPC: estatísticas (admin — service role)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_knowledge_repository_stats()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total INT;
  v_active INT;
  v_by_category JSONB;
  v_by_source JSONB;
BEGIN
  SELECT COUNT(*) INTO v_total FROM public.knowledge_records;
  SELECT COUNT(*) INTO v_active FROM public.knowledge_records WHERE is_active = true;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object('category_n', t.category_n, 'topic', t.topic, 'count', t.cnt)
    ORDER BY t.category_n, t.topic
  ), '[]'::jsonb)
  INTO v_by_category
  FROM (
    SELECT category_n, topic, COUNT(*)::INT AS cnt
    FROM public.knowledge_records
    WHERE is_active = true
    GROUP BY category_n, topic
  ) t;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object('source', t.source, 'count', t.cnt) ORDER BY t.cnt DESC, t.source
  ), '[]'::jsonb)
  INTO v_by_source
  FROM (
    SELECT source, COUNT(*)::INT AS cnt
    FROM public.knowledge_records
    WHERE is_active = true
    GROUP BY source
  ) t;

  RETURN jsonb_build_object(
    'total', v_total,
    'active', v_active,
    'byCategoryTopic', v_by_category,
    'bySource', v_by_source
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- save_question_to_bank — acrescenta knowledge_id, source_id, confidence
-- (helper reino_cat20_bank_requires_knowledge_id: ver cat20-bank-knowledge-id-guard.sql)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.save_question_to_bank(INT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT);

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

  IF public.reino_cat20_bank_requires_knowledge_id(p_category_n, p_format)
     AND (p_knowledge_id IS NULL OR trim(p_knowledge_id) = '') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_knowledge_id');
  END IF;

  INSERT INTO public.question_bank (
    category_n, age_band, question, correct_answer,
    options, format, knowledge_key, question_hash, source,
    knowledge_id, source_id, confidence
  ) VALUES (
    p_category_n, p_age_band, p_question, p_correct_answer,
    p_options, p_format, p_knowledge_key, p_question_hash, COALESCE(p_source, 'ai'),
    NULLIF(p_knowledge_id, ''), NULLIF(p_source_id, ''), p_confidence
  );

  RETURN jsonb_build_object('ok', true, 'reason', 'inserted');
END;
$$;

-- ---------------------------------------------------------------------------
-- RLS e permissões
-- ---------------------------------------------------------------------------
ALTER TABLE public.knowledge_records ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.knowledge_records FROM PUBLIC;
GRANT SELECT ON TABLE public.knowledge_records TO service_role;

REVOKE ALL ON FUNCTION public.pick_knowledge_record(INT, TEXT, TEXT, TEXT, TEXT, TEXT[], NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pick_knowledge_record(INT, TEXT, TEXT, TEXT, TEXT, TEXT[], NUMERIC) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.import_knowledge_batch(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.import_knowledge_batch(JSONB) TO service_role;

REVOKE ALL ON FUNCTION public.disable_knowledge_record(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.disable_knowledge_record(TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.get_knowledge_repository_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_knowledge_repository_stats() TO service_role;

GRANT EXECUTE ON FUNCTION public.save_question_to_bank(INT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC) TO anon, authenticated;
