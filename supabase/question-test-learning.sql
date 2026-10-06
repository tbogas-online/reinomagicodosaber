-- Resultados de teste de perguntas + regras aprendidas (input do gerador).
-- Executar no SQL Editor do Supabase. Sem políticas públicas: só service role.

CREATE TABLE IF NOT EXISTS public.question_test_results (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  session_id      TEXT,
  tester          TEXT,
  engine_version  TEXT,
  result_id       TEXT,
  category        TEXT,
  age_band_key    TEXT,
  format_id       TEXT,
  rating          SMALLINT,
  verdict         TEXT,
  issues          TEXT[],
  payload         JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS question_test_results_created_idx
  ON public.question_test_results (created_at DESC);
CREATE INDEX IF NOT EXISTS question_test_results_scope_idx
  ON public.question_test_results (age_band_key, category, format_id);
CREATE INDEX IF NOT EXISTS question_test_results_verdict_idx
  ON public.question_test_results (verdict, rating);

ALTER TABLE public.question_test_results ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.question_learning_rules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  rule_key        TEXT NOT NULL UNIQUE,
  scope           JSONB NOT NULL DEFAULT '{}'::jsonb,
  type            TEXT NOT NULL,
  rule_text       TEXT NOT NULL,
  confidence      REAL NOT NULL DEFAULT 0,
  evidence        INTEGER NOT NULL DEFAULT 0,
  active          BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS question_learning_rules_active_idx
  ON public.question_learning_rules (active, confidence DESC);

ALTER TABLE public.question_learning_rules ENABLE ROW LEVEL SECURITY;
