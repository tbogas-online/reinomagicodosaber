-- Memória das rejeições na curadoria de importação (Wikidata e outras fontes).
-- Executar no SQL Editor do Supabase (ou via admin após deploy).
-- Sem políticas públicas: só service_role.

CREATE TABLE IF NOT EXISTS public.knowledge_import_rejections (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  knowledge_id  TEXT NOT NULL UNIQUE,
  source        TEXT,
  source_id     TEXT,
  qid           TEXT,
  fact_key      TEXT,
  fact_hash     TEXT,
  answer_hash   TEXT,
  category_n    INT,
  topic         TEXT,
  fact          TEXT,
  answer        TEXT,
  rejected_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS knowledge_import_rejections_qid_idx
  ON public.knowledge_import_rejections (qid)
  WHERE qid IS NOT NULL;

CREATE INDEX IF NOT EXISTS knowledge_import_rejections_source_idx
  ON public.knowledge_import_rejections (source, source_id)
  WHERE source_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS knowledge_import_rejections_fact_hash_idx
  ON public.knowledge_import_rejections (fact_hash)
  WHERE fact_hash IS NOT NULL;

ALTER TABLE public.knowledge_import_rejections ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.knowledge_import_rejections FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.knowledge_import_rejections TO service_role;

NOTIFY pgrst, 'reload schema';
