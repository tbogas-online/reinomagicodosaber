-- Apagar factos do repositório (admin) para permitir reimportação.
-- Remove knowledge_records, perguntas do banco com o mesmo knowledge_id e eventos de reuso.

CREATE OR REPLACE FUNCTION public.delete_knowledge_records(p_knowledge_ids TEXT[])
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids TEXT[];
  v_deleted INT := 0;
  v_bank INT := 0;
  v_reuse INT := 0;
BEGIN
  SELECT COALESCE(array_agg(DISTINCT trimmed), '{}'::TEXT[])
    INTO v_ids
  FROM (
    SELECT trim(id) AS trimmed
    FROM unnest(COALESCE(p_knowledge_ids, '{}'::TEXT[])) AS id
    WHERE trim(id) <> ''
  ) s;

  IF v_ids IS NULL OR cardinality(v_ids) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'deleted', 0, 'bankDeleted', 0, 'reuseDeleted', 0);
  END IF;

  IF to_regclass('public.question_reuse_events') IS NOT NULL THEN
    DELETE FROM public.question_reuse_events
    WHERE knowledge_id = ANY(v_ids);
    GET DIAGNOSTICS v_reuse = ROW_COUNT;
  END IF;

  DELETE FROM public.question_bank
  WHERE knowledge_id = ANY(v_ids);
  GET DIAGNOSTICS v_bank = ROW_COUNT;

  DELETE FROM public.knowledge_records
  WHERE knowledge_id = ANY(v_ids);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'deleted', v_deleted,
    'bankDeleted', v_bank,
    'reuseDeleted', v_reuse
  );
END;
$$;

REVOKE ALL ON FUNCTION public.delete_knowledge_records(TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_knowledge_records(TEXT[]) TO service_role;
