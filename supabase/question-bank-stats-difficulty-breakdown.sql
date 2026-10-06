-- Estatísticas do banco com contagem por dificuldade (categoria × faixa × nível).
-- Executar no SQL Editor do Supabase após question-bank-multi-taxonomy.sql
-- e question-bank-pick-difficulty-tolerance.sql (reino_bank_effective_difficulty).

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
  v_by_category_age_difficulty JSONB;
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
    jsonb_build_object(
      'category_n', t.category_n,
      'age_band', t.age_band,
      'difficulty', t.difficulty,
      'count', t.cnt
    ) ORDER BY t.category_n, t.age_band, t.difficulty
  ), '[]'::jsonb)
  INTO v_by_category_age_difficulty
  FROM (
    SELECT
      cat_n AS category_n,
      age_b AS age_band,
      COALESCE(public.reino_bank_effective_difficulty(qb, age_b), 0)::INT AS difficulty,
      COUNT(*)::INT AS cnt
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
    GROUP BY cat_n, age_b, COALESCE(public.reino_bank_effective_difficulty(qb, age_b), 0)
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
    'byCategoryAgeDifficulty', v_by_category_age_difficulty,
    'bySource', v_by_source
  );
END;
$$;
