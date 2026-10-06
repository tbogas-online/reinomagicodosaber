-- Inventário do repositório: fonte, tópico, cronologia de importação e ligação ao banco.
-- CREATE OR REPLACE de get_knowledge_repository_stats() — a assinatura não muda.
-- byHour: últimas 24 h (Lisboa). byMinute: últimos 6 h em buckets de 5 min.

CREATE OR REPLACE FUNCTION public.get_knowledge_repository_stats()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total INT;
  v_active INT;
  v_inactive INT;
  v_by_category JSONB;
  v_by_source JSONB;
  v_by_source_topic JSONB;
  v_by_day JSONB;
  v_by_hour JSONB;
  v_by_minute JSONB;
  v_bank_linked JSONB;
  v_bank_by_knowledge_source JSONB;
BEGIN
  SELECT COUNT(*) INTO v_total FROM public.knowledge_records;
  SELECT COUNT(*) INTO v_active FROM public.knowledge_records WHERE is_active = true;
  v_inactive := COALESCE(v_total, 0) - COALESCE(v_active, 0);

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object('category_n', t.category_n, 'topic', t.topic, 'count', t.cnt)
    ORDER BY t.category_n, t.topic
  ), '[]'::jsonb)
  INTO v_by_category
  FROM (
    SELECT category_n, topic, COUNT(*)::INT AS cnt
    FROM public.knowledge_records
    WHERE is_active = true
    GROUP BY category_n, topic
  ) t;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'source', t.source,
      'count', t.active,
      'active', t.active,
      'inactive', t.inactive,
      'total', t.total
    ) ORDER BY t.active DESC, t.source
  ), '[]'::jsonb)
  INTO v_by_source
  FROM (
    SELECT
      source,
      COUNT(*) FILTER (WHERE is_active)::INT AS active,
      COUNT(*) FILTER (WHERE NOT is_active)::INT AS inactive,
      COUNT(*)::INT AS total
    FROM public.knowledge_records
    GROUP BY source
  ) t;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'source', t.source,
      'category_n', t.category_n,
      'topic', t.topic,
      'active', t.active,
      'inactive', t.inactive,
      'total', t.total
    ) ORDER BY t.active DESC, t.source, t.topic
  ), '[]'::jsonb)
  INTO v_by_source_topic
  FROM (
    SELECT
      source,
      category_n,
      topic,
      COUNT(*) FILTER (WHERE is_active)::INT AS active,
      COUNT(*) FILTER (WHERE NOT is_active)::INT AS inactive,
      COUNT(*)::INT AS total
    FROM public.knowledge_records
    GROUP BY source, category_n, topic
  ) t;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'day', to_char(t.day, 'YYYY-MM-DD'),
      'source', t.source,
      'count', t.cnt
    ) ORDER BY t.day, t.source
  ), '[]'::jsonb)
  INTO v_by_day
  FROM (
    SELECT
      (created_at AT TIME ZONE 'Europe/Lisbon')::date AS day,
      source,
      COUNT(*)::INT AS cnt
    FROM public.knowledge_records
    GROUP BY 1, 2
  ) t;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'hour', t.hour_key,
      'source', t.source,
      'count', t.cnt
    ) ORDER BY t.hour_key, t.source
  ), '[]'::jsonb)
  INTO v_by_hour
  FROM (
    SELECT
      to_char(
        date_trunc('hour', created_at AT TIME ZONE 'Europe/Lisbon'),
        'YYYY-MM-DD"T"HH24'
      ) AS hour_key,
      source,
      COUNT(*)::INT AS cnt
    FROM public.knowledge_records
    WHERE created_at >= now() - interval '24 hours'
    GROUP BY 1, 2
  ) t;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'minute', t.minute_key,
      'source', t.source,
      'count', t.cnt
    ) ORDER BY t.minute_key, t.source
  ), '[]'::jsonb)
  INTO v_by_minute
  FROM (
    SELECT
      to_char(
        date_bin(
          interval '5 minutes',
          created_at AT TIME ZONE 'Europe/Lisbon',
          timestamp '2000-01-01'
        ),
        'YYYY-MM-DD"T"HH24:MI'
      ) AS minute_key,
      source,
      COUNT(*)::INT AS cnt
    FROM public.knowledge_records
    WHERE created_at >= now() - interval '6 hours'
    GROUP BY 1, 2
  ) t;

  SELECT jsonb_build_object(
    'total', COUNT(*)::INT,
    'withKnowledgeId', COUNT(*) FILTER (
      WHERE knowledge_id IS NOT NULL AND btrim(knowledge_id) <> ''
    )::INT
  )
  INTO v_bank_linked
  FROM public.question_bank;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object('source', t.source, 'count', t.cnt)
    ORDER BY t.cnt DESC, t.source
  ), '[]'::jsonb)
  INTO v_bank_by_knowledge_source
  FROM (
    SELECT COALESCE(kr.source, '(facto removido)') AS source, COUNT(*)::INT AS cnt
    FROM public.question_bank qb
    LEFT JOIN public.knowledge_records kr ON kr.knowledge_id = qb.knowledge_id
    WHERE qb.knowledge_id IS NOT NULL AND btrim(qb.knowledge_id) <> ''
    GROUP BY 1
  ) t;

  RETURN jsonb_build_object(
    'total', v_total,
    'active', v_active,
    'inactive', v_inactive,
    'byCategoryTopic', v_by_category,
    'bySource', v_by_source,
    'bySourceTopic', v_by_source_topic,
    'byDay', v_by_day,
    'byHour', v_by_hour,
    'byMinute', v_by_minute,
    'bankLinked', v_bank_linked,
    'bankByKnowledgeSource', v_bank_by_knowledge_source
  );
END;
$$;
