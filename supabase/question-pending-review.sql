-- Fila de revisão manual — perguntas com dificuldade errada (ou outras rejeições só de dificuldade).
-- Executar no SQL Editor do Supabase.

CREATE TABLE IF NOT EXISTS public.question_pending_review (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  status                TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'accepted', 'dismissed')),
  reviewed_at           TIMESTAMPTZ,
  question_hash         TEXT NOT NULL,
  category_n            SMALLINT,
  age_band              TEXT,
  format_id             TEXT,
  requested_difficulty  SMALLINT,
  estimated_difficulty  SMALLINT,
  question              TEXT NOT NULL,
  correct_answer        TEXT NOT NULL,
  options               JSONB,
  issue_codes           TEXT[] NOT NULL DEFAULT '{}',
  knowledge_key         TEXT,
  knowledge_id          TEXT,
  source                TEXT,
  source_id             TEXT,
  confidence            NUMERIC,
  game_mode             TEXT DEFAULT 'local'
);

CREATE INDEX IF NOT EXISTS question_pending_review_status_idx
  ON public.question_pending_review (status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS question_pending_review_pending_hash_uidx
  ON public.question_pending_review (question_hash)
  WHERE status = 'pending';

ALTER TABLE public.question_pending_review ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- RPC: enfileirar pergunta para revisão (cliente anon — mesmo modelo do banco)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.queue_question_pending_review(
  p_question_hash TEXT,
  p_category_n INT,
  p_age_band TEXT,
  p_question TEXT,
  p_correct_answer TEXT,
  p_options JSONB DEFAULT NULL,
  p_format_id TEXT DEFAULT NULL,
  p_requested_difficulty SMALLINT DEFAULT NULL,
  p_estimated_difficulty SMALLINT DEFAULT NULL,
  p_issue_codes TEXT[] DEFAULT '{}',
  p_knowledge_key TEXT DEFAULT NULL,
  p_knowledge_id TEXT DEFAULT NULL,
  p_source TEXT DEFAULT NULL,
  p_source_id TEXT DEFAULT NULL,
  p_confidence NUMERIC DEFAULT NULL,
  p_game_mode TEXT DEFAULT 'local'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF p_question_hash IS NULL OR trim(p_question_hash) = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_hash');
  END IF;
  IF p_question IS NULL OR trim(p_question) = '' OR p_correct_answer IS NULL OR trim(p_correct_answer) = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_content');
  END IF;

  IF EXISTS (SELECT 1 FROM public.question_bank_blocked WHERE question_hash = p_question_hash) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'reported');
  END IF;

  SELECT id INTO v_id
  FROM public.question_pending_review
  WHERE question_hash = p_question_hash AND status = 'pending';

  IF FOUND THEN
    UPDATE public.question_pending_review
    SET
      created_at = now(),
      category_n = p_category_n,
      age_band = NULLIF(trim(p_age_band), ''),
      format_id = NULLIF(trim(p_format_id), ''),
      requested_difficulty = p_requested_difficulty,
      estimated_difficulty = p_estimated_difficulty,
      question = p_question,
      correct_answer = p_correct_answer,
      options = p_options,
      issue_codes = COALESCE(p_issue_codes, '{}'),
      knowledge_key = NULLIF(trim(p_knowledge_key), ''),
      knowledge_id = NULLIF(trim(p_knowledge_id), ''),
      source = NULLIF(trim(p_source), ''),
      source_id = NULLIF(trim(p_source_id), ''),
      confidence = p_confidence,
      game_mode = COALESCE(NULLIF(trim(p_game_mode), ''), 'local')
    WHERE id = v_id;
    RETURN jsonb_build_object('ok', true, 'reason', 'updated', 'id', v_id);
  END IF;

  INSERT INTO public.question_pending_review (
    question_hash, category_n, age_band, format_id,
    requested_difficulty, estimated_difficulty,
    question, correct_answer, options, issue_codes,
    knowledge_key, knowledge_id, source, source_id, confidence, game_mode
  ) VALUES (
    p_question_hash, p_category_n, NULLIF(trim(p_age_band), ''), NULLIF(trim(p_format_id), ''),
    p_requested_difficulty, p_estimated_difficulty,
    p_question, p_correct_answer, p_options, COALESCE(p_issue_codes, '{}'),
    NULLIF(trim(p_knowledge_key), ''), NULLIF(trim(p_knowledge_id), ''),
    NULLIF(trim(p_source), ''), NULLIF(trim(p_source_id), ''),
    p_confidence, COALESCE(NULLIF(trim(p_game_mode), ''), 'local')
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'reason', 'inserted', 'id', v_id);
END;
$$;

REVOKE ALL ON FUNCTION public.queue_question_pending_review(
  TEXT, INT, TEXT, TEXT, TEXT, JSONB, TEXT, SMALLINT, SMALLINT, TEXT[], TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.queue_question_pending_review(
  TEXT, INT, TEXT, TEXT, TEXT, JSONB, TEXT, SMALLINT, SMALLINT, TEXT[], TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT
) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- Estatísticas da fila de revisão (painel admin)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_question_pending_review_stats()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'available', true,
    'pending', (SELECT COUNT(*)::int FROM public.question_pending_review WHERE status = 'pending'),
    'accepted', (SELECT COUNT(*)::int FROM public.question_pending_review WHERE status = 'accepted'),
    'dismissed', (SELECT COUNT(*)::int FROM public.question_pending_review WHERE status = 'dismissed'),
    'queuedLast7d', (
      SELECT COUNT(*)::int FROM public.question_pending_review
      WHERE created_at >= now() - interval '7 days'
    ),
    'acceptedLast7d', (
      SELECT COUNT(*)::int FROM public.question_pending_review
      WHERE status = 'accepted' AND reviewed_at >= now() - interval '7 days'
    ),
    'dismissedLast7d', (
      SELECT COUNT(*)::int FROM public.question_pending_review
      WHERE status = 'dismissed' AND reviewed_at >= now() - interval '7 days'
    )
  );
$$;

REVOKE ALL ON FUNCTION public.get_question_pending_review_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_question_pending_review_stats() TO service_role;
