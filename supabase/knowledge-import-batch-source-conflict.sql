-- Correcção: import_knowledge_batch não pode falhar no UNIQUE (source, source_id).
-- O upsert só tratava knowledge_id; dois factos Wikidata do mesmo Q-id (V e F)
-- partilhavam source_id e abortavam o lote.
-- Executar no SQL Editor do Supabase (CREATE OR REPLACE).

CREATE OR REPLACE FUNCTION public.import_knowledge_batch(p_items JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  item JSONB;
  v_upserted INT := 0;
  v_skipped INT := 0;
  v_rows INT;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RETURN jsonb_build_object('ok', false, 'upserted', 0, 'skipped', 0);
  END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    IF item->>'knowledge_id' IS NULL OR item->>'knowledge_id' = ''
       OR item->>'source' IS NULL OR item->>'source_id' IS NULL
       OR (item->>'category_n')::INT IS NULL
       OR (item->>'category_n')::INT NOT BETWEEN 1 AND 20
       OR length(trim(COALESCE(item->>'fact', ''))) = 0
       OR length(trim(COALESCE(item->>'answer', ''))) = 0
       OR length(trim(COALESCE(item->>'topic', ''))) = 0
    THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    BEGIN
      INSERT INTO public.knowledge_records (
        knowledge_id, category_n, topic, subtopic, fact, answer, clues,
        statement, is_true, source, source_id, source_url, license,
        confidence, priority_pt, age_bands, allowed_formats, tags,
        verified_at, verified_by, metadata
      ) VALUES (
        item->>'knowledge_id',
        (item->>'category_n')::INT,
        item->>'topic',
        NULLIF(item->>'subtopic', ''),
        item->>'fact',
        item->>'answer',
        COALESCE(item->'clues', '[]'::jsonb),
        NULLIF(item->>'statement', ''),
        CASE WHEN item ? 'is_true' THEN (item->>'is_true')::BOOLEAN ELSE NULL END,
        item->>'source',
        item->>'source_id',
        NULLIF(item->>'source_url', ''),
        NULLIF(item->>'license', ''),
        COALESCE((item->>'confidence')::NUMERIC, 0.900),
        CASE WHEN item ? 'priority_pt' THEN (item->>'priority_pt')::INT ELSE NULL END,
        COALESCE(
          ARRAY(SELECT jsonb_array_elements_text(COALESCE(item->'age_bands', '["6-9","10-15","15+"]'::jsonb))),
          ARRAY['6-9', '10-15', '15+']::TEXT[]
        ),
        COALESCE(
          ARRAY(SELECT jsonb_array_elements_text(COALESCE(item->'allowed_formats', '["RESPOSTA_DIRETA"]'::jsonb))),
          ARRAY['RESPOSTA_DIRETA']::TEXT[]
        ),
        COALESCE(
          ARRAY(SELECT jsonb_array_elements_text(COALESCE(item->'tags', '[]'::jsonb))),
          '{}'::TEXT[]
        ),
        CASE WHEN item->>'verified_at' IS NOT NULL THEN (item->>'verified_at')::DATE ELSE NULL END,
        NULLIF(item->>'verified_by', ''),
        COALESCE(item->'metadata', '{}'::jsonb)
      )
      ON CONFLICT (knowledge_id) DO UPDATE SET
        category_n = EXCLUDED.category_n,
        topic = EXCLUDED.topic,
        subtopic = EXCLUDED.subtopic,
        fact = EXCLUDED.fact,
        answer = EXCLUDED.answer,
        clues = EXCLUDED.clues,
        statement = EXCLUDED.statement,
        is_true = EXCLUDED.is_true,
        source = EXCLUDED.source,
        source_id = EXCLUDED.source_id,
        source_url = EXCLUDED.source_url,
        license = EXCLUDED.license,
        confidence = EXCLUDED.confidence,
        priority_pt = EXCLUDED.priority_pt,
        age_bands = EXCLUDED.age_bands,
        allowed_formats = EXCLUDED.allowed_formats,
        tags = EXCLUDED.tags,
        verified_at = EXCLUDED.verified_at,
        verified_by = EXCLUDED.verified_by,
        metadata = EXCLUDED.metadata,
        updated_at = now();

      GET DIAGNOSTICS v_rows = ROW_COUNT;
      IF v_rows > 0 THEN
        v_upserted := v_upserted + 1;
      ELSE
        v_skipped := v_skipped + 1;
      END IF;
    EXCEPTION
      WHEN unique_violation THEN
        -- UNIQUE (source, source_id) com knowledge_id diferente: não sobrescrever o facto já gravado.
        v_skipped := v_skipped + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'upserted', v_upserted, 'skipped', v_skipped);
END;
$$;

REVOKE ALL ON FUNCTION public.import_knowledge_batch(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.import_knowledge_batch(JSONB) TO service_role;
