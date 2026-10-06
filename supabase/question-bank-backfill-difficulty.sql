-- Preenche dificuldade em falta no banco (reduz s/n nas estatísticas).
-- Executar no SQL Editor do Supabase após question-bank-save-difficulty-meta.sql.
-- Seguro repetir: só actualiza linhas com difficulty NULL.

-- 1) Copiar estimada → pedida quando só a estimada existe
UPDATE public.question_bank
SET difficulty = estimated_difficulty
WHERE difficulty IS NULL
  AND estimated_difficulty BETWEEN 1 AND 5
  AND is_reported = false;

-- 2) Preencher difficulty_by_age_band a partir de difficulty + age_band principal
UPDATE public.question_bank qb
SET difficulty_by_age_band = jsonb_build_object(qb.age_band, qb.difficulty)
WHERE qb.difficulty BETWEEN 1 AND 5
  AND qb.age_band IN ('6-9', '10-15', '15+')
  AND (qb.difficulty_by_age_band IS NULL OR qb.difficulty_by_age_band = '{}'::jsonb)
  AND qb.is_reported = false;

-- 3) Multi-faixa: repetir difficulty global em cada faixa listada em age_bands
UPDATE public.question_bank qb
SET difficulty_by_age_band = (
  SELECT COALESCE(jsonb_object_agg(age_b, qb.difficulty), '{}'::jsonb)
  FROM unnest(
    CASE
      WHEN qb.age_bands IS NOT NULL AND cardinality(qb.age_bands) > 0 THEN qb.age_bands
      ELSE ARRAY[qb.age_band]
    END
  ) AS age_b
  WHERE age_b IN ('6-9', '10-15', '15+')
)
WHERE qb.difficulty BETWEEN 1 AND 5
  AND (qb.difficulty_by_age_band IS NULL OR qb.difficulty_by_age_band = '{}'::jsonb)
  AND qb.is_reported = false
  AND (
    qb.age_bands IS NOT NULL AND cardinality(qb.age_bands) > 0
    OR qb.age_band IN ('6-9', '10-15', '15+')
  );
