-- Banco de perguntas (Supabase) — perguntas geradas por IA
-- Executar no SQL Editor do Supabase após schema.sql
--
-- Perguntas reportadas ficam marcadas e deixam de ser devolvidas nem re-inseridas.

CREATE TABLE IF NOT EXISTS public.question_bank (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_n      INT NOT NULL CHECK (category_n BETWEEN 1 AND 20),
  age_band        TEXT NOT NULL CHECK (age_band IN ('6-9', '10-15', '15+')),
  question        TEXT NOT NULL,
  correct_answer  TEXT NOT NULL,
  options         JSONB,
  format          TEXT,
  knowledge_key   TEXT,
  question_hash   TEXT NOT NULL UNIQUE,
  source          TEXT NOT NULL DEFAULT 'ai',
  is_reported     BOOLEAN NOT NULL DEFAULT false,
  reported_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS question_bank_pick_idx
  ON public.question_bank (category_n, age_band)
  WHERE is_reported = false;

-- Hashes bloqueados por reporte (mesmo que a pergunta nunca tenha sido guardada)
CREATE TABLE IF NOT EXISTS public.question_bank_blocked (
  question_hash   TEXT PRIMARY KEY,
  reported_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.question_bank ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.question_bank_blocked ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Helper: opções válidas para escolha múltipla (2 = V/F, 4 = MC normal)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reino_has_valid_mc_options(
  p_options JSONB,
  p_format TEXT,
  p_correct_answer TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_len INT;
  v_expected INT;
  v_norm TEXT;
BEGIN
  IF p_options IS NULL OR jsonb_typeof(p_options) <> 'array' THEN
    RETURN FALSE;
  END IF;

  v_len := jsonb_array_length(p_options);
  IF v_len < 2 THEN
    RETURN FALSE;
  END IF;

  v_norm := lower(trim(regexp_replace(COALESCE(p_correct_answer, ''), '<[^>]*>', '', 'gi')));
  IF COALESCE(p_format, '') IN ('VERDADEIRO_FALSO', 'CURIOSIDADE') THEN
    v_expected := 2;
    IF v_norm NOT IN ('verdadeiro', 'falso') THEN
      RETURN FALSE;
    END IF;
  ELSIF v_norm IN ('verdadeiro', 'falso') THEN
    v_expected := 2;
  ELSE
    v_expected := 4;
  END IF;

  IF v_len <> v_expected THEN
    RETURN FALSE;
  END IF;

  IF v_expected = 2 THEN
    RETURN EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(p_options) AS opt(val)
      WHERE lower(trim(regexp_replace(val, '<[^>]*>', '', 'gi'))) = 'verdadeiro'
    ) AND EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(p_options) AS opt(val)
      WHERE lower(trim(regexp_replace(val, '<[^>]*>', '', 'gi'))) = 'falso'
    );
  END IF;

  RETURN TRUE;
END;
$$;

-- ---------------------------------------------------------------------------
-- RPC: escolher pergunta aleatória (não reportada, com opções válidas)
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
    AND public.reino_has_valid_mc_options(qb.options, qb.format, qb.correct_answer)
  ORDER BY random()
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'q', v_row.question,
    'a', v_row.correct_answer,
    'options', v_row.options,
    'format', v_row.format,
    'knowledge_key', v_row.knowledge_key,
    'knowledge_id', v_row.knowledge_id,
    'question_hash', v_row.question_hash,
    'source', 'bank'
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- RPC: guardar pergunta validada (ignora se já existir ou estiver reportada)
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
  p_source TEXT DEFAULT 'ai'
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

  INSERT INTO public.question_bank (
    category_n, age_band, question, correct_answer,
    options, format, knowledge_key, question_hash, source
  ) VALUES (
    p_category_n, p_age_band, p_question, p_correct_answer,
    p_options, p_format, p_knowledge_key, p_question_hash, COALESCE(p_source, 'ai')
  );

  RETURN jsonb_build_object('ok', true, 'reason', 'inserted');
END;
$$;

-- ---------------------------------------------------------------------------
-- RPC: marcar pergunta como reportada (deixa de ser usada / guardada)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_question_reported(p_question_hash TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_question_hash IS NULL OR p_question_hash = '' THEN
    RETURN jsonb_build_object('ok', false);
  END IF;

  INSERT INTO public.question_bank_blocked (question_hash)
  VALUES (p_question_hash)
  ON CONFLICT (question_hash) DO NOTHING;

  UPDATE public.question_bank
  SET is_reported = true, reported_at = now()
  WHERE question_hash = p_question_hash AND is_reported = false;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ---------------------------------------------------------------------------
-- RPC: importar várias perguntas (ex.: histórico localStorage no browser)
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
  v_inserted INT := 0;
  v_exists INT := 0;
  v_skipped INT := 0;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RETURN jsonb_build_object('ok', false, 'inserted', 0, 'exists', 0, 'skipped', 0);
  END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_hash := item->>'question_hash';
    IF v_hash IS NULL OR v_hash = '' THEN
      v_skipped := v_skipped + 1;
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

    IF (item->>'category_n')::INT IS NULL
      OR (item->>'category_n')::INT NOT BETWEEN 1 AND 20
      OR item->>'age_band' IS NULL
      OR item->>'age_band' NOT IN ('6-9', '10-15', '15+')
      OR length(trim(COALESCE(item->>'question', ''))) = 0
      OR length(trim(COALESCE(item->>'correct_answer', ''))) = 0
      OR NOT public.reino_has_valid_mc_options(
        item->'options',
        NULLIF(item->>'format', ''),
        item->>'correct_answer'
      )
    THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    INSERT INTO public.question_bank (
      category_n, age_band, question, correct_answer,
      options, format, knowledge_key, question_hash, source
    ) VALUES (
      (item->>'category_n')::INT,
      item->>'age_band',
      item->>'question',
      item->>'correct_answer',
      item->'options',
      NULLIF(item->>'format', ''),
      NULLIF(item->>'knowledge_key', ''),
      v_hash,
      COALESCE(NULLIF(item->>'source', ''), 'local')
    );
    v_inserted := v_inserted + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'inserted', v_inserted, 'exists', v_exists, 'skipped', v_skipped);
END;
$$;

-- ---------------------------------------------------------------------------
-- RPC: estatísticas do banco (painel admin — service role)
-- ---------------------------------------------------------------------------
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
    SELECT category_n, age_band, COUNT(*)::INT AS cnt
    FROM public.question_bank qb
    WHERE qb.is_reported = false
      AND public.reino_has_valid_mc_options(qb.options, qb.format, qb.correct_answer)
    GROUP BY category_n, age_band
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

-- ---------------------------------------------------------------------------
-- RPC: remover perguntas activas sem opções válidas (admin)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.purge_question_bank_without_options()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted INT;
BEGIN
  DELETE FROM public.question_bank qb
  WHERE qb.is_reported = false
    AND NOT public.reino_has_valid_mc_options(qb.options, qb.format, qb.correct_answer);

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'deleted', v_deleted);
END;
$$;

-- ---------------------------------------------------------------------------
-- RPC: cobertura por categoria/faixa (cliente — teste de perguntas)
-- ---------------------------------------------------------------------------
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
      SELECT qb.category_n, qb.age_band, COUNT(*)::INT AS cnt
      FROM public.question_bank qb
      WHERE qb.is_reported = false
        AND public.reino_has_valid_mc_options(qb.options, qb.format, qb.correct_answer)
      GROUP BY qb.category_n, qb.age_band
    ) t
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.get_question_bank_coverage() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_question_bank_coverage() TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- RPC: apagar perguntas do banco (admin) — ver também question-bank-delete.sql
-- ---------------------------------------------------------------------------
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

REVOKE ALL ON FUNCTION public.get_question_bank_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_question_bank_stats() TO service_role;
REVOKE ALL ON FUNCTION public.purge_question_bank_without_options() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_question_bank_without_options() TO service_role;
REVOKE ALL ON FUNCTION public.delete_questions_from_bank(TEXT[], BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_questions_from_bank(TEXT[], BOOLEAN) TO service_role;

GRANT EXECUTE ON FUNCTION public.pick_question_from_bank(INT, TEXT, TEXT[], TEXT[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_question_to_bank(INT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_question_reported(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.import_questions_batch(JSONB) TO anon, authenticated;
