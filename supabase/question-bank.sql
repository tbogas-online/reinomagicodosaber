-- Banco de perguntas (Supabase) — perguntas geradas por IA
-- Executar no SQL Editor do Supabase após schema.sql
--
-- Perguntas reportadas ficam marcadas e deixam de ser devolvidas nem re-inseridas.

CREATE TABLE IF NOT EXISTS public.question_bank (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_n      INT NOT NULL CHECK (category_n BETWEEN 1 AND 12),
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
-- RPC: escolher pergunta aleatória (não reportada)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pick_question_from_bank(
  p_category_n INT,
  p_age_band TEXT,
  p_exclude_hashes TEXT[] DEFAULT '{}'::TEXT[]
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

GRANT EXECUTE ON FUNCTION public.pick_question_from_bank(INT, TEXT, TEXT[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_question_to_bank(INT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_question_reported(TEXT) TO anon, authenticated;
