-- Impede re-enfileirar perguntas já revistas (aceites ou descartadas).
-- Executar no SQL Editor do Supabase após question-pending-review.sql.

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

  IF EXISTS (
    SELECT 1 FROM public.question_pending_review
    WHERE question_hash = p_question_hash
      AND status IN ('accepted', 'dismissed')
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_reviewed');
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

CREATE INDEX IF NOT EXISTS question_pending_review_hash_status_idx
  ON public.question_pending_review (question_hash, status);
