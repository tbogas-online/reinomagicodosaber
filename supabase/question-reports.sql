-- Reportes de perguntas — armazenamento principal (substitui Netlify Blobs)
-- Executar no SQL Editor do Supabase após schema.sql
--
-- Escrita/leitura apenas via Netlify Functions (service_role). Sem políticas RLS públicas.

CREATE TABLE IF NOT EXISTS public.question_reports (
  report_id             TEXT PRIMARY KEY,
  received_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  status                TEXT NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open', 'resolved', 'cancelled')),
  resolved_at           TIMESTAMPTZ,
  resolved_at_portugal  TEXT,
  cancelled_at          TIMESTAMPTZ,
  issue_type            TEXT NOT NULL,
  issue_label           TEXT,
  age_band              TEXT,
  category_name         TEXT,
  category_n            SMALLINT,
  reporter_id           TEXT,
  device_type           TEXT,
  question_hash         TEXT,
  knowledge_id          TEXT,
  question_text         TEXT,
  comment               TEXT,
  suggestion            TEXT,
  payload               JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS question_reports_received_idx
  ON public.question_reports (received_at DESC);

CREATE INDEX IF NOT EXISTS question_reports_status_idx
  ON public.question_reports (status, received_at DESC);

CREATE INDEX IF NOT EXISTS question_reports_issue_idx
  ON public.question_reports (issue_type, received_at DESC);

CREATE INDEX IF NOT EXISTS question_reports_reporter_idx
  ON public.question_reports (reporter_id)
  WHERE reporter_id IS NOT NULL AND reporter_id <> '';

CREATE INDEX IF NOT EXISTS question_reports_hash_idx
  ON public.question_reports (question_hash)
  WHERE question_hash IS NOT NULL AND question_hash <> '';

CREATE INDEX IF NOT EXISTS question_reports_search_idx
  ON public.question_reports
  USING gin (
    to_tsvector(
      'simple',
      coalesce(question_text, '') || ' ' ||
      coalesce(comment, '') || ' ' ||
      coalesce(suggestion, '') || ' ' ||
      coalesce(report_id, '')
    )
  );

ALTER TABLE public.question_reports ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Manutenção: manter no máximo N reportes (os mais recentes)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trim_question_reports(p_max INT DEFAULT 2000)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted INT := 0;
BEGIN
  IF p_max IS NULL OR p_max < 1 THEN
    RETURN 0;
  END IF;

  WITH ranked AS (
    SELECT report_id
    FROM public.question_reports
    ORDER BY received_at DESC
    OFFSET p_max
  )
  DELETE FROM public.question_reports r
  USING ranked x
  WHERE r.report_id = x.report_id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;
