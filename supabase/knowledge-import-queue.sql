-- Fila de importação diária do Knowledge Repository
-- Executar APÓS knowledge-repository.sql

CREATE TABLE IF NOT EXISTS public.knowledge_import_queue (
  queue_id     TEXT PRIMARY KEY,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'imported')),
  record       JSONB NOT NULL,
  imported_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.knowledge_import_state (
  singleton      BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
  last_run_date  DATE,
  runs           JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.knowledge_import_state (singleton, last_run_date, runs)
VALUES (true, NULL, '[]'::jsonb)
ON CONFLICT (singleton) DO NOTHING;

CREATE INDEX IF NOT EXISTS knowledge_import_queue_status_idx
  ON public.knowledge_import_queue (status);

-- Sincroniza itens da fila (upsert por queue_id; não repõe imported → pending)
CREATE OR REPLACE FUNCTION public.sync_knowledge_import_queue(p_items JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  item JSONB;
  v_upserted INT := 0;
  v_skipped INT := 0;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RETURN jsonb_build_object('ok', false, 'upserted', 0, 'skipped', 0);
  END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    IF item->>'queue_id' IS NULL OR item->>'queue_id' = ''
       OR item->'record' IS NULL OR jsonb_typeof(item->'record') <> 'object'
    THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    INSERT INTO public.knowledge_import_queue (queue_id, status, record, imported_at)
    VALUES (
      item->>'queue_id',
      COALESCE(NULLIF(item->>'status', ''), 'pending'),
      item->'record',
      CASE WHEN item->>'imported_at' IS NOT NULL THEN (item->>'imported_at')::timestamptz ELSE NULL END
    )
    ON CONFLICT (queue_id) DO UPDATE SET
      record = EXCLUDED.record,
      updated_at = now()
    WHERE knowledge_import_queue.status = 'pending';

    IF FOUND THEN
      v_upserted := v_upserted + 1;
    ELSE
      v_skipped := v_skipped + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'upserted', v_upserted, 'skipped', v_skipped);
END;
$$;

CREATE OR REPLACE FUNCTION public.reset_knowledge_import_queue()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT;
BEGIN
  UPDATE public.knowledge_import_queue
  SET status = 'pending', imported_at = NULL, updated_at = now()
  WHERE status = 'imported';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'reset', v_count);
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_knowledge_import_queue_imported(
  p_queue_ids TEXT[],
  p_imported_at TIMESTAMPTZ DEFAULT now()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT;
BEGIN
  UPDATE public.knowledge_import_queue
  SET status = 'imported',
      imported_at = COALESCE(p_imported_at, now()),
      updated_at = now()
  WHERE queue_id = ANY(p_queue_ids);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'marked', v_count);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_knowledge_import_dashboard()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_state public.knowledge_import_state%ROWTYPE;
  v_total INT;
  v_pending INT;
  v_imported INT;
  v_preview JSONB;
BEGIN
  SELECT * INTO v_state FROM public.knowledge_import_state WHERE singleton = true;

  SELECT COUNT(*) INTO v_total FROM public.knowledge_import_queue;
  SELECT COUNT(*) INTO v_pending FROM public.knowledge_import_queue WHERE status = 'pending';
  SELECT COUNT(*) INTO v_imported FROM public.knowledge_import_queue WHERE status = 'imported';

  SELECT COALESCE(jsonb_agg(row_to_json(preview)), '[]'::jsonb)
    INTO v_preview
  FROM (
    SELECT
      q.queue_id AS "queueId",
      q.record->>'knowledge_id' AS "knowledgeId",
      q.record->>'topic' AS topic,
      q.record->'age_bands' AS "ageBands"
    FROM public.knowledge_import_queue q
    WHERE q.status = 'pending'
    ORDER BY q.created_at
    LIMIT 12
  ) preview;

  RETURN jsonb_build_object(
    'summary', jsonb_build_object('total', v_total, 'pending', v_pending, 'imported', v_imported),
    'state', jsonb_build_object(
      'lastRunDate', v_state.last_run_date,
      'runs', COALESCE(v_state.runs, '[]'::jsonb)
    ),
    'lastRun', COALESCE(v_state.runs->0, 'null'::jsonb),
    'pendingPreview', v_preview
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.touch_knowledge_import_state(
  p_last_run_date DATE,
  p_run JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_runs JSONB;
BEGIN
  SELECT runs INTO v_runs FROM public.knowledge_import_state WHERE singleton = true;
  v_runs := jsonb_build_array(p_run) || COALESCE(v_runs, '[]'::jsonb);
  v_runs := (
    SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
    FROM (
      SELECT elem FROM jsonb_array_elements(v_runs) WITH ORDINALITY AS t(elem, ord)
      ORDER BY ord
      LIMIT 30
    ) s
  );

  UPDATE public.knowledge_import_state
  SET last_run_date = p_last_run_date,
      runs = v_runs,
      updated_at = now()
  WHERE singleton = true;

  RETURN jsonb_build_object('ok', true, 'lastRunDate', p_last_run_date);
END;
$$;

ALTER TABLE public.knowledge_import_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_import_state ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.knowledge_import_queue FROM PUBLIC;
REVOKE ALL ON TABLE public.knowledge_import_state FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.knowledge_import_queue TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.knowledge_import_state TO service_role;

REVOKE ALL ON FUNCTION public.sync_knowledge_import_queue(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reset_knowledge_import_queue() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_knowledge_import_queue_imported(TEXT[], TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_knowledge_import_dashboard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.touch_knowledge_import_state(DATE, JSONB) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.sync_knowledge_import_queue(JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.reset_knowledge_import_queue() TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_knowledge_import_queue_imported(TEXT[], TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_knowledge_import_dashboard() TO service_role;
GRANT EXECUTE ON FUNCTION public.touch_knowledge_import_state(DATE, JSONB) TO service_role;
